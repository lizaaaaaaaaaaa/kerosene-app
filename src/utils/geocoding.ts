/* eslint-disable @typescript-eslint/no-explicit-any */
// src/utils/geocoding.ts

/**
 * Geocoding utilities for the oil delivery system.
 * - Named export: getLatLng
 * - Strict return type: Promise<{lat:number; lng:number} | null>
 * - In-memory + localStorage cache
 * - Endpoint order: VITE_GEOCODING_ENDPOINT → Nominatim fallback
 * - Simple rate-limit (1.2s/req) for public providers
 */

import { db, type Customer } from '../db'

export type GeocodeResult = { lat: number; lng: number }

/** メモリキャッシュ（起動中のみ） */
const memCache = new Map<string, GeocodeResult>()

/** localStorage キャッシュ */
const LS_KEY = 'geocode_cache_v1'
type CacheFile = Record<string, GeocodeResult>

function loadLS(): CacheFile {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return {}
    return JSON.parse(raw) as CacheFile
  } catch {
    return {}
  }
}
function saveLS(cache: CacheFile) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(cache))
  } catch {
    // storage 満杯などは無視
  }
}

const lsCache: CacheFile = loadLS()

/** アドレスのゆらぎ吸収：全角空白→半角、前後空白除去、連続空白の圧縮など */
function normalizeAddress(q: string): string {
  return q
    .replace(/\u3000/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** public provider利用時の礼儀レートリミット */
const MIN_INTERVAL_MS = 1200
let lastFetchTime = 0
async function politeDelay() {
  const now = Date.now()
  const elapsed = now - lastFetchTime
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS - elapsed))
  }
  lastFetchTime = Date.now()
}

/** .env（Vite）からのカスタムAPIエンドポイント */
const CUSTOM_ENDPOINT =
  (import.meta as any)?.env?.VITE_GEOCODING_ENDPOINT ||
  (typeof process !== 'undefined' ? (process as any).env?.VITE_GEOCODING_ENDPOINT : '')

/**
 * カスタムエンドポイント形式:
 *   GET {CUSTOM_ENDPOINT}?q=<encoded>
 *   → 200: { lat:number, lng:number } / 204: no content / 4xx/5xx:失敗
 */
async function fetchFromCustomEndpoint(query: string): Promise<GeocodeResult | null> {
  if (!CUSTOM_ENDPOINT) return null
  const url = `${CUSTOM_ENDPOINT}?q=${encodeURIComponent(query)}`
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const data = (await res.json()) as Partial<GeocodeResult> | null
    const lat = Number((data as any)?.lat)
    const lng = Number((data as any)?.lng)
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null
  } catch {
    return null
  }
}

/**
 * Nominatim (OpenStreetMap) へのフォールバック
 * - ドキュメント: https://nominatim.org/release-docs/latest/api/Search/
 * - CORS可（ただし過負荷はNG）
 */
type NominatimHit = { lat?: string | number; lon?: string | number; lng?: string | number }
async function fetchFromNominatim(query: string): Promise<GeocodeResult | null> {
  const url =
    `https://nominatim.openstreetmap.org/search` +
    `?format=json&limit=1&addressdetails=1&accept-language=ja&countrycodes=jp&q=${encodeURIComponent(query)}`
  try {
    await politeDelay()
    const res = await fetch(url, {
      headers: {
        // 可能なら User-Agent / 連絡先を設定推奨
        // 'User-Agent': 'your-app-name/1.0 (contact@example.com)'
      }
    })
    if (!res.ok) return null
    const arr = (await res.json()) as NominatimHit[]
    if (!Array.isArray(arr) || arr.length === 0) return null
    const hit = arr[0]
    const lat = Number(hit?.lat)
    const lon = Number((hit?.lon ?? hit?.lng))
    return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lng: lon } : null
  } catch {
    return null
  }
}

/**
 * 住所文字列 → {lat, lng} を返す。失敗時は null。
 * - まずキャッシュを参照（memory → localStorage）
 * - ヒットしなければ CUSTOM_ENDPOINT → Nominatim の順で問い合わせ
 * - 成功したら両キャッシュへ保存
 */
