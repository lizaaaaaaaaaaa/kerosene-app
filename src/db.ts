// src/db.ts
/* eslint-disable */
import Dexie, { Table } from 'dexie'
import { buildPlanFromHistory } from '@/logic/forecast'

// ===================== 型定義（主キー/参照キーは number に統一） ==================

export type TankKey = 'A' | 'B' | 'C'
export const TankType = { A: 'A', B: 'B', C: 'C' } as const
export type TankType = typeof TankType[keyof typeof TankType]

export interface Customer {
  id?: number
  name: string
  address: string
  city?: string
  tankType?: TankType
  tankCapacity?: number
  usage?: number        // 受付で入れた 1ヶ月あたり使用量(L/月の目安)
  phone?: string
  lat?: number
  lng?: number
}

export interface Order {
  id?: number
  customerId: number
  date: string                // 'YYYY-MM-DD'
  preferredAt?: number
  status?: string
  quantity?: number           // 受付時に入力された使用量（現状は L/月 の目安として保存）
  createdAt?: number
  nextEstimatedAt?: number
}

export interface PlanRecord {
  id: string                  // `${dateISO}#${customerId}`
  dateISO: string             // 'YYYY-MM-DD'
  customerId: number
}

export type MonthlyPlanItem = {
  dateISO: string
  customer: Customer
}

// =============================== Dexie ======================================

class KeroseneDB extends Dexie {
  customers!: Table<Customer, number>
  orders!: Table<Order, number>
  plans!: Table<PlanRecord, string>

  constructor() {
    super('kerosene-db')
    this.version(1).stores({
      customers: '++id, name, city, tankType',
      orders: '++id, customerId, date, preferredAt, status',
      plans: 'id, dateISO, customerId',
    })
    this.version(2).upgrade(async (tx) => {
      const orders = tx.table('orders')
      const plans = tx.table('plans')
      await orders.toCollection().modify((o: any) => {
        if (o && typeof o.customerId !== 'number' && o.customerId != null) {
          const n = Number(o.customerId)
          if (!Number.isNaN(n)) o.customerId = n
        }
      })
      await plans.toCollection().modify((p: any) => {
        if (!p) return
        const n = typeof p.customerId === 'number' ? p.customerId : Number(p.customerId)
        if (!Number.isNaN(n)) {
          p.customerId = n
          if (typeof p.dateISO === 'string' && p.dateISO.length >= 10) {
            p.id = `${p.dateISO}#${n}`
          }
        }
      })
    })
  }
}
export const db = new KeroseneDB()

// ============================ 日付ユーティリティ ==============================

const ISO_YMD = /^\d{4}-\d{2}-\d{2}$/

function jstYmdFromDate(d: Date): string {
  const j = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  return j.toISOString().slice(0, 10)
}
function parseYmd(ymd: string): Date {
  return new Date(`${ymd}T00:00:00+09:00`)
}
function addDaysYmd(ymd: string, days: number): string {
  const d = parseYmd(ymd)
  d.setDate(d.getDate() + days)
  return jstYmdFromDate(d)
}
function addYearsYmd(ymd: string, years: number): string {
  const d = parseYmd(ymd)
  d.setFullYear(d.getFullYear() + years)
  return jstYmdFromDate(d)
}
function monthKey(ymd: string): string { return ymd.slice(0, 7) }
function maxYmd(a: string, b: string) { return a >= b ? a : b }

// ============================= 周期とIDユーティリ =============================

export function cycleDaysFromTank(t?: TankType, fallback?: number): number {
  if (t === 'A') return 38
  if (t === 'B') return 42
  if (t === 'C') return 51
  return Number.isFinite(fallback) ? Number(fallback) : 42
}
export function newId(_seed?: number | string): number { return Date.now() }
export const calcThreshold = (t?: TankType, fb?: number) => cycleDaysFromTank(t, fb)

// =============================== 直近実績 =====================================

async function getLastDeliveredYmd(customerId: number): Promise<string | null> {
  const list = await db.orders.where('customerId').equals(customerId).toArray()
  let last: string | null = null
  for (const o of list) {
    if (o?.date && ISO_YMD.test(o.date)) {
      last = last ? maxYmd(last, o.date) : o.date
    }
  }
  return last
}

