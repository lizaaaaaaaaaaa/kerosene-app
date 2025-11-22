import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

// Leaflet の CSS をローカル同梱（CDNに依存しない）
// ※ index.html の CDN リンクは削除します
import 'leaflet/dist/leaflet.css'

// vite-plugin-pwa の仮想モジュールで SW を自動登録
// （vite.config.ts で VitePWA を有効にしている前提）
import { registerSW } from 'virtual:pwa-register'
registerSW({ immediate: true })

const el = document.getElementById('root')!
createRoot(el).render(<App />)
