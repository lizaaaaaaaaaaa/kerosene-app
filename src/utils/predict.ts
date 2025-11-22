// src/utils/predict.ts
/* eslint-disable */

/**
 * 予測ユーティリティ
 *
 * 役割（2025-11 時点）:
 *  - タンク種別 → デフォルト周期日数 の変換
 *  - 過去の配送日・最後の配送日から、位相を保った次回/1年分の予測日を出す簡易ヘルパー
 *  - 年間計画（plannedDates）のサマリ生成
 *  - RAG 等から返ってきた補正指示(JSON相当)を、plannedDates に適用するヘルパー
 *
 * ※ 以前ここに存在していた
 *   - makeDailyUseByMonth(...)
 *   - makeDaysUntil15ByMonth(...)
 *   などの「タンク容量 × 使用量ベースの daysUntil15 計算ロジック」は、
 *   新しい年間計画ロジック（src/logic/forecast.ts）に置き換えたため削除済み。
 */

const ISO_YMD = /^\d{4}-\d{2}-\d{2}$/;

function jstYmdFromDate(d: Date): string {
  // UTC基準DateをJST(+9h)に寄せて YYYY-MM-DD で返す
  const j = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return j.toISOString().slice(0, 10);
}

function parseYmd(s: string): Date {
  // 'YYYY-MM-DD' を JST の 00:00 として解釈
  return new Date(`${s}T00:00:00+09:00`);
}

function addDaysYmd(ymd: string, days: number): string {
  const d = parseYmd(ymd);
  d.setDate(d.getDate() + days);
  return jstYmdFromDate(d);
}

function maxYmd(a: string, b: string) {
  return a >= b ? a : b;
}

export type TankType = 'A' | 'B' | 'C';

/**
 * タンク種別から周期日数を返す（A=38, B=42, C=51）。
 * fallback が渡されればそれを優先。
 *
 * db.ts 側の cycleDaysFromTank と同じ意味を持つ簡易ヘルパー。
 * （こちらは UI やテスト用などでの利用を想定）
 */
export function cycleDaysFromTank(tankType?: TankType, fallback?: number): number {
  if (tankType === 'A') return 38;
  if (tankType === 'B') return 42;
  if (tankType === 'C') return 51;
  return Number.isFinite(fallback) ? Number(fallback) : 42; // 既定はB相当
}

/* ============================================================================
 * 位相維持ベースのシンプルな予測ヘルパー
 * - タンク種別 or cycleDays をもとに、最後の配送日・履歴最大日から次回を決める
 * - 新ロジック（forecast.ts）で年間計画を作れない場合などのフォールバックにも利用可能
 * ========================================================================== */

/**
 * 履歴（配列または単一）から位相を保って「今日より後の最初の1本」を返す。
 * - today 省略時は「今のJST」
 * - historyDates があれば最大日を、無ければ lastDate を起点にする
 * - 起点が無い場合のみ today+cycle の簡易フォールバック
 */
export function predictNextDatePhaseAligned(opts: {
  tankType?: TankType;
  cycleDays?: number;
  lastDate?: string;            // 'YYYY-MM-DD'
  historyDates?: string[];      // 'YYYY-MM-DD' の配列
  today?: string;               // 'YYYY-MM-DD'（省略時：JSTの今日）
}): string {
  const today = opts.today ?? jstYmdFromDate(new Date());
  const cycle = Number.isFinite(opts.cycleDays)
    ? Number(opts.cycleDays)
    : cycleDaysFromTank(opts.tankType);

  // 起点＝履歴最大日 or lastDate
  let base: string | null = null;
  if (Array.isArray(opts.historyDates) && opts.historyDates.length > 0) {
    base = opts.historyDates
      .filter(s => ISO_YMD.test(s))
      .reduce((m, s) => (m ? maxYmd(m, s) : s), '' as string);
  }
  if (!base && typeof opts.lastDate === 'string' && ISO_YMD.test(opts.lastDate)) {
    base = opts.lastDate;
  }
  if (!base) {
    // 起点が無い場合のみ today 起点で返す（最小限のフォールバック）
    return addDaysYmd(today, cycle);
  }

  // 位相維持：base から cycle を足し続け、today を超えた1本目を返す
  let next = addDaysYmd(base, cycle);
  while (next <= today) next = addDaysYmd(next, cycle);
  return next;
}

/**
 * 今日より後の約1年分（デフォ ~370日まで）を位相維持で作る。
 * - first を求めてから cycle ごとに horizon まで鎖を伸ばす
 * - 新ロジックが使えない/一時的にフェールしたときのバックアップなどに利用可能
 */
