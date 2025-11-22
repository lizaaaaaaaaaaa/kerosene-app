// functions/api/sync.ts
// Cloudflare Pages Functions 版

const KEY = 'default-json' // 1事業所だけなら固定キーでOK

export async function onRequestGet(context: {
  env: { OIL_SYNC: KVNamespace }
}) {
  const { env } = context
  const json = await env.OIL_SYNC.get(KEY)
  const body = json || JSON.stringify({ customers: [], orders: [], plans: [] })

  return new Response(body, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // フロントと同じオリジンならCORSはなくてもOK。別ドメインから叩くなら下を有効化。
      'access-control-allow-origin': '*',
    },
  })
}

export async function onRequestPost(context: {
  env: { OIL_SYNC: KVNamespace }
  request: Request
}) {
  const { env, request } = context
  const bodyText = await request.text()

  // JSONとしてざっくり検証
  try {
    JSON.parse(bodyText)
  } catch {
    return new Response('invalid json', { status: 400 })
  }

  await env.OIL_SYNC.put(KEY, bodyText)

  return new Response('ok', {
    headers: {
      'access-control-allow-origin': '*',
    },
  })
}

// 必要なら OPTIONS も足せるけど、同一オリジンなら不要なことが多い
