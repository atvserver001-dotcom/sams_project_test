'use client'
import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { heartRateBridge } from '@/lib/heart-rate/bridge'
import { useFeedback } from '@/components/console/feedback-provider'
import { stopPreviewTransport } from '../../runtime'

export default function PreviewControls() {
  const [busy, setBusy] = useState(false)
  const { confirmAction, notify } = useFeedback()
  async function reset() {
    if (!await confirmAction('샘플 변경 내용과 측정 세션을 초기화할까요?')) return
    setBusy(true)
    try {
      const response = await fetch('/api/preview/reset', { method: 'POST' })
      if (!response.ok) throw new Error('샘플 초기화에 실패했습니다.')
      heartRateBridge.dispose()
      stopPreviewTransport()
      for (const storage of [localStorage, sessionStorage]) {
        const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
        for (const key of keys) {
          if (key && (key.startsWith('sams-heart-care-v1:') || key.startsWith('sams-school-preview:'))) storage.removeItem(key)
        }
      }
      window.location.replace('/school')
    } catch (error) {
      notify(error instanceof Error ? error.message : '샘플 초기화 실패')
      setBusy(false)
    }
  }
  return <main className="mx-auto max-w-[640px] px-7 py-12">
    <h1 className="mb-8 text-2xl font-extrabold">학교 샘플 미리보기</h1>
    <dl className="mb-8 divide-y border-y border-border">
      <div className="flex justify-between gap-5 py-4"><dt>데이터</dt><dd>가상 학교 · 가상 학생</dd></div>
      <div className="flex justify-between gap-5 py-4"><dt>학년도</dt><dd>2025 / 2026</dd></div>
      <div className="flex justify-between gap-5 py-4"><dt>저장 위치</dt><dd>이 브라우저의 샘플 세션</dd></div>
    </dl>
    <div className="flex flex-wrap gap-3">
      <Button asChild variant="outline"><Link href="/school"><ArrowLeft />학교 화면</Link></Button>
      <Button onClick={reset} disabled={busy}><RotateCcw />{busy ? '초기화 중' : '샘플 초기화'}</Button>
    </div>
  </main>
}
