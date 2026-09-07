'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import { Download, Pause, Play, RotateCcw, StepForward, X } from 'lucide-react'
import { MonthlyExerciseChart, ExerciseLegend } from '@/components/exercises/exercise-charts'
import { formatValue, monthlySummary, MONTH_ORDER, type ExerciseRow } from '@/components/exercises/exercise-data'
import { HeartRateChart, ZoneLegend } from '@/components/heart-rate/HeartRateChart'
import { average, windowSamples, sessionResults, type Session } from '@/lib/heart-rate/session'
import { movingAverage, tileSamples } from '@/lib/heart-rate/chart'
import { formatDuration } from '@/lib/heart-rate/zones'
import { SCENARIOS, LAB_YEAR, makeMonthlyRows, expectedMonthly, makeLabSession, advanceLab, type Scenario } from '../fixtures'
import styles from './page.module.css'

function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function RawMonthly({ rows }: { rows: ExerciseRow[] }) {
  return <details className={styles.raw}><summary>원본 입력 · 학생별 월 데이터</summary>
    <div className={styles.tableViewport}><table><thead><tr><th>학생</th><th>지표</th>{MONTH_ORDER.map(month => <th key={month}>{month + 1}월</th>)}</tr></thead>
      <tbody>{rows.flatMap(row => (['minutes_c1', 'minutes_c2', 'minutes_c3', 'avg_bpm', 'max_bpm'] as const).map(field =>
        <tr key={`${row.student_id}-${field}`}><th>{row.name}</th><th>{field}</th>{MONTH_ORDER.map(month => <td key={month}>{formatValue(row[field]?.[month])}</td>)}</tr>))}</tbody>
    </table></div></details>
}

