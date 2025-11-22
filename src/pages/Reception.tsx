// src/pages/Reception.tsx
import React, { useEffect, useMemo, useState } from 'react'
import { db, TankType, buildMonthlyPlanByThreshold } from '@/db'

type FormState = {
  name: string
  phone: string
  address: string
  tankType: TankType
  tankCapacity: number
  usage: number // 1ヶ月あたり使用量(L/月の目安)
}

type YearMonth = { y: number; m: number } // m: 1-12

function ymOf(d = new Date()): YearMonth {
  return { y: d.getFullYear(), m: d.getMonth() + 1 }
}
function daysInMonth(y: number, m: number) {
  return new Date(y, m, 0).getDate()
}
function pad2(n: number) {
  return String(n).padStart(2, '0')
}
function toISO(y: number, m: number, d: number) {
  return `${y}-${pad2(m)}-${pad2(d)}`
}
function isFuture(y: number, m: number, d: number) {
  const t = new Date(y, m - 1, d, 23, 59, 59).getTime()
  return t > Date.now()
}
function seasonOf(month: number): 'winter' | 'summer' | 'other' {
  if ([12, 1, 2].includes(month)) return 'winter'
  if ([6, 7, 8].includes(month)) return 'summer'
  return 'other'
}

/**
 * フォールバック用の次回日付計算（タンク容量 × 1ヶ月あたり使用量から日数をざっくり推定）
 */
