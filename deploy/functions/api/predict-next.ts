// functions/api/predict-next.ts
// 予測：直近配送日 lastDate（YYYY-MM-DD, JST基準）から cycleDays を足して次回配送日を返す。
// 仕様：常に JSON を返却 / CORS・OPTIONS 対応 / 入力バリデーション厳密化

type BodyIn = { lastDate?: string; cycleDays?: number };

const ISO_YMD = /^\d{4}-\d{2}-\d{2}$/;

function addDaysJst(ymd: string, days: number): string {
  // 基準日を JST で固定して加算 → JST の YYYY-MM-DD を返す
  const d = new Date(`${ymd}T00:00:00+09:00`);
  d.setDate(d.getDate() + Number(days || 0));
  const j = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return j.toISOString().slice(0, 10);
}

function corsHeaders(extra?: Record<string, string>) {
  return {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    ...(extra || {}),
  };
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: corsHeaders() });
}

export const onRequestOptions: PagesFunction = async () =>
  new Response(null, { status: 204, headers: corsHeaders() });

export const onRequestPost: PagesFunction = async ({ request }) => {
  try {
    const body = (await request.json().catch(() => ({}))) as BodyIn;

    const lastDate = body?.lastDate;
    const cycleDays = body?.cycleDays;

    // 入力バリデーション
    if (!lastDate || !ISO_YMD.test(lastDate) || !Number.isFinite(cycleDays)) {
      return json({ ok: false, message: 'bad request' }, 400);
    }

    // JST で次回日付を計算（位相維持）
    const next = addDaysJst(lastDate, Number(cycleDays));

    return json({ ok: true, next });
  } catch {
    // どんな失敗でも JSON を返す（フロントの res.json() が必ず成功）
    return json({ ok: false, message: 'internal error' }, 500);
  }
};

// （任意）POST/OPTIONS 以外にアクセスされた場合も JSON で返すようにする
export const onRequest: PagesFunction = async ({ request }) => {
  if (request.method === 'POST') return onRequestPost({ request } as any);
  if (request.method === 'OPTIONS') return onRequestOptions({ request } as any);
  return json({ ok: false, message: 'method not allowed' }, 405);
};
