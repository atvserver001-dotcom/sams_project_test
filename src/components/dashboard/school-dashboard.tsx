'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Download, Radio, RotateCw, Search, Settings2 } from 'lucide-react'
import { PageHeader } from '@/components/console/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { ExerciseLegend, MonthlyExerciseChart } from '@/components/exercises/exercise-charts'
import { ExerciseEmpty, ExerciseError, ExerciseLoading, ExerciseSegments } from '@/components/exercises/exercise-controls'
import { MONTH_ORDER, academicYear, formatValue, hasRecord, mean, monthlySummary } from '@/components/exercises/exercise-data'
import { DashboardData, classSummary, licenseStatus, loadDashboard } from './dashboard-data'

interface DashboardResult { key: string; data?: DashboardData; error?: string }

export default function SchoolDashboard() {
  const [year, setYear] = useState(academicYear)
  const [query, setQuery] = useState('')
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState<DashboardResult | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const key = `${year}-${revision}`

  useEffect(() => {
    const controller = new AbortController()
    loadDashboard(year, controller.signal).then(data => {
      if (!controller.signal.aborted) setResult({ key, data })
    }).catch(error => {
      if (!controller.signal.aborted) {
        setResult({ key, error: error instanceof Error ? error.message : '대시보드 조회 실패' })
        controller.abort()
      }
    })
    return () => controller.abort()
  }, [year, key])

  const data = result?.key === key ? result.data : undefined
  const error = result?.key === key ? result.error : undefined
  const loading = result?.key !== key
  const rows = useMemo(() => data?.classes.flatMap(item => item.rows) ?? [], [data])
  const classes = useMemo(() => data?.classes.filter(item => {
    const search = query.trim()
    return `${item.grade}학년 ${item.classNo}반`.includes(search) || item.students.some(student => `${student.name} ${student.student_no}`.includes(search))
  }) ?? [], [data, query])
  const studentCount = data?.classes.reduce((total, item) => total + item.students.length, 0) ?? 0
  const recordStudents = rows.filter(row => hasRecord(row)).length
  const now = new Date()
  const currentYear = academicYear(now)
  const latestMonth = [...MONTH_ORDER].reverse().find(index => rows.some(row => hasRecord(row, index)))
  const recordMonth = year === currentYear ? now.getMonth() : latestMonth
  const monthlyStudents = recordMonth === undefined ? null : rows.filter(row => hasRecord(row, recordMonth)).length
  const averageMinutes = mean(rows.flatMap(row => row.minutes))
  const averageAccuracy = mean(rows.flatMap(row => row.accuracy ?? []))
  const averageBpm = mean(rows.flatMap(row => row.avg_bpm))
  const retry = () => setRevision(value => value + 1)

  async function exportClasses() {
    setExporting(true)
    setExportError(null)
    try {
      const XLSX = await import('xlsx')
      const workbook = XLSX.utils.book_new()
      const worksheet = XLSX.utils.aoa_to_sheet([
        [`${year}학년도 학급별 기록 현황`, data?.school.name],
        ['학급', '학생수', '기록 학생수', '참여율 (%)', '평균 운동시간 (분/월)', '평균 정확도 (%)', '평균 심박 (bpm)', '최근 기록 월'],
        ...classes.map(item => { const summary = classSummary(item, year); return [summary.label, summary.students, summary.active, summary.participation, summary.minutes, summary.accuracy, summary.bpm, summary.latest] }),
      ])
      worksheet['!cols'] = Array.from({ length: 8 }, () => ({ wch: 24 }))
      XLSX.utils.book_append_sheet(workbook, worksheet, '학급 현황')
      const monthly = monthlySummary(classes.flatMap(item => item.rows), year)
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
        ['기록 월', '근력 (분)', '지구력 (분)', '유연성 (분)', '총 운동시간 (분)', '누적 칼로리 (kcal)'],
        ...monthly.map(month => [month.calendarMonth, month.minutes_c1, month.minutes_c2, month.minutes_c3, month.minutes, month.calories]),
      ]), '월별 운동시간')
      XLSX.writeFile(workbook, `학급별기록_${year}.xlsx`)
    } catch { setExportError('엑셀 내보내기에 실패했습니다. 다시 시도해 주세요.') }
    finally { setExporting(false) }
  }

  const kpis = [
    { label: '재적 학생', value: studentCount, digits: 0, unit: '명', caption: `${data?.classes.length ?? 0}학급 · ${new Set(data?.classes.map(item => item.grade)).size}개 학년` },
    { label: year === currentYear ? '이번 달 기록 학생' : '최근 기록 월 학생', value: monthlyStudents, digits: 0, unit: '명', caption: recordMonth === undefined ? '수신된 월별 기록 없음' : `${recordMonth + 1}월 · 수신 기록이 있는 학생 기준` },
    { label: '평균 운동시간', value: averageMinutes, digits: 1, unit: '분/월', caption: '기록이 있는 학생·월 기준' },
    { label: '평균 정확도', value: averageAccuracy, digits: 1, unit: '%', caption: `평균 심박 ${formatValue(averageBpm)} bpm · 학생·월 기준` },
  ]

  return <div className="min-w-0 bg-background text-foreground">
    <PageHeader className="[&_h1]:!text-[19px] [&_h1]:!leading-[1.2] [&_p]:text-[10px] [&_p]:leading-[1.3]" eyebrow="대시보드" title={`${year} 학년도 요약`} actions={<>
      <div className="relative w-full sm:w-[280px]"><Search aria-hidden className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={query} onChange={event => setQuery(event.target.value)} placeholder="학생 이름 · 번호 · 학급 검색" aria-label="학생 이름, 번호 또는 학급 검색" className="h-9 bg-background pl-9 text-[13px]" /></div>
      <ExerciseSegments label="대시보드 학년도" value={String(year)} onChange={value => { setYear(Number(value)); setExportError(null) }} options={[currentYear, currentYear - 1].map(value => ({ value: String(value), label: String(value) }))} />
      <Button variant="outline" size="icon" disabled={loading} onClick={retry} aria-label="대시보드 새로고침" title="대시보드 새로고침"><RotateCw className="h-4 w-4" /></Button>
    </>} />
    <div className="space-y-5 px-4 py-6 sm:px-7">
      {loading ? <ExerciseLoading /> : error ? <ExerciseError message={error} retry={retry} /> : data && <>
        <dl className="grid grid-cols-1 gap-[2px] border border-border bg-border sm:grid-cols-2 xl:grid-cols-4">
          {kpis.map(kpi => <div key={kpi.label} className="flex min-w-0 flex-col gap-2 bg-white px-5 py-[18px]"><dt className="text-xs font-bold text-muted-foreground">{kpi.label}</dt><dd className="break-words text-[34px] leading-none font-extrabold tabular-nums">{formatValue(kpi.value, kpi.digits)}<span className="ml-1 text-[15px] font-semibold text-muted-foreground">{kpi.unit}</span></dd><p className="text-xs text-muted-foreground">{kpi.caption}</p></div>)}
        </dl>
        {!recordStudents && <ExerciseEmpty noStudents={!studentCount} />}
        <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <section className="min-w-0 border border-border bg-white p-5" aria-labelledby="dashboard-monthly-title">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><h2 id="dashboard-monthly-title" className="text-[15px] leading-[1.2] font-extrabold">월별 운동시간</h2><p className="mt-1 text-xs leading-[1.4] text-foreground/55">학년도 기준 3월 → 익년 2월 · 단위 분</p></div><ExerciseLegend /></div>
            <MonthlyExerciseChart rows={rows} year={year} metric="minutes" height={228} dashboard />
          </section>
          <section className="flex min-h-[392px] min-w-0 flex-col border border-border bg-white" aria-labelledby="dashboard-device-title">
            <div className="flex h-14 items-center justify-between border-b-2 border-border px-[18px]"><h2 id="dashboard-device-title" className="text-[15px] font-extrabold">디바이스 · 콘텐츠</h2><Button asChild variant="ghost" size="icon-sm"><Link href="/school/settings" aria-label="디바이스 설정" title="디바이스 설정"><Settings2 className="h-4 w-4" /></Link></Button></div>
            <ul className="max-h-[300px] overflow-y-auto divide-y divide-[#201e1d]/18">
              {data.licenses.map(license => { const status = licenseStatus(license); return <li key={license.key} className={cn('flex items-center justify-between gap-3 px-[18px] py-[13px]', status === '기간만료' && 'text-muted-foreground')}><div className="min-w-0"><p className="break-words text-[13px] font-semibold">{license.name}</p><p className="mt-1 text-xs text-muted-foreground">{license.kind} · {license.start ?? '시작일 미등록'} ~ {license.unlimited ? '무기한' : license.end ?? '종료일 미등록'}</p></div><Badge variant="outline" className={cn('shrink-0 rounded-none text-xs', status === '사용중' ? 'border-transparent bg-accent text-[#ae1800]' : 'bg-muted text-muted-foreground')}>{status}</Badge></li> })}
              {!data.licenses.length && <li className="px-[18px] py-6 text-xs text-muted-foreground">등록된 디바이스·콘텐츠가 없습니다.</li>}
            </ul>
            <div className="mt-auto border-t border-[#201e1d]/18 px-[18px] py-4"><h3 className="mb-2 text-xs font-bold text-muted-foreground">허브 수신 상태</h3><p className="flex items-center gap-2 text-[13px] text-muted-foreground"><Radio className="h-4 w-4" />수신 상태 정보 없음</p></div>
          </section>
        </div>
        <section className="min-w-0 border border-border bg-white">
          <div className="flex flex-wrap items-center gap-3 border-b-2 border-border px-[18px] py-4"><h2 className="mr-auto text-[15px] font-extrabold">학급별 기록 현황</h2><Button variant="outline" disabled={!classes.length || exporting} onClick={exportClasses}><Download className="h-[15px] w-[15px]" />{exporting ? '내보내는 중' : '엑셀 내보내기'}</Button><Button asChild variant="ghost"><Link href={`/school/exercises?year=${year}`} >통계 화면<ArrowRight className="h-[15px] w-[15px]" /></Link></Button></div>
          {exportError && <ExerciseError message={exportError} retry={exportClasses} />}
          <div className="isolate max-h-[440px] overflow-auto" tabIndex={0} role="region" aria-label="학급별 기록 현황 표">
            <table className="w-full min-w-[900px] border-separate border-spacing-0 text-[13px] leading-[1.45]">
              <TableHeader><TableRow>{['학급', '학생', '기록 학생수', '평균 운동시간', '평균 정확도', '평균 심박', '최근 기록 월', '상태'].map((label, index) => <TableHead key={label} scope="col" className={cn('sticky top-0 z-20 h-11 border-b-2 border-border bg-background px-4 text-right text-xs font-semibold', index === 0 && 'left-0 z-30 min-w-[125px] text-left', index === 7 && 'text-left')}>{label}</TableHead>)}</TableRow></TableHeader>
              <TableBody>{classes.map(item => { const summary = classSummary(item, year); return <TableRow key={`${item.grade}-${item.classNo}`} className="group">
                <TableCell className="sticky left-0 z-10 border-b border-[#201e1d]/18 bg-white px-4 py-3 font-bold group-hover:bg-[#f6f6f6]"><Link href={`/school/exercises?year=${year}&grade=${item.grade}&class_no=${item.classNo}`} className="underline-offset-4 hover:underline">{summary.label}</Link></TableCell>
                {[`${summary.students}명`, `${summary.active}명 (${formatValue(summary.participation, 0)}%)`, `${formatValue(summary.minutes)}분`, `${formatValue(summary.accuracy)}%`, `${formatValue(summary.bpm)} bpm`, summary.latest ?? '—'].map((value, index) => <TableCell key={index} className="border-b border-[#201e1d]/18 px-4 py-3 text-right font-normal tabular-nums">{value}</TableCell>)}
                <TableCell className="border-b border-[#201e1d]/18 px-4 py-3"><Badge variant="outline" className={cn('rounded-none text-xs', summary.active ? 'border-transparent bg-accent text-[#ae1800]' : 'text-muted-foreground')}>{summary.active ? '기록 있음' : '미수신'}</Badge></TableCell>
              </TableRow> })}</TableBody>
            </table>
          </div>
          {!classes.length && <p className="p-8 text-center text-sm text-muted-foreground">{query ? '검색 결과가 없습니다.' : '등록된 학급이 없습니다.'}</p>}
          <p className="border-t-2 border-border px-[18px] py-3 text-xs text-muted-foreground">{classes.length}학급 · 조회 범위: {data.school.school_type === 1 ? '1–6' : '1–3'}학년, 각 1–10반 · 평균은 기록이 있는 학생·월 기준</p>
        </section>
      </>}
    </div>
  </div>
}
