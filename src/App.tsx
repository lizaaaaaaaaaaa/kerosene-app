// src/App.tsx
import React, { useState, useEffect } from 'react'

// default export の画面
import Reception from './pages/Reception'
import Plan from './pages/Plan'
import History from './pages/History' // ← default import

// named export の画面
import { Settings } from './pages/Settings' // ※Settings 側が default export ならここも直してね

// ★ 追加：カレンダービュー
import PlanCalendar from './pages/PlanCalendar'

// ★ 追加：クラウド同期ユーティリティ
import { pullFromCloud } from '@/utils/sync'

type Tab = 'reception' | 'plan' | 'planCalendar' | 'history' | 'settings'

export default function App() {
  const [tab, setTab] = useState<Tab>('reception')

  // ★ 初回マウント時にクラウド → ローカル同期
  useEffect(() => {
    pullFromCloud().catch((e) => console.warn('initial pull failed', e))
  }, [])

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginBottom: 12 }}>
        <button onClick={() => setTab('reception')}>受付</button>
        <button onClick={() => setTab('plan')}>計画</button>
        {/* ★ 追加：年間カレンダー（3×4） */}
        <button onClick={() => setTab('planCalendar')}>カレンダー</button>
        <button onClick={() => setTab('history')}>履歴</button>
        <button onClick={() => setTab('settings')}>設定</button>
      </div>

      {tab === 'reception' && <Reception />}
      {tab === 'plan' && <Plan />}
      {/* ★ 追加：カレンダービューの表示 */}
      {tab === 'planCalendar' && <PlanCalendar />}
      {tab === 'history' && <History />}
      {tab === 'settings' && <Settings />}
    </div>
  )
}
