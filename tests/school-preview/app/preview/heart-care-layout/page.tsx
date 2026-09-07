'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { SerialHeartCareView } from '@/components/heart-rate/SerialHeartCareView'
import { makeLabSession } from '../../../../chart-lab/fixtures'

export default function HeartCareLayoutPreview() {
  const router = useRouter()
  const [session] = useState(() => makeLabSession('normal', 1200))
  return <SerialHeartCareView session={session} now={session.startedAt + session.lastSec * 1000}
    state="preview" statusText="레이아웃 검증 · 합성 데이터" error={null} busy={false}
    onBack={() => router.push('/school/heart-rate')} onStop={() => router.push('/school/heart-rate')} />
}
