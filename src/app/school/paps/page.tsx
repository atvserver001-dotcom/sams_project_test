"use client"

import React, { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { RecordSelect } from '@/components/school-records/record-select'
import { Label } from '@/components/ui/label'
import { PageHeader } from '@/components/console/page-header'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { FilterBar } from '@/components/console/filter-bar'
import { ClassFilterFields } from '@/components/console/class-filter-fields'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Download, Printer, UserRound, UsersRound } from 'lucide-react'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { renderPersonalReport, type ReportMeasurement } from '@/components/paps/personal-report'
import { renderClassReport, type ClassReportMeasurement } from '@/components/paps/class-report'
import * as XLSX from 'xlsx'

type Gender = 'M' | 'F'

interface StudentRow {
  id: string
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

type PapsViewMode = 'record' | 'grade'

interface PapsRow {
  student_id: string
  student_no: number
  name: string
  muscular_endurance: (number | null)[]
  power_1: (number | null)[]
  power_2: (number | null)[]
  flexibility_1: (number | null)[]
  flexibility_2: (number | null)[]
  cardio_1min: (number | null)[]
  cardio_2min: (number | null)[]
  cardio_3min: (number | null)[]
  bmi: (number | null)[]
}

interface GradeRefRow {
  id: number
  exercise_id: number
  school_id: number
  grade: number
  sex: number
  grade5: number[]
  grade4: number[]
  grade3: number[]
  grade2: number[]
  grade1: number[]
}

// 등급 점수 기준: 5등급 0~3, 4등급 4~7, 3등급 8~11, 2등급 12~15, 1등급 16~20
function calcGradeAndScore(
  value: number,
  ref: GradeRefRow
): { gradeNo: number; score: number } | null {
  const levels: { arr: number[]; gradeNo: number; baseScore: number }[] = [
    { arr: ref.grade1, gradeNo: 1, baseScore: 16 },
    { arr: ref.grade2, gradeNo: 2, baseScore: 12 },
    { arr: ref.grade3, gradeNo: 3, baseScore: 8 },
    { arr: ref.grade4, gradeNo: 4, baseScore: 4 },
    { arr: ref.grade5, gradeNo: 5, baseScore: 0 },
  ]

  if (value > ref.grade1[3]) {
    return { gradeNo: 1, score: 20 }
  }

  for (const lvl of levels) {
    if (value >= lvl.arr[0]) {
      let pos = 0
      for (let i = 3; i >= 0; i--) {
        if (value >= lvl.arr[i]) {
          pos = i
          break
        }
      }
      return { gradeNo: lvl.gradeNo, score: lvl.baseScore + pos }
    }
  }

  return { gradeNo: 5, score: 0 }
}

const BMI_SCORE_MAP = [13, 14, 15, 16, 17, 18, 19, 20, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]

function getBmiResult(initialScore: number): { gradeNo: number; score: number; label: string } {
  const score = BMI_SCORE_MAP[Math.min(19, initialScore)] ?? 1

  let label = "정상"
  let gradeNo = 1

  if (score <= 4) {
    label = "고도비만"
    gradeNo = 5
  } else if (score <= 8) {
    label = "경도비만"
    gradeNo = 4
  } else if (score <= 12) {
    label = "과체중"
    gradeNo = 3
  } else if (score <= 16) {
    label = "마름"
    gradeNo = 2
  } else {
    label = "정상"
    gradeNo = 1
  }

  return { gradeNo, score, label }
}

function gradeColor(gradeNo: number): string {
  return gradeNo >= 4 ? 'border border-border bg-muted text-foreground' : 'border border-border bg-card text-foreground'
}

function gradeTextColor(gradeNo: number): string {
  return gradeNo >= 4 ? 'text-destructive' : 'text-foreground'
}

// PEI (Physical Efficiency Index) 계산
// 1. 일반 (초등, 중등, 고등 여학생): PEI = D / P * 100
// 2. 고등학생 (남학생): PEI = D * 100 / (5.5 * p / 2) + 0.22 * (300 - D)
// D: 스텝운동 지속시간 (180초), P: 1+2+3분 심박수 합, p: 1분 심박수
function getCardioPEI(row: PapsRow, idx: number, schoolType: number, gender: Gender | null): number | null {
  const d = 180
  const c1 = row.cardio_1min[idx]
  const c2 = row.cardio_2min[idx]
  const c3 = row.cardio_3min[idx]

  // 고등학생(3) 남학생(M)
  if (schoolType === 3 && gender === 'M') {
    if (c1 === null || c1 === 0) return null
    const pei = (d * 100 / (5.5 * Number(c1) / 2)) + (0.22 * (300 - d))
    return Math.round(pei * 10) / 10
  }

  // 일반 공식 (초/중/고여)
  if (c1 === null || c2 === null || c3 === null) return null
  const P = Number(c1) + Number(c2) + Number(c3)
  if (P === 0) return null

  const pei = (d / P) * 100
  return Math.round(pei * 10) / 10
}

export default function PapsPage() {
  const computeDefaultYear = () => {
    const now = new Date()
    const m = now.getMonth() + 1
    return (m === 1 || m === 2) ? now.getFullYear() - 1 : now.getFullYear()
  }

  const [grade, setGrade] = useState<number>(1)
  const [classNo, setClassNo] = useState<number>(1)
  const [schoolType, setSchoolType] = useState<1 | 2 | 3>(1)
  const [year, setYear] = useState<number>(computeDefaultYear())

  const [students, setStudents] = useState<StudentRow[]>([])
  const [rows, setRows] = useState<PapsRow[]>([])
  const [gradeRefs, setGradeRefs] = useState<GradeRefRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [schoolName, setSchoolName] = useState<string>('')

  const [view, setView] = useState<PapsViewMode>('record')
  const [showPrintModal, setShowPrintModal] = useState(false)
  const [studentPrintMonths, setStudentPrintMonths] = useState<Record<number, number>>({})
  const [showPrintTypeModal, setShowPrintTypeModal] = useState(false)
  const [showClassPrintModal, setShowClassPrintModal] = useState(false)
  const [classPrintMonth, setClassPrintMonth] = useState<number>(2) // 기본값 3월 (origIdx=2)
  const [showExcelModal, setShowExcelModal] = useState(false)
  const [excelMonth, setExcelMonth] = useState<number>(2)

  // 월 인덱스 순서 (3월~다음해 2월) - exercises/heart-rate와 동일
  const monthOrderIdx = useMemo(() => [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 0, 1], [])
  const months = useMemo(() => monthOrderIdx.map((idx) => `${idx + 1}월`), [monthOrderIdx])
  const monthCellPx = 56

  // 특정 학생의 특정 월 데이터 유무 확인
  const hasStudentData = (studentNo: number, origIdx: number) => {
    const row = rows.find(r => r.student_no === studentNo)
    if (!row) return false
    return (
      row.muscular_endurance[origIdx] !== null ||
      row.power_1[origIdx] !== null ||
      row.power_2[origIdx] !== null ||
      row.flexibility_1[origIdx] !== null ||
      row.flexibility_2[origIdx] !== null ||
      row.cardio_1min[origIdx] !== null ||
      row.cardio_2min[origIdx] !== null ||
      row.cardio_3min[origIdx] !== null ||
      row.bmi[origIdx] !== null
    )
  }

  // 모달 열릴 때 초기 월 설정 (데이터가 있는 마지막 월)
  useEffect(() => {
    if (showPrintModal) {
      const defaults: Record<number, number> = {}
      students.forEach(s => {
        const num = s.student_no
        for (let i = monthOrderIdx.length - 1; i >= 0; i--) {
          const origIdx = monthOrderIdx[i]
          if (hasStudentData(num, origIdx)) {
            defaults[num] = origIdx
            break
          }
        }
      })
      setStudentPrintMonths(defaults)
    }
  }, [showPrintModal]) // eslint-disable-line react-hooks/exhaustive-deps

  const onChangeYear = (v: number) => { setYear(v) }
  const onChangeGrade = (v: number) => { setGrade(v) }
  const onChangeClassNo = (v: number) => { setClassNo(v) }

  useEffect(() => {
    const loadSchool = async () => {
      try {
        const res = await fetch('/api/school/info', { credentials: 'include' })
        const data = await res.json()
        if (res.ok && data?.school) {
          if (data.school.name) setSchoolName(data.school.name)
          if (data.school.school_type) {
            const t = Number(data.school.school_type)
            if (t === 1 || t === 2 || t === 3) {
              setSchoolType(t as 1 | 2 | 3)
              setGrade((g) => {
                const maxG = t === 1 ? 6 : 3
                return Math.min(Math.max(1, g), maxG)
              })
              setClassNo((c) => Math.min(Math.max(1, c), 10))
            }
          }
        }
      } catch { }
    }
    loadSchool()
  }, [])

  useEffect(() => {
    const loadGradeRefs = async () => {
      try {
        const res = await fetch('/api/school/paps/grade-reference', { credentials: 'include' })
        const data = await res.json()
        if (res.ok && data?.refs) {
          setGradeRefs(data.refs as GradeRefRow[])
        }
      } catch { }
    }
    loadGradeRefs()
  }, [])

  const fetchStudents = async () => {
    try {
      setError(null)
      const res = await fetch(`/api/school/students?year=${year}&grade=${grade}&class_no=${classNo}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '학생 조회 실패')
      setStudents(data.students as StudentRow[])
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      setError(message)
    }
  }

  useEffect(() => {
    fetchStudents()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grade, classNo, year])

  const fetchPaps = async (yearValue: number, studs: StudentRow[]) => {
    try {
      setError(null)
      const res = await fetch(`/api/school/paps?grade=${grade}&class_no=${classNo}&year=${yearValue}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'PAPS 기록 조회 실패')
      const apiRows = (data.rows || []) as PapsRow[]
      setRows(apiRows)
    } catch (e: unknown) {
      const empty12 = Array.from({ length: 12 }, () => null)
      const mapped: PapsRow[] = studs
        .slice()
        .sort((a, b) => (a.student_no ?? 0) - (b.student_no ?? 0))
        .map(s => ({
          student_id: s.id,
          student_no: s.student_no,
          name: s.name,
          muscular_endurance: [...empty12],
          power_1: [...empty12],
          power_2: [...empty12],
          flexibility_1: [...empty12],
          flexibility_2: [...empty12],
          cardio_1min: [...empty12],
          cardio_2min: [...empty12],
          cardio_3min: [...empty12],
          bmi: [...empty12],
        }))
      setRows(mapped)
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  useEffect(() => {
    if (students.length === 0) {
      setRows([])
      return
    }
    fetchPaps(year, students)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [students, year])

  // 기록 탭 필드 정의 (순발력/유연성 한 줄로 통합)
  const recordFields: {
    key: string;
    label: string;
    unit: string;
    bgClass: string;
    textClass: string;
    render: (row: PapsRow, origIdx: number) => React.ReactNode
  }[] = [
      {
        key: 'muscular_endurance',
        label: '근지구력',
        unit: '회',
        bgClass: 'bg-card',
        textClass: 'text-muted-foreground',
        render: (r, i) => r.muscular_endurance[i] !== null ? Math.round(Number(r.muscular_endurance[i])) : '-'
      },
      {
        key: 'power',
        label: '순발력',
        unit: 'cm',
        bgClass: 'bg-card',
        textClass: 'text-muted-foreground',
        render: (r, i) => {
          const v1 = r.power_1[i]
          const v2 = r.power_2[i]
          if (v1 === null && v2 === null) return '-'
          return (
            <div className="flex flex-col text-[13px] font-normal leading-normal">
              <span>{v1 !== null ? Number(v1).toFixed(1) : '-'}</span>
              <div className="h-[1px] w-full bg-card my-0.5" />
              <span>{v2 !== null ? Number(v2).toFixed(1) : '-'}</span>
            </div>
          )
        }
      },
      {
        key: 'flexibility',
        label: '유연성',
        unit: 'cm',
        bgClass: 'bg-card',
        textClass: 'text-muted-foreground',
        render: (r, i) => {
          const v1 = r.flexibility_1[i]
          const v2 = r.flexibility_2[i]
          if (v1 === null && v2 === null) return '-'
          return (
            <div className="flex flex-col text-[13px] font-normal leading-normal">
              <span>{v1 !== null ? Number(v1).toFixed(1) : '-'}</span>
              <div className="h-[1px] w-full bg-card my-0.5" />
              <span>{v2 !== null ? Number(v2).toFixed(1) : '-'}</span>
            </div>
          )
        }
      },
      {
        key: 'cardio_pei',
        label: '심폐지구력',
        unit: 'PEI',
        bgClass: 'bg-card',
        textClass: 'text-muted-foreground',
        render: (r, i) => {
          const student = students.find(s => s.id === r.student_id)
          const pei = getCardioPEI(r, i, schoolType, student?.gender ?? null)
          return pei !== null ? pei.toFixed(1) : '-'
        }
      },
      {
        key: 'bmi',
        label: '체질량지수',
        unit: 'kg/m²',
        bgClass: 'bg-card',
        textClass: 'text-muted-foreground',
        render: (r, i) => r.bmi[i] !== null ? Number(r.bmi[i]).toFixed(1) : '-'
      },
    ]

  // 등급 계산용 필드 (exerciseId 기준)
  const gradeFields: { key: string; label: string; bgClass: string; textClass: string; exerciseId: number; getValue: (row: PapsRow, origIdx: number) => number | null }[] = [
    { key: 'muscular_endurance', label: '근지구력', bgClass: 'bg-card', textClass: 'text-muted-foreground', exerciseId: 1, getValue: (r, i) => r.muscular_endurance[i] },
    {
      key: 'power', label: '순발력', bgClass: 'bg-card', textClass: 'text-muted-foreground', exerciseId: 2, getValue: (r, i) => {
        // 순발력: 1회, 2회 중 더 좋은 값 사용
        const v1 = r.power_1[i]
        const v2 = r.power_2[i]
        if (v1 === null && v2 === null) return null
        if (v1 === null) return v2
        if (v2 === null) return v1
        return Math.max(v1, v2)
      }
    },
    {
      key: 'flexibility', label: '유연성', bgClass: 'bg-card', textClass: 'text-muted-foreground', exerciseId: 3, getValue: (r, i) => {
        // 유연성: 1회, 2회 중 더 좋은 값 사용
        const v1 = r.flexibility_1[i]
        const v2 = r.flexibility_2[i]
        if (v1 === null && v2 === null) return null
        if (v1 === null) return v2
        if (v2 === null) return v1
        return Math.max(v1, v2)
      }
    },
    {
      key: 'cardio_endurance', label: '심폐지구력', bgClass: 'bg-card', textClass: 'text-muted-foreground', exerciseId: 4, getValue: (r, i) => {
        const student = students.find(s => s.id === r.student_id)
        return getCardioPEI(r, i, schoolType, student?.gender ?? null)
      }
    },
    { key: 'bmi', label: '체질량지수', bgClass: 'bg-card', textClass: 'text-muted-foreground', exerciseId: 5, getValue: (r, i) => r.bmi[i] },
  ]

  // 등급 참조 행 찾기
  const findGradeRef = (exerciseId: number, studentGrade: number, gender: Gender | null): GradeRefRow | null => {
    if (gradeRefs.length === 0) return null
    const sexCode = gender === 'F' ? 2 : 1 // 성별 미지정 시 남(M)으로 기본 처리

    if (exerciseId === 4) {
      return gradeRefs.find(r => r.exercise_id === 4) ?? null
    }

    const exact = gradeRefs.find(r =>
      r.exercise_id === exerciseId &&
      r.school_id === schoolType &&
      r.grade === studentGrade &&
      r.sex === sexCode
    )
    if (exact) return exact

    const bySchool = gradeRefs.find(r =>
      r.exercise_id === exerciseId &&
      r.school_id === schoolType &&
      r.grade === 0 &&
      r.sex === sexCode
    )
    if (bySchool) return bySchool

    return gradeRefs.find(r =>
      r.exercise_id === exerciseId &&
      r.school_id === 0 &&
      r.sex === 0
    ) ?? null
  }

  // 항목별 한글 종목명 매핑 (결과지 출력용)
  const exerciseNames: Record<number, { category: string; method: string }> = {
    1: { category: '근력 / 근지구력 평가', method: '윗몸말아올리기 (회)' },
    2: { category: '순발력 평가', method: '제자리 멀리뛰기 (cm)' },
    3: { category: '유연성 평가', method: '앉아 윗몸 앞으로 굽히기 (cm)' },
    4: { category: '심폐지구력 평가', method: '스텝검사' },
    5: { category: '체지방 평가', method: '체질량지수 (kg/m²)' },
  }

  // 결과지 출력 핸들러
  const handlePrintStudent = (studentNo: number, selectedOrigIdx?: number) => {
    const student = students.find(s => s.student_no === studentNo) || null
    const record = rows.find(r => r.student_no === studentNo) || null
    const origIdx = selectedOrigIdx !== undefined ? selectedOrigIdx : 2

    const gender = student?.gender ?? null
    const genderLabel = gender === 'M' ? '남' : gender === 'F' ? '여' : '-'
    const formatMeasurement = (value: number | null | undefined, digits = 1) =>
      value == null ? '-' : Number(value).toFixed(digits)

    const itemResults = gradeFields.map(field => {
      const ref = findGradeRef(field.exerciseId, grade, gender)
      const value = record ? field.getValue(record, origIdx) : null
      const result = value == null || !ref ? null : calcGradeAndScore(Number(value), ref)
      if (!result) return { exerciseId: field.exerciseId, rawValue: value, result: null, label: '-' }
      if (field.exerciseId === 5) {
        const bmi = getBmiResult(result.score)
        return { exerciseId: field.exerciseId, rawValue: value, result: bmi, label: bmi.label }
      }
      return { exerciseId: field.exerciseId, rawValue: value, result, label: `${result.gradeNo}등급` }
    })

    // A partial record is not a completed assessment with the absent scores set to zero.
    const complete = itemResults.every(item => item.result !== null)
    const totalScore = complete
      ? itemResults.reduce((sum, item) => sum + item.result!.score, 0)
      : null
    const finalGrade = totalScore === null ? null
      : totalScore < 20 ? 5
        : totalScore < 40 ? 4
          : totalScore < 60 ? 3
            : totalScore < 80 ? 2 : 1
    const power = itemResults.find(item => item.exerciseId === 2)?.result
    const cardio = itemResults.find(item => item.exerciseId === 4)?.result
    const bmi = itemResults.find(item => item.exerciseId === 5)?.result

    const measurement = (exerciseId: number, value: number | null): ReportMeasurement => {
      if (exerciseId === 2 || exerciseId === 3) {
        const first = exerciseId === 2 ? record?.power_1[origIdx] : record?.flexibility_1[origIdx]
        const second = exerciseId === 2 ? record?.power_2[origIdx] : record?.flexibility_2[origIdx]
        return { kind: 'paired', first: formatMeasurement(first), second: formatMeasurement(second) }
      }
      if (exerciseId === 4) {
        return {
          kind: 'step',
          pei: formatMeasurement(value),
          heartRates: [
            formatMeasurement(record?.cardio_1min[origIdx], 0),
            formatMeasurement(record?.cardio_2min[origIdx], 0),
            formatMeasurement(record?.cardio_3min[origIdx], 0),
          ],
        }
      }
      return { kind: 'single', value: formatMeasurement(value, exerciseId === 1 ? 0 : 1) }
    }

    const html = renderPersonalReport({
      schoolName: schoolName || '-',
      studentName: student?.name ?? `${studentNo}번 학생`,
      studentNo, grade, classNo, genderLabel, month: origIdx + 1,
      heightCm: formatMeasurement(student?.height_cm),
      weightKg: formatMeasurement(student?.weight_kg),
      items: itemResults.map(item => ({
        exerciseId: item.exerciseId,
        ...exerciseNames[item.exerciseId],
        measurement: measurement(item.exerciseId, item.rawValue),
        score: item.result?.score ?? null,
        gradeNo: item.result?.gradeNo ?? null,
        resultLabel: item.label,
      })),
      totalScore, finalGrade,
      badges: [
        { key: 'sports', label: '스포츠 영재', active: power && cardio ? power.score === 20 && cardio.score === 20 : null },
        { key: 'health', label: '건강 체력 우수', active: complete ? itemResults.every(item => item.result?.gradeNo === 1) : null },
        { key: 'fitness', label: '체력 우수', active: cardio ? cardio.gradeNo === 1 : null },
        { key: 'low', label: '저체력', active: complete ? itemResults.every(item => item.result!.gradeNo >= 4) : null },
        { key: 'bmi', label: '비만', active: bmi ? bmi.gradeNo >= 4 : null },
      ],
    })

    const iframe = document.createElement('iframe')
    iframe.style.position = 'fixed'
    iframe.style.right = '0'
    iframe.style.bottom = '0'
    iframe.style.width = '0'
    iframe.style.height = '0'
    iframe.style.border = '0'
    document.body.appendChild(iframe)

    const doc = iframe.contentWindow?.document
    if (doc) {
      doc.open()
      doc.write(html)
      doc.close()
    }

    setTimeout(async () => {
      await doc?.fonts.ready
      await Promise.allSettled(Array.from(doc?.images ?? [], (image) => image.decode()))
      iframe.contentWindow?.focus()
      iframe.contentWindow?.print()
      setTimeout(() => {
        document.body.removeChild(iframe)
      }, 1000)
    }, 500)
  }

  // 학급 전체 결과지 출력 핸들러
  const handlePrintClassAll = (origIdx: number) => {
    const formatValue = (value: number | null | undefined, digits = 1) =>
      value == null ? '-' : Number(value).toFixed(digits)

    const classData = Array.from({ length: 30 }, (_, idx) => {
      const num = idx + 1
      const student = students.find(s => s.student_no === num) || null
      const record = rows.find(r => r.student_no === num) || null
      const gender = student?.gender ?? null

      const itemResults = gradeFields.map(field => {
        if (!record) return { exerciseId: field.exerciseId, result: null, label: '-' }
        const ref = findGradeRef(field.exerciseId, grade, gender)
        const value = field.exerciseId === 4
          ? getCardioPEI(record, origIdx, schoolType, gender)
          : field.getValue(record, origIdx)
        const result = value == null || !ref ? null : calcGradeAndScore(Number(value), ref)
        if (!result) return { exerciseId: field.exerciseId, result: null, label: '-' }
        if (field.exerciseId === 5) {
          const bmi = getBmiResult(result.score)
          return { exerciseId: field.exerciseId, result: bmi, label: bmi.label }
        }
        return { exerciseId: field.exerciseId, result, label: `${result.gradeNo}등급` }
      })

      // Use the same incomplete-assessment display rule as the personal report.
      const complete = itemResults.every(item => item.result !== null)
      const totalScore = complete ? itemResults.reduce((sum, item) => sum + item.result!.score, 0) : null
      const finalGrade = totalScore === null ? null
        : totalScore < 20 ? 5
          : totalScore < 40 ? 4
            : totalScore < 60 ? 3
              : totalScore < 80 ? 2 : 1

      const measurement = (exerciseId: number): ClassReportMeasurement => {
        if (exerciseId === 2 || exerciseId === 3) {
          const first = exerciseId === 2 ? record?.power_1[origIdx] : record?.flexibility_1[origIdx]
          const second = exerciseId === 2 ? record?.power_2[origIdx] : record?.flexibility_2[origIdx]
          return { kind: 'paired', first: formatValue(first), second: formatValue(second) }
        }
        const value = exerciseId === 1 ? record?.muscular_endurance[origIdx]
          : exerciseId === 4 ? record ? getCardioPEI(record, origIdx, schoolType, gender) : null
            : record?.bmi[origIdx]
        return { kind: 'single', value: formatValue(value, exerciseId === 1 ? 0 : 1) }
      }

      return {
        number: num,
        name: student?.name ?? `${num}번 학생`,
        items: itemResults.map(item => ({
          exerciseId: item.exerciseId,
          gradeNo: item.result?.gradeNo ?? null,
          resultLabel: item.label,
          measurement: measurement(item.exerciseId),
        })),
        finalGrade,
      }
    })

    const html = renderClassReport({
      schoolName: schoolName || '-',
      grade, classNo, year, month: origIdx + 1,
      students: classData,
    })

    const iframe = document.createElement('iframe')
    iframe.style.position = 'fixed'
    iframe.style.right = '0'
    iframe.style.bottom = '0'
    iframe.style.width = '0'
    iframe.style.height = '0'
    iframe.style.border = '0'
    document.body.appendChild(iframe)

    const doc = iframe.contentWindow?.document
    if (doc) {
      doc.open()
      doc.write(html)
      doc.close()
    }

    setTimeout(async () => {
      await doc?.fonts.ready
      await Promise.allSettled(Array.from(doc?.images ?? [], (image) => image.decode()))
      iframe.contentWindow?.focus()
      iframe.contentWindow?.print()
      setTimeout(() => {
        document.body.removeChild(iframe)
      }, 1000)
    }, 500)
  }

  // 엑셀 출력 핸들러
  const handleExcelExport = (origIdx: number) => {
    const headers = [
      '학년', '반명', '번호', '학생성명',
      '윗몸 말아 올리기 (회)',
      '제자리 멀리뛰기 (cm)1차', '제자리 멀리뛰기 (cm)2차',
      '앉아 윗몸앞으로 굽히기(cm) 1차', '앉아 윗몸앞으로 굽히기(cm) 2차',
      'Step 검사(1min)', 'Step 검사(2min)', 'Step 검사(3min)',
      'BMI', '신장(cm)', '체중(kg)'
    ]

    const dataRows = Array.from({ length: 30 }, (_, idx) => {
      const num = idx + 1
      const student = students.find(s => s.student_no === num) || null
      const record = rows.find(r => r.student_no === num) || null

      const muscular = record?.muscular_endurance[origIdx]
      const power1 = record?.power_1[origIdx]
      const power2 = record?.power_2[origIdx]
      const flex1 = record?.flexibility_1[origIdx]
      const flex2 = record?.flexibility_2[origIdx]
      const cardio1 = record?.cardio_1min[origIdx]
      const cardio2 = record?.cardio_2min[origIdx]
      const cardio3 = record?.cardio_3min[origIdx]
      const bmi = record?.bmi[origIdx]
      const heightCm = student?.height_cm
      const weightKg = student?.weight_kg

      return [
        grade,
        `${classNo}반`,
        num,
        student?.name ?? `${num}번 학생`,
        muscular !== null && muscular !== undefined ? Math.round(Number(muscular)) : '',
        power1 !== null && power1 !== undefined ? Number(power1) : '',
        power2 !== null && power2 !== undefined ? Number(power2) : '',
        flex1 !== null && flex1 !== undefined ? Number(flex1) : '',
        flex2 !== null && flex2 !== undefined ? Number(flex2) : '',
        cardio1 !== null && cardio1 !== undefined ? Number(cardio1) : '',
        cardio2 !== null && cardio2 !== undefined ? Number(cardio2) : '',
        cardio3 !== null && cardio3 !== undefined ? Number(cardio3) : '',
        bmi !== null && bmi !== undefined ? Number(Number(bmi).toFixed(2)) : '',
        heightCm !== null && heightCm !== undefined ? Number(heightCm) : '',
        weightKg !== null && weightKg !== undefined ? Number(weightKg) : '',
      ]
    })

    const wsData = [headers, ...dataRows]
    const ws = XLSX.utils.aoa_to_sheet(wsData)

    // 열 너비 설정
    ws['!cols'] = [
      { wch: 6 }, { wch: 6 }, { wch: 6 }, { wch: 10 },
      { wch: 18 }, { wch: 20 }, { wch: 20 },
      { wch: 26 }, { wch: 26 },
      { wch: 16 }, { wch: 16 }, { wch: 16 },
      { wch: 8 }, { wch: 10 }, { wch: 10 },
    ]

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'PAPS')

    const fileName = `PAPS_${grade}학년${classNo}반_${origIdx + 1}월_${year}.xlsx`
    XLSX.writeFile(wb, fileName)
  }

  return (
    <div className="console-page space-y-5">
      <PageHeader title="PAPS 기록 관리" eyebrow="기록 관리" />

      <FilterBar>
        <ClassFilterFields
          year={year} grade={grade} classNo={classNo}
          years={Array.from({ length: 7 }, (_, index) => {
            const value = computeDefaultYear() + 1 - index
            return { value, label: `${value}년` }
          })}
          gradeCount={schoolType === 1 ? 6 : 3} labels={{ year: '년도' }}
          onYearChange={onChangeYear} onGradeChange={onChangeGrade} onClassChange={onChangeClassNo}
        />
      </FilterBar>

      {/* 탭 메뉴: 기록 / 등급 + 결과지 출력 버튼 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ToggleGroup type="single" value={view} onValueChange={(value) => { if (value) setView(value as PapsViewMode) }} aria-label="PAPS 보기">
          <ToggleGroupItem value="record">기록</ToggleGroupItem>
          <ToggleGroupItem value="grade">등급</ToggleGroupItem>
        </ToggleGroup>
        <div className="flex items-center gap-2">
          <Button variant="outline"
            onClick={() => setShowPrintTypeModal(true)}
            className="px-5 py-2 text-[13px] font-semibold bg-card text-foreground border border-border hover:bg-muted transition flex items-center gap-2"
          >
            <Printer className="size-4" aria-hidden="true" />
            결과지 출력
          </Button>
          <Button variant="outline"
            onClick={() => setShowExcelModal(true)}
            className="px-5 py-2 text-[13px] font-semibold bg-primary text-primary-foreground border border-border hover:bg-primary transition flex items-center gap-2"
          >
            <Download className="size-4" aria-hidden="true" />
            엑셀 출력
          </Button>
        </div>
      </div>

      <div className="min-w-0 border-y border-border bg-card">
        {error && <div className="mb-4 text-[13px] text-destructive">{error}</div>}

        {view === 'record' ? (
          <div className="[&>div]:max-h-[calc(100dvh-18rem)] [&>div]:overflow-auto">
            <Table className="min-w-[1040px] text-[13px] font-normal tabular-nums">
              <TableHeader className="sticky top-0 z-10 bg-card [&_tr]:border-b-2">
                <TableRow>
                  <TableHead className="px-3 py-2 w-16 text-left text-[13px] font-bold text-foreground">번호</TableHead>
                  <TableHead className="px-3 py-2 w-32 text-left text-[13px] font-bold text-foreground">이름</TableHead>
                  <TableHead className="px-2 py-2 w-24 text-center text-[13px] font-bold text-foreground"></TableHead>
                  {months.map((m) => (
                    <TableHead
                      key={m}
                      className="px-2 py-2 text-center text-[13px] font-bold text-foreground"
                      style={{ width: monthCellPx }}
                    >
                      {m}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody className="bg-card divide-y divide-border">
                {Array.from({ length: 30 }).map((_, idx) => {
                  const num = idx + 1
                  const s = students.find(st => st.student_no === num) || null
                  const r = rows.find(rr => rr.student_no === num) || null
                  const mergedRowSpan = recordFields.length

                  return (
                    <React.Fragment key={num}>
                      {recordFields.map((field, fieldIdx) => {
                        return (
                          <TableRow key={`${num}-${field.key}`} className={`${field.bgClass} h-[42px]`}>
                            {fieldIdx === 0 && (
                              <>
                                <TableCell className="px-3 py-2 whitespace-nowrap text-[13px] font-bold text-foreground align-middle text-center bg-card border-b border-border" rowSpan={mergedRowSpan}>{num}</TableCell>
                                <TableCell className="px-3 py-2 whitespace-nowrap text-[13px] font-bold text-foreground align-middle text-center bg-card border-b border-border" rowSpan={mergedRowSpan}>
                                  {s ? s.name : `${num}번 학생`}
                                </TableCell>
                              </>
                            )}
                            <TableCell className={`px-2 py-2 whitespace-nowrap text-[13px] text-center font-normal ${field.textClass}`}>
                              {field.label}
                              <span className="block text-[11px] font-normal">({field.unit})</span>
                            </TableCell>
                            {monthOrderIdx.map((origIdx, i) => {
                              return (
                                <TableCell key={i} className="px-1 py-1 whitespace-nowrap text-[13px] text-center text-foreground" style={{ width: monthCellPx }}>
                                  {r ? field.render(r, origIdx) : '-'}
                                </TableCell>
                              )
                            })}
                          </TableRow>
                        )
                      })}
                    </React.Fragment>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        ) : (
          /* 등급 탭 */
          <div className="[&>div]:max-h-[calc(100dvh-18rem)] [&>div]:overflow-auto">
            <Table className="min-w-[1040px] text-[13px] font-normal tabular-nums">
              <TableHeader className="sticky top-0 z-10 bg-card [&_tr]:border-b-2">
                <TableRow>
                  <TableHead className="px-3 py-2 w-16 text-left text-[13px] font-bold text-foreground">번호</TableHead>
                  <TableHead className="px-3 py-2 w-28 text-left text-[13px] font-bold text-foreground">이름</TableHead>
                  <TableHead className="px-2 py-2 w-24 text-center text-[13px] font-bold text-foreground"></TableHead>
                  {months.map((m) => (
                    <TableHead
                      key={m}
                      className="px-2 py-2 text-center text-[13px] font-bold text-foreground"
                      style={{ width: monthCellPx }}
                    >
                      {m}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody className="bg-card divide-y divide-border">
                {Array.from({ length: 30 }).map((_, idx) => {
                  const num = idx + 1
                  const s = students.find(st => st.student_no === num) || null
                  const r = rows.find(rr => rr.student_no === num) || null
                  const mergedRowSpan = gradeFields.length + 1

                  const studentInfo = students.find(st => st.student_no === num) || null
                  const gender = studentInfo?.gender ?? null

                  const fieldResults = gradeFields.map(field => {
                    const ref = findGradeRef(field.exerciseId, grade, gender)
                    const results = monthOrderIdx.map((origIdx) => {
                      const v = r ? field.getValue(r, origIdx) : null
                      if (v === null || v === undefined || !ref) return null
                      const res = calcGradeAndScore(Number(v), ref)
                      if (!res) return null
                      if (field.exerciseId === 5) {
                        const bmi = getBmiResult(res.score)
                        return { gradeNo: bmi.gradeNo, score: bmi.score, label: bmi.label }
                      }
                      return { ...res, label: `${res.gradeNo}등급` }
                    })
                    return { field, results }
                  })

                  const monthTotals = Array.from({ length: 12 }, (_, mIdx) => {
                    const scores = fieldResults.map(fr => fr.results[mIdx]?.score ?? null)
                    if (scores.every(s => s === null)) return null
                    return scores.reduce((acc, s) => (acc ?? 0) + (s ?? 0), 0 as number | null)
                  })

                  const getMonthGrade = (totalScore: number | null) => {
                    if (totalScore === null) return null
                    if (totalScore < 20) return 5
                    if (totalScore < 40) return 4
                    if (totalScore < 60) return 3
                    if (totalScore < 80) return 2
                    return 1
                  }

                  return (
                    <React.Fragment key={num}>
                      {fieldResults.map(({ field, results }, fieldIdx) => (
                        <TableRow key={`${num}-${field.key}`} className={`${field.bgClass} h-[42px]`}>
                          {fieldIdx === 0 && (
                            <>
                              <TableCell className="px-3 py-2 whitespace-nowrap text-[13px] font-bold text-foreground align-middle text-center bg-card border-b border-border" rowSpan={mergedRowSpan}>{num}</TableCell>
                              <TableCell className="px-3 py-2 whitespace-nowrap text-[13px] font-bold text-foreground align-middle text-center bg-card border-b border-border" rowSpan={mergedRowSpan}>
                                {s ? s.name : `${num}번 학생`}
                              </TableCell>
                            </>
                          )}
                          <TableCell className={`px-2 py-2 whitespace-nowrap text-[13px] text-center font-normal ${field.textClass}`}>{field.label}</TableCell>
                          {results.map((res, mIdx) => (
                            <TableCell key={mIdx} className="px-1 py-1 whitespace-nowrap text-[13px] font-normal text-center" style={{ width: monthCellPx }}>
                              {res !== null ? (
                                <span className={`inline-block px-1.5 py-0.5 text-[13px] font-normal ${gradeColor(res.gradeNo)}`}>
                                  {res.label}
                                </span>
                              ) : '-'}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                      {/* 합계 점수 요약 행 */}
                      <TableRow className="bg-muted h-[42px] border-t-2 border-border border-b border-border">
                        <TableCell className="px-2 py-2 whitespace-nowrap text-[13px] text-center font-semibold text-foreground">합계</TableCell>
                        {monthTotals.map((total, mIdx) => {
                          const g = getMonthGrade(total)
                          return (
                            <TableCell key={mIdx} className="px-2 py-1 whitespace-nowrap text-center" style={{ width: monthCellPx }}>
                              {g !== null ? (
                                <span className={`text-[13px] font-normal ${gradeTextColor(g)}`}>
                                  {g}등급
                                </span>
                              ) : '-'}
                            </TableCell>
                          )
                        })}
                      </TableRow>
                    </React.Fragment>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* 결과지 출력 모달 */}
      <Dialog open={showPrintModal} onOpenChange={setShowPrintModal}>
        <DialogContent className="bg-card max-h-[90dvh] overflow-y-auto sm:max-w-xl" aria-describedby={undefined}>
            <div className="border-b-2 border-border pb-3 pr-8">
              <DialogTitle>결과지 출력</DialogTitle>

            </div>

            <div className="flex-1 overflow-y-auto px-6 py-3">
              <Table className="w-full text-[13px]">
                <TableHeader>
                  <TableRow className="border-b border-border">
                    <TableHead className="py-2 text-left text-[13px] font-bold text-foreground w-12">번호</TableHead>
                    <TableHead className="py-2 text-left text-[13px] font-bold text-foreground">이름</TableHead>
                    <TableHead className="py-2 text-center text-[13px] font-bold text-foreground w-28">월 선택</TableHead>
                    <TableHead className="py-2 text-right text-[13px] font-bold text-foreground w-20">출력</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Array.from({ length: 30 }, (_, idx) => {
                    const num = idx + 1
                    const st = students.find(s => s.student_no === num) || null

                    // 데이터가 있는 월 리스트 (monthOrderIdx 순서대로)
                    const availableMonths = monthOrderIdx.filter(origIdx => hasStudentData(num, origIdx))
                    const hasAnyData = availableMonths.length > 0

                    const currentOrigIdx = studentPrintMonths[num] ?? (hasAnyData ? availableMonths[0] : 2)
                    const isCurrentEmpty = !hasStudentData(num, currentOrigIdx)

                    return (
                      <TableRow key={num} className="border-b border-border hover:bg-muted transition">
                        <TableCell className="py-2.5 text-[13px] font-semibold text-foreground">{num}</TableCell>
                        <TableCell className="py-2.5 text-[13px] font-bold text-foreground">{st ? st.name : `${num}번 학생`}</TableCell>
                        <TableCell className="py-2.5 text-center">
                          {hasAnyData ? (
                            <RecordSelect aria-label="출력할 월"
                              value={currentOrigIdx}
                              onValueChange={(value) => {
                                const val = Number(value)
                                setStudentPrintMonths(prev => ({ ...prev, [num]: val }))
                              }}
                              className="h-9 min-w-28"
                            >
                              {availableMonths.map(origIdx => (
                                <option key={origIdx} value={origIdx}>
                                  {origIdx + 1}월
                                </option>
                              ))}
                            </RecordSelect>
                          ) : (
                            <span className="text-muted-foreground text-xs">-</span>
                          )}
                        </TableCell>
                        <TableCell className="py-2.5 text-right">
                          <Button variant="outline"
                            onClick={() => handlePrintStudent(num, currentOrigIdx)}
                            disabled={isCurrentEmpty}
                            className={`px-3 py-1.5 text-xs font-semibold transition ${isCurrentEmpty
                              ? 'bg-muted text-muted-foreground cursor-not-allowed'
                              : 'bg-primary text-primary-foreground hover:bg-primary'
                              }`}
                          >
                            출력
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>

            <div className="px-6 py-3 border-t border-border flex justify-end">
              <Button variant="outline"
                onClick={() => setShowPrintModal(false)}
                className="px-4 py-2 text-[13px] font-semibold bg-muted text-foreground hover:bg-muted transition"
              >
                닫기
              </Button>
            </div>

        </DialogContent>
      </Dialog>

      {/* 출력 유형 선택 모달 */}
      <Dialog open={showPrintTypeModal} onOpenChange={setShowPrintTypeModal}>
        <DialogContent className="bg-card max-h-[90dvh] overflow-y-auto sm:max-w-md" aria-describedby={undefined}>
            <div className="border-b-2 border-border pb-3 pr-8">
              <DialogTitle>출력 유형 선택</DialogTitle>

            </div>
            <div className="px-6 py-6 flex flex-col gap-3">
              <Button variant="outline"
                onClick={() => {
                  setShowPrintTypeModal(false)
                  setShowPrintModal(true)
                }}
                className="h-auto min-h-20 w-full justify-start gap-4 whitespace-normal border-2 px-5 py-4 text-left"
              >
                <div className="w-12 h-12 bg-card flex items-center justify-center text-2xl group-hover:bg-card transition">
                  <UserRound className="size-6" aria-hidden="true" />
                </div>
                <div className="text-left">
                  <div className="font-bold text-foreground text-[13px]">학생 개인</div>
                  <div className="text-xs text-muted-foreground mt-0.5">학생별 개별 결과지를 출력합니다</div>
                </div>
              </Button>
              <Button variant="outline"
                onClick={() => {
                  setShowPrintTypeModal(false)
                  setShowClassPrintModal(true)
                }}
                className="h-auto min-h-20 w-full justify-start gap-4 whitespace-normal border-2 px-5 py-4 text-left"
              >
                <div className="w-12 h-12 bg-card flex items-center justify-center text-2xl group-hover:bg-card transition">
                  <UsersRound className="size-6" aria-hidden="true" />
                </div>
                <div className="text-left">
                  <div className="font-bold text-foreground text-[13px]">학급 전체</div>
                  <div className="text-xs text-muted-foreground mt-0.5">학급 전체 기록지를 출력합니다</div>
                </div>
              </Button>
            </div>

        </DialogContent>
      </Dialog>

      {/* 학급 전체 출력 모달 */}
      <Dialog open={showClassPrintModal} onOpenChange={setShowClassPrintModal}>
        <DialogContent className="bg-card max-h-[90dvh] overflow-y-auto sm:max-w-sm" aria-describedby={undefined}>
            <div className="border-b-2 border-border pb-3 pr-8">
              <DialogTitle>학급 전체 기록지 출력</DialogTitle>

            </div>
            <div className="px-6 py-6">
              <div className="mb-4">
                <div className="text-[13px] font-semibold text-foreground mb-2">대상 학급</div>
                <div className="text-lg font-bold text-foreground">{grade}학년 {classNo}반</div>
              </div>
              <div className="mb-6">
                <Label className="block text-[13px] font-semibold text-foreground mb-2">출력할 월 선택</Label>
                <RecordSelect aria-label="출력할 월 선택"
                  value={classPrintMonth}
                  onValueChange={(value) => setClassPrintMonth(Number(value))}
                  className="h-9 min-w-28"
                >
                  {monthOrderIdx.map(origIdx => (
                    <option key={origIdx} value={origIdx}>{origIdx + 1}월</option>
                  ))}
                </RecordSelect>
              </div>
              <div className="flex gap-3">
                <Button variant="outline"
                  onClick={() => setShowClassPrintModal(false)}
                  className="flex-1 px-4 py-3 text-[13px] font-semibold bg-muted text-foreground hover:bg-muted transition"
                >
                  취소
                </Button>
                <Button variant="outline"
                  onClick={() => {
                    setShowClassPrintModal(false)
                    handlePrintClassAll(classPrintMonth)
                  }}
                  className="flex-1 px-4 py-3 text-[13px] font-semibold bg-primary text-primary-foreground hover:bg-primary transition flex items-center justify-center gap-2"
                >
                  <Printer className="size-4" aria-hidden="true" />
                  출력
                </Button>
              </div>
            </div>

        </DialogContent>
      </Dialog>

      {/* 엑셀 출력 모달 */}
      <Dialog open={showExcelModal} onOpenChange={setShowExcelModal}>
        <DialogContent className="bg-card max-h-[90dvh] overflow-y-auto sm:max-w-sm" aria-describedby={undefined}>
            <div className="border-b-2 border-border pb-3 pr-8">
              <DialogTitle>엑셀 파일 다운로드</DialogTitle>

            </div>
            <div className="px-6 py-6">
              <div className="mb-4">
                <div className="text-[13px] font-semibold text-foreground mb-2">대상 학급</div>
                <div className="text-lg font-bold text-foreground">{grade}학년 {classNo}반</div>
              </div>
              <div className="mb-6">
                <Label className="block text-[13px] font-semibold text-foreground mb-2">다운로드할 월 선택</Label>
                <RecordSelect aria-label="다운로드할 월 선택"
                  value={excelMonth}
                  onValueChange={(value) => setExcelMonth(Number(value))}
                  className="h-9 min-w-28"
                >
                  {monthOrderIdx.map(origIdx => (
                    <option key={origIdx} value={origIdx}>{origIdx + 1}월</option>
                  ))}
                </RecordSelect>
              </div>
              <div className="flex gap-3">
                <Button variant="outline"
                  onClick={() => setShowExcelModal(false)}
                  className="flex-1 px-4 py-3 text-[13px] font-semibold bg-muted text-foreground hover:bg-muted transition"
                >
                  취소
                </Button>
                <Button variant="outline"
                  onClick={() => {
                    setShowExcelModal(false)
                    handleExcelExport(excelMonth)
                  }}
                  className="flex-1 px-4 py-3 text-[13px] font-semibold bg-primary text-primary-foreground hover:bg-primary transition flex items-center justify-center gap-2"
                >
                  <Download className="size-4" aria-hidden="true" />
                  다운로드
                </Button>
              </div>
            </div>

        </DialogContent>
      </Dialog>
    </div>
  )
}
