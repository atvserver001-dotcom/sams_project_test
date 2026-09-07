'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChartNoAxesCombined, Download, List, Search, Table2 } from 'lucide-react'
import { PageHeader } from '@/components/console/page-header'
import { FilterBar } from '@/components/console/filter-bar'
import { ClassFilterFields } from '@/components/console/class-filter-fields'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ExerciseComposition, ExerciseLegend, MonthlyExerciseChart } from '@/components/exercises/exercise-charts'
import { ExerciseEmpty, ExerciseError, ExerciseLoading, ExercisePagination, ExerciseSegments } from '@/components/exercises/exercise-controls'
import { ExerciseTable } from '@/components/exercises/exercise-table'
import { CATEGORIES, CategoryFilter, ExerciseMetric, ExerciseRow, ExerciseSchool, ExerciseStudent, METRICS, MONTH_ORDER, academicYear, exerciseExportRows, hasRecord, joinStudents, monthLabel, readSchoolApi } from '@/components/exercises/exercise-data'

interface ExerciseResult { key: string; rows: ExerciseRow[]; error?: string }

export default function ExercisesPage() {
  const [year, setYear] = useState(academicYear)
  const [grade, setGrade] = useState(1)
  const [classNo, setClassNo] = useState(1)
  const [category, setCategory] = useState<CategoryFilter>('all')
  const [metric, setMetric] = useState<ExerciseMetric>('minutes')
  const [view, setView] = useState<'data' | 'chart'>('data')
  const [allMetrics, setAllMetrics] = useState(false)
  const [school, setSchool] = useState<ExerciseSchool | null>(null)
  const [schoolError, setSchoolError] = useState<string | null>(null)
  const [result, setResult] = useState<ExerciseResult | null>(null)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(6)
  const [revision, setRevision] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const key = `${year}-${grade}-${classNo}-${category}-${revision}`

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const requestedYear = Number(params.get('year'))
    const requestedGrade = Number(params.get('grade'))
    const requestedClass = Number(params.get('class_no'))
    if (Number.isInteger(requestedYear) && requestedYear >= academicYear() - 5 && requestedYear <= academicYear() + 1) setYear(requestedYear)
    if (Number.isInteger(requestedGrade) && requestedGrade >= 1 && requestedGrade <= 6) setGrade(requestedGrade)
    if (Number.isInteger(requestedClass) && requestedClass >= 1 && requestedClass <= 10) setClassNo(requestedClass)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setSchoolError(null)
    readSchoolApi<{ school: ExerciseSchool }>('/api/school/info', controller.signal).then(data => {
      setSchool(data.school)
      setGrade(value => Math.min(value, data.school.school_type === 1 ? 6 : 3))
    }).catch(error => { if (!controller.signal.aborted) setSchoolError(error instanceof Error ? error.message : '학교 조회 실패') })
    return () => controller.abort()
  }, [revision])

  useEffect(() => {
    if (!school) return
    const controller = new AbortController()
    async function load() {
      try {
        const params = new URLSearchParams({ year: String(year), grade: String(grade), class_no: String(classNo) })
        const students = await readSchoolApi<{ students: ExerciseStudent[] }>(`/api/school/students?${params}`, controller.signal)
        params.set('category_type', String(category))
        const exercises = await readSchoolApi<{ rows: ExerciseRow[] }>(`/api/school/exercises?${params}`, controller.signal)
        if (!controller.signal.aborted) setResult({ key, rows: joinStudents(students.students, exercises.rows) })
      } catch (error) {
        if (!controller.signal.aborted) setResult({ key, rows: [], error: error instanceof Error ? error.message : '기록 조회 실패' })
      }
    }
    void load()
    return () => controller.abort()
  }, [year, grade, classNo, category, key, school])

  const loading = !schoolError && (!school || result?.key !== key)
  const error = schoolError || (result?.key === key ? result.error : null)
  const rows = useMemo(() => result?.key === key && !result.error ? result.rows : [], [result, key])
  const filtered = useMemo(() => rows.filter(row => `${row.student_no} ${row.name}`.includes(query.trim())), [rows, query])
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / pageSize) - 1))
  const pageRows = useMemo(() => filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize), [filtered, currentPage, pageSize])
  const retry = () => setRevision(value => value + 1)
  const resetPage = () => { setPage(0); setExportError(null) }

  async function exportRecords() {
    setExporting(true)
    setExportError(null)
    try {
      const XLSX = await import('xlsx')
      const workbook = XLSX.utils.book_new()
      const worksheet = XLSX.utils.aoa_to_sheet([
        [`${year}학년도 ${grade}학년 ${classNo}반`, CATEGORIES.find(item => item.value === String(category))?.title],
        ['번호', '이름', '지표', ...MONTH_ORDER.map(index => monthLabel(year, index)), '합계 / 평균 / 최대'],
        ...exerciseExportRows(filtered),
      ])
      worksheet['!cols'] = [{ wch: 7 }, { wch: 16 }, { wch: 22 }, ...MONTH_ORDER.map(() => ({ wch: 12 })), { wch: 23 }]
      XLSX.utils.book_append_sheet(workbook, worksheet, '운동기록')
      XLSX.writeFile(workbook, `운동기록_${year}_${grade}학년${classNo}반_${category}.xlsx`)
    } catch { setExportError('엑셀 내보내기에 실패했습니다. 다시 시도해 주세요.') }
    finally { setExporting(false) }
  }

  return <div className="min-w-0 bg-background text-foreground">
    <PageHeader className="[&_h1]:!text-[19px] [&_h1]:!leading-[1.2] [&_p]:text-[10px] [&_p]:leading-[1.3]" eyebrow="기록 통계" title="운동기록 · 학급 리포트" actions={<Button variant="outline" disabled={loading || !!error || !filtered.length || exporting} onClick={exportRecords}><Download className="h-[15px] w-[15px]" />{exporting ? '내보내는 중' : '엑셀 내보내기'}</Button>} />
    <FilterBar className="sticky top-0 z-30">
      <ClassFilterFields
        year={year} grade={grade} classNo={classNo}
        years={Array.from({ length: 7 }, (_, index) => {
          const value = academicYear() + 1 - index
          return { value, label: `${value}학년도` }
        })}
        gradeCount={school?.school_type === 1 ? 6 : 3}
        onYearChange={value => { setYear(value); resetPage() }}
        onGradeChange={value => { setGrade(value); resetPage() }}
        onClassChange={value => { setClassNo(value); resetPage() }}
      />
      <div className="max-w-full space-y-1.5"><p className="text-xs text-muted-foreground">운동 종목</p><ExerciseSegments label="운동 종목" value={String(category)} onChange={value => { setCategory(value === 'all' ? 'all' : Number(value) as CategoryFilter); resetPage() }} options={CATEGORIES} /></div>
      <div className="ml-auto max-w-full space-y-1.5"><p className="text-xs text-muted-foreground">지표</p><ExerciseSegments label="운동 지표" value={metric} onChange={value => setMetric(value as ExerciseMetric)} options={Object.entries(METRICS).map(([value, item]) => ({ value, label: item.label }))} /></div>
    </FilterBar>
    <div className="space-y-5 px-4 py-6 sm:px-7">
      {error ? <ExerciseError message={error} retry={retry} /> : loading ? <ExerciseLoading /> : <>
        {!rows.some(row => hasRecord(row)) && <ExerciseEmpty noStudents={!rows.length} />}
        <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <section className="flex min-h-[346px] min-w-0 flex-col gap-[14px] border border-border bg-white p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-3"><h2 className="text-[15px] leading-[1.2] font-extrabold">월별 평균 심박 / 최대 심박</h2><p className="text-xs text-foreground/55">{grade}학년 {classNo}반 · {rows.length}명</p></div>
            <MonthlyExerciseChart rows={rows} year={year} metric="bpm" category={String(category)} height={220} />
            <div className="mt-auto flex flex-wrap items-center justify-between gap-2"><ExerciseLegend metric="bpm" /><p className="text-[11px] text-foreground/50">평균: 기록이 있는 학생·월 기준</p></div>
          </section>
          <ExerciseComposition rows={rows} studentCount={rows.length} />
        </div>
        <section className="min-w-0 border border-border bg-white">
          <div className="flex flex-wrap items-center gap-3 border-b-2 border-border px-[18px] py-[10px]">
            <h2 className="mr-auto text-[15px] font-extrabold">학생별 월간 {allMetrics && view === 'data' ? '운동 기록' : `${METRICS[metric].label} (${METRICS[metric].unit})`}</h2>
            <div className="relative w-full sm:w-[190px]"><Search aria-hidden className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input aria-label="학생 이름 또는 번호 검색" placeholder="학생 이름 · 번호" value={query} onChange={event => { setQuery(event.target.value); resetPage() }} className="h-9 rounded-none bg-background pl-9 text-[13px]" /></div>
            {view === 'data' && <Button variant={allMetrics ? 'default' : 'outline'} aria-pressed={allMetrics} onClick={() => setAllMetrics(value => !value)}><List className="h-[15px] w-[15px]" />모든 지표</Button>}
            <ExerciseSegments label="기록 보기" value={view} onChange={value => setView(value as 'data' | 'chart')} options={[{ value: 'data', label: <><Table2 className="h-[15px] w-[15px]" />데이터</>, title: '데이터 보기' }, { value: 'chart', label: <><ChartNoAxesCombined className="h-[15px] w-[15px]" />그래프</>, title: '그래프 보기' }]} />
          </div>
          {exportError && <ExerciseError message={exportError} retry={exportRecords} />}
          {!filtered.length ? <p className="p-8 text-center text-sm text-muted-foreground">{query ? '검색 결과가 없습니다.' : '등록된 학생이 없습니다.'}</p> : view === 'data' ? <ExerciseTable rows={pageRows} year={year} metric={metric} allMetrics={allMetrics} /> : <div className="divide-y divide-[#201e1d]/18">{pageRows.map(row => <section key={row.student_id} className="p-5">
            <h3 className="mb-3 text-sm font-bold">{row.student_no}번 {row.name}</h3>
            <div className="grid min-w-0 gap-6 xl:grid-cols-2"><div className="min-w-0"><ExerciseLegend metric={metric} /><MonthlyExerciseChart rows={[row]} year={year} metric={metric} category={String(category)} height={190} /></div><div className="min-w-0"><ExerciseLegend metric={metric === 'bpm' ? 'minutes' : 'bpm'} /><MonthlyExerciseChart rows={[row]} year={year} metric={metric === 'bpm' ? 'minutes' : 'bpm'} category={String(category)} height={190} /></div></div>
          </section>)}</div>}
          <ExercisePagination total={filtered.length} page={currentPage} pageSize={pageSize} onPage={setPage} onPageSize={value => { setPageSize(value); resetPage() }} />
        </section>
      </>}
    </div>
  </div>
}
