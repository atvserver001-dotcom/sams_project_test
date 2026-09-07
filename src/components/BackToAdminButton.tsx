'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/contexts/AuthContext'

export default function BackToAdminButton() {
  const router = useRouter()
  const { refreshUser } = useAuth()
  const [submitting, setSubmitting] = useState(false)

  const handleClick = async () => {
    if (submitting) return
    setSubmitting(true)
    try {
      await fetch('/api/admin/act-as', {
        method: 'DELETE',
        credentials: 'include',
      })
      await refreshUser()
    } catch {}
    router.replace('/admin')
  }

  return (
    <Button variant="ghost" onClick={handleClick} disabled={submitting}>
      <ArrowLeft aria-hidden="true" /> 관리자로 돌아가기
    </Button>
  )
}
