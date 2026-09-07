'use client'
import type { ReactNode } from 'react'
import { Building2, ListChecks, Monitor, UserRoundCog } from 'lucide-react'
import AdminRoute from '@/components/AdminRoute'
import { AppShell, type MenuGroup } from '@/components/console/app-shell'
const groups: MenuGroup[] = [
  {
    title: '운영 관리',
    items: [
      {
        id: 'accounts',
        label: '계정관리',
        href: '/admin/accounts',
        icon: UserRoundCog,
      },
      {
        id: 'schools',
        label: '학교관리',
        href: '/admin/schools',
        icon: Building2,
      },
      {
        id: 'details',
        label: '학교 세부정보',
        href: '/admin/school-details',
        icon: ListChecks,
      },
      {
        id: 'devices',
        label: '디바이스 관리',
        href: '/admin/devices',
        icon: Monitor,
      },
    ],
  },
]
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <AdminRoute>
      <AppShell groups={groups} admin>
        {children}
      </AppShell>
    </AdminRoute>
  )
}