export function predictNextYearPhaseAligned(opts: {
  tankType?: TankType;
  cycleDays?: number;
  lastDate?: string;
  historyDates?: string[];
  today?: string;
  horizonDays?: number; // 省略時 370（日）
}): string[] {
  const first = predictNextDatePhaseAligned(opts);
  const cycle = Number.isFinite(opts.cycleDays)
    ? Number(opts.cycleDays)
    : cycleDaysFromTank(opts.tankType);
  const horizon = Number.isFinite(opts.horizonDays) ? Number(opts.horizonDays) : 370;

  const list: string[] = [];
  let d = first;
  const today = opts.today ?? jstYmdFromDate(new Date());
  const end = addDaysYmd(today, horizon);
  while (d <= end) {
    list.push(d);
    d = addDaysYmd(d, cycle);
  }
  return list;
}

/* ============================================================================
 * 年間計画（plannedDates）評価・補正用のユーティリティ
 *  - forecast.ts が作成した plannedDates を対象に、
 *    「何回あるか」「月ごとの回数」などを集計する。
 *  - RAG や将来のAIロジックが返した補正指示(JSON)を適用するためのヘルパー。
 * ========================================================================== */

export type YearlyPlanSummary = {
  /** 対象年（plannedDates の年を自動推定。混在している場合は最小の年を採用） */
  year: number;
  /** 年間総回数 */
  totalCount: number;
  /** 月別回数（index 0 = 1月, 11 = 12月） */
  monthlyCounts: number[];
};

/**
 * plannedDates（YYYY-MM-DD の配列）から、
 * 年間総回数と月別回数を集計するヘルパー。
 *
 * - 主に UI 表示や、RAG へのプロンプト用の特徴量生成に利用。
 */
export function summarizePlannedDates(plannedDates: string[]): YearlyPlanSummary | null {
  if (!Array.isArray(plannedDates) || plannedDates.length === 0) {
    return null;
  }

  const valid = plannedDates.filter(d => typeof d === 'string' && ISO_YMD.test(d));
  if (valid.length === 0) return null;

  // 年の推定：混在していた場合は最小の年を採用（通常は同じ年のはず）
  let minYear = Infinity;
  for (const d of valid) {
    const y = Number(d.slice(0, 4));
    if (Number.isFinite(y) && y < minYear) minYear = y;
  }
  const year = Number.isFinite(minYear) ? (minYear as number) : new Date().getFullYear();

  const monthlyCounts = new Array<number>(12).fill(0);
  for (const d of valid) {
    const y = Number(d.slice(0, 4));
    const m = Number(d.slice(5, 7)); // 1〜12
    if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) continue;
    if (y !== year) continue; // 想定外の年は無視
    monthlyCounts[m - 1] += 1;
  }

  const totalCount = monthlyCounts.reduce((a, b) => a + b, 0);

  return {
    year,
    totalCount,
    monthlyCounts,
  };
}

/**
 * RAG や外部ロジックから返ってくる補正指示の想定フォーマット。
 *
 * - addDates: 追加したい配達日（YYYY-MM-DD）
 * - removeDates: 削除したい配達日（YYYY-MM-DD）
 * - monthlyFactors: 月ごとに係数(0.8〜1.2など)を掛けて回数を微調整したい場合のヒント
 *
 * ※ monthlyFactors は applyPlanAdjustment では現時点では使わず、
 *   必要に応じて forecast.ts 側で使う想定。
 */
export type RagPlanAdjustment = {
  addDates?: string[];
  removeDates?: string[];
  monthlyFactors?: { month: number; factor: number }[]; // 1〜12
};

/**
 * plannedDates に対して、RAG 等から返ってきた補正指示を適用する。
 *
 * - removeDates に含まれる日付は除外
 * - addDates に含まれる日付は追加
 * - 結果は重複を取り除き、日付昇順で返す
 */
export function applyPlanAdjustment(
  plannedDates: string[],
  adjustment: RagPlanAdjustment
): string[] {
  if (!Array.isArray(plannedDates)) return [];

  const removeSet = new Set(
    (adjustment.removeDates ?? []).filter(d => typeof d === 'string' && ISO_YMD.test(d))
  );
  const addSet = new Set(
    (adjustment.addDates ?? []).filter(d => typeof d === 'string' && ISO_YMD.test(d))
  );

  const base = plannedDates.filter(d => typeof d === 'string' && ISO_YMD.test(d));
  const outSet = new Set<string>();

  // 1. まず元の予定から removeDates を除外して追加
  for (const d of base) {
    if (removeSet.has(d)) continue;
    outSet.add(d);
  }

  // 2. addDates を上乗せ
  for (const d of addSet) {
    outSet.add(d);
  }

  // 3. 昇順ソートして配列で返す
  const result = Array.from(outSet.values());
  result.sort();
  return result;
}