export async function getLatLng(rawQuery: string): Promise<GeocodeResult | null> {
  if (!rawQuery || !rawQuery.trim()) return null
  const query = normalizeAddress(rawQuery)

  // 1) メモリキャッシュ
  const mem = memCache.get(query)
  if (mem) return mem

  // 2) localStorage キャッシュ
  const ls = lsCache[query]
  if (ls) {
    memCache.set(query, ls)
    return ls
  }

  // 3) カスタムエンドポイント（存在すれば優先）
  const custom = await fetchFromCustomEndpoint(query)
  if (custom) {
    memCache.set(query, custom)
    lsCache[query] = custom
    // 500件を超えたら最古キーを捨てる簡易LRU
    if (Object.keys(lsCache).length > 500) {
      delete lsCache[Object.keys(lsCache)[0]]
    }
    saveLS(lsCache)
    return custom
  }

  // 4) Nominatim フォールバック
  const nominatim = await fetchFromNominatim(query)
  if (nominatim) {
    memCache.set(query, nominatim)
    lsCache[query] = nominatim
    if (Object.keys(lsCache).length > 500) {
      delete lsCache[Object.keys(lsCache)[0]]
    }
    saveLS(lsCache)
    return nominatim
  }

  return null
}

/* ========== 便利ユーティリティ（vrp / Today / DB 連携から使えるオプション） ========== */

/** lat/lng を必須にしたレコード型へ安全に絞り込むための型ガード */
export function isFilledLatLng<T extends { lat?: number; lng?: number }>(
  r: T
): r is T & { lat: number; lng: number } {
  return typeof r.lat === 'number' && Number.isFinite(r.lat) &&
         typeof r.lng === 'number' && Number.isFinite(r.lng)
}

/**
 * rows の lat/lng を可能な範囲で補完して返す。
 * - address があって lat/lng が未設定の行に対し getLatLng を実行
 * - 補完できた行は {lat,lng} を書き戻す
 * - 戻り値: { filled: lat/lngが揃った行[], unresolved: まだ未解決の行[] }
 */
export async function ensureLatLng<T extends { address?: string; lat?: number; lng?: number }>(
  rows: T[],
  addressBuilder?: (r: T) => string // 住所をカスタム生成したい場合
): Promise<{ filled: (T & { lat: number; lng: number })[]; unresolved: T[] }> {
  const copy = [...rows]
  for (const r of copy) {
    if ((r.lat == null || r.lng == null) && (r.address || addressBuilder)) {
      const q = addressBuilder ? addressBuilder(r) : (r.address as string)
      const geo = await getLatLng(q)
      if (geo) {
        r.lat = geo.lat
        r.lng = geo.lng
      }
    }
  }
  const filled = copy.filter(isFilledLatLng) as (T & { lat: number; lng: number })[]
  const unresolved = copy.filter((r) => !isFilledLatLng(r))
  return { filled, unresolved }
}

/**
 * 顧客IDを受け取り、必要に応じて geocoding を行い、
 * lat/lng を DB(customers) に保存してから Customer を返すヘルパー。
 *
 * - すでに lat/lng が入っていれば DBアクセスのみで即返す
 * - address が無い / geocoding 失敗時は null を返す
 */
export async function ensureCustomerLatLng(
  customerId: number
): Promise<(Customer & { lat: number; lng: number }) | null> {
  const c = await db.customers.get(customerId)
  if (!c) return null

  // 既に lat/lng が入っている場合はそのまま返す
  if (typeof c.lat === 'number' && Number.isFinite(c.lat) &&
      typeof c.lng === 'number' && Number.isFinite(c.lng)) {
    return c as Customer & { lat: number; lng: number }
  }

  if (!c.address) return null

  const geo = await getLatLng(c.address)
  if (!geo) return null

  await db.customers.update(customerId, { lat: geo.lat, lng: geo.lng })

  // Dexie.update は部分更新なので、ローカルオブジェクトも更新して返す
  return {
    ...c,
    lat: geo.lat,
    lng: geo.lng,
  } as Customer & { lat: number; lng: number }
}

/** 互換維持用（不要なら削除可） */
const _default = { getLatLng, isFilledLatLng, ensureLatLng, ensureCustomerLatLng }
export default _default
