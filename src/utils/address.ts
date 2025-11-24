// src/utils/address.ts

/**
 * 住所から「市区町村＋その後ろ（町名など）」を抽出して表示用に使う。
 * 例）
 *   山口県熊毛郡平生町曽根   → 平生町曽根
 *   山口県熊毛郡田布施町波野 → 田布施町波野
 *
 * 山口県周辺でよくある「◯◯県◯◯郡◯◯町△△」形式を意識したロジック。
 */
export function extractCityForDisplay(address: string | null | undefined): string {
  if (!address) return ''

  let s = String(address).trim()

  // 1) 都道府県までを削る（◯◯県 / ◯◯都 / ◯◯府 / ◯◯道）
  //    例: 山口県熊毛郡平生町曽根 → 熊毛郡平生町曽根
  s = s.replace(/^[^都道府県]+[都道府県]/, '')

  // 2) 「◯◯郡」までを削る
  //    例: 熊毛郡平生町曽根 → 平生町曽根
  s = s.replace(/^[^郡]+郡/, '')

  s = s.trim()

  // 万が一何も残らなかったら、元の住所をそのまま返す
  return s || String(address).trim()
}
