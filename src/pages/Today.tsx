/* eslint-disable */
import React, { useEffect, useState } from 'react'
import dayjs from 'dayjs'
import { db, type Customer } from '@/db'
import MapView from './Map'
import { ensureCustomerLatLng } from '@/utils/geocoding'
import { buildSimpleRoute, type RouteCandidate } from '@/logic/vrp'

// 地図描画用ポイント
type P = { id: string; lat: number; lng: number; label: string }

// Todayテーブル用の行
type TodayRow = {
  customerId: number
  name: string
  address: string
  date: string       // YYYY-MM-DD（plans.dateISO）
  lat: number
  lng: number
  routeOrder?: number
}

export default function Today() {
  const [rows, setRows] = useState<TodayRow[]>([])
  const [points, setPoints] = useState<P[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    ;(async () => {
      setLoading(true)
      try {
        const target = dayjs()
        const windowDays = 3

        const start = target.subtract(windowDays, 'day').format('YYYY-MM-DD')
        const end = target.add(windowDays, 'day').format('YYYY-MM-DD')

        // 1. plans テーブルから「today ± windowDays」の予定を取得
        const plans = await db.plans
          .where('dateISO')
          .between(start, end, true, true)
          .toArray()

        const tmpRows: TodayRow[] = []

        for (const p of plans) {
          const customerId = Number((p as any).customerId)
          if (!Number.isFinite(customerId)) continue

          // 顧客情報 + lat/lng を必ず埋める
          const cust = await ensureCustomerLatLng(customerId)
          if (!cust || cust.lat == null || cust.lng == null) continue

          tmpRows.push({
            customerId,
            name: (cust as Customer).name,
            address: (cust as Customer).address,
            date: (p as any).dateISO, // PlanRecord.dateISO
            lat: cust.lat,
            lng: cust.lng,
          })
        }

        if (tmpRows.length === 0) {
          setRows([])
          setPoints([])
          setLoading(false)
          return
        }

        // 2. ルート最適化
        // デポ（ガソリンスタンド）の座標：
        // - .env に VITE_DEPOT_LAT / VITE_DEPOT_LNG があればそれを使う
        // - 無ければ、とりあえず最初の顧客を起点にする
        const envLat = Number(
          (import.meta as any)?.env?.VITE_DEPOT_LAT ??
            (typeof process !== 'undefined'
              ? (process as any).env?.VITE_DEPOT_LAT
              : undefined)
        )
        const envLng = Number(
          (import.meta as any)?.env?.VITE_DEPOT_LNG ??
            (typeof process !== 'undefined'
              ? (process as any).env?.VITE_DEPOT_LNG
              : undefined)
        )

        const depot =
          Number.isFinite(envLat) && Number.isFinite(envLng)
            ? { lat: envLat, lng: envLng }
            : { lat: tmpRows[0].lat, lng: tmpRows[0].lng }

        const candidates: RouteCandidate[] = tmpRows.map((r) => ({
          id: r.customerId,
          lat: r.lat,
          lng: r.lng,
        }))

        const route = buildSimpleRoute(depot, candidates)

        // 3. ルート順を rows に埋める
        const withOrder = tmpRows.map((r) => {
          const idx = route.findIndex((x) => x.id === r.customerId)
          return { ...r, routeOrder: idx >= 0 ? idx + 1 : undefined }
        })

        // 表示用にルート順でソート（未割り当ては末尾）
        const sortedRows = withOrder.sort(
          (a, b) =>
            (a.routeOrder ?? Number.POSITIVE_INFINITY) -
            (b.routeOrder ?? Number.POSITIVE_INFINITY)
        )

        setRows(sortedRows)

        // 4. MapView 用ポイント（ラベルに順番＋名前）
        const mapPoints: P[] = sortedRows.map((r) => ({
          id: `${r.date}-${r.customerId}`,
          lat: r.lat,
          lng: r.lng,
          label: r.routeOrder
            ? `${r.routeOrder}. ${r.name}`
            : r.name,
        }))
        setPoints(mapPoints)
      } catch (e) {
        console.error('Today: failed to load plans/route', e)
        setRows([])
        setPoints([])
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <h2>今日 ±3日の配送候補（ルート順）</h2>

      {loading && <div>読み込み中...</div>}

      {!loading && (
        <>
          {points.length > 0 ? (
            <MapView points={points} />
          ) : (
            <div>ルート候補がありません（住所未設定 or geocoding失敗の可能性）</div>
          )}

          <table
            style={{
              borderCollapse: 'collapse',
              width: '100%',
              maxWidth: 960,
            }}
          >
            <thead>
              <tr>
                <th style={{ border: '1px solid #ddd', padding: 4 }}>順番</th>
                <th style={{ border: '1px solid #ddd', padding: 4 }}>日付</th>
                <th style={{ border: '1px solid #ddd', padding: 4 }}>名前</th>
                <th style={{ border: '1px solid #ddd', padding: 4 }}>住所</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.date}-${r.customerId}`}>
                  <td style={{ border: '1px solid #ddd', padding: 4, textAlign: 'center' }}>
                    {r.routeOrder ?? '-'}
                  </td>
                  <td style={{ border: '1px solid #ddd', padding: 4 }}>{r.date}</td>
                  <td style={{ border: '1px solid #ddd', padding: 4 }}>{r.name}</td>
                  <td style={{ border: '1px solid #ddd', padding: 4 }}>{r.address}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}
