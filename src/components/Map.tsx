import React, { useEffect, useRef } from 'react'
import L from 'leaflet'

type Point = { id: string | number; lat: number; lng: number; label: string }

export function MapView({ points }: { points: Point[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)

  useEffect(() => {
    if (!ref.current) return

    // 初期化（初回のみ）
    if (!mapRef.current) {
      mapRef.current = L.map(ref.current).setView([35.0, 135.0], 7)
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(mapRef.current)
    }

    const map = mapRef.current
    if (!map) return

    // マーカー用レイヤー（描画ごとに作って最後に掃除）
    const layer = L.layerGroup().addTo(map)
    points.forEach((p) => {
      L.marker([p.lat, p.lng]).addTo(layer).bindPopup(p.label)
    })

    if (points.length) {
      const bounds = L.latLngBounds(
        points.map((p) => [p.lat, p.lng] as [number, number]),
      )
      map.fitBounds(bounds.pad(0.2))
    }

    // クリーンアップ：このレンダリングで作った layer だけ削除
    return () => {
      map.removeLayer(layer)
    }
  }, [points])

  return (
    <div
      ref={ref}
      style={{
        width: '100%',
        height: 300,
        border: '1px solid #ddd',
        borderRadius: 8,
      }}
    />
  )
}
