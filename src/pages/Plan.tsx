// src/pages/Plan.tsx
import React, { useEffect, useMemo, useState } from 'react'
import { getMonthlyPlanMap, buildMonthlyPlanByThreshold } from '@/db'
import { useNowYMJST, nowYMJST } from '@/utils/time'

type PlanRow = {
  nextDateISO: string
  city: string
  name: string
  address: string
  tankType?: string // タンク種別（A/B/C など）
  tankCapacity?: number // タンク容量
  usage?: number // 使用量（Customer.usage = 受付での 1ヶ月あたり使用量[L/月]）
  routeOrder: number
  // reason?: string // 理由は内部では持てるが画面には出さない
}

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

// 住所から市区町村っぽい部分を抽出（city 未保存のときの補助）
function extractCity(address: string): string {
  if (!address) return ''
  const m = address.match(/^.*?(市|区|町|村)/)
  if (m) return m[0]
  const m2 = address.match(/^..*?[市区郡]/)
  return m2 ? m2[0] : address
}

// セクションキー用：空白を除去して安定化
function cityKey(v: string) {
  return String(v || '').replace(/\s/g, '')
}

// JSTの “今日(YYYY-MM-DD)” を返す
function todayISO() {
  const t = nowYMJST()
  return `${t.year}-${pad2(t.month)}-${pad2(t.day)}`
}

