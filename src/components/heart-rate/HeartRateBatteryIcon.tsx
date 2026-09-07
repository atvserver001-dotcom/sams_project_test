'use client'

import {
  HeartRateBatteryLevel,
  getHeartRateBatteryLevel,
} from './heartRateVisualization'

export { getHeartRateBatteryLevel } from './heartRateVisualization'
export type { HeartRateBatteryLevel } from './heartRateVisualization'

interface HeartRateBatteryIconProps {
  percent: number | null | undefined
  stale?: boolean
  className?: string
}

const batteryColor: Record<HeartRateBatteryLevel, string> = {
  1: 'text-rose-500',
  2: 'text-amber-500',
  3: 'text-emerald-500',
  4: 'text-emerald-600',
}

export default function HeartRateBatteryIcon({
  percent,
  stale = false,
  className = '',
}: HeartRateBatteryIconProps) {
  const measuredLevel = getHeartRateBatteryLevel(percent)
  const level = stale ? null : measuredLevel
  const isAvailable = level !== null
  const label = isAvailable
    ? `배터리 ${Math.round(percent as number)}퍼센트, ${level}단계`
    : stale && measuredLevel !== null
      ? `배터리 정보 지연, 마지막 수신 ${Math.round(percent as number)}퍼센트`
      : '배터리 정보 없음'

  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`inline-flex shrink-0 items-center gap-0.5 ${isAvailable ? batteryColor[level] : 'text-gray-400'} ${className}`}
    >
      <svg
        viewBox="0 0 30 14"
        className="h-3.5 w-[30px]"
        fill="none"
        aria-hidden="true"
      >
        <rect x="1" y="1" width="24" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M26 4.5h2a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-2v-5Z" fill="currentColor" />
        {[0, 1, 2, 3].map((segment) => (
          <rect
            key={segment}
            x={3.5 + segment * 5.25}
            y="3.5"
            width="3.75"
            height="7"
            rx="0.75"
            className={isAvailable && segment < level ? 'fill-current' : 'fill-gray-200'}
          />
        ))}
      </svg>
      {!isAvailable && <span className="text-[9px] font-bold leading-none">?</span>}
    </span>
  )
}
