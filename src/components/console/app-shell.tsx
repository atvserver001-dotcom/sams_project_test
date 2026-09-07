'use client'
import type { ReactNode } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { LucideIcon } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import AdminLogoutButton from '@/components/AdminLogoutButton'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
export type MenuItem = {
  id: string
  label: string
  href?: string
  icon: LucideIcon
  expired?: boolean
  onClick?: () => void
}
export type MenuGroup = {
  title: string
  items: MenuItem[]
  loading?: boolean
  error?: string
}
export function AppShell({
  children,
  groups,
  admin = false,
  banner,
  fullscreen = false,
}: {
  children: ReactNode
  groups: MenuGroup[]
  admin?: boolean
  banner?: ReactNode
  fullscreen?: boolean
}) {
  const pathname = usePathname()
  const { schoolName, user } = useAuth()
  const activeItem = groups.flatMap(group => group.loading ? [] : group.items)
    .filter(item => item.href && !item.expired && (
      pathname === item.href ||
      (item.href !== '/school' && item.href !== '/admin' && pathname.startsWith(item.href + '/'))
    ))
    .sort((left, right) => right.href!.length - left.href!.length)[0]
  const shell = (
    <div
      className={fullscreen ? 'console-shell [&_.console-page-header]:!hidden' : 'console-shell'}
      data-console-theme={admin ? 'admin' : 'school'}
      data-fullscreen={fullscreen}
      style={fullscreen ? { gridTemplateColumns: 'minmax(0, 1fr)', height: '100dvh', minHeight: 0, overflow: 'hidden' } : undefined}
    >
      <aside
        className="console-sidebar"
        aria-label={admin ? '관리자 메뉴' : '학교 메뉴'}
        hidden={fullscreen}
        style={fullscreen ? { display: 'none' } : undefined}
      >
        <Link
          className="console-brand"
          href={admin ? '/admin' : '/school'}
          aria-label="atvcms 홈"
        >
          <Image
            src="/image/logo_atvcms.svg"
            width={112}
            height={27}
            alt="atvcms"
            priority
          />
          <span className="console-brand-caption text-[11px] font-semibold leading-tight text-muted-foreground">
            {admin ? (
              <>
                운영 관리
                <br />
                콘솔
              </>
            ) : (
              <>
                학생 운동
                <br />
                관리 시스템
              </>
            )}
          </span>
        </Link>
        <nav className="console-nav">
          {groups.map((group) => (
            <div key={group.title} className="console-nav-group">
              <p className="console-nav-heading">{group.title}</p>
              {group.error && (
                <p
                  className="console-nav-label px-5 pb-2 text-xs text-destructive"
                  role="alert"
                >
                  {group.error}
                </p>
              )}
              {group.loading ? (
                <div className="space-y-2 px-4">
                  {[0, 1, 2].map((n) => (
                    <Skeleton key={n} className="h-10 w-full" />
                  ))}
                </div>
              ) : (
                group.items.map((item) => {
                  const Icon = item.icon
                  const active = item === activeItem
                  const content = (
                    <>
                      <Icon aria-hidden="true" />
                      <span className="console-nav-label min-w-0 flex-1 truncate">
                        {item.label}
                      </span>
                      {item.expired && (
                        <span className="console-nav-label border border-border px-1 text-[10px] font-medium">
                          만료
                        </span>
                      )}
                    </>
                  )
                  const props = {
                    className:
                      'console-nav-link' +
                      (item.expired ? ' text-muted-foreground' : ''),
                    'data-active': active,
                    'aria-label': item.label,
                  }
                  return (
                    <Tooltip key={item.id}>
                      <TooltipTrigger asChild>
                        {item.href && !item.expired ? (
                          <Link
                            {...props}
                            href={item.href}
                            aria-current={active ? 'page' : undefined}
                          >
                            {content}
                          </Link>
                        ) : (
                          <button
                            {...props}
                            type="button"
                            onClick={item.onClick}
                          >
                            {content}
                          </button>
                        )}
                      </TooltipTrigger>
                      <TooltipContent side="right">
                        {item.label}
                        {item.expired ? ' · 기간 만료' : ''}
                      </TooltipContent>
                    </Tooltip>
                  )
                })
              )}
            </div>
          ))}
        </nav>
        <div className="console-account">
          <div className="console-account-text">
            <p
              className="truncate text-[13px] font-bold"
              title={schoolName || '관리자'}
            >
              {admin ? '운영 관리자' : schoolName || '학교 계정'}
            </p>
            <p className="truncate text-[11px] text-muted-foreground">
              {user?.username}
            </p>
          </div>
          <AdminLogoutButton />
        </div>
      </aside>
      <div className="console-main" style={fullscreen ? { height: '100%', overflow: 'hidden' } : undefined}>
        <main id="main-content" style={fullscreen ? { height: '100%' } : undefined}>{children}</main>
      </div>
    </div>
  )
  // Keep the same child positions when fullscreen changes so live controllers stay mounted.
  return (
    <div className={banner ? 'console-workspace-with-banner' : undefined} style={banner && fullscreen ? { gridTemplateRows: 'minmax(0, 1fr)' } : undefined}>
      <div hidden={!banner || fullscreen} style={!banner || fullscreen ? { display: 'none' } : undefined}>{banner}</div>
      {shell}
    </div>
  )
}
