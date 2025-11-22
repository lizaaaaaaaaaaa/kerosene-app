// src/pages/Map.tsx
import React from 'react'

type Point = { id: string; lat: number; lng: number; label: string }
type Props = { points: Point[] }

/**
 * 仮の地図ビュー（プレースホルダー）
 * - まずは並び順の確認用にリスト表示します。
 * - 本物の地図（Leaflet/Google Maps 等）に差し替える場合は、
 *   下の return を置き換えるだけでOK。
 */
export default function MapView({ points }: Props) {
  if (!points?.length) {
    return (
      <div style={{ border: '1px solid #ddd', padding: 8, borderRadius: 8 }}>
        地点がありません
      </div>
    )
  }

  return (
    <div style={{ border: '1px solid #ddd', padding: 8, borderRadius: 8 }}>
      <b>ルート順ポイント（先頭が最初に回る地点）</b>
      <ol style={{ marginTop: 8 }}>
        {points.map((p) => (
          <li key={p.id}>
            {p.label}（{p.lat.toFixed(5)}, {p.lng.toFixed(5)}）
          </li>
        ))}
      </ol>
    </div>
  )
}
