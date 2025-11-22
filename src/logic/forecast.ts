// src/logic/forecast.ts

export type PlanResult = {
  /** 基準となる年間ターゲット回数（パターンの目安。実際の1年分とは多少ズレることあり） */
  targetYearCount: number;
  /** 月別の回数パターン（index 0 = 1月, 11 = 12月） */
  monthlyCounts: number[];
  /** 実際に使う予測配送日（startFromYmd から horizonDays までの範囲で生成） */
  plannedDates: string[];
};

type YearlyCount = {
  year: number;
  count: number;
};

const ISO_YMD = /^\d{4}-\d{2}-\d{2}$/;

function jstYmdFromDate(d: Date): string {
  const j = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return j.toISOString().slice(0, 10);
}
function parseYmd(ymd: string): Date {
  return new Date(`${ymd}T00:00:00+09:00`);
}
function addDaysYmd(ymd: string, days: number): string {
  const d = parseYmd(ymd);
  d.setDate(d.getDate() + days);
  return jstYmdFromDate(d);
}

/**
 * 1. 履歴を年ごとに分解する
 */
export function splitHistoryByYear(
  historyDates: string[],
  baseYear: number,
  maxYearsBack: number
): Record<number, string[]> {
  const byYear: Record<number, string[]> = {};
  const minYear = baseYear - maxYearsBack;

  for (const d of historyDates) {
    if (!d || !ISO_YMD.test(d)) continue;
    const y = Number(d.slice(0, 4));
    if (!Number.isFinite(y)) continue;
    if (y > baseYear) continue;
    if (y < minYear) continue;
    if (!byYear[y]) byYear[y] = [];
    byYear[y].push(d);
  }

  for (const yStr of Object.keys(byYear)) {
    const y = Number(yStr);
    byYear[y].sort();
  }

  return byYear;
}

/**
 * 2. 年ごとの回数を出す
 */
export function calcYearlyCounts(byYear: Record<number, string[]>): YearlyCount[] {
  const out: YearlyCount[] = [];
  for (const [yStr, dates] of Object.entries(byYear)) {
    const y = Number(yStr);
    if (!Number.isFinite(y)) continue;
    out.push({ year: y, count: dates.length });
  }
  out.sort((a, b) => a.year - b.year);
  return out;
}

/**
 * 3. 目標回数（減りすぎ防止）を決める
 */
export function decideTargetYearCount(
  yearlyCounts: YearlyCount[],
  baseYear: number
): number {
  if (!yearlyCounts.length) return 0;

  const lastYearStat = yearlyCounts.find(y => y.year === baseYear);
  const lastYearCount = lastYearStat?.count ?? 0;

  if (lastYearCount <= 0) {
    const avg = yearlyCounts.reduce((sum, s) => sum + s.count, 0) / yearlyCounts.length;
    return Math.round(avg);
  }

  const avgPast =
    yearlyCounts.reduce((sum, s) => sum + s.count, 0) / yearlyCounts.length;

  let target = Math.round(avgPast);

  const minAllowed = Math.floor(lastYearCount * 0.85);
  const maxAllowed = Math.ceil(lastYearCount * 1.3);

  if (target < minAllowed) target = minAllowed;
  if (target > maxAllowed) target = maxAllowed;
  if (target <= 0) target = lastYearCount;

  return target;
}

/**
 * 4. 過去1年＋過去数年の月別比率を出す
 */
export function calcMonthlyWeights(
  byYear: Record<number, string[]>,
  baseYear: number,
  wLast: number = 0.7,
  wPast: number = 0.3
): number[] {
  const last = new Array<number>(12).fill(0);
  const past = new Array<number>(12).fill(0);

  for (const [yStr, dates] of Object.entries(byYear)) {
    const y = Number(yStr);
    if (!Number.isFinite(y)) continue;
    const targetArr = y === baseYear ? last : past;

    for (const d of dates) {
      if (!d || !ISO_YMD.test(d)) continue;
      const m = Number(d.slice(5, 7));
      if (!Number.isFinite(m) || m < 1 || m > 12) continue;
      targetArr[m - 1] += 1;
    }
  }

  const weights: number[] = new Array(12).fill(0);
  for (let i = 0; i < 12; i++) {
    weights[i] = wLast * last[i] + wPast * past[i];
  }

  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) {
    return new Array(12).fill(1 / 12);
  }

  return weights.map(w => w / sum);
}