/**
 * 指定した顧客について、「baseYear までの最大 maxYearsBack 年分」の配送日（ISO文字列）を返す。
 * - date が不正な行はスキップ
 * - baseYear を超える年は含めない
 * - それより古い年でも maxYearsBack より前は切り捨てる
 */
async function getHistoryDatesForCustomer(
  customerId: number,
  baseYear: number,
  maxYearsBack: number
): Promise<string[]> {
  const rows = await db.orders.where('customerId').equals(customerId).toArray()
  const minYear = baseYear - maxYearsBack
  const out: string[] = []

  for (const o of rows) {
    if (!o?.date || !ISO_YMD.test(o.date)) continue
    const y = Number(o.date.slice(0, 4))
    if (!Number.isFinite(y)) continue
    if (y > baseYear) continue
    if (y < minYear) continue
    out.push(o.date)
  }

  out.sort()
  return out
}

// ============================== plans CRUD ==================================

function planId(dateISO: string, customerId: number) {
  return `${dateISO}#${customerId}`
}
async function upsertPlan(dateISO: string, customerId: number) {
  await db.plans.put({ id: planId(dateISO, customerId), dateISO, customerId })
}
async function deleteFuturePlansForCustomer(customerId: number, fromYmd: string) {
  const all = await db.plans.where('customerId').equals(customerId).toArray()
  const delIds = all.filter(p => p.dateISO >= fromYmd).map(p => p.id)
  if (delIds.length) await db.plans.bulkDelete(delIds)
}
// 履歴ゼロの顧客などの取り残し除去に使う全削除（内部）
async function deleteAllPlansForCustomer(customerId: number) {
  const all = await db.plans.where('customerId').equals(customerId).toArray()
  if (all.length) await db.plans.bulkDelete(all.map(p => p.id))
}

/**
 * ★ 公開API：History / Reception などから呼び出して plans を確実に掃除する
 */
export async function purgePlansForCustomer(
  customerId: number,
  scope: 'all' | 'future' = 'all',
  fromYmd?: string
): Promise<number> {
  if (scope === 'all') {
    const all = await db.plans.where('customerId').equals(customerId).toArray()
    if (all.length) await db.plans.bulkDelete(all.map(p => p.id))
    return all.length
  } else {
    const base = fromYmd ?? jstYmdFromDate(new Date())
    const all = await db.plans.where('customerId').equals(customerId).toArray()
    const targets = all.filter(p => p.dateISO >= base)
    if (targets.length) await db.plans.bulkDelete(targets.map(p => p.id))
    return targets.length
  }
}

// ============================== 予測の再構築 =================================

/**
 * 予測ロジック（新）:
 *
 * - 基本は「過去1年分（＋あれば最大 maxYearsBack 年分）の orders.date だけ」を入力にして、
 *   '@/logic/forecast' の buildPlanFromHistory に委譲する。
 * - buildPlanFromHistory は、以下を満たすように 1年分の配送予定日を決定する想定:
 *     - 年間回数が「過去実績から大きく減りすぎない（下限80〜90%など）」※実装は forecast 側
 *     - 月ごとの回数配分は「過去の月別比率」を尊重
 *     - 月内では均等間隔で日付を配置
 *     - ★ startFrom（= today） から horizonDays 日先までの範囲で plannedDates を返す
 *
 * - 直近(baseYear)の実績が 1件も無い顧客については、
 *     → 旧来どおり cycleDaysFromTank による固定周期フォールバックで plans を生成。
 *
 * 引数:
 *   - horizonDays: 「今日から何日先まで予定を作るか」（フォールバックでも使用）
 *   - fallbackCycleDays: タンク種別が不明な場合の固定周期デフォルト。
 *   - maxYearsBack: 何年分まで過去の履歴を予測に使うか（デフォルト 3年）。
 */
