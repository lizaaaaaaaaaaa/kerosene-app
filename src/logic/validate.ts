// src/logic/validate.ts
/* eslint-disable */
// @ts-nocheck
//
// 目的：受付時などに日付の取りこぼしを早期検知する軽量バリデータ
// - ISO(YYYY-MM-DD) かどうかの判定（isIsoYmd）
// - さまざまな型(Date/string/number)を JST の YYYY-MM-DD に正規化（normalizePreferredAtToYmd）
// - 非ISOが来たときだけ warn を出すユーティリティ（warnIfNonIsoDate）
// - 受付オブジェクト向けの簡易検証（validateReceptionOrder）
//
// 依存：なし（他のユーティリティを呼ばない）
// 互換：named export に加え、default export も用意（既存 import との両立）

// --- 内部ユーティリティ -----------------------------------------------------

export const ISO_YMD = /^\d{4}-\d{2}-\d{2}$/;

/** UTC→JST(+9h) で日付切りへ正規化して YYYY-MM-DD を返す */
function jstYmdFromDate(d: Date): string {
  const j = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return j.toISOString().slice(0, 10);
}

/** 文字列/Date/数値(ms) を JST の YYYY-MM-DD に正規化。不可なら null */
export function normalizePreferredAtToYmd(v: unknown): string | null {
  try {
    if (v == null) return null;
    if (typeof v === 'string') {
      if (ISO_YMD.test(v)) return v;
      // 例: "2025/11/07 09:00" などを許容し Date 経由で正規化
      return jstYmdFromDate(new Date(v));
    }
    if (typeof v === 'number' && isFinite(v)) {
      return jstYmdFromDate(new Date(v));
    }
    if (v instanceof Date) {
      return jstYmdFromDate(v);
    }
    return null;
  } catch {
    return null;
  }
}

// --- 公開API ---------------------------------------------------------------

/** "YYYY-MM-DD" 形式かどうかを厳密に確認（ゼロ詰め必須） */
export function isIsoYmd(s: string): boolean {
  return ISO_YMD.test(String(s));
}

/**
 * 値が ISO でない場合だけ console.warn にログを出す補助。
 * label: ログ識別用ラベル（例: "order.date"）
 */
export function warnIfNonIsoDate(label: string, value: unknown): void {
  // undefined/null はスルー（別の必須チェックで扱う想定）
  if (value == null) return;
  const ymd = normalizePreferredAtToYmd(value);
  if (!ymd) {
    console.warn(`[validate] ${label}: 非対応の形式`, value);
    return;
  }
  if (!isIsoYmd(ymd)) {
    console.warn(`[validate] ${label}: ISOではありません ->`, value, ' / 正規化=', ymd);
  }
}

/**
 * 受付オブジェクトの簡易検証。
 * - name/address の存在チェック（空白のみは不可）
 * - date / preferredAt の ISO 正規化・警告
 * - quantity/tankCapacity などが数値として妥当か軽く確認
 *
 * 戻り値:
 *  - ok: 重大エラーがなければ true
 *  - warnings: 軽微注意（画面上で blocking しない項目）
 *  - normalized: 日付系などを正規化した浅いコピー
 */
export function validateReceptionOrder(input: any): {
  ok: boolean;
  warnings: string[];
  normalized: any;
} {
  const warnings: string[] = [];
  const n: any = { ...(input || {}) };

  // 必須項目の存在（空白文字のみはNG）
  const name = (n.name ?? '').toString().trim();
  const address = (n.address ?? '').toString().trim();
  if (!name) warnings.push('氏名が空です');
  if (!address) warnings.push('住所が空です');

  // 日付の正規化（JST YYYY-MM-DD）
  if ('date' in n) {
    const ymd = normalizePreferredAtToYmd(n.date);
    if (!ymd) warnings.push('date が日付として解釈できません');
    else if (!isIsoYmd(ymd)) warnings.push(`date を ISO(YYYY-MM-DD) に揃えてください（例: ${ymd}）`);
    n.date = ymd ?? n.date;
  }
  if ('preferredAt' in n) {
    const ymd = normalizePreferredAtToYmd(n.preferredAt);
    if (!ymd) {
      // preferredAt は任意の可能性が高いので軽微注意で済ませる
      warnings.push('preferredAt が日付として解釈できません（任意項目）');
    } else if (!isIsoYmd(ymd)) {
      warnings.push(`preferredAt を ISO(YYYY-MM-DD) に揃えてください（例: ${ymd}）`);
    }
    n.preferredAt = ymd ?? n.preferredAt;
  }

  // 量やタンク容量などの数値系（数値化できなければ警告）
  const numericFields = ['quantity', 'tankCapacity', 'usage'];
  for (const f of numericFields) {
    if (f in n && n[f] != null && n[f] !== '') {
      const v = Number(n[f]);
      if (!Number.isFinite(v) || v < 0) {
        warnings.push(`${f} が数値として不正です`);
      } else {
        n[f] = v;
      }
    }
  }

  // 電話番号（大きな制約はかけない：数字と+ - () スペースのみ許容）
  if ('phone' in n && n.phone != null) {
    const p = String(n.phone).trim();
    if (p && !/^[0-9+\-() ]+$/.test(p)) {
      warnings.push('phone に不正な文字が含まれています');
    } else {
      n.phone = p;
    }
  }

  // 重大エラーの定義（ここでは name/address が空なら false）
  const ok = Boolean(name && address);

  return { ok, warnings, normalized: n };
}

// --- 互換のための default export（どこかで default import されていても壊さない） --
const _default = {
  isIsoYmd,
  normalizePreferredAtToYmd,
  warnIfNonIsoDate,
  validateReceptionOrder,
  ISO_YMD,
};
export default _default;
