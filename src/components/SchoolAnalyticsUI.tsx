'use client'

import React from 'react'
import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/native-select'
import { cn } from '@/lib/utils'

export const ACADEMIC_MONTHS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2]

export function getDefaultAcademicYear() {
  const now = new Date()
  const month = now.getMonth() + 1
  return month === 1 || month === 2 ? now.getFullYear() - 1 : now.getFullYear()
}

export function SelectField({
  label,
  value,
  onChange,
  children,
  className = 'w-[120px]',
  disabled = false,
}: {
  label: string
  value: string | number
  onChange: (value: string) => void
  children: React.ReactNode
  className?: string
  disabled?: boolean
}) {
  return (
    <label className={cn('flex flex-col items-start gap-1.5', className)}>
      <span className="text-[11px] font-bold leading-[1.3] text-muted-foreground">{label}</span>
      <NativeSelect
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="h-9 rounded-none bg-background text-[13px]"
      >
        {children}
      </NativeSelect>
    </label>
  )
}

export function SegmentButton({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      variant={active ? 'default' : 'ghost'}
      className="rounded-none"
    >
      {children}
    </Button>
  )
}

export function GradeBadge({ grade }: { grade: number | null | undefined }) {
  if (!grade) return <span className="text-gray-400">-</span>
  const classes: Record<number, string> = {
    1: 'bg-emerald-100 text-emerald-800',
    2: 'bg-blue-100 text-blue-800',
    3: 'bg-yellow-100 text-yellow-800',
    4: 'bg-orange-100 text-orange-800',
    5: 'bg-red-100 text-red-800',
  }
  return (
    <span className={`inline-flex min-w-12 items-center justify-center px-2 py-0.5 text-xs font-bold ${classes[grade] ?? 'bg-gray-100 text-gray-700'}`}>
      {grade}등급
    </span>
  )
}

export function MetricCard({
  label,
  value,
  suffix,
}: {
  label: string
  value: string | number | null
  suffix?: string
}) {
  return (
    <div className="min-w-0 border border-border bg-card p-5">
      <div className="text-xs font-semibold text-muted-foreground">{label}</div>
      <div className="mt-2 flex flex-wrap items-baseline gap-1">
        <span className="break-all text-2xl font-bold text-foreground">{value ?? '-'}</span>
        {suffix && value != null && <span className="text-sm font-bold text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  )
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="px-4 py-10 text-center text-sm text-muted-foreground" role="status">
      {message}
    </div>
  )
}
