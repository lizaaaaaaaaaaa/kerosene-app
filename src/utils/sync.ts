// src/utils/sync.ts
import {
  exportAllData,
  importAllFromData,
  type BackupData,
} from '@/utils/backup'

// Cloudflare Pages のURLに合わせる
// 例: https://oil-app.pages.dev/api/sync
const SYNC_ENDPOINT = '/api/sync'

/**
 * クラウドから最新JSONを取得してDexieに流し込む（ローカル上書き）
 */
export async function pullFromCloud() {
  try {
    const res = await fetch(SYNC_ENDPOINT, { method: 'GET' })

    if (!res.ok) {
      console.warn('pullFromCloud failed', res.status)
      return
    }

    const remote = (await res.json()) as BackupData

    // backup.ts 側の統一復元ロジックを利用
    await importAllFromData(remote)

    console.log('pullFromCloud: imported', remote)
  } catch (e) {
    console.warn('pullFromCloud: fetch or import failed', e)
  }
}

/**
 * Dexieの全データをバックアップJSONとしてクラウドに保存
 */
export async function pushToCloud() {
  try {
    // Dexie → BackupData オブジェクト
    const data = await exportAllData()

    const res = await fetch(SYNC_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
    })

    if (!res.ok) {
      console.warn('pushToCloud failed', res.status)
      throw new Error('pushToCloud failed')
    }

    console.log('pushToCloud: uploaded')
  } catch (e) {
    console.warn('pushToCloud: upload failed', e)
    throw e
  }
}
