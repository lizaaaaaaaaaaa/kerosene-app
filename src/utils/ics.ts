/* eslint-disable */

// src/utils/ics.ts
const CRLF = '\r\n'
const ISO_YMD = /^\d{4}-\d{2}-\d{2}$/

/** 例: 2025-11-07 -> 20251107 */
function ymdCompact(ymd: string): string {
  return ymd.replace(/-/g, '')
}

/** 例: 2025-11-07, 9, 0, 0 -> 20251107T090000 */
function ymdHmsCompact(ymd: string, hh = 9, mm = 0, ss = 0): string {
  const HH = String(hh).padStart(2, '0')
  const MM = String(mm).padStart(2, '0')
  const SS = String(ss).padStart(2, '0')
  return `${ymdCompact(ymd)}T${HH}${MM}${SS}`
}

/** UTC→JST(+9h) に補正して YYYY-MM-DD を返す */
function jstYmdFromDate(d: Date): string {
  const j = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  return j.toISOString().slice(0, 10)
}

/** 任意の入力を JST の YYYY-MM-DD に正規化（Date / string 両対応） */
function ensureYmd(input: string | Date): string {
  if (input instanceof Date) return jstYmdFromDate(input)
  const s = String(input)
  if (ISO_YMD.test(s)) return s
  return jstYmdFromDate(new Date(s))
}

/** DTSTAMP 用：常に UTC の Z 付き */
export function jstNowDtstamp(): string {
  return new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
}

/** RFC5545: ICS テキストを生成（Asia/Tokyo） */
export type IcsEvent = {
  /** "YYYY-MM-DD"（JST の日付切り） */
  dateYmd: string
  /** 表示タイトル */
  summary: string
  /** 任意: 詳細 */
  description?: string
  /** 任意: 場所 */
  location?: string
  /** 任意: 開始時刻（JST）既定 09:00 */
  startHour?: number
  /** 任意: 継続分数（既定 60分） */
  durationMinutes?: number
}

export function buildIcs(
  calendarTitle: string,
  events: IcsEvent[],
): string {
  const lines: string[] = []
  lines.push('BEGIN:VCALENDAR')
  lines.push('VERSION:2.0')
  lines.push('PRODID:-//KeroseneApp//JP')
  lines.push('CALSCALE:GREGORIAN')
  lines.push('METHOD:PUBLISH')

  const dtstamp = jstNowDtstamp()

  for (const ev of events) {
    if (!ev?.dateYmd || !ISO_YMD.test(ev.dateYmd)) continue
    const startH = Number.isFinite(ev.startHour) ? Number(ev.startHour) : 9
    const durMin = Number.isFinite(ev.durationMinutes) ? Number(ev.durationMinutes) : 60

    const dtstart = ymdHmsCompact(ev.dateYmd, startH, 0, 0)
    // 終了は start + duration 分
    const endDate = new Date(`${ev.dateYmd}T${String(startH).padStart(2,'0')}:00:00+09:00`)
    endDate.setMinutes(endDate.getMinutes() + durMin)
    const endYmd = `${endDate.getFullYear()}-${String(endDate.getMonth()+1).padStart(2,'0')}-${String(endDate.getDate()).padStart(2,'0')}`
    const endH  = endDate.getHours()
    const endM  = endDate.getMinutes()
    const dtend = ymdHmsCompact(endYmd, endH, endM, 0)

    const uid = `${cryptoRandomUid()}@kerosene.local`

    lines.push('BEGIN:VEVENT')
    lines.push(`UID:${uid}`)
    lines.push(`DTSTAMP:${dtstamp}`)
    lines.push(`DTSTART;TZID=Asia/Tokyo:${dtstart}`)
    lines.push(`DTEND;TZID=Asia/Tokyo:${dtend}`)
    lines.push(`SUMMARY:${escapeText(ev.summary ?? '')}`)
    if (ev.location)    lines.push(`LOCATION:${escapeText(ev.location)}`)
    if (ev.description) lines.push(`DESCRIPTION:${escapeText(ev.description)}`)
    lines.push('END:VEVENT')
  }

  lines.push('END:VCALENDAR')
  return lines.join(CRLF)
}

/** 画面からダウンロード（ファイル保存） */
export function downloadIcs(filename: string, icsText: string) {
  const blob = new Blob([icsText], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.ics') ? filename : `${filename}.ics`
  document.body.appendChild(a)
  a.click()
  URL.revokeObjectURL(url)
  a.remove()
}

/** テキストのエスケープ（カンマ・セミコロン・改行） */
function escapeText(s: string): string {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
}

/** 簡易 UID 生成 */
function cryptoRandomUid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    // @ts-ignore
    return crypto.randomUUID()
  }
  return 'uid-' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

// ===== 既存互換: default も提供 =====
export default buildIcs

// ===== 既存互換: Settings.tsx が期待していた名前 =====
//
// 新スタイル: makeICS(title, events[])
// 旧スタイル: makeICS(title, ymd(=string|Date), summary, description?, location?, startHour?, durationMinutes?)
export function makeICS(title: string, events: IcsEvent[]): string
export function makeICS(
  title: string,
  ymd: string | Date,
  summary: string,
  description?: string,
  location?: string,
  startHour?: number,
  durationMinutes?: number,
): string
// ← 最終フォールバック（どんな呼び方でも受ける）
export function makeICS(...args: any[]): string

export function makeICS(titleOrAnything: any, arg2?: any, ...rest: any[]): string {
  // パターン1: makeICS(title, events[])
  if (Array.isArray(arg2)) {
    const title = String(titleOrAnything)
    return buildIcs(title, arg2 as IcsEvent[])
  }

  // パターン2: makeICS(title, ymd(=string|Date), summary, ...)
  const title = String(titleOrAnything)
  const ymd = ensureYmd(arg2 as string | Date)
  const summary = String(rest[0] ?? '')
  const description = rest[1] != null ? String(rest[1]) : undefined
  const location    = rest[2] != null ? String(rest[2]) : undefined
  const startHour   = Number.isFinite(rest[3]) ? Number(rest[3]) : 9
  const durationMin = Number.isFinite(rest[4]) ? Number(rest[4]) : 60

  const ev: IcsEvent = {
    dateYmd: ymd,
    summary,
    description,
    location,
    startHour,
    durationMinutes: durationMin,
  }
  return buildIcs(title, [ev])
}

// downloadICS（大文字）互換
export const downloadICS = downloadIcs
