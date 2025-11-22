// src/pages/Settings.tsx
import React, { useState } from 'react'
import { setPasscode, hasPasscode } from '../utils/passcode'
import { importAll } from '../utils/backup'
import { db } from '../db'
import { makeICS, downloadICS } from '../utils/ics'

// ★ クラウド同期ユーティリティを追加
import { pushToCloud, pullFromCloud } from '@/utils/sync'

export function Settings() {
  const [pass, setPass] = useState('')

  async function onSetPass() {
    if (!pass || pass.length < 4) {
      alert('4桁以上で設定してください')
      return
    }
    await setPasscode(pass)
    alert('パスコードを設定しました')
    setPass('')
  }

  async function onImportJSON(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    await importAll(f)
    alert('復元しました')
    e.currentTarget.value = ''
  }

  // === 明日の配達ICSを作成（JST前提） ==========================
  async function exportTomorrowICS() {
    const base = new Date()
    const tomorrow = new Date(
      base.getFullYear(),
      base.getMonth(),
      base.getDate() + 1
    )

    const min = new Date(
      tomorrow.getFullYear(),
      tomorrow.getMonth(),
      tomorrow.getDate(),
      0, 0, 0, 0
    ).getTime()

    const max = new Date(
      tomorrow.getFullYear(),
      tomorrow.getMonth(),
      tomorrow.getDate(),
      23, 59, 59, 999
    ).getTime()

    const cnt = await db.orders
      .where('preferredAt')
      .between(min, max, true, true)
      .filter((o) => o.status !== 'canceled')
      .count()

    const title = `灯油配達（${cnt}件見込み）`
    const summary = '明日の配達'
    const description = 'PWAから生成'
    const location = ''

    const ics = makeICS(title, tomorrow, summary, description, location, 8, 60)
    downloadICS('tomorrow-oil', ics)
  }

  return (
    <div style={{ display: 'grid', gap: 12, maxWidth: 560 }}>
      <h2>設定</h2>

      {/* パスコード */}
      <section style={{ border: '1px solid #ddd', padding: 8, borderRadius: 8 }}>
        <h3>パスコード</h3>
        <div>現在: {hasPasscode() ? '設定あり' : '未設定'}</div>
        <input
          placeholder="4〜6桁推奨"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
        />
        <button onClick={onSetPass}>設定/更新</button>
      </section>

      {/* バックアップ/復元 */}
      <section style={{ border: '1px solid #ddd', padding: 8, borderRadius: 8 }}>
        <h3>バックアップ/復元</h3>
        <input
          type="file"
          accept="application/json"
          onChange={onImportJSON}
        />
        <p style={{ opacity: 0.7 }}>
          ※ バックアップ作成は「履歴」→ JSONバックアップ
        </p>
      </section>

      {/* ★★ クラウド同期（Cloudflare KV） ★★ */}
      <section style={{ border: '1px solid #ddd', padding: 8, borderRadius: 8 }}>
        <h3>クラウド同期（全端末で同じ状態にする）</h3>
        <p style={{ fontSize: 14 }}>
          「クラウドへアップロード」で現在のデータを Cloudflare に保存します。
          <br />
          他端末では起動時 & 「クラウドから読み込み」で同じ内容が反映されます。
        </p>

        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button
            type="button"
            onClick={async () => {
              try {
                await pushToCloud()
                alert('クラウドへアップロードしました')
              } catch (e) {
                alert('アップロードに失敗しました')
              }
            }}
          >
            クラウドへアップロード
          </button>

          <button
            type="button"
            onClick={async () => {
              try {
                await pullFromCloud()
                alert('クラウドから読み込みました')
                // 履歴や計画を更新させる
                window.dispatchEvent(new Event('oil-refresh'))
                window.dispatchEvent(new Event('plan-refresh'))
              } catch (e) {
                alert('読み込みに失敗しました')
              }
            }}
          >
            クラウドから読み込み
          </button>
        </div>
      </section>

      {/* ICS出力 */}
      <section style={{ border: '1px solid #ddd', padding: 8, borderRadius: 8 }}>
        <h3>リマインド（ICS生成）</h3>
        <button onClick={exportTomorrowICS}>明日の配達ICSを作成</button>
      </section>
    </div>
  )
}
