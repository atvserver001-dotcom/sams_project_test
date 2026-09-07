'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { AlertCircle, ChevronLeft, ChevronRight, RotateCw, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'

export function ExerciseSelect({ label, value, onChange, options, compact = false }: {
  label: string; value: string; onChange: (value: string) => void
  options: { value: string; label: string }[]
  compact?: boolean
}) {
  const id = `exercise-${label}`
  return <div className="flex flex-col items-start gap-1.5">
    <Label htmlFor={id} className={cn('whitespace-nowrap text-xs text-muted-foreground', compact && 'sr-only')}>{label}</Label>
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className={cn('h-9 w-[100px] rounded-none bg-background text-[13px]', label === '학년도' && 'w-[120px]')}><SelectValue /></SelectTrigger>
      <SelectContent>{options.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
    </Select>
  </div>
}

export function ExerciseSegments({ label, value, onChange, options }: {
  label: string; value: string; onChange: (value: string) => void
  options: readonly { value: string; label: ReactNode; title?: string }[]
}) {
  return <ToggleGroup type="single" value={value} onValueChange={next => { if (next) onChange(next) }} aria-label={label} spacing={0} className="max-w-full flex-wrap justify-start gap-0">
    {options.map(option => <ToggleGroupItem key={option.value} value={option.value} title={option.title} aria-label={option.title} className="gap-1.5">{option.label}</ToggleGroupItem>)}
  </ToggleGroup>
}

export function ExerciseLoading() {
  return <div role="status" aria-label="기록을 불러오는 중" className="space-y-4 bg-white p-5">
    <span className="sr-only">기록을 불러오는 중입니다.</span>
    <Skeleton className="h-44 w-full rounded-none" />
    {Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-9 w-full rounded-none" />)}
  </div>
}

export function ExerciseError({ message, retry }: { message: string; retry: () => void }) {
  return <div role="alert" className="flex flex-wrap items-center gap-3 border-l-[3px] border-[#ae1800] bg-[#fff2ef] p-4 text-[13px] text-[#8f1400]">
    <AlertCircle className="h-4 w-4 shrink-0" /><span className="min-w-0 flex-1 break-words">{message}</span>
    <Button variant="outline" onClick={retry}><RotateCw className="h-[15px] w-[15px]" />다시 불러오기</Button>
  </div>
}

export function ExerciseEmpty({ noStudents = false }: { noStudents?: boolean }) {
  return <div className="flex min-h-40 flex-col items-center justify-center gap-4 border-2 border-dashed border-[#201e1d]/40 p-6 text-center">
    <p className="text-sm text-[#605d5d]">{noStudents ? '등록된 학생이 없습니다.' : '아직 수신된 기록이 없습니다'}</p>
    <Button asChild><Link href="/school/students"><UserPlus className="h-[15px] w-[15px]" />학생 정보입력</Link></Button>
  </div>
}

export function ExercisePagination({ total, page, pageSize, onPage, onPageSize }: {
  total: number; page: number; pageSize: number; onPage: (page: number) => void; onPageSize: (size: number) => void
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  return <div className="flex flex-wrap items-center gap-3 border-t-2 border-[#201e1d]/40 bg-white px-[18px] py-3">
    <span role="status" className="mr-auto text-xs text-[#605d5d]">{total}명 중 {total ? page * pageSize + 1 : 0}–{Math.min(total, (page + 1) * pageSize)} 표시</span>
    <ExerciseSelect label="표시" compact value={String(pageSize)} onChange={value => onPageSize(Number(value))} options={[6, 10, 20, 30, 50].map(value => ({ value: String(value), label: `${value}명` }))} />
    <Button variant="outline" size="icon" title="이전 페이지" aria-label="이전 페이지" disabled={page === 0} onClick={() => onPage(page - 1)}><ChevronLeft className="h-4 w-4" /></Button>
    <span className="min-w-10 text-center text-xs tabular-nums">{page + 1} / {pages}</span>
    <Button variant="outline" size="icon" title="다음 페이지" aria-label="다음 페이지" disabled={page >= pages - 1} onClick={() => onPage(page + 1)}><ChevronRight className="h-4 w-4" /></Button>
  </div>
}
