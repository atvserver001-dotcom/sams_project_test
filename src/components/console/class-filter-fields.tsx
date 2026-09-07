'use client'

import { useId } from 'react'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

type ClassFilterFieldsProps = {
  year: number
  grade: number
  classNo: number
  years: readonly { value: number; label: string }[]
  gradeCount: number
  classCount?: number
  labels?: { year?: string; grade?: string; classNo?: string }
  disabled?: boolean
  onYearChange: (value: number) => void
  onGradeChange: (value: number) => void
  onClassChange: (value: number) => void
}

export function ClassFilterFields({
  year, grade, classNo, years, gradeCount, classCount = 10, labels, disabled = false,
  onYearChange, onGradeChange, onClassChange,
}: ClassFilterFieldsProps) {
  const id = useId()
  const fields = [
    { key: 'year', label: labels?.year ?? '학년도', value: year, onChange: onYearChange, options: years },
    { key: 'grade', label: labels?.grade ?? '학년', value: grade, onChange: onGradeChange,
      options: Array.from({ length: gradeCount }, (_, index) => ({ value: index + 1, label: `${index + 1}학년` })) },
    { key: 'class', label: labels?.classNo ?? '반', value: classNo, onChange: onClassChange,
      options: Array.from({ length: classCount }, (_, index) => ({ value: index + 1, label: `${index + 1}반` })) },
  ]

  return <>{fields.map(field => (
    <div key={field.key} data-class-filter={field.key} className="flex flex-col items-start gap-1.5">
      <Label htmlFor={`${id}-${field.key}`} className="text-[11px] font-bold leading-[1.3] text-muted-foreground">{field.label}</Label>
      <Select value={String(field.value)} onValueChange={value => field.onChange(Number(value))} disabled={disabled}>
        <SelectTrigger id={`${id}-${field.key}`} aria-label={field.label} className={`h-9 rounded-none bg-background text-[13px] ${field.key === 'year' ? 'w-[120px]' : 'w-[100px]'}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>{field.options.map(option => <SelectItem key={option.value} value={String(option.value)}>{option.label}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  ))}</>
}
