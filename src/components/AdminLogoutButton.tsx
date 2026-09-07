'use client'

import React from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function AdminLogoutButton() {
  const { signOut } = useAuth()
  const router = useRouter()

  const handleClick = async () => {
    await signOut()
    router.replace('/')
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="로그아웃"
      title="로그아웃"
      onClick={handleClick}
    >
      <LogOut aria-hidden="true" />
    </Button>
  )
}
