// JSTのYYYY-MM-DDだけを返す軽量ユーティリティ
// ・日付オブジェクトは+9時間オフセットでJST化
// ・YYYY-MM-DD文字列はそのまま返す
// ・その他の文字列はDate化してJSTに正規化
export function jstYmd(input?: Date | string): string {
  if (!input) return jstYmd(new Date());

  if (typeof input === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return input;     // 既にYYYY-MM-DD
    const d = new Date(input);
    return jstYmd(d);
  }

  // Date → +9h（DSTが無い日本なら固定+9hでOK）
  const jst = new Date(input.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10); // YYYY-MM-DD
}

// 今日のJST日付
export function todayJstYmd(): string {
  return jstYmd(new Date());
}
