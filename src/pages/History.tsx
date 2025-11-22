// src/pages/History.tsx
import React, { useEffect, useMemo, useState } from 'react'
import {
  db,
  getHistoryGrouped,
  TankType,
  purgePlansForCustomer,
  buildMonthlyPlanByThreshold,
} from '@/db'

type FlatOrderUI = {
  date: string
  id: string
  customerId: string
  customer: {
    name: string
    address: string
    phone: string
    tankType?: TankType
    tankCapacity?: number
    usage?: number // ★ 1ヶ月の使用量（目安）[L/月] を履歴からも拾えるように
  }
  quantity?: number
}

type CustomerGroup = {
  customerId: string
  name: string
  address: string
  phone: string
  tankType?: TankType
  tankCapacity?: number
  usage?: number // ★ 受付へ渡す用
  orders: { date: string; quantity?: number; orderId: string }[]
}

export default function History() {
  const [flat, setFlat] = useState<FlatOrderUI[]>([])
  const [years, setYears] = useState<number[]>([])
  const [selectedYears, setSelectedYears] = useState<number[]>([])
  const [open, setOpen] = useState<Set<string>>(new Set())

  async function reload() {
    const grouped = await getHistoryGrouped()
    const f: FlatOrderUI[] = []
    for (const g of grouped) {
      for (const o of g.orders) {
        f.push({
          date: g.date,
          id: o.id,
          customerId: String(o.customerId),
          customer: {
            name: o.customer.name,
            address: o.customer.address,
            phone: o.customer.phone,
            tankType: o.customer.tankType,
            tankCapacity: o.customer.tankCapacity,
            usage: (o.customer as any).usage, // customers テーブルに usage があれば拾う
          },
          quantity: o.quantity,
        })
      }
    }
    f.sort((a, b) => a.date.localeCompare(b.date))
    setFlat(f)

    const ys = Array.from(new Set(f.map((x) => Number(x.date.slice(0, 4))))).sort(
      (a, b) => a - b
    )
    setYears(ys)
    setSelectedYears(ys)
  }

  useEffect(() => {
    const h = () => reload()
    window.addEventListener('oil-refresh', h)
    reload()
    return () => window.removeEventListener('oil-refresh', h)
  }, [])

  const flatFiltered = useMemo(() => {
    if (selectedYears.length === 0) return flat
    const set = new Set(selectedYears)
    return flat.filter((x) => set.has(Number(x.date.slice(0, 4))))
  }, [flat, selectedYears])

  const groups = useMemo<CustomerGroup[]>(() => {
    const map = new Map<string, CustomerGroup>()
    for (const o of flatFiltered) {
      const key = o.customerId
      let g = map.get(key)
      if (!g) {
        g = {
          customerId: key,
          name: o.customer.name,
          address: o.customer.address,
          phone: o.customer.phone,
          tankType: o.customer.tankType,
          tankCapacity: o.customer.tankCapacity,
          usage: o.customer.usage,
          orders: [],
        }
        map.set(key, g)
      }
      g.orders.push({ date: o.date, quantity: o.quantity, orderId: o.id })
    }
    const arr = Array.from(map.values())
    for (const g of arr) {
      g.orders.sort((a, b) => a.date.localeCompare(b.date))
    }
    arr.sort((a, b) =>
      a.name === b.name ? a.address.localeCompare(b.address) : a.name.localeCompare(b.name)
    )
    return arr
  }, [flatFiltered])

  const toggle = (id: string) =>
    setOpen((s) => {
      const ns = new Set(s)
      ns.has(id) ? ns.delete(id) : ns.add(id)
      return ns
    })

  const labelTank = (t?: TankType) =>
    t === 'A' ? 'A（小型）' : t === 'B' ? 'B（中型）' : t === 'C' ? 'C（大型）' : '-'

  const deleteAllByCustomer = async (customerIdStr: string, name: string) => {
    if (!confirm(`氏名「${name}」のすべての履歴を削除します。よろしいですか？`)) return
    const customerId = Number(customerIdStr)
    if (Number.isNaN(customerId)) return

    const list = await db.orders.where('customerId').equals(customerId).toArray()
    if (list.length) await db.orders.bulkDelete(list.map((x) => x.id as number))

    await purgePlansForCustomer(customerId)
    await buildMonthlyPlanByThreshold()

    window.dispatchEvent(new Event('oil-refresh'))
  }

  const deleteByDateAndCustomer = async (dateISO: string, customerIdStr: string) => {
    if (!confirm(`${dateISO} の「この氏名」の登録を削除します。よろしいですか？`)) return
    const customerId = Number(customerIdStr)
    if (Number.isNaN(customerId)) return

    const list = await db.orders
      .where('date')
      .equals(dateISO)
      .and((o) => Number(o.customerId) === customerId)
      .toArray()
    if (list.length) await db.orders.bulkDelete(list.map((x) => x.id as number))

    await purgePlansForCustomer(customerId)
    await buildMonthlyPlanByThreshold()

    window.dispatchEvent(new Event('oil-refresh'))
  }

  // ★ 履歴 → 受付フォーム へ反映するためのセレクタ保存
  const setReceptionPrefill = (g: CustomerGroup) => {
    try {
      const payload = {
        customerId: Number(g.customerId) || undefined,
        name: g.name,
        address: g.address,
        phone: g.phone,
        tankType: g.tankType,
        tankCapacity: g.tankCapacity,
        usage: g.usage,
      }
      sessionStorage.setItem('oil-reception-prefill', JSON.stringify(payload))
      alert('受付タブを開くと、この顧客情報が反映されます。')
    } catch (e) {
      console.warn('setReceptionPrefill failed', e)
      alert('受付への反映に失敗しました（コンソールを確認してください）')
    }
  }

  return (
    <div
      style={{
        fontSize: 18,
        lineHeight: 1.6,
        padding: '8px 12px',   // ★ スマホで左右に余白
        maxWidth: 960,
        margin: '0 auto',
      }}
    >
      <h2 style={{ fontSize: 22, marginBottom: 12 }}>履歴</h2>

      <div style={{ marginBottom: 16 }}>
        <span style={{ marginRight: 8 }}>年切り替え：</span>
        <select
          multiple
          size={Math.min(8, Math.max(3, years.length || 3))}
          value={selectedYears.map(String)}
          onChange={(e) => {
            const opts = Array.from(e.target.selectedOptions).map((o) => Number(o.value))
            setSelectedYears(opts)
          }}
          style={{ fontSize: 16, padding: '4px 6px' }}
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      {groups.length === 0 ? (
        <p>履歴はまだありません。</p>
      ) : (
        <div style={{ width: '100%', maxWidth: 1200, margin: '0 auto' }}>
          {groups.map((g) => {
            const totalUsage = g.orders.reduce((s, o) => s + Number(o.quantity || 0), 0)
            const count = g.orders.length
            const opened = open.has(g.customerId)
            return (
              <div
                key={g.customerId}
                style={{
                  border: '1px solid #e5e5e5',
                  borderRadius: 8,
                  padding: 12,          // ★ 少しコンパクトに
                  marginBottom: 12,     // ★ スマホで詰めめ
                  background: '#fff',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                {/* ヘッダー行 */}
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    gap: 16,
                    fontSize: 18,
                  }}
                >
                  <div style={{ minWidth: 180 }}>
                    <strong>名前：</strong>
                    {g.name}
                  </div>
                  <div style={{ minWidth: 280, flex: 1 }}>
                    <strong>住所：</strong>
                    {g.address}
                  </div>
                  <div style={{ minWidth: 200 }}>
                    <strong>電話：</strong>
                    {g.phone || '-'}
                  </div>
                  <div style={{ minWidth: 150 }}>
                    <strong>タンク種別：</strong>
                    {labelTank(g.tankType)}
                  </div>
                  <div style={{ minWidth: 150 }}>
                    <strong>タンク容量：</strong>
                    {g.tankCapacity ?? '-'}L
                  </div>
                  <div
                    style={{
                      marginLeft: 'auto',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <span>
                      <strong>タンク合計使用量：</strong>
                      {totalUsage}L（{count}回）
                    </span>
                    <button
                      onClick={() => setReceptionPrefill(g)}
                      style={{ fontSize: 16, padding: '4px 10px' }}
                      title="この氏名の情報を受付フォームに反映します"
                    >
                      この顧客を受付に反映
                    </button>
                    <button
                      onClick={() => toggle(g.customerId)}
                      style={{ fontSize: 16, padding: '4px 10px' }}
                    >
                      {opened ? '閉じる' : '詳細'}
                    </button>
                    <button
                      onClick={() => deleteAllByCustomer(g.customerId, g.name)}
                      style={{
                        color: '#b11',
                        fontSize: 16,
                        padding: '4px 10px',
                      }}
                      title="この氏名の履歴をすべて削除します"
                    >
                      氏名ごと全削除
                    </button>
                  </div>
                </div>

                {opened && (
                  <div
                    style={{
                      marginTop: 10,
                      borderTop: '1px solid #f0f0f0',
                      paddingTop: 10,
                      fontSize: 17,
                    }}
                  >
                    <h4 style={{ margin: '4px 0 8px', fontSize: 18 }}>登録情報</h4>

                    {/* ★ スマホで横スクロールできるようにするラッパ */}
                    <div style={{ width: '100%', overflowX: 'auto' }}>
                      <table
                        style={{
                          width: '100%',
                          minWidth: 480, // 列が潰れないよう最低幅を確保
                          borderCollapse: 'collapse',
                        }}
                      >
                        <thead>
                          <tr style={{ background: '#fafafa' }}>
                            <th
                              style={{
                                textAlign: 'left',
                                width: 180,
                                padding: '8px 10px',
                              }}
                            >
                              過去配達日
                            </th>
                            <th
                              style={{
                                textAlign: 'left',
                                width: 140,
                                padding: '8px 10px',
                              }}
                            >
                              使用量(L)
                            </th>
                            <th
                              style={{
                                textAlign: 'left',
                                width: 220,
                                padding: '8px 10px',
                              }}
                            >
                              操作
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {g.orders.map((o) => (
                            <tr key={o.orderId} style={{ borderTop: '1px solid #eee' }}>
                              <td style={{ padding: '8px 10px' }}>{o.date}</td>
                              <td style={{ padding: '8px 10px' }}>{o.quantity ?? '-'}</td>
                              <td style={{ padding: '8px 10px' }}>
                                <button
                                  onClick={() => deleteByDateAndCustomer(o.date, g.customerId)}
                                  style={{ fontSize: 16, padding: '4px 10px' }}
                                >
                                  この日の登録を削除
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
