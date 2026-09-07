'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function BackToAdminButton() {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)

  const handleClick = async () => {
    if (submitting) return
    setSubmitting(true)
    try {
      await fetch('/api/admin/act-as', {
        method: 'DELETE',
        credentials: 'include',
      })
    } catch {}
    router.replace('/admin')
  }

  return (
    <Button variant="ghost" onClick={handleClick} disabled={submitting}>
      <ArrowLeft aria-hidden="true" /> 관리자로 돌아가기
    </Button>
  )
}
