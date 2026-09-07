'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import LoginForm from './LoginForm'

interface ProtectedRouteProps {
  children: React.ReactNode
}

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, loading } = useAuth()
  const router = useRouter()
  const pathname = usePathname()

  // 역할별 루트 자동 이동
  useEffect(() => {
    if (!loading && pathname === '/') {
      if (user?.role === 'admin') {
        router.replace('/admin')
      } else if (user?.role === 'school') {
        router.replace('/school')
      }
    }
  }, [loading, user, pathname, router])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-indigo-600"></div>
      </div>
    )
  }

  // 인증된 사용자가 루트 경로('/')에 있는 동안에는 자식 렌더링을 막아
  // 대시보드가 보이지 않도록 즉시 리다이렉트만 처리
  if (user && pathname === '/') {
    return null
  }

  if (!user) {
    return <LoginForm />
  }

  return <>{children}</>
}
