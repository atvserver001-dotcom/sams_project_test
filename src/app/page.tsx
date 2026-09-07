'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import LoginForm from '@/components/LoginForm'

export default function Home() {
  const { user, loading } = useAuth()
  const router = useRouter()
  useEffect(() => { if (user) router.replace(user.role === 'admin' ? '/admin' : '/school') }, [user, router])
  if (loading || user) return <div role="status" className="grid min-h-screen place-items-center text-sm text-muted-foreground">불러오는 중...</div>
  return <LoginForm />
}
