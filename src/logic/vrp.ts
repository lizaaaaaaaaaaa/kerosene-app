/* eslint-disable @typescript-eslint/no-explicit-any */
// src/logic/vrp.ts

import { ensureLatLng } from '@/utils/geocoding'

/** 受付やToday画面から渡ってくる素の行（lat/lngが未確定の可能性あり） */
export type VRPInputRow = {
  id: string | number
  name: string
  address?: string
  lat?: number
  lng?: number
  demandLiters?: number // 必要なら利用
  [key: string]: any
}

/** lat/lngがnumberで確定した行（VRP計算はこれを使う） */
export type FilledRow = Omit<VRPInputRow, 'lat' | 'lng'> & { lat: number; lng: number }

/** VRPオプション（必要に応じて拡張） */
export type VRPOptions = {
  /** 出発点（デポ）。指定がなければ最初の点を起点扱い */
  depot?: { lat: number; lng: number }
  /** 終了時にデポへ戻るか（デフォルト: false） */
  returnToDepot?: boolean
  /** 距離優先（true固定・将来拡張用） */
  minimizeDistance?: boolean
}

/** VRP結果 */
export type VRPResult = {
  /** 緯度経度が確定してルート順に並んだ行 */
  ordered: FilledRow[]
  /** 住所解決できなかった行（UIで別枠表示推奨） */
  unresolved: VRPInputRow[]
  /** 総移動距離[km]（returnToDepot=trueのときは帰りも含む） */
  totalDistanceKm: number
}

/* ------------------------ 基本ユーティリティ ------------------------ */

/** 2点間の球面距離[km] */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371 // km
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2

  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/* -------- Today.tsx などから使いやすいシンプルなルート構築API -------- */

/** 単純な座標点型 */
export interface Point {
  lat: number
  lng: number
}

/** 顧客ID付きのルート候補点 */
export interface RouteCandidate extends Point {
  id: number // customerId を想定
}

/** 距離関数（haversineKm のラッパー） */
export function distanceKm(a: Point, b: Point): number {
  return haversineKm(a, b)
}

/**
 * 最近傍法で簡易ルートを構築するヘルパー。
 * - depot: 出発点
 * - candidates: 立ち寄り候補（customerId + lat/lng）
 *
 * Today.tsx からは：
 *   const route = buildSimpleRoute(depot, candidates)
 * のように呼び出して「今日のルート順」を決める想定。
 */
export function buildSimpleRoute(
  depot: Point,
  candidates: RouteCandidate[]
): RouteCandidate[] {
  const route: RouteCandidate[] = []
  const remaining = [...candidates]
  let current: Point = depot

  while (remaining.length > 0) {
    let bestIndex = 0
    let bestDist = Infinity
    for (let i = 0; i < remaining.length; i++) {
      const d = distanceKm(current, remaining[i])
      if (d < bestDist) {
        bestDist = d
        bestIndex = i
      }
    }
    const next = remaining.splice(bestIndex, 1)[0]
    route.push(next)
    current = next
  }

  return route
}

/** rows の lat/lng を補完して、Filled/Unresolved に分割（geocoding.ts へ委譲） */
export async function fillLatLngForRows<T extends VRPInputRow>(
  rows: T[],
  addressBuilder?: (r: T) => string
): Promise<{ filled: (T & { lat: number; lng: number })[]; unresolved: T[] }> {
  const { filled, unresolved } = await ensureLatLng(rows, addressBuilder)
  return { filled, unresolved }
}

/* ------------------------ ルーティング本体（VRP版） ------------------------ */

/**
 * 最近傍法（Nearest Neighbor）で簡易ルートを求める
 * - 計算量・実装の簡潔さ優先。小～中規模で実用的
 * - 改善余地：2-opt等での最適化を後段に追加可能
 */
function nearestNeighborOrder(points: FilledRow[], depot: { lat: number; lng: number }): FilledRow[] {
  const remaining = [...points]
  const ordered: FilledRow[] = []
  let current = depot

  while (remaining.length > 0) {
    let bestIdx = 0
    let bestDist = Infinity
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineKm(current, remaining[i])
      if (d < bestDist) {
        bestDist = d
        bestIdx = i
      }
    }
    const next = remaining.splice(bestIdx, 1)[0]
    ordered.push(next)
    current = next
  }
  return ordered
}

/* ------------------------ 外部公開：VRPエンジン ------------------------ */

/**
 * 入力行（lat/lng不定）を受け取り、住所解決→ルート計算→結果を返す。
 * - 住所が解決できない行は unresolved として返却
 * - ルートは最近傍法で計算
 * - TSエラー（TS2322）を避けるため、FilledRow[] に絞ってから計算
 */
export async function solveVrp(
  rows: VRPInputRow[],
  options: VRPOptions = {}
): Promise<VRPResult> {
  // 1) 緯度経度の補完（ここで Filled と Unresolved に分離）
  const { filled, unresolved } = await fillLatLngForRows(rows)

  // 解ける地点が無ければ空の結果
  if (filled.length === 0) {
    return { ordered: [], unresolved, totalDistanceKm: 0 }
  }

  // 2) デポ（起点）の決定
  const depot =
    options.depot ??
    // 指定がなければ、最初の点を起点とみなす（副作用避けのためコピー）
    { lat: filled[0].lat, lng: filled[0].lng }

  // 3) ルート順の算出（最近傍法）
  const ordered = nearestNeighborOrder(filled as unknown as FilledRow[], depot)

  // 4) 総移動距離の算出
  let total = 0
  let prev = depot
  for (const p of ordered) {
    total += haversineKm(prev, p)
    prev = p
  }
  if (options.returnToDepot) {
    total += haversineKm(prev, depot)
  }

  return { ordered, unresolved, totalDistanceKm: Math.round(total * 1000) / 1000 }
}

/* ------------------------ 型ガード（TS2677対応のジェネリック版） ------------------------ */
/**
 * VRPInputRow系の任意のTに対し、lat/lngがnumberであることを保証する型ガード。
 * - 述語の返り値型を `T & {lat;lng}` にすることで、呼び出し側のパラメーター型(T)に常に割り当て可能
 * - これにより「type 述語の型はそのパラメーターの型に割り当て可能である必要があります( TS2677 )」を回避
 */
export function isFilledRow<T extends VRPInputRow>(
  r: T
): r is T & { lat: number; lng: number } {
  return (
    typeof (r as any).lat === 'number' && Number.isFinite((r as any).lat) &&
    typeof (r as any).lng === 'number' && Number.isFinite((r as any).lng)
  )
}
