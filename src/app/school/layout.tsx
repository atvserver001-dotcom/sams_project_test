'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { ChartNoAxesCombined, Cable, LayoutDashboard, Settings2, Trophy, Users } from 'lucide-react'
import SchoolRoute from '@/components/SchoolRoute'
import BackToAdminButton from '@/components/BackToAdminButton'
import { useAuth } from '@/contexts/AuthContext'
import { AppShell, type MenuGroup } from '@/components/console/app-shell'
import { useFeedback } from '@/components/console/feedback-provider'
import { buildAssignedMenu, type Content, type Device } from './assigned-menu'

export default function SchoolLayout({ children }: { children: ReactNode }) {
  const { schoolName, isAdmin } = useAuth()
  const pathname = usePathname()
  const { notify } = useFeedback()
  const [devices, setDevices] = useState<Device[]>([])
  const [contents, setContents] = useState<Content[]>([])
  const [loading, setLoading] = useState(true)
  const [assignmentError, setAssignmentError] = useState(false)

  useEffect(() => {
    const abort = new AbortController()
    async function load() {
      const results = await Promise.allSettled(
        ['/api/school/devices', '/api/school/contents'].map(async (url) => {
          const response = await fetch(url, {
            credentials: 'include',
            signal: abort.signal,
          })
          if (!response.ok) throw new Error('Assignment request failed')
          const data = await response.json()
          return Array.isArray(data.items) ? data.items : []
        }),
      )
      if (abort.signal.aborted) return
      const [deviceResult, contentResult] = results
      if (deviceResult.status === 'fulfilled') setDevices(deviceResult.value)
      if (contentResult.status === 'fulfilled') setContents(contentResult.value)
      setAssignmentError(results.some((result) => result.status === 'rejected'))
      setLoading(false)
    }
    void load()
    return () => abort.abort()
  }, [])

  useEffect(() => {
    if (!isAdmin) return
    const refresh = () => {
      void fetch('/api/admin/act-as', {
        method: 'POST',
        credentials: 'include',
      }).catch(() => {})
    }
    refresh()
    const timer = setInterval(refresh, 30 * 60 * 1000)
    return () => clearInterval(timer)
  }, [isAdmin])

  const groups: MenuGroup[] = [
    {
      title: '개요',
      items: [
        { id: 'home', label: '대시보드', href: '/school', icon: LayoutDashboard },
      ],
    },
    {
      title: '학생',
      items: [
        { id: 'students', label: '학생 정보입력', href: '/school/students', icon: Users },
      ],
    },
    {
      title: '기록 관리',
      loading,
      items: buildAssignedMenu(contents, devices, notify),
      error: assignmentError ? '일부 메뉴 조회 실패' : undefined,
    },
    {
      title: '분석 · 설정',
      items: [
        { id: 'ranking', label: '랭킹', href: '/school/ranking', icon: Trophy },
        { id: 'dashboard', label: '학교 전체 통계', href: '/school/dashboard', icon: ChartNoAxesCombined },
        { id: 'settings', label: '디바이스 설정', href: '/school/settings', icon: Settings2 },
      ],
    },
    {
      title: '개발중',
      items: [
        { id: 'device-test', label: '줄넘기 / 체성분 테스트', href: '/school/device-test', icon: Cable },
      ],
    },
  ]

  return (
    <SchoolRoute>
      <AppShell
        fullscreen={pathname === '/school/heart-rate/live'}
        groups={groups}
        banner={isAdmin && schoolName ? (
          <div className="acting-banner flex flex-wrap items-center justify-between gap-2 border-b border-border bg-accent px-7 py-2 text-[13px] text-accent-foreground">
            <span><strong>{schoolName}</strong>로 작업 중</span>
            <BackToAdminButton />
          </div>
        ) : undefined}
      >
        {children}
      </AppShell>
    </SchoolRoute>
  )
}