export default function ChartLab() {
  const [scenario, setScenario] = useState<Scenario>('normal')
  const [view, setView] = useState<'monthly' | 'live'>('monthly')
  const [session, setSession] = useState<Session>(() => makeLabSession('normal'))
  const sessionRef = useRef(session)
  const replayTime = useRef(session.lastSec)
  const [revision, setRevision] = useState(0)
  const [running, setRunning] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [focus, setFocus] = useState<number | null>(null)
  const [dataOpen, setDataOpen] = useState(false)
  const [tabStateReady, setTabStateReady] = useState(false)
  const rows = useMemo(() => makeMonthlyRows(scenario), [scenario])
  const monthly = useMemo(() => monthlySummary(rows, LAB_YEAR), [rows])
  const selected = session.students.find(student => student.participant.no === focus)
  const sampleRows = selected && dataOpen ? windowSamples(selected) : []
  const smooth = dataOpen ? movingAverage(sampleRows) : []
  const sampled = dataOpen ? tileSamples(sampleRows) : []

  useEffect(() => {
    const url = new URL(window.location.href)
    const requested = url.searchParams.get('scenario')
    if (SCENARIOS.some(item => item.value === requested)) {
      const initial = makeLabSession(requested as Scenario)
      sessionRef.current = initial
      replayTime.current = initial.lastSec
      setSession(initial)
      setScenario(requested as Scenario)
    }
    if (url.searchParams.get('view') === 'live') setView('live')
    setTabStateReady(true)
  }, [])

  useEffect(() => {
    if (!tabStateReady) return
    const url = new URL(window.location.href)
    url.searchParams.set('scenario', scenario)
    url.searchParams.set('view', view)
    window.history.replaceState(null, '', url)
  }, [scenario, view, tabStateReady])

  useEffect(() => {
    if (!running) return
    const activeSession = sessionRef.current
    let lastWall = performance.now()
    let lastPaint = lastWall
    let frame = 0
    const advanceTime = (now: number) => {
      replayTime.current += (now - lastWall) / 1000 * speed
      lastWall = now
      // Keep catch-up work bounded per frame and retain fractional time on pause/speed changes.
      const through = Math.min(Math.floor(replayTime.current), activeSession.lastSec + 60)
      advanceLab(activeSession, scenario, through)
      setRevision(value => value + 1)
    }
    const tick = (now: number) => {
      if (now - lastPaint >= 250) {
        advanceTime(now)
        lastPaint = now
      }
      frame = requestAnimationFrame(tick)
    }
    const visibility = () => { if (document.hidden) setRunning(false) }
    document.addEventListener('visibilitychange', visibility)
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('visibilitychange', visibility)
      if (sessionRef.current === activeSession) advanceTime(performance.now())
    }
  }, [running, speed, scenario])

  const replaceSession = (nextScenario: Scenario, seconds = 120) => {
    setRunning(false)
    const next = makeLabSession(nextScenario, seconds)
    sessionRef.current = next
    replayTime.current = next.lastSec
    setSession(next)
    setRevision(value => value + 1)
  }
  const chooseScenario = (value: Scenario) => {
    setScenario(value)
    replaceSession(value)
  }
  const step = () => {
    advanceLab(sessionRef.current, scenario, sessionRef.current.lastSec + 1)
    replayTime.current = sessionRef.current.lastSec
    setRevision(value => value + 1)
  }
  const exportData = () => download(`atvcms-chart-${scenario}.json`, {
    kind: 'synthetic-chart-verification', scenario, year: LAB_YEAR, rows, monthly, expectedMonthly: expectedMonthly(scenario),
    sessionId: session.id, lastSec: session.lastSec, results: sessionResults(session),
    students: session.students.map(live => {
      const window = windowSamples(live)
      return { no: live.participant.no, aggregate: live.agg, window, displayed: { fiveSecondMean: movingAverage(window), compact: tileSamples(window) } }
    }),
  })

  return <main className={styles.lab} data-testid="chart-lab" data-scenario={scenario} data-session-id={session.id}
    data-last-sec={session.lastSec} data-running={String(running)} data-revision={revision} data-ready={String(tabStateReady)}
    data-buffer-size={Math.max(...session.students.map(student => student.size))}>
    <header className={styles.header}>
      <Image src="/logo_atvcms.svg" width={128} height={25} alt="atvcms" unoptimized />
      <h1>그래프 검증</h1><span className={styles.badge}>테스트 데이터</span>
      <span className={styles.candidate}>기준 이미지 · 검토 후보</span>
      <button className={styles.iconButton} onClick={exportData} title="검증 데이터 다운로드" aria-label="검증 데이터 다운로드"><Download size={18} /></button>
    </header>
    <div className={styles.toolbar}>
      <div role="tablist" aria-label="그래프 종류" className={styles.tabs}>
        <button role="tab" id="monthly-tab" aria-controls="monthly-panel" aria-selected={view === 'monthly'} onClick={() => setView('monthly')}>월별 집계</button>
        <button role="tab" id="live-tab" aria-controls="live-panel" aria-selected={view === 'live'} onClick={() => setView('live')}>실시간 파형</button>
      </div>
      <label>검증 데이터<select aria-label="검증 데이터" value={scenario} onChange={event => chooseScenario(event.target.value as Scenario)}>
        {SCENARIOS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
      </select></label>
      {view === 'monthly' ? <span className={styles.meta}>{LAB_YEAR}학년도 · 3월–익년 2월</span> : <>
        <div className={styles.transport}>
          <button className={styles.iconButton} title={running ? '일시정지' : '재생'} aria-label={running ? '일시정지' : '재생'} onClick={() => setRunning(!running)}>{running ? <Pause size={18} /> : <Play size={18} />}</button>
          <button className={styles.iconButton} title="1초 진행" aria-label="1초 진행" disabled={running} onClick={step}><StepForward size={18} /></button>
          <button className={styles.iconButton} title="처음으로" aria-label="처음으로" onClick={() => replaceSession(scenario, 1)}><RotateCcw size={18} /></button>
        </div>
        <label>속도<select aria-label="재생 속도" value={speed} onChange={event => setSpeed(Number(event.target.value))}><option value="1">1배</option><option value="10">10배</option><option value="60">60배</option></select></label>
        <span className={styles.elapsed}>{formatDuration(Math.max(0, session.lastSec))}</span>
        <button className={styles.outlineButton} aria-label="60분 데이터 불러오기" onClick={() => replaceSession(scenario, 3600)}>60분 데이터 불러오기</button>
        <span className={styles.meta}>수신 {session.students.filter(student => student.cur !== null).length}/30명</span>
      </>}
    </div>
    {view === 'monthly' ? <div role="tabpanel" id="monthly-panel" aria-labelledby="monthly-tab" className={styles.content}>
      <div className={styles.chartRow}>
        <section className={styles.chartTool} data-testid="monthly-bars"><h2>월별 운동시간</h2>
          <MonthlyExerciseChart rows={rows} year={LAB_YEAR} metric="minutes" height={260} dashboard /><ExerciseLegend />
        </section>
        <section className={styles.chartTool} data-testid="monthly-lines"><h2>월별 최대·평균 심박</h2>
          <MonthlyExerciseChart rows={rows} year={LAB_YEAR} metric="bpm" height={260} /><ExerciseLegend metric="bpm" />
        </section>
      </div>
      <section className={styles.dataSection}><h2>그래프 입력 집계</h2><div className={styles.tableViewport}>
        <table data-testid="monthly-data"><thead><tr><th>월</th><th>근력 (분)</th><th>지구력 (분)</th><th>유연성 (분)</th><th>합계 (분)</th><th>평균 (bpm)</th><th>최대 (bpm)</th></tr></thead>
          <tbody>{monthly.map(row => <tr key={row.index} data-month={row.index + 1}><th>{row.calendarMonth}</th>
            {(['minutes_c1', 'minutes_c2', 'minutes_c3', 'minutes', 'avg_bpm', 'max_bpm'] as const).map(key => <td data-field={key} key={key}>{formatValue(row[key])}</td>)}
          </tr>)}</tbody></table>
      </div><RawMonthly rows={rows} /></section>
    </div> : <div role="tabpanel" id="live-panel" aria-labelledby="live-tab" className={styles.content}>
      <div className={styles.liveHeading}><h2>30인 간략 파형</h2><ZoneLegend age={13} /></div>
      <div className={styles.liveGrid} data-testid="live-grid">{session.students.map(live => <button key={live.participant.no} data-student-no={live.participant.no}
        aria-label={`${live.participant.no}번 학생 상세`} aria-pressed={focus === live.participant.no} onClick={() => setFocus(live.participant.no)}>
        <span className={styles.studentLabel}><strong>{live.participant.no} {live.participant.name}</strong><b>{live.cur ?? '--'} <small>bpm</small></b></span>
        <HeartRateChart live={live} />
      </button>)}</div>
      {selected && <section className={styles.focus} data-testid="live-detail">
        <div className={styles.liveHeading}><h2>{selected.participant.no}번 학생 · 상세 파형</h2>
          <span className={styles.meta}>원시 최저 {selected.agg.min ?? '--'} · 평균 {average(selected) ?? '--'} · 최고 {selected.agg.max ?? '--'} bpm</span>
          <button className={styles.iconButton} title="선택 해제" aria-label="선택 해제" onClick={() => setFocus(null)}><X size={18} /></button></div>
        <HeartRateChart live={selected} detail />
        <details className={styles.raw} onToggle={event => setDataOpen(event.currentTarget.open)}><summary>원시 수신 · 표시 수치 대조</summary>
          {dataOpen && <div className={styles.tableViewport}><table data-testid="live-data"><thead><tr><th>경과 (초)</th><th>원시 수신 (bpm)</th><th>5초 이동평균 (bpm)</th><th>원시 최저</th><th>원시 최고</th></tr></thead>
            <tbody>{sampleRows.slice(-30).map((sample, index) => <tr key={sample.sec}><th>{sample.sec}</th><td>{formatValue(sample.bpm)}</td><td>{formatValue(smooth[smooth.length - Math.min(30, sampleRows.length) + index]?.bpm)}</td><td>{formatValue(sample.min)}</td><td>{formatValue(sample.max)}</td></tr>)}</tbody>
          </table><p className={styles.meta}>최근 {Math.min(30, sampleRows.length)}초 · 저장 창 {sampleRows.length}/3000초 · 간략 표시 {sampled.length}점</p></div>}
        </details>
      </section>}
    </div>}
  </main>
}
