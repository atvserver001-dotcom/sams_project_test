"use client"

import React, { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { RecordSelect } from '@/components/school-records/record-select'
import { Label } from '@/components/ui/label'
import { PageHeader } from '@/components/console/page-header'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { FilterBar } from '@/components/console/filter-bar'
import { ClassFilterFields } from '@/components/console/class-filter-fields'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useFeedback } from '@/components/console/feedback-provider'

type Gender = 'M' | 'F'

interface StudentRow {
  id: string
  year: number
  grade: number
  class_no: number
  student_no: number
  name: string
  gender: Gender | null
  birth_date: string | null
  email: string | null
  height_cm: number | null
  weight_kg: number | null
  notes: string | null
}

export default function StudentsPage() {
  const [grade, setGrade] = useState<number>(1)
  const [classNo, setClassNo] = useState<number>(1)
  // 학년도: 3~12월은 해당 연도, 1~2월은 전년도
  const computeDefaultYear = () => {
    const now = new Date()
    const m = now.getMonth() + 1
    return (m === 1 || m === 2) ? now.getFullYear() - 1 : now.getFullYear()
  }
  const [year, setYear] = useState<number>(computeDefaultYear())
  const [schoolType, setSchoolType] = useState<1 | 2 | 3>(1)
  const [students, setStudents] = useState<StudentRow[]>([])
  const [error, setError] = useState<string | null>(null)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<StudentRow | null>(null)
  // 학교 정보 로드 (school_type)
  useEffect(() => {
    const loadSchool = async () => {
      try {
        const res = await fetch('/api/school/info', { credentials: 'include' })
        const data = await res.json()
        if (res.ok && data?.school?.school_type) {
          const t = Number(data.school.school_type)
          if (t === 1 || t === 2 || t === 3) {
            setSchoolType(t as 1 | 2 | 3)
            // 학년/반 기본값을 유효 범위로 보정
            setGrade((g) => {
              const maxG = t === 1 ? 6 : 3
              return Math.min(Math.max(1, g), maxG)
            })
            setClassNo((c) => Math.min(Math.max(1, c), 10))
          }
        }
      } catch { }
    }
    loadSchool()
  }, [])


  const fetchStudents = useCallback(async () => {
    try {
      setError(null)
      const res = await fetch(`/api/school/students?year=${year}&grade=${grade}&class_no=${classNo}`, { credentials: 'include' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '학생 조회 실패')
      setStudents(data.students as StudentRow[])
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      setError(message)
    } finally {
    }
  }, [year, grade, classNo])



  useEffect(() => {
    fetchStudents()
  }, [fetchStudents])

  const openEdit = (row: StudentRow) => {
    setEditTarget(row)
    setDialogOpen(true)
  }


  const openCreateWithNumber = (studentNo: number) => {
    setEditTarget({
      id: '', // New student, no ID yet
      year,
      grade,
      class_no: classNo,
      student_no: studentNo,
      name: `${studentNo}번 학생`,
      gender: null,
      birth_date: '',
      email: '',
      height_cm: null,
      weight_kg: null,
      notes: '',
    })
    setDialogOpen(true)
  }

  return (
    <div className="console-page space-y-5">
      <PageHeader title="학생 정보입력" eyebrow="학생" />

      <FilterBar>
        <ClassFilterFields
          year={year} grade={grade} classNo={classNo}
          years={Array.from({ length: 7 }, (_, index) => {
            const value = computeDefaultYear() + 1 - index
            return { value, label: `${value}년` }
          })}
          gradeCount={schoolType === 1 ? 6 : 3} labels={{ year: '년도' }}
          onYearChange={setYear} onGradeChange={setGrade} onClassChange={setClassNo}
        />
      </FilterBar>

      <div className="min-w-0 border-y border-border bg-card">

        {error && (
          <div className="mb-4 text-[13px] text-destructive">{error}</div>
        )}
        <div className="[&>div]:max-h-[calc(100dvh-18rem)] [&>div]:overflow-auto">
          <Table className="min-w-[1040px] text-[13px] font-normal tabular-nums">
            <TableHeader className="sticky top-0 z-10 bg-card [&_tr]:border-b-2">
              <TableRow>
                <TableHead className="px-3 py-2 w-16 text-left text-[13px] font-bold text-foreground">번호</TableHead>
                <TableHead className="px-3 py-2 w-32 text-left text-[13px] font-bold text-foreground">이름</TableHead>
                <TableHead className="px-3 py-2 w-16 text-left text-[13px] font-bold text-foreground">성별</TableHead>
                <TableHead className="px-3 py-2 w-32 text-left text-[13px] font-bold text-foreground">생년월일</TableHead>
                <TableHead className="px-3 py-2 w-56 text-left text-[13px] font-bold text-foreground">이메일</TableHead>
                <TableHead className="px-3 py-2 w-24 text-left text-[13px] font-bold text-foreground">키(cm)</TableHead>
                <TableHead className="px-3 py-2 w-28 text-left text-[13px] font-bold text-foreground">몸무게(kg)</TableHead>
                <TableHead className="px-3 py-2 w-auto text-left text-[13px] font-bold text-foreground">특이사항</TableHead>
                <TableHead className="px-2 py-2 w-28"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="bg-card divide-y divide-border">
              {Array.from({ length: 30 }).map((_, idx) => {
                const num = idx + 1
                const s = students.find(st => st.student_no === num)
                if (s) {
                  return (
                    <TableRow key={num} className="hover:bg-muted">
                      <TableCell className="px-3 py-2 whitespace-nowrap text-[13px] text-foreground">{s.student_no}</TableCell>
                      <TableCell className="px-3 py-2 whitespace-nowrap text-[13px] font-bold text-foreground">{s.name}</TableCell>
                      <TableCell className="px-3 py-2 whitespace-nowrap text-[13px] text-foreground">{s.gender === 'M' ? '남' : s.gender === 'F' ? '여' : '-'}</TableCell>
                      <TableCell className="px-3 py-2 whitespace-nowrap text-[13px] text-foreground">{s.birth_date ?? '-'}</TableCell>
                      <TableCell className="px-3 py-2 whitespace-nowrap text-[13px] text-foreground">{s.email ?? '-'}</TableCell>
                      <TableCell className="px-3 py-2 whitespace-nowrap text-[13px] text-foreground">{s.height_cm ?? '-'}</TableCell>
                      <TableCell className="px-3 py-2 whitespace-nowrap text-[13px] text-foreground">{s.weight_kg ?? '-'}</TableCell>
                      <TableCell className="px-3 py-2 text-[13px] text-foreground truncate max-w-[1px]">{s.notes ?? '-'}</TableCell>
                      <TableCell className="px-2 py-2 whitespace-nowrap text-right text-[13px]">
                        <div className="flex gap-1 justify-end">
                          <Button variant="outline"
                            onClick={() => openEdit(s)}
                            className="px-2 py-1 border border-border text-foreground hover:bg-card"
                          >
                            수정
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                }
                return (
                  <TableRow key={num} className="hover:bg-muted">
                    <TableCell className="px-3 py-2 whitespace-nowrap text-[13px] text-foreground">{num}</TableCell>
                    <TableCell className="px-3 py-2 whitespace-nowrap text-[13px] font-bold text-foreground">{`${num}번 학생`}</TableCell>
                    <TableCell className="px-3 py-2 whitespace-nowrap text-[13px] text-muted-foreground">-</TableCell>
                    <TableCell className="px-3 py-2 whitespace-nowrap text-[13px] text-muted-foreground">-</TableCell>
                    <TableCell className="px-3 py-2 whitespace-nowrap text-[13px] text-muted-foreground">-</TableCell>
                    <TableCell className="px-3 py-2 whitespace-nowrap text-[13px] text-muted-foreground">-</TableCell>
                    <TableCell className="px-3 py-2 whitespace-nowrap text-[13px] text-muted-foreground">-</TableCell>
                    <TableCell className="px-3 py-2 text-[13px] text-muted-foreground">-</TableCell>
                    <TableCell className="px-2 py-2 whitespace-nowrap text-right text-[13px]">
                      <div className="flex gap-1 justify-end">
                        <Button variant="outline"
                          onClick={() => openCreateWithNumber(num)}
                          className="px-2 py-1 border border-border text-foreground hover:bg-card"
                        >
                          수정
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      {dialogOpen && (
        <StudentDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          initial={editTarget}
          year={year}
          grade={grade}
          classNo={classNo}
          onSaved={async () => {
            setDialogOpen(false)
            await fetchStudents()
          }}
        />
      )}
    </div>
  )
}

interface StudentDialogProps {
  open: boolean
  onClose: () => void
  initial: StudentRow | null
  year: number
  grade: number
  classNo: number
  onSaved: () => Promise<void> | void
}

function StudentDialog({ open, onClose, initial, year, grade, classNo, onSaved }: StudentDialogProps) {
  const { notify, confirmAction } = useFeedback()
  const isEdit = Boolean(initial && initial.id)
  interface StudentForm {
    year: number
    grade: number
    class_no: number
    student_no: string
    name: string
    gender: '' | Gender
    birth_date: string
    email: string
    height_cm: string
    weight_kg: string
    notes: string
  }
  const [form, setForm] = useState<StudentForm>({
    year,
    grade,
    class_no: classNo,
    student_no: initial && initial.student_no != null ? String(initial.student_no) : '',
    name: initial?.name ?? '',
    gender: (initial?.gender ?? '') as '' | Gender,
    birth_date: initial?.birth_date ?? '',
    email: initial?.email ?? '',
    height_cm: initial && initial.height_cm != null ? String(initial.height_cm) : '',
    weight_kg: initial && initial.weight_kg != null ? String(initial.weight_kg) : '',
    notes: initial?.notes ?? '',
  })

  useEffect(() => {
    setForm((prev) => ({ ...prev, year, grade, class_no: classNo }))
  }, [year, grade, classNo])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target
    if (name === 'year') {
      const parsed = Number(value)
      setForm((prev) => ({ ...prev, year: Number.isFinite(parsed) ? parsed : prev.year }))
      return
    }
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  // 숫자만 허용 (정수)
  const handleIntChange = (name: 'student_no', raw: string) => {
    const onlyDigits = raw.replace(/\D+/g, '')
    if (onlyDigits === '') {
      setForm((prev) => ({ ...prev, [name]: '' }))
      return
    }
    let num = parseInt(onlyDigits, 10)
    if (!Number.isFinite(num)) num = 1
    if (num < 1) num = 1
    if (num > 30) num = 30
    setForm((prev) => ({ ...prev, [name]: String(num) }))
  }

  // 숫자와 소수점 하나만 허용 (실수)
  const handleDecimalChange = (name: 'height_cm' | 'weight_kg', raw: string) => {
    let sanitized = raw.replace(/[^0-9.]+/g, '')
    const firstDot = sanitized.indexOf('.')
    if (firstDot !== -1) {
      // 첫 번째 소수점만 유지
      sanitized = sanitized.slice(0, firstDot + 1) + sanitized.slice(firstDot + 1).replace(/\./g, '')
    }
    // 소수점 둘째 자리까지만 허용
    if (sanitized.includes('.')) {
      const [intPart, fracRaw] = sanitized.split('.')
      const fracPart = (fracRaw || '').slice(0, 2)
      sanitized = fracPart.length > 0 ? `${intPart}.${fracPart}` : `${intPart}.`
    }
    setForm((prev) => ({ ...prev, [name]: sanitized }))
  }

  const submit = async () => {
    // 간단 검증
    if (!form.name || !form.student_no) {
      notify('이름과 번호는 필수입니다.')
      return
    }

    // 공통 검증: 번호 1~30 범위 확인
    const parsedNo = Number(form.student_no)
    if (!Number.isFinite(parsedNo) || parsedNo < 1 || parsedNo > 30) {
      notify('번호는 1~30 사이여야 합니다.')
      return
    }

    const payload = {
      id: isEdit && initial ? initial.id : undefined,
      source_student_no: initial && initial.student_no != null ? initial.student_no : undefined,
      year: Number(form.year),
      grade: Number(form.grade),
      class_no: Number(form.class_no),
      student_no: form.student_no === '' ? undefined : Number(form.student_no),
      name: form.name,
      gender: form.gender || null,
      birth_date: form.birth_date || null,
      email: form.email || null,
      height_cm: form.height_cm === '' ? null : Number(form.height_cm),
      weight_kg: form.weight_kg === '' ? null : Number(form.weight_kg),
      notes: form.notes || null,
    }

    const res = await fetch('/api/school/students/save-slot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'include',
    })

    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      notify(data.error || '저장에 실패했습니다.')
      return
    }

    await onSaved()
  }

  const handleDeleteAll = async () => {
    if (!isEdit || !initial) return
    const confirmed = await confirmAction('해당 학생의 학생 데이터와 관련 운동기록이 모두 삭제됩니다.\n정말 삭제하시겠습니까?')
    if (!confirmed) return

    try {
      const res = await fetch(`/api/school/students/${initial.id}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        notify(data.error || '삭제 중 오류가 발생했습니다.')
        return
      }
      notify('학생 데이터와 관련 운동기록이 모두 삭제되었습니다.')
      await onSaved()
    } catch {
      notify('삭제 중 알 수 없는 오류가 발생했습니다.')
    }
  }

  if (!open) return null

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="bg-card max-h-[90dvh] overflow-y-auto sm:max-w-xl" aria-describedby={undefined}>
        <DialogTitle>{isEdit ? '학생 정보 수정' : '학생 추가'}</DialogTitle>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="student-year" className="block text-[13px] font-medium text-foreground mb-1">년도</Label>
            <Input id="student-year" name="year" value={form.year} onChange={handleChange} type="number" className="w-full h-10 px-3 border-border text-[13px]" />
          </div>
          <div>
            <Label htmlFor="student-student_no" className="block text-[13px] font-medium text-foreground mb-1">번호</Label>
            <Input
              id="student-student_no"
              name="student_no"
              value={form.student_no}
              onChange={(e) => handleIntChange('student_no', e.target.value)}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={2}
              className="w-full h-10 px-3 border-border text-[13px]"
            />
          </div>
          <div>
            <Label htmlFor="student-name" className="block text-[13px] font-medium text-foreground mb-1">이름</Label>
            <Input id="student-name" name="name" value={form.name} onChange={handleChange} className="w-full h-10 px-3 border-border text-[13px]" />
          </div>
          <div>
            <Label htmlFor="student-gender" className="block text-[13px] font-medium text-foreground mb-1">성별</Label>
            <RecordSelect id="student-gender" aria-label="성별" name="gender" value={form.gender} onValueChange={(value) => setForm((prev) => ({ ...prev, gender: value as '' | Gender }))} className="h-10 w-full">
              <option value="">선택</option>
              <option value="M">남</option>
              <option value="F">여</option>
            </RecordSelect>
          </div>
          <div>
            <Label htmlFor="student-birth_date" className="block text-[13px] font-medium text-foreground mb-1">생년월일</Label>
            <Input id="student-birth_date" name="birth_date" value={form.birth_date} onChange={handleChange} type="date" className="w-full h-10 px-3 border-border text-[13px]" />
          </div>
          <div>
            <Label htmlFor="student-email" className="block text-[13px] font-medium text-foreground mb-1">이메일</Label>
            <Input id="student-email" name="email" value={form.email} onChange={handleChange} type="email" className="w-full h-10 px-3 border-border text-[13px]" />
          </div>
          <div>
            <Label htmlFor="student-height_cm" className="block text-[13px] font-medium text-foreground mb-1">키(cm)</Label>
            <Input id="student-height_cm" name="height_cm" value={form.height_cm} onChange={(e) => handleDecimalChange('height_cm', e.target.value)} type="text" inputMode="decimal" pattern="^[0-9]*\.?[0-9]{0,2}$" className="w-full h-10 px-3 border-border text-[13px]" />
          </div>
          <div>
            <Label htmlFor="student-weight_kg" className="block text-[13px] font-medium text-foreground mb-1">몸무게(kg)</Label>
            <Input id="student-weight_kg" name="weight_kg" value={form.weight_kg} onChange={(e) => handleDecimalChange('weight_kg', e.target.value)} type="text" inputMode="decimal" pattern="^[0-9]*\.?[0-9]{0,2}$" className="w-full h-10 px-3 border-border text-[13px]" />
          </div>
          <div>
            <Label htmlFor="student-notes" className="block text-[13px] font-medium text-foreground mb-1">특이사항</Label>
            <Input id="student-notes" name="notes" value={form.notes} onChange={handleChange} maxLength={16} className="w-full h-10 px-3 border-border text-[13px]" />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <div>
            {isEdit && initial && (
              <Button variant="outline"
                type="button"
                onClick={handleDeleteAll} aria-label="학생 데이터와 관련 운동기록 삭제"
                className="px-4 py-2 bg-primary text-primary-foreground hover:bg-primary text-[13px] font-semibold"
              >
                데이터 삭제
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} className="px-4 py-2 border border-border hover:bg-muted">취소</Button>
            <Button variant="outline" onClick={submit} className="px-4 py-2 bg-primary text-primary-foreground hover:bg-primary">저장</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}



