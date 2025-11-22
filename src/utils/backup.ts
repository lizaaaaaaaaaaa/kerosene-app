// src/utils/backup.ts
import { db, buildMonthlyPlanByThreshold } from '@/db'

/**
 * バックアップJSONの構造
 */
export type BackupData = {
  version: number
  exportedAt: number
  customers: any[]
  locations: any[]
  orders: any[]
  events: any[]
  plans: any[]   // 読み込み時には使わない（orders から再計算）
}

/**
 * Dexieの全データをオブジェクトとして取得
 * ＝ Cloudflareへの同期にも使う
 */
export async function exportAllData(): Promise<BackupData> {
  const [customers, orders, events, plans] = await Promise.all([
    db.customers.toArray(),
    db.orders.toArray(),
    (db as any).delivery_events?.toArray?.() ?? [],
    (db as any).plans?.toArray?.() ?? [],
  ])

  const locations = (db as any).locations?.toArray
    ? await (db as any).locations.toArray()
    : []

  return {
    version: 1,
    exportedAt: Date.now(),
    customers,
    locations,
    orders,
    events,
    plans,
  }
}

/**
 * 既存の「JSONファイルをダウンロードする」機能
 * （従来通りのバックアップ用）
 */
export async function exportAllJSON() {
  const data = await exportAllData()
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `oil-backup-${new Date().toISOString()}.json`
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * オブジェクト（BackupData）から DB を復元
 * → クラウド同期 pull 時に使用
 */
export async function importAllFromData(data: BackupData) {
  await db.transaction(
    'rw',
    db.customers,
    db.orders,
    (db as any).plans ?? db.customers,
    async () => {
      // --- 主要テーブルのクリア ---
      if ((db as any).plans?.clear) {
        await Promise.all([
          db.customers.clear(),
          db.orders.clear(),
          (db as any).plans.clear(),
        ])
      } else {
        await Promise.all([db.customers.clear(), db.orders.clear()])
      }

      // --- オプションテーブルもあればクリア ---
      if ((db as any).delivery_events?.clear) {
        await (db as any).delivery_events.clear()
      }
      if ((db as any).locations?.clear) {
        await (db as any).locations.clear()
      }

      // --- データ書き込み ---
      await db.customers.bulkAdd(data.customers ?? [])
      await db.orders.bulkAdd(data.orders ?? [])

      if ((db as any).delivery_events?.bulkAdd) {
        await (db as any).delivery_events.bulkAdd(data.events ?? [])
      }
      if ((db as any).locations?.bulkAdd) {
        await (db as any).locations.bulkAdd(data.locations ?? [])
      }

      // plans は使わず、ordersから再計算する
    }
  )

  // --- 派生テーブル（plans）の再生成 ---
  try {
    await buildMonthlyPlanByThreshold()

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('oil-refresh'))
      window.dispatchEvent(new Event('plan-refresh'))
    }
  } catch (e) {
    console.warn('importAllFromData: rebuild plans failed', e)
  }
}

/**
 * 従来通りの「JSONファイルから復元」機能
 * Settingsの手動インポートで使用
 */
export async function importAll(file: File) {
  const text = await file.text()
  const data = JSON.parse(text)
  await importAllFromData(data)
}
