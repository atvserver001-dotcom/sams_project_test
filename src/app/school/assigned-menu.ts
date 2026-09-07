import { Activity, ChartNoAxesCombined, HeartPulse, Package } from 'lucide-react'
import type { MenuItem } from '@/components/console/app-shell'

export type Device = {
  device_id: string
  device_name: string
  limited_period: boolean
  end_date: string | null
}
export type Content = {
  school_content_id: string
  name: string
  is_unlimited: boolean
  end_date: string | null
}

function expired(unlimited: boolean, end: string | null, now: number) {
  return !unlimited && !!end && new Date(`${end}T23:59:59`).getTime() < now
}

function assignedMenu(
  id: string,
  label: string,
  isExpired: boolean,
  content: boolean,
): MenuItem | null {
  const name = label.replace(/\s/g, '')
  if (!name || name === '-') return null
  if (name === 'JumpRope' || name === 'BodyComposition') return null
  let href: string | undefined
  let icon = Package
  if (
    name.includes('운동기록관리') ||
    name.includes('헬스케어') ||
    (content && name.includes('HealthCare'))
  ) {
    href = '/school/exercises'
    icon = Activity
  } else if (
    name.includes('심박기록관리') ||
    name.includes('하트케어') ||
    name.includes('심박계') ||
    (content && name.includes('HeartCare'))
  ) {
    href = '/school/heart-rate'
    icon = HeartPulse
  } else if (name.includes('PAPS기록관리') || name.includes('PAPSCare')) {
    href = '/school/paps'
    icon = ChartNoAxesCombined
  }
  return {
    id,
    label: href === '/school/heart-rate' ? 'Heart Care' : label,
    href,
    icon,
    expired: isExpired,
  }
}

export function buildAssignedMenu(
  contents: readonly Content[],
  devices: readonly Device[],
  notify: (message: string) => void,
  now = Date.now(),
): MenuItem[] {
  const candidates = [
    ...contents.map((c) =>
      assignedMenu(
        'content-' + c.school_content_id,
        c.name,
        expired(c.is_unlimited, c.end_date, now),
        true,
      ),
    ),
    ...devices.map((d) =>
      assignedMenu(
        'device-' + d.device_id,
        d.device_name,
        expired(!d.limited_period, d.end_date, now),
        false,
      ),
    ),
  ]
  const assigned: MenuItem[] = []
  const destinations = new Map<string, MenuItem>()
  for (const item of candidates) {
    if (!item) continue
    const existing = item.href ? destinations.get(item.href) : undefined
    if (existing) {
      // Merge only generated menu items; any available assignment keeps access.
      existing.expired = existing.expired && item.expired
    } else {
      assigned.push(item)
      if (item.href) destinations.set(item.href, item)
    }
  }
  return assigned.map((item) => ({
    ...item,
    onClick: () =>
      notify(
        item.expired
          ? '이 항목의 이용 기간이 만료되었습니다.'
          : '준비 중입니다.',
      ),
  }))
}