export async function buildMonthlyPlanByThreshold(opts?: {
  horizonDays?: number
  fallbackCycleDays?: number
  maxYearsBack?: number
}) {
  // today から horizonDays 日先までを 1年分の目安として扱う
  const horizonDays = Number.isFinite(opts?.horizonDays) ? Number(opts!.horizonDays) : 370
  const fallbackCycleDays = Number.isFinite(opts?.fallbackCycleDays) ? Number(opts!.fallbackCycleDays) : 42
  const maxYearsBack = Number.isFinite(opts?.maxYearsBack) ? Number(opts!.maxYearsBack) : 3

  const today = jstYmdFromDate(new Date())
  const horizonEnd = addDaysYmd(today, horizonDays)

  const currentYear = Number(today.slice(0, 4))
  const baseYear = currentYear - 1

  const customers = await db.customers.toArray()

  for (const c of customers) {
    if (c?.id == null) continue
    const cid = Number(c.id)

    // この顧客の baseYear までの履歴（日付文字列）を取得
    const historyDates = await getHistoryDatesForCustomer(cid, baseYear, maxYearsBack)
    const baseYearDates = historyDates.filter(d => d.slice(0, 4) === String(baseYear))

    // ============ ① baseYear に1件以上の実績がある場合：新ロジックで1年分の計画を構築 ============

    if (baseYearDates.length > 0) {
      // まず「今日以降の既存 plans」を掃除
      await deleteFuturePlansForCustomer(cid, today)

      try {
        // ★ 今日(today) から horizonDays 日先までの plannedDates を生成
        const { plannedDates } = buildPlanFromHistory(historyDates, baseYear, today, horizonDays)

        // 今日より未来の日付だけ plans に登録
        for (const dateISO of plannedDates) {
          if (!ISO_YMD.test(dateISO)) continue
          if (dateISO < today) continue
          await upsertPlan(dateISO, cid)
        }

        // この顧客は新ロジックで完了したので次へ
        continue
      } catch (e) {
        console.warn('[buildMonthlyPlanByThreshold] forecast 失敗につきフォールバックへ移行:', {
          customerId: cid,
          error: e,
        })
        // ↓ そのままフォールバック処理に流す
      }
    }

    // ============ ② baseYear に実績が無い or forecast に失敗した場合：固定周期フォールバック ============

    const last = await getLastDeliveredYmd(cid)

    if (!last) {
      // そもそも1本も配達していない顧客 → 既存計画は全部削除して終了
      await deleteAllPlansForCustomer(cid)
      continue
    }

    // 今日以降の既存 plans を削除
    await deleteFuturePlansForCustomer(cid, today)

    const baseCycle = cycleDaysFromTank(c.tankType, fallbackCycleDays)
    const cycle = baseCycle

    let next = addDaysYmd(last, cycle)
    // 今日以前をスキップ
    while (next <= today) next = addDaysYmd(next, cycle)
    // horizonEnd まで plans を追加
    while (next <= horizonEnd) {
      await upsertPlan(next, cid)
      next = addDaysYmd(next, cycle)
    }
  }
}

/** Reception.tsx 互換：別名（オーバーロード対応） */
export function generateMonthlyPlans(): Promise<void>
export function generateMonthlyPlans(horizonDays?: number, fallbackCycleDays?: number): Promise<void>
export function generateMonthlyPlans(opts?: { horizonDays?: number; fallbackCycleDays?: number; maxYearsBack?: number }): Promise<void>
export function generateMonthlyPlans(a?: any, b?: any): Promise<void> {
  let opts: { horizonDays?: number; fallbackCycleDays?: number; maxYearsBack?: number } | undefined
  if (typeof a === 'object' && a !== null) opts = a
  else if (typeof a === 'number' || typeof b === 'number') opts = { horizonDays: a, fallbackCycleDays: b }
  return buildMonthlyPlanByThreshold(opts)
}

// ============================ 月別取得（Map） ================================

