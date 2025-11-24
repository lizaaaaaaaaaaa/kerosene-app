// src/pages/PlanCalendar.tsx
import React, { useEffect, useMemo, useState } from 'react'
import {
  db,
  Customer,
  getMonthlyPlanMap,
  MonthlyPlanItem,
  buildMonthlyPlanByThreshold,
} from '@/db'
import { useNowYMJST, nowYMJST } from '@/utils/time'
import { extractCityForDisplay } from '@/utils/address'

type PlanRow = {
  customerId: number
  nextDate: string
  city: string
  name: string
  address: string
  routeOrder?: number
}

type DayCell = { dateISO: string; rows: PlanRow[] }

function toISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`
}
function startOfMonth(y: number, m: number) {
  return new Date(y, m - 1, 1)
}
function endOfMonth(y: number, m: number) {
  return new Date(y, m, 0)
}

export default function PlanCalendar() {
  const ym = useNowYMJST()
  const [year, setYear] = useState(ym.year)
  const [month, setMonth] = useState(ym.month)

  useEffect(() => {
    setYear(ym.year)
    setMonth(ym.month)
  }, [ym.year, ym.month])

  const [days, setDays] = useState<DayCell[]>([])
  const [loading, setLoading] = useState(false)

  const [open, setOpen] = useState(false)
  const [detail, setDetail] = useState<{ row: PlanRow; customer?: Customer } | null>(null)

  const years = useMemo(() => {
    const y = ym.year
    return [y - 2, y - 1, y, y + 1, y + 2]
  }, [ym.year])

  const loadMonth = async (y: number, m: number) => {
    setLoading(true)
    try {
      // 「過去配送日ベース自動予測」で plans を再構築
      await buildMonthlyPlanByThreshold()

      const mp = await getMonthlyPlanMap({ y, m }, 1)
      const key = `${y}-${String(m).padStart(2, '0')}`
      const items: MonthlyPlanItem[] = mp.get(key) ?? []

      const s = startOfMonth(y, m)
      const e = endOfMonth(y, m)
      const cells: Record<string, DayCell> = {}
      for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
        const iso = toISO(d)
        cells[iso] = { dateISO: iso, rows: [] }
      }

      for (const it of items) {
        const c = it.customer
        const iso = it.dateISO
        const row: PlanRow = {
          customerId: Number(c.id),
          nextDate: iso,
          // 県名・郡を削って「平生町曽根」「田布施町波野」などに整形
          city: (c.city && String(c.city)) || extractCityForDisplay(String(c.address)),
          name: String(c.name ?? ''),
          address: String(c.address ?? ''),
        }
        if (cells[iso]) cells[iso].rows.push(row)
      }

      const list = Object.values(cells).map((c) => {
        c.rows.sort((a, b) => {
          const dc = a.city.localeCompare(b.city, 'ja')
          if (dc !== 0) return dc
          return a.name.localeCompare(b.name, 'ja')
        })
        return c
      })
      setDays(list)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadMonth(year, month)
  }, [year, month])

  useEffect(() => {
    const handler = () => loadMonth(year, month)
    window.addEventListener('plan-refresh', handler)
    window.addEventListener('oil-refresh', handler)
    return () => {
      window.removeEventListener('plan-refresh', handler)
      window.removeEventListener('oil-refresh', handler)
    }
  }, [year, month])

  useEffect(() => {
    ;(async () => {
      await buildMonthlyPlanByThreshold()
      await loadMonth(ym.year, ym.month)
      window.dispatchEvent(new Event('plan-refresh'))
    })()
  }, [ym.year, ym.month])

  const onClickRow = async (row: PlanRow) => {
    const customer = await db.customers.get(row.customerId)
    setDetail({ row, customer: customer ?? undefined })
    setOpen(true)
  }

  const calendarMatrix = useMemo(() => {
    const first = startOfMonth(year, month)
    const last = endOfMonth(year, month)
    const firstWeekday = first.getDay()
    const totalDays = last.getDate()
    const matrix: DayCell[][] = []
    let week: DayCell[] = []

    for (let i = 0; i < firstWeekday; i++) week.push({ dateISO: '', rows: [] })
    for (let d = 1; d <= totalDays; d++) {
      const iso = toISO(new Date(year, month - 1, d))
      const cell = days.find((x) => x.dateISO === iso) ?? { dateISO: iso, rows: [] }
      week.push(cell)
      if (week.length === 7) {
        matrix.push(week)
        week = []
      }
    }
    if (week.length) {
      while (week.length < 7) week.push({ dateISO: '', rows: [] })
      matrix.push(week)
    }
    return matrix
  }, [days, year, month])

  return (
    <div>
      <h2>📅 月間カレンダー（過去配送日ベース自動予測）</h2>

      <div
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          marginBottom: 12,
          flexWrap: 'wrap',
        }}
      >
        <label>年：</label>
        <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <label>月：</label>
        <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <button onClick={() => loadMonth(year, month)} disabled={loading}>
          再計算
        </button>
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

      <div style={{ border: '1px solid #ddd', borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['日', '月', '火', '水', '木', '金', '土'].map((w) => (
                <th
                  key={w}
                  style={{
                    padding: 6,
                    borderBottom: '1px solid #eee',
                    background: '#fafafa',
                    textAlign: 'center',
                  }}
                >
                  {w}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {calendarMatrix.map((week, wi) => (
              <tr key={wi}>
                {week.map((cell, di) => (
                  <td
                    key={di}
                    style={{
                      verticalAlign: 'top',
                      height: 110,
                      borderBottom: '1px solid #f3f3f3',
                      borderRight: '1px solid #f7f7f7',
                      padding: 6,
                      overflow: 'hidden',
                    }}
                  >
                    {cell.dateISO ? (
                      <>
                        <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>
                          {cell.dateISO.slice(-2)}日
                        </div>
                        {cell.rows.map((r, idx) => (
                          <div
                            key={idx}
                            onClick={() => onClickRow(r)}
                            title={r.name}
                            style={{
                              display: 'inline-block',
                              maxWidth: '100%',
                              fontSize: 12,
                              marginBottom: 4,
                              padding: '2px 6px',
                              borderRadius: 6,
                              border: '1px solid #e0e7ff',
                              background: '#eef2ff',
                              cursor: 'pointer',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {r.name}
                          </div>
                        ))}
                      </>
                    ) : null}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && detail && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,.35)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 50,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff',
              borderRadius: 12,
              padding: '16px 20px',
              // PC では 480px、スマホでは画面幅 96% 以内に収める
              width: 'min(480px, 96vw)',
              maxHeight: '90vh',
              overflowY: 'auto',
              boxSizing: 'border-box',
            }}
          >
            <h3 style={{ marginTop: 0, marginBottom: 12 }}>予測詳細</h3>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 16 }}>
              <tbody>
                <tr>
                  <td
                    style={{
                      width: 120,
                      opacity: 0.7,
                      padding: '4px 8px',
                      verticalAlign: 'top',
                    }}
                  >
                    予測日
                  </td>
                  <td
                    style={{
                      padding: '4px 8px',
                      wordBreak: 'break-word',
                      whiteSpace: 'normal',
                    }}
                  >
                    {detail.row.nextDate}
                  </td>
                </tr>
                <tr>
                  <td
                    style={{
                      width: 120,
                      opacity: 0.7,
                      padding: '4px 8px',
                      verticalAlign: 'top',
                    }}
                  >
                    名前
                  </td>
                  <td
                    style={{
                      padding: '4px 8px',
                      wordBreak: 'break-word',
                      whiteSpace: 'normal',
                    }}
                  >
                    {detail.row.name}
                  </td>
                </tr>
                <tr>
                  <td
                    style={{
                      width: 120,
                      opacity: 0.7,
                      padding: '4px 8px',
                      verticalAlign: 'top',
                    }}
                  >
                    市区町村
                  </td>
                  <td
                    style={{
                      padding: '4px 8px',
                      wordBreak: 'break-word',
                      whiteSpace: 'normal',
                    }}
                  >
                    {detail.row.city}
                  </td>
                </tr>
                <tr>
                  <td
                    style={{
                      width: 120,
                      opacity: 0.7,
                      padding: '4px 8px',
                      verticalAlign: 'top',
                    }}
                  >
                    住所
                  </td>
                  <td
                    style={{
                      padding: '4px 8px',
                      wordBreak: 'break-word', // 長い住所も折り返し
                      whiteSpace: 'normal',
                    }}
                  >
                    {detail.row.address}
                  </td>
                </tr>
                {detail.customer && (
                  <>
                    <tr>
                      <td
                        style={{
                          width: 120,
                          opacity: 0.7,
                          padding: '4px 8px',
                          verticalAlign: 'top',
                        }}
                      >
                        電話
                      </td>
                      <td
                        style={{
                          padding: '4px 8px',
                          wordBreak: 'break-word',
                          whiteSpace: 'normal',
                        }}
                      >
                        {detail.customer.phone ?? '-'}
                      </td>
                    </tr>
                    <tr>
                      <td
                        style={{
                          width: 120,
                          opacity: 0.7,
                          padding: '4px 8px',
                          verticalAlign: 'top',
                        }}
                      >
                        タンク
                      </td>
                      <td
                        style={{
                          padding: '4px 8px',
                          wordBreak: 'break-word',
                          whiteSpace: 'normal',
                        }}
                      >
                        {detail.customer.tankType} / {detail.customer.tankCapacity}L
                      </td>
                    </tr>
                    <tr>
                      <td
                        style={{
                          width: 120,
                          opacity: 0.7,
                          padding: '4px 8px',
                          verticalAlign: 'top',
                        }}
                      >
                        使用量(L/月・受付値)
                      </td>
                      <td
                        style={{
                          padding: '4px 8px',
                          wordBreak: 'break-word',
                          whiteSpace: 'normal',
                        }}
                      >
                        {detail.customer.usage != null
                          ? `${detail.customer.usage} L/月`
                          : '-'}
                      </td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 8,
                marginTop: 16,
              }}
            >
              <button onClick={() => setOpen(false)}>閉じる</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
