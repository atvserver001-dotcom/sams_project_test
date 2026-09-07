'use client'

import { Fragment, useMemo, type RefObject } from 'react'
import { Activity, Download, Maximize } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { PageHeader } from '@/components/console/page-header'
import { FilterBar } from '@/components/console/filter-bar'
import { ClassFilterFields } from '@/components/console/class-filter-fields'
const HEART_FIT_DOWNLOAD = 'https://sxvtdnnzmvyksqqkidoi.supabase.co/storage/v1/object/public/apps/Heart%20Fit%20Setup.exe'
import { monthlySummary, monthlyZoneOf, type HeartRateRow } from '@/lib/heart-rate/monthly'
import { type SchoolStudent } from '@/lib/heart-rate/session'
import { academicYear, monthOrderIdx, zoneOf } from '@/lib/heart-rate/zones'
import { AnnualSparkline } from '@/components/heart-rate/AnnualSparkline'
import { ZoneLegend } from '@/components/heart-rate/HeartRateChart'
import { deriveGradeProxyAge } from '@/lib/heartRateSession'
import styles from '@/components/heart-rate/heart-care.module.css'


export interface MonthlyHeartRateProps {
 year: number; grade: number; classNo: number; schoolType: 1 | 2 | 3
 students: SchoolStudent[]; rows: HeartRateRow[]; loading: boolean; starting: boolean; startDisabled: boolean
 activeSession: boolean; state: string; statusText: string; error: string | null
 measurementButtonRef: RefObject<HTMLButtonElement | null>
 start: () => void; onYearChange: (value: number) => void; onGradeChange: (value: number) => void; onClassChange: (value: number) => void
}
export function HeartRateMonthlyView({ year, grade, classNo, schoolType, students, rows, loading, starting, startDisabled, activeSession, state, statusText, error, measurementButtonRef, start, onYearChange, onGradeChange, onClassChange }: MonthlyHeartRateProps) {
 const ages = useMemo(() => new Map(students.map(student => [student.student_no, deriveGradeProxyAge(schoolType, grade)])), [students, grade, schoolType])
 const summary = useMemo(() => monthlySummary(rows, ages), [rows, ages])
  return <div className={`${styles.root} ${styles.monthly}`}>
    <PageHeader title="심박기록관리" eyebrow="Heart Care" actions={<>
      <div className={styles.monthlyStatus} data-state={state} role="status"><i />{statusText}</div>
      <Button asChild variant="outline"><a href={HEART_FIT_DOWNLOAD} target="_blank" rel="noopener noreferrer"><Download size={15} />Heart Fit 다운로드</a></Button>
    </>} />
    <FilterBar>
      <ClassFilterFields
        year={year} grade={grade} classNo={classNo}
        years={Array.from({ length: 7 }, (_, index) => {
          const value = academicYear() + 1 - index
          return { value, label: `${value}학년도` }
        })}
        gradeCount={schoolType === 1 ? 6 : 3} disabled={activeSession || starting}
        onYearChange={onYearChange} onGradeChange={onGradeChange} onClassChange={onClassChange}
      />
      <Button ref={measurementButtonRef} onClick={start} disabled={starting || loading || startDisabled} className={`${styles.startButton} ${state === 'open' ? styles.measuring : ''}`}>
        {activeSession ? <Maximize size={15} /> : <Activity size={15} />}{starting || state === 'connecting' ? '연결 중 ···' : state === 'open' ? '측정 중' : activeSession ? '측정 화면 열기' : '측정 시작'}
      </Button>
    </FilterBar>
    <div className={styles.monthlyBody}>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <div className={styles.monthlyKpis}>
      <div><span>학급 평균</span><strong>{summary.average ?? '--'}<small>bpm</small></strong><small>학생별 월평균 기준</small></div>
      <div><span>학급 최고</span><strong style={{ color: summary.maximum === null ? undefined : zoneOf(summary.maximum, summary.maximumAge).color }}>{summary.maximum ?? '--'}<small>bpm</small></strong><small>{summary.maximum === null ? '기록 없음' : zoneOf(summary.maximum, summary.maximumAge).label}</small></div>
      <div><span>중·고강도 비율</span><strong>{summary.ratio ?? '--'}<small>%</small></strong><small>중강도 이상 월평균 비율</small></div>
      <div><span>기록 학생수</span><strong>{summary.recorded}<small>명</small></strong><small>재적 {students.length}명</small></div>
    </div>
    <section className={styles.monthlyRecords} aria-label="학생별 월간 심박 기록">
      <div className={styles.tableHeading}><h2>{year}학년도 · {grade}학년 {classNo}반</h2><ZoneLegend /><span>bpm</span></div>
      <Table className={styles.monthlyTable}>
        <colgroup><col style={{ width: 50 }} /><col /><col style={{ width: 54 }} />{monthOrderIdx.map(month => <col key={month} style={{ width: 56 }} />)}<col style={{ width: 100 }} /></colgroup>
        <TableHeader><TableRow><TableHead>번호</TableHead><TableHead>이름</TableHead><TableHead>구분</TableHead>{monthOrderIdx.map(month => <TableHead key={month}>{month + 1}월</TableHead>)}<TableHead>연간 추이</TableHead></TableRow></TableHeader>
        <TableBody>{loading ? Array.from({ length: 5 }, (_, index) => <TableRow key={index}><TableCell colSpan={16}><Skeleton className="h-12 w-full" /></TableCell></TableRow>)
          : Array.from({ length: 30 }, (_, index) => {
            const no = index + 1
            const student = students.find(item => item.student_no === no)
            const row = rows.find(item => item.student_no === no)
            const age = ages.get(no) ?? deriveGradeProxyAge(schoolType, grade)
            return <Fragment key={no}>{(['max_bpm', 'avg_bpm', 'min_bpm'] as const).map((metric, metricIndex) => <TableRow key={metric} className={metricIndex === 0 ? styles.studentFirstRow : undefined}>
              {metricIndex === 0 && <><TableCell rowSpan={3}>{no}</TableCell><TableCell rowSpan={3} className={styles.studentName}>{student?.name ?? row?.name ?? <span className={styles.missing}>—</span>}</TableCell></>}
              <TableCell className={styles.metricLabel}>{['최고', '평균', '최저'][metricIndex]}</TableCell>
              {monthOrderIdx.map(month => {
                const value = row?.[metric]?.[month] ?? null
                const zone = value === null ? null : monthlyZoneOf(value, age)
                return <TableCell key={month} title={value !== null && zone === null ? '원본 기록값 · 심박 구간 평가 범위 밖' : undefined} style={{ color: value === null ? undefined : metric === 'min_bpm' ? '#605d5d' : zone?.color ?? '#605d5d' }}>{value === null ? <span className={styles.missing}>—</span> : Math.round(value)}</TableCell>
              })}
              {metricIndex === 0 && <TableCell rowSpan={3}>{row ? <AnnualSparkline row={row} age={age} /> : <span className={styles.missing}>—</span>}</TableCell>}
            </TableRow>)}</Fragment>
          })}</TableBody>
      </Table>
      {!loading && !rows.some(row => row.avg_bpm.some(value => value !== null)) && <div className={styles.emptyRecords}>아직 수신된 기록이 없습니다<Button onClick={start} disabled={startDisabled || starting}>측정 시작</Button></div>}
    </section>
    </div>
  </div>
}

