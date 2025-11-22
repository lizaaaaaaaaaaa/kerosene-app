// src/utils/time.ts
// JST（日本標準時）関連のユーティリティ
// - nowYMJST(): JST基準の { year, month, day } を返す
// - useNowYMJST(): Reactフック。JSTの“日付が変わったら”自動的に再計算して再レンダー

import { useEffect, useRef, useState } from 'react'

export type NowYMJST = {
  year: number
  month: number // 1-12
  day: number   // 1-31
}

/** 内部: 現在をJSTのDateに変換（タイムゾーン差分を手動補正） */
function currentJSTDate(): Date {
  const now = new Date()
  // JST = UTC+9。ローカル→UTC→JST への補正をまとめて行う。
  // getTimezoneOffset() は「分」単位で“現地とUTCの差(UTC - 現地)”を返す（日本だと -540）。
  // UTC = now.getTime() + offset(min)*60*1000、JST = UTC + 9h
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60 * 1000
  return new Date(utcMs + 9 * 60 * 60 * 1000)
}

/** 現在のJST年月日を返す（日単位まで） */
export function nowYMJST(): NowYMJST {
  const jst = currentJSTDate()
  return {
    year: jst.getUTCFullYear(),
    month: jst.getUTCMonth() + 1,
    day: jst.getUTCDate(),
  }
}

/**
 * JST基準で“日付が変わったら”自動的に再計算してくれるフック。
 * 既存コードは year/month だけ使っていてもOK。必要なら day も参照できる。
 */
export function useNowYMJST(): NowYMJST {
  const [state, setState] = useState<NowYMJST>(() => nowYMJST())
  const prevRef = useRef<NowYMJST>(state)

  useEffect(() => {
    // 1分毎にJSTをチェック。日付が変わっていたら更新。
    const timer = setInterval(() => {
      const cur = nowYMJST()
      const prev = prevRef.current
      if (
        cur.year !== prev.year ||
        cur.month !== prev.month ||
        cur.day !== prev.day
      ) {
        prevRef.current = cur
        setState(cur)
      }
    }, 60 * 1000) // 60秒ごと

    // 初回にも一度同期（マウント直後のズレ防止）
    const cur = nowYMJST()
    prevRef.current = cur
    setState(cur)

    return () => clearInterval(timer)
  }, [])

  return state
}

/** （任意で使用可）JSTの“今日(YYYY-MM-DD)”を返す補助 */
export function todayISOJST(): string {
  const { year, month, day } = nowYMJST()
  const pad2 = (n: number) => String(n).padStart(2, '0')
  return `${year}-${pad2(month)}-${pad2(day)}`
}