export default function Plan() {
  // ▼ JSTの現在年月（深夜0時で自動更新）
  const ym = useNowYMJST()
  const [rows, setRows] = useState<PlanRow[]>([])
  const [year, setYear] = useState<number>(ym.year)
  const [month, setMonth] = useState<number>(ym.month)
  const [loading, setLoading] = useState<boolean>(true)

  // --- 共通: 計画データを再構築してテーブルへ反映 ---
  async function reload() {
    setLoading(true)

    // 過去配送日ベースの予測で “過去配送日 → 次回予測日” を最新化（DB更新）
    await buildMonthlyPlanByThreshold()

    // 表示用：現在(JST)から24ヶ月分の予測を月別に取得
    const t = nowYMJST()
    const mp = await getMonthlyPlanMap({ y: t.year, m: t.month }, 24)

    // Map<YYYY-MM, MonthlyPlanItem[]> → テーブル行へ
    const tmp: PlanRow[] = []
    for (const [, list] of mp.entries()) {
      for (const it of list) {
        const c = it.customer
        const city = (c.city && String(c.city)) || extractCity(String(c.address))
        tmp.push({
          nextDateISO: it.dateISO, // 'YYYY-MM-DD'
          city,
          name: String(c.name ?? ''),
          address: String(c.address ?? ''),
          tankType: c.tankType,
          tankCapacity: c.tankCapacity,
          usage: c.usage, // 受付で入力した 1ヶ月あたり使用量(L/月)の目安
          routeOrder: 0,
        })
      }
    }

    // 過去日は除外（今日未満を捨てる）
    const base = todayISO()
    const futureOnly = tmp.filter((r) => r.nextDateISO >= base)

    // 安定ソート（市区町村→日付→氏名）＆ routeOrder 採番
    futureOnly.sort(
      (a, b) =>
        a.city.localeCompare(b.city, 'ja') ||
        a.nextDateISO.localeCompare(b.nextDateISO) ||
        a.name.localeCompare(b.name, 'ja')
    )
    futureOnly.forEach((r, i) => (r.routeOrder = i + 1))

    setRows(futureOnly)
    setLoading(false)
  }

  // 初期ロード & 受付/計画リフレッシュイベントで再読み込み
  useEffect(() => {
    const handler = () => reload()
    window.addEventListener('oil-refresh', handler)
    window.addEventListener('plan-refresh', handler)
    reload()
    return () => {
      window.removeEventListener('oil-refresh', handler)
      window.removeEventListener('plan-refresh', handler)
    }
  }, [])

  // ▼ JSTの年月が切り替わった時（深夜0時跨ぎ）に
  //    1) 再計算 → 2) 自画面更新 → 3) カレンダーへも通知
  useEffect(() => {
    ;(async () => {
      setYear(ym.year)
      setMonth(ym.month)
      await buildMonthlyPlanByThreshold() // ① 再計算（DB更新）
      await reload() // ② 自画面更新
      window.dispatchEvent(new Event('plan-refresh')) // ③ カレンダー等へ反映
    })()
  }, [ym.year, ym.month])

  // 年セレクタ候補（未来データから生成）
  const years = useMemo(() => {
    if (rows.length === 0) return [year]
    const ys = rows.map((r) => Number(r.nextDateISO.slice(0, 4)))
    const min = Math.min(...ys)
    const max = Math.max(...ys)
    const out: number[] = []
    for (let y = min; y <= max; y++) out.push(y)
    if (!out.includes(year)) out.push(year)
    return out.sort((a, b) => a - b)
  }, [rows, year])

  // 月別フィルタ（未来のみの rows から選択中の年/月を抽出）
  const filtered = useMemo(() => {
    const ymStr = `${year}-${pad2(month)}`
    return rows.filter((r) => r.nextDateISO.startsWith(ymStr))
  }, [rows, year, month])

  // 市区町村でグループ化
  const groupedByCity = useMemo(() => {
    const map = new Map<string, PlanRow[]>()
    for (const r of filtered) {
      const key = cityKey(r.city)
      const list = map.get(key) ?? []
      list.push(r)
      map.set(key, list)
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b, 'ja'))
      .map(([key, list]) => ({
        city: list[0]?.city || key,
        rows: list.sort(
          (a, b) =>
            a.nextDateISO.localeCompare(b.nextDateISO) ||
            a.name.localeCompare(b.name, 'ja')
        ),
      }))
  }, [filtered])

  return (
    <div
      style={{
        padding: '8px 12px', // ★ スマホの左右に少し余白
        maxWidth: 1100,
        margin: '0 auto',
        fontSize: 14,
      }}
    >
      <h2 style={{ marginBottom: 16, fontSize: 20 }}>
        📅 配達計画（過去配送日ベース自動予測）
      </h2>

      {/* ▼ 上部コントロール類（wrap ありでスマホ2段構成） */}
      <div
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          marginBottom: 16,
          flexWrap: 'wrap',
        }}
      >
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span>年：</span>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            style={{ width: 110 }}
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span>月：</span>
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            style={{ width: 90 }}
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>

        <button onClick={reload} disabled={loading}>
          {loading ? '計算中...' : '🔄 再計算'}
        </button>

        {/* 今月へ（JST） */}
        <button
          onClick={() => {
            const t = nowYMJST()
            setYear(t.year)
            setMonth(t.month)
          }}
          disabled={loading}
        >
          今月へ
        </button>
      </div>

      {/* ▼ 配達計画テーブル */}
      {loading ? (
        <p>計画データを計算中...</p>
      ) : groupedByCity.length === 0 ? (
        <p style={{ color: '#666' }}>この月の配達計画はありません。</p>
      ) : (
        groupedByCity.map((g) => (
          <div key={g.city} style={{ marginBottom: 20 }}>
            <h3 style={{ margin: '12px 0 8px', fontSize: 18 }}>📍 {g.city}</h3>

            {/* ★ スマホではテーブルを横スクロールさせるコンテナ */}
            <div
              style={{
                overflowX: 'auto',
                WebkitOverflowScrolling: 'touch',
                border: '1px solid #eee',
                borderRadius: 6,
              }}
            >
              <table
                style={{
                  width: '100%',
                  minWidth: 720, // スマホでは横スワイプ、それ以外はそのまま
                  borderCollapse: 'collapse',
                  background: '#fff',
                }}
              >
                <thead>
                  <tr style={{ background: '#f8f8f8' }}>
                    <th style={{ textAlign: 'right', width: 40, padding: '6px 4px' }}>
                      順
                    </th>
                    <th style={{ textAlign: 'left', padding: '6px 4px', whiteSpace: 'nowrap' }}>
                      配達日
                    </th>
                    <th style={{ textAlign: 'left', padding: '6px 4px' }}>名前</th>
                    <th style={{ textAlign: 'left', padding: '6px 4px' }}>住所</th>
                    <th style={{ textAlign: 'left', padding: '6px 4px', whiteSpace: 'nowrap' }}>
                      タンク種別
                    </th>
                    <th style={{ textAlign: 'left', padding: '6px 4px', whiteSpace: 'nowrap' }}>
                      タンク容量
                    </th>
                    <th style={{ textAlign: 'left', padding: '6px 4px', whiteSpace: 'nowrap' }}>
                      使用量(L/月・受付値)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((r, i) => (
                    <tr key={`${g.city}-${r.name}-${r.nextDateISO}-${i}`}>
                      <td
                        style={{
                          textAlign: 'right',
                          padding: '4px 4px',
                          borderTop: '1px solid #eee',
                        }}
                      >
                        {r.routeOrder}
                      </td>
                      <td style={{ padding: '4px 4px', borderTop: '1px solid #eee' }}>
                        {r.nextDateISO}
                      </td>
                      <td style={{ padding: '4px 4px', borderTop: '1px solid #eee' }}>
                        {r.name}
                      </td>
                      <td style={{ padding: '4px 4px', borderTop: '1px solid #eee' }}>
                        {r.address}
                      </td>
                      <td style={{ padding: '4px 4px', borderTop: '1px solid #eee' }}>
                        {r.tankType ?? '-'}
                      </td>
                      <td style={{ padding: '4px 4px', borderTop: '1px solid #eee' }}>
                        {r.tankCapacity != null ? `${r.tankCapacity}L` : '-'}
                      </td>
                      <td style={{ padding: '4px 4px', borderTop: '1px solid #eee' }}>
                        {r.usage != null ? `${r.usage}L` : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </div>
  )
}