function fallbackNextISO(lastISO: string, tankCapacity: number, monthlyUsage: number) {
  if (!lastISO || tankCapacity <= 0 || monthlyUsage <= 0) return undefined
  const dailyUse = monthlyUsage / 30
  const usable = tankCapacity * 0.85
  const days = Math.max(7, Math.floor(usable / dailyUse))

  const d = new Date(lastISO)
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

// ---- 予測API ----
async function predictNextByApi(input: {
  name: string
  capacity: number
  usage: number
  tankType: TankType
  lastDate: string
  season: 'winter' | 'summer' | 'other'
}): Promise<string | null> {
  try {
    const r = await fetch('/api/predict-next', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (!r.ok) {
      console.warn('predict-next: http error', r.status)
      return null
    }
    const j = (await r.json().catch((e) => {
      console.warn('predict-next: json parse error', e)
      return null
    })) as { ok?: boolean; next?: string; nextDate?: string } | null

    if (!j) return null
    const iso = (typeof j.next === 'string' ? j.next : j.nextDate) ?? null
    const ISO = /^\d{4}-\d{2}-\d{2}$/
    if (iso && ISO.test(iso)) return iso
    console.warn('predict-next: invalid payload', j)
    return null
  } catch (e) {
    console.warn('predict-next: fetch failed', e)
    return null
  }
}

/* ------------------ 顧客更新ユーティリティ ------------------ */
type FormValues = {
  name: string
  address: string
  phone?: string
  tankType?: TankType
  tankCapacity?: number | string
  usage?: number | string
}

async function ensureCustomerByForm(
  v: FormValues,
  fixedCustomerId?: number
): Promise<number> {
  const tankType = v.tankType
  const tankCapacity = Number(v.tankCapacity ?? 0) || undefined
  const usage = Number(v.usage ?? 0) || undefined

  // 1) 履歴から customerId 指定があればそれを最優先で更新
  if (fixedCustomerId != null && !Number.isNaN(fixedCustomerId)) {
    const existing = await db.customers.get(fixedCustomerId)
    if (existing?.id != null) {
      await db.customers.update(existing.id, {
        name: v.name,
        address: v.address,
        phone: v.phone ?? existing.phone,
        tankType,
        tankCapacity,
        usage,
      })
      return Number(existing.id)
    }
  }

  // 氏名＋住所＋(電話あれば) で既存検索
  const hit = await db.customers
    .filter(
      (c) =>
        c.name === v.name &&
        c.address === v.address &&
        (v.phone ? c.phone === v.phone : true)
    )
    .first()

  if (hit?.id != null) {
    await db.customers.update(hit.id, {
      tankType,
      tankCapacity,
      usage,
      phone: v.phone ?? hit.phone,
    })
    return Number(hit.id)
  }

  // 新規作成
  const id = await db.customers.add({
    name: v.name,
    address: v.address,
    phone: v.phone,
    tankType,
    tankCapacity,
    usage,
  })
  return Number(id!)
}
/* ------------------------------------------------------------------------ */

export default function Reception() {
  // 履歴 → 受付 の引き継ぎID（sessionStorage 経由）
  const [fixedCustomerId, setFixedCustomerId] = useState<number | undefined>(undefined)

  const [form, setForm] = useState<FormState>({
    name: '',
    phone: '',
    address: '',
    tankType: TankType.A,
    tankCapacity: 100,
    usage: 20,
  })

  const [cal, setCal] = useState<YearMonth>(ymOf())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [usageMap, setUsageMap] = useState<Record<string, number>>({})
  const [submitting, setSubmitting] = useState(false)

  // 初期化：sessionStorage の受付プリセット → なければ最後の顧客
  useEffect(() => {
    ;(async () => {
      try {
        const raw = sessionStorage.getItem('oil-reception-prefill')
        if (raw) {
          sessionStorage.removeItem('oil-reception-prefill')
          const payload = JSON.parse(raw) as {
            customerId?: number
            name?: string
            address?: string
            phone?: string
            tankType?: TankType
            tankCapacity?: number
            usage?: number
          }

          const cid =
            typeof payload.customerId === 'number' && Number.isFinite(payload.customerId)
              ? payload.customerId
              : undefined
          setFixedCustomerId(cid ?? undefined)

          setForm((s) => ({
            ...s,
            name: payload.name ?? s.name,
            phone: payload.phone ?? s.phone,
            address: payload.address ?? s.address,
            tankType: (payload.tankType as TankType) ?? s.tankType,
            tankCapacity: payload.tankCapacity ?? s.tankCapacity,
            usage: payload.usage ?? s.usage,
          }))
          return
        }
      } catch (e) {
        console.warn('failed to read oil-reception-prefill', e)
      }

      // 履歴プリセットなし → 最後の顧客を初期値に
      try {
        const last: any = await db.customers.orderBy('id').last()
        if (last) {
          setForm((s) => ({
            ...s,
            name: last.name ?? s.name,
            phone: last.phone ?? s.phone,
            address: last.address ?? s.address,
            tankType: (last.tankType as TankType) ?? TankType.A,
            tankCapacity: Number(last.tankCapacity ?? s.tankCapacity),
            usage: Number(last.usage ?? s.usage),
          }))
        }
      } catch (e) {
        console.warn('failed to load last customer', e)
      }
    })()
  }, [])

  const canSubmit = useMemo(
    () =>
      !!(
        form.name.trim() &&
        form.address.trim() &&
        form.phone.trim() &&
        selected.size > 0
      ),
    [form, selected]
  )

  const onChangeBase = (k: keyof FormState, v: string) => {
    setForm((s) => ({
      ...s,
      [k]:
        k === 'tankCapacity' || k === 'usage'
          ? Number(v || 0)
          : k === 'tankType'
          ? (v as TankType)
          : v,
    }))
  }

  const goPrevMonth = () =>
    setCal(({ y, m }) => (m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 }))
  const goNextMonth = () =>
    setCal(({ y, m }) => (m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 }))
  const toggleDay = (d: number) => {
    const iso = toISO(cal.y, cal.m, d)
    if (isFuture(cal.y, cal.m, d)) return
    setSelected((s) => {
      const ns = new Set(s)
      if (ns.has(iso)) {
        ns.delete(iso)
      } else {
        ns.add(iso)
        setUsageMap((prev) => ({ ...prev, [iso]: prev[iso] ?? form.usage }))
      }
      return ns
    })
  }

  // 提出
  async function onSubmitClick() {
    if (!canSubmit || submitting) return
    setSubmitting(true)
    try {
      const dates = Array.from(selected).sort()
      const baseForm = { ...form }
      const baseUsageMap = { ...usageMap }

      const customerId = await ensureCustomerByForm(
        {
          name: baseForm.name.trim(),
          address: baseForm.address.trim(),
          phone: baseForm.phone.trim(),
          tankType: baseForm.tankType,
          tankCapacity: baseForm.tankCapacity,
          usage: baseForm.usage,
        },
        fixedCustomerId
      )

      // A: 次回予測
      let predictedList: Array<{ iso: string; nextEstimatedAt?: number }> = []
      try {
        predictedList = await Promise.all(
          dates.map(async (iso) => {
            const monthlyUsage = Number(baseUsageMap[iso] ?? baseForm.usage)

            const apiNext = await predictNextByApi({
              name: baseForm.name.trim(),
              capacity: baseForm.tankCapacity,
              usage: monthlyUsage,
              tankType: baseForm.tankType,
              lastDate: iso,
              season: seasonOf(new Date(iso).getMonth() + 1),
            })
            const fallback = fallbackNextISO(iso, baseForm.tankCapacity, monthlyUsage)
            const nextISO = apiNext ?? fallback
            return { iso, nextEstimatedAt: nextISO ? new Date(nextISO).getTime() : undefined }
          })
        )
      } catch (e) {
        console.error('stage A (predict) failed', e)
        predictedList = []
      }

      // B: DB書き込み
      try {
        await db.transaction('rw', db.orders, async () => {
          for (const p of predictedList) {
            const preferredAt = new Date(p.iso).getTime()
            const raw = baseUsageMap[p.iso]
            const monthlyUsage = Number(raw ?? baseForm.usage)
            const qty = Number.isFinite(monthlyUsage) ? monthlyUsage : undefined

            await db.orders.add({
              customerId,
              date: p.iso,
              preferredAt,
              quantity: qty,
              status: 'requested',
              createdAt: Date.now(),
              nextEstimatedAt: p.nextEstimatedAt,
            } as any)
          }
        })
      } catch (e) {
        console.error('stage B (db) failed', e)
        throw e
      }

      // C: 月次計画再生成
      try {
        await buildMonthlyPlanByThreshold()
      } catch (e) {
        console.warn('stage C (build plan) failed', e)
      }

      window.dispatchEvent(new Event('oil-refresh'))
      window.dispatchEvent(new Event('plan-refresh'))

      alert('登録しました（履歴・計画・カレンダーへ反映）')
      setSelected(new Set())
      setUsageMap({})
    } catch (err) {
      console.error('submit failed (outer)', err)
      alert('登録中にエラーが発生しました（DB書き込み）。コンソールログを確認してください。')
    } finally {
      setSubmitting(false)
    }
  }

  // カレンダー表示用
  const weeks = useMemo(() => {
    const first = new Date(cal.y, cal.m - 1, 1)
    const firstW = first.getDay()
    const dim = daysInMonth(cal.y, cal.m)
    const cells: { d?: number }[] = []
    for (let i = 0; i < firstW; i++) cells.push({})
    for (let d = 1; d <= dim; d++) cells.push({ d })
    while (cells.length % 7 !== 0) cells.push({})
    const out: { d?: number }[][] = []
    for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7))
    return out
  }, [cal])

  return (
    <div
      style={{
        padding: '8px 12px', // ★ スマホ用余白
        maxWidth: 960,
        margin: '0 auto',
      }}
    >
      <h2 style={{ marginBottom: 16 }}>受付フォーム</h2>

      {/* 基本情報フォーム：画面幅に合わせて1〜3列に自動折り返し */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 12,
          maxWidth: 1024,
        }}
      >
        <label style={{ display: 'flex', flexDirection: 'column' }}>
          <span>名前</span>
          <input
            value={form.name}
            onChange={(e) => onChangeBase('name', e.target.value)}
            placeholder="山田 太郎"
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column' }}>
          <span>住所</span>
          <input
            value={form.address}
            onChange={(e) => onChangeBase('address', e.target.value)}
            placeholder="山口県〇〇市△△町1-2-3"
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column' }}>
          <span>電話番号</span>
          <input
            value={form.phone}
            onChange={(e) => onChangeBase('phone', e.target.value)}
            placeholder="000-xxxx-xxxx"
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column' }}>
          <span>タンク種別</span>
          <select
            value={form.tankType}
            onChange={(e) => onChangeBase('tankType', e.target.value)}
          >
            <option value="A">A（小型）</option>
            <option value="B">B（中型）</option>
            <option value="C">C（大型）</option>
          </select>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column' }}>
          <span>タンク容量（L）</span>
          <input
            type="number"
            value={form.tankCapacity}
            min={0}
            step={10}
            onChange={(e) => onChangeBase('tankCapacity', e.target.value)}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column' }}>
          <span>1ヶ月の使用量（目安）[L/月]</span>
          <input
            type="number"
            value={form.usage}
            min={0}
            step={0.01}
            onChange={(e) => onChangeBase('usage', e.target.value)}
            placeholder="例: 50（このお客様は1ヶ月に50Lくらい使う）"
          />
        </label>
      </div>

      <h3 style={{ marginTop: 24 }}>過去配送日（複数選択）</h3>

      <div
        style={{
          display: 'flex',
          gap: 24,
          alignItems: 'flex-start',
          flexWrap: 'wrap', // ★ 狭い画面では縦並びになる
        }}
      >
        {/* カレンダー */}
        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 8,
            }}
          >
            <button type="button" onClick={goPrevMonth}>
              〈
            </button>
            <strong>
              {cal.y}年 {cal.m}月
            </strong>
            <button type="button" onClick={goNextMonth}>
              〉
            </button>
          </div>
          <table style={{ borderCollapse: 'collapse', width: 280 }}>
            <thead>
              <tr>
                {['日', '月', '火', '水', '木', '金', '土'].map((w) => (
                  <th
                    key={w}
                    style={{ width: 40, textAlign: 'center', fontWeight: 500 }}
                  >
                    {w}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map((w, wi) => (
                <tr key={wi}>
                  {w.map((cell, di) => {
                    const d = cell.d
                    const disabled = d ? isFuture(cal.y, cal.m, d) : true
                    const iso = d ? toISO(cal.y, cal.m, d) : ''
                    const isSel = d ? selected.has(iso) : false
                    return (
                      <td key={`${wi}-${di}`} style={{ padding: 2 }}>
                        {d ? (
                          <button
                            type="button"
                            onClick={() => !disabled && toggleDay(d)}
                            style={{
                              width: 36,
                              height: 32,
                              cursor: disabled ? 'not-allowed' : 'pointer',
                              border: '1px solid #ccc',
                              background: disabled
                                ? '#f5f5f5'
                                : isSel
                                ? '#d7f0ff'
                                : 'white',
                            }}
                            disabled={disabled}
                            title={iso}
                          >
                            {d}
                          </button>
                        ) : (
                          <span
                            style={{
                              display: 'inline-block',
                              width: 36,
                              height: 32,
                            }}
                          />
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 選択した日付＋使用量入力 */}
        <div style={{ minWidth: 280, flex: 1 }}>
          <div style={{ marginBottom: 8, fontWeight: 600 }}>
            選択した日付と1ヶ月の使用量（L/月）
          </div>
          {selected.size === 0 && (
            <div style={{ color: '#666' }}>日付を選択してください</div>
          )}

          {Array.from(selected)
            .sort()
            .map((iso) => (
              <div
                key={iso}
                style={{
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                  marginBottom: 6,
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ width: 120 }}>{iso}</div>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={usageMap[iso] ?? form.usage}
                  onChange={(e) =>
                    setUsageMap((s) => ({
                      ...s,
                      [iso]: Number(e.target.value || 0),
                    }))
                  }
                  style={{ width: 120 }}
                  placeholder="使用量(L/月)"
                />
                <button
                  type="button"
                  onClick={() => {
                    setSelected((s) => {
                      const ns = new Set(s)
                      ns.delete(iso)
                      return ns
                    })
                    setUsageMap((s) => {
                      const { [iso]: _omit, ...rest } = s
                      return rest
                    })
                  }}
                  style={{ padding: '2px 6px' }}
                >
                  削除
                </button>
              </div>
            ))}
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <button
          type="button"
          onClick={onSubmitClick}
          style={{ width: 240, maxWidth: '100%' }}
          disabled={!canSubmit || submitting}
        >
          {submitting ? '登録中…' : '登録'}
        </button>
      </div>
    </div>
  )
}