export async function getMonthlyPlanMap(
  start: { y: number; m: number },
  months: number
): Promise<Map<string, MonthlyPlanItem[]>> {
  const y0 = start.y
  const m0 = start.m
  const first = new Date(y0, m0 - 1, 1)
  const last = new Date(y0, m0 - 1 + (Number.isFinite(months) ? months : 1), 0)
  const fromYmd = jstYmdFromDate(first)
  const toYmd = jstYmdFromDate(last)

  const allPlans = await db.plans.toArray()
  const inRange = allPlans.filter(p => p.dateISO >= fromYmd && p.dateISO <= toYmd)

  const custIds = Array.from(new Set(inRange.map(p => p.customerId)))
  const custList = await db.customers.bulkGet(custIds as any)
  const custMap = new Map<number, Customer>()
  custList.forEach((c, i) => {
    const id = Number(custIds[i])
    if (c) custMap.set(id, c)
  })

  const out = new Map<string, MonthlyPlanItem[]>()
  for (const p of inRange) {
    const key = monthKey(p.dateISO)
    const c = custMap.get(Number(p.customerId))
    if (!c) continue
    const arr = out.get(key) ?? []
    arr.push({ dateISO: p.dateISO, customer: c })
    out.set(key, arr)
  }

  for (const [k, arr] of out) {
    arr.sort((a, b) => {
      const cityA = (a.customer.city ?? extractCity(a.customer.address ?? '')).toString()
      const cityB = (b.customer.city ?? extractCity(b.customer.address ?? '')).toString()
      return (
        cityA.localeCompare(cityB, 'ja') ||
        a.dateISO.localeCompare(b.dateISO) ||
        (a.customer.name ?? '').localeCompare(b.customer.name ?? '', 'ja')
      )
    })
    out.set(k, arr)
  }

  return out
}

// ============================ History.tsx 向け ===============================

export type FlatCustomer = {
  id?: number
  name: string
  address: string
  phone: string
  tankType?: TankType
  tankCapacity?: number
  city?: string
  usage?: number
}

export type FlatOrder = {
  id: string
  customerId: number
  date: string
  status?: string
  quantity?: number
  customer: FlatCustomer
}

export async function getHistoryGrouped(
  ids?: Array<number | undefined>
): Promise<Array<{ date: string; orders: FlatOrder[] }>> {
  const hasFilter = Array.isArray(ids) && ids.length > 0
  const targetIds = (ids || []).filter((x): x is number => x !== undefined && x !== null)

  const rows = hasFilter
    ? await db.orders.where('customerId').anyOf(targetIds as any).toArray()
    : await db.orders.toArray()

  const custIds = Array.from(new Set(rows.map(r => r.customerId)))
  const custList = await db.customers.bulkGet(custIds as any)
  const custMap = new Map<number, Customer>()
  custList.forEach((c, i) => {
    const id = Number(custIds[i])
    if (c) custMap.set(id, c)
  })

  const bucket = new Map<string, FlatOrder[]>()
  for (const o of rows) {
    if (!o?.date || !ISO_YMD.test(o.date)) continue

    const key = o.date

    const custRaw = custMap.get(Number(o.customerId))
    if (!custRaw) continue

    const cust: FlatCustomer = {
      id: custRaw.id,
      name: custRaw.name,
      address: custRaw.address,
      phone: custRaw.phone ?? '',
      tankType: custRaw.tankType,
      tankCapacity: custRaw.tankCapacity,
      city: custRaw.city,
      usage: custRaw.usage,
    }

    const flat: FlatOrder = {
      id: String(o.id ?? `${o.customerId}-${o.date}`),
      customerId: Number(o.customerId),
      date: o.date,
      status: o.status,
      quantity: o.quantity,
      customer: cust,
    }

    const list = bucket.get(key) ?? []
    list.push(flat)
    bucket.set(key, list)
  }

  const out: Array<{ date: string; orders: FlatOrder[] }> = []
  for (const [key, list] of Array.from(bucket.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    list.sort((a, b) => a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id)))
    out.push({ date: key, orders: list })
  }
  return out
}

// ======================= 住所→市区町村（nullガード付き） ======================

function extractCity(address: string): string {
  if (!address) return ''
  const m1 = address.match(/^.*?(市|区|町|村)/)
  if (m1 && m1[0]) return m1[0]
  const m2 = address.match(/^..*?[市区郡]/)
  if (m2 && m2[0]) return m2[0]
  return address
}