/**
 * 5. 月別に回数を配分
 */
export function makeMonthlyTargets(
  targetYearCount: number,
  shares: number[]
): number[] {
  if (targetYearCount <= 0) {
    return new Array(12).fill(0);
  }

  const raw = shares.map(s => s * targetYearCount);
  let monthly = raw.map(x => Math.round(x));

  let diff = targetYearCount - monthly.reduce((a, b) => a + b, 0);

  let idx = 0;
  const limit = 12 * 3;
  while (diff !== 0 && idx < limit) {
    const i = idx % 12;
    if (diff > 0) {
      monthly[i] += 1;
      diff -= 1;
    } else if (diff < 0 && monthly[i] > 0) {
      monthly[i] -= 1;
      diff += 1;
    }
    idx++;
  }

  return monthly;
}

/**
 * 6. 月内で均等配置して日付を作る
 */
export function generateDatesForMonth(
  year: number,
  month: number,
  count: number
): string[] {
  if (count <= 0) return [];

  const daysInMonth = new Date(year, month, 0).getDate();
  const step = daysInMonth / count;

  const dates: string[] = [];
  for (let i = 0; i < count; i++) {
    const day = Math.round(i * step + step / 2);
    const d = Math.min(Math.max(day, 1), daysInMonth);
    const mm = String(month).padStart(2, '0');
    const dd = String(d).padStart(2, '0');
    dates.push(`${year}-${mm}-${dd}`);
  }

  return dates;
}

/**
 * 7. 履歴から「startFromYmd 以降 horizonDays 日分」の年間計画を作る公開API
 *
 * @param historyDates - 過去1〜数年分の配送日（YYYY-MM-DD）
 * @param baseYear     - 基準年（例: 2024 → 主に 2024年の実績を基にする）
 * @param startFromYmd - 予測開始日（例: 今日）。省略時は baseYear+1 年の 1/1。
 * @param horizonDays  - 何日先まで作るか（デフォルト 370日 ≒ 1年）
 */
export function buildPlanFromHistory(
  historyDates: string[],
  baseYear: number,
  startFromYmd?: string,
  horizonDays: number = 370
): PlanResult {
  const MAX_YEARS_BACK = 3;

  if (!Array.isArray(historyDates) || historyDates.length === 0) {
    throw new Error('historyDates が空のため、年間計画を作成できません');
  }

  const byYear = splitHistoryByYear(historyDates, baseYear, MAX_YEARS_BACK);
  const yearlyCounts = calcYearlyCounts(byYear);

  if (!yearlyCounts.length) {
    throw new Error('有効な履歴が存在しないため、年間計画を作成できません');
  }

  const lastYearStat = yearlyCounts.find(s => s.year === baseYear);
  if (!lastYearStat || lastYearStat.count <= 0) {
    throw new Error('直近1年(baseYear)の履歴が無いため、新ロジックでは計画を作成できません');
  }

  const targetYearCount = decideTargetYearCount(yearlyCounts, baseYear);
  const shares = calcMonthlyWeights(byYear, baseYear);
  const monthlyCounts = makeMonthlyTargets(targetYearCount, shares);

  // ▼ ここから「今日から1年分」のロジック
  const defaultStart = `${baseYear + 1}-01-01`;
  const startYmd =
    startFromYmd && ISO_YMD.test(startFromYmd) ? startFromYmd : defaultStart;
  const endYmd = addDaysYmd(startYmd, horizonDays);

  const startDate = parseYmd(startYmd);
  const endDate = parseYmd(endYmd);

  const plannedDatesAll: string[] = [];

  let y = startDate.getFullYear();
  let m = startDate.getMonth() + 1; // 1〜12

  // startFromYmd の属する月から順に、endDate を超えるまで月ごとに生成
  while (true) {
    const monthStart = new Date(y, m - 1, 1);
    if (monthStart > endDate) break;

    const idx = m - 1; // 0〜11
    const count = monthlyCounts[idx] ?? 0;
    plannedDatesAll.push(...generateDatesForMonth(y, m, count));

    if (m === 12) {
      m = 1;
      y += 1;
    } else {
      m += 1;
    }
  }

  const plannedDates = plannedDatesAll
    .filter(d => d >= startYmd && d <= endYmd)
    .sort();

  return {
    targetYearCount,
    monthlyCounts,
    plannedDates,
  };
}
