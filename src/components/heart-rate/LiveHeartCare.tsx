'use client'

import { useCallback, useEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { Activity, ArrowDown, ArrowLeft, CircleStop, Maximize, Minimize, RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { average, isWarning, type LiveStudent } from '@/lib/heart-rate/session'
import { formatDuration, HR_ZONES, hrMax, zoneOf } from '@/lib/heart-rate/zones'
import { HeartRateChart, ZoneLegend } from './HeartRateChart'
import { useHeartRateBridge } from './useHeartRateBridge'
import { InstallDialog, SaveActions } from './SessionDialogs'
import styles from './heart-care.module.css'

const valueText = (value: number | null) => value === null ? '--' : Math.round(value)

export function StudentTile({ live, warning, onFocus }: { live: LiveStudent; warning: boolean; onFocus: () => void }) {
  const zone = live.cur === null ? null : zoneOf(live.cur, live.participant.age)
  return <button type="button" className={`${styles.tile} ${zone ? '' : styles.noSignal} ${warning ? styles.warningTile : ''}`}
    onClick={onFocus} data-student-no={live.participant.no} aria-label={`${live.participant.no}번 ${live.participant.name}, ${zone ? `${live.cur} bpm, ${zone.label}` : '신호 없음'}, 상세 보기`}>
    <div className={styles.tileIdentity}><strong>{live.participant.no} {live.participant.name}</strong><span style={{ color: zone?.color }}>{zone?.label ?? '신호 없음'}</span></div>
    <div className={styles.tileReading}><strong style={{ color: zone?.color }}>{valueText(live.cur)}</strong><span>bpm</span><span className={styles.percent}>{live.cur === null ? '--' : `${Math.round(live.cur / hrMax(live.participant.age) * 100)}%`} HRmax</span></div>
    <HeartRateChart live={live} />
    <div className={styles.tileStats}>
      <span>최저 <b>{valueText(live.agg.min)}</b></span><span>평균 <b>{valueText(average(live))}</b></span>
      <span>최고 <b style={{ color: live.agg.max === null ? undefined : zoneOf(live.agg.max, live.participant.age).color }}>{valueText(live.agg.max)}</b></span>
    </div>
  </button>
}

export function StudentFocus({ live, elapsed, onClear }: { live: LiveStudent; elapsed: number; onClear: () => void }) {
  const { participant, agg } = live
  const zone = live.cur === null ? null : zoneOf(live.cur, participant.age)
  const observed = agg.zoneSec.reduce((sum, seconds) => sum + seconds, 0)
  const target = agg.zoneSec.slice(1).reduce((sum, seconds) => sum + seconds, 0)
  return <section className={styles.focusDetail} aria-label={`${participant.no}번 학생 상세`}>
    <div className={styles.focusIdentity}>
      <span className={styles.overline}>선택 학생</span><h2>{participant.no}번 {participant.name}</h2>
      <span>{participant.estimatedAge ? '학년 기준' : '만'} {participant.age}세 · HRmax {hrMax(participant.age)} · 센서 {participant.device_id || '--'}</span>
      <Button variant="ghost" onClick={onClear}><X size={15} />선택 해제 · 30명 보기</Button>
    </div>
    <div className={styles.focusKpis}>
      <div className={styles.currentKpi}><div><strong style={{ color: zone?.color }}>{valueText(live.cur)}</strong><span>bpm</span></div>
        <div><b className={styles.zoneChip} style={{ background: zone?.color ?? '#605d5d' }}>{zone?.label ?? '신호 없음'}{live.cur !== null && ` · ${Math.round(live.cur / hrMax(participant.age) * 100)}%`}</b><span>현재 심박</span></div></div>
      <div><span>세션 최저</span><strong className={styles.muted}>{valueText(agg.min)}</strong><small>{agg.min === null ? '--' : `${zoneOf(agg.min, participant.age).label} · ${formatDuration(agg.minSec)}`}</small></div>
      <div><span>세션 평균</span><strong>{valueText(average(live))}</strong><small>{agg.n ? `${agg.n.toLocaleString()}회 수신` : '--'}</small></div>
      <div><span>세션 최고</span><strong style={{ color: agg.max === null ? undefined : zoneOf(agg.max, participant.age).color }}>{valueText(agg.max)}</strong><small>{agg.max === null ? '--' : `${zoneOf(agg.max, participant.age).label} · ${formatDuration(agg.maxSec)}`}</small></div>
    </div>
    <div className={styles.waveform}>
      <div className={styles.waveformHeading}><h3>세션 심박 파형 · 최근 50분 창</h3><span><i />세션 평균 {valueText(average(live))}</span></div>
      <HeartRateChart live={live} detail />
      <div className={styles.focusMetrics}>
        <div><span className={styles.overline}>구간 체류</span><div className={styles.zoneStack} aria-label="구간별 수신 시간">
          {HR_ZONES.map((item, index) => <span key={item.key} title={`${item.label} ${formatDuration(agg.zoneSec[index])}`} style={{ width: `${observed ? agg.zoneSec[index] / observed * 100 : 0}%`, background: item.band }} />)}
        </div><small>{HR_ZONES.map((item, index) => `${item.label} ${formatDuration(agg.zoneSec[index])}`).join(' · ')}</small></div>
        <div><span className={styles.overline}>목표 구간 · 중강도 이상</span><strong>{formatDuration(target)}</strong><small>/ {formatDuration(elapsed)} · 수신 시간 중 {observed ? Math.round(target / observed * 100) : 0}%</small></div>
        <div><span className={styles.overline}>추정 열량 · 1분 회복</span><strong>-- <small>kcal · -- bpm</small></strong><small>계산에 필요한 측정 데이터 없음</small></div>
      </div>
    </div>
  </section>
}

export default function LiveHeartCare() {
  const bridge = useHeartRateBridge()
  const [focusNo, setFocusNo] = useState<number | null>(null)
  const [sort, setSort] = useState('number')
  const [fullscreen, setFullscreen] = useState(false)
  const [installOpen, setInstallOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const selectFocus = useCallback((no: number | null) => {
    setFocusNo(no)
    const url = new URL(window.location.href)
    if (no === null) url.searchParams.delete('focus')
    else url.searchParams.set('focus', String(no))
    window.history.replaceState(window.history.state, '', url)
  }, [])

  useEffect(() => {
    let active = true
    const syncFocus = () => {
      const no = Number(new URL(window.location.href).searchParams.get('focus'))
      setFocusNo(Number.isInteger(no) && no >= 1 && no <= 30 ? no : null)
    }
    syncFocus()
    window.addEventListener('popstate', syncFocus)
    void fetch('/api/school/info', { credentials: 'include' }).then(async response => {
      const data = await response.json()
      if (!response.ok || !data.school?.id) throw new Error(data.error || '학교 정보를 확인할 수 없습니다.')
      if (active) bridge.restore(data.school.id)
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : '학교 정보 조회 실패') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false; window.removeEventListener('popstate', syncFocus) }
  }, [bridge])
  useEffect(() => {
    const onFullscreen = () => setFullscreen(Boolean(document.fullscreenElement))
    onFullscreen()
    document.addEventListener('fullscreenchange', onFullscreen)
    return () => document.removeEventListener('fullscreenchange', onFullscreen)
  }, [])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('[role="alertdialog"]')) return
      if (focusNo !== null) { event.preventDefault(); selectFocus(null) }
      else if (document.fullscreenElement) void document.exitFullscreen().catch(() => setError('전체화면을 종료하지 못했습니다.'))
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [focusNo, selectFocus])

  const session = bridge.session
  const students = session?.students ?? []
  const selected = students.find(student => student.participant.no === focusNo)
  const remaining = students.filter(student => student.participant.no !== focusNo).sort((a, b) => sort === 'bpm'
    ? (b.cur ?? -1) - (a.cur ?? -1) || a.participant.no - b.participant.no : a.participant.no - b.participant.no)
  const received = students.filter(student => student.cur !== null)
  const elapsed = session ? Math.max(0, ((session.stoppedAt ?? bridge.now) - session.startedAt) / 1000) : 0
  const warnings = students.filter(student => isWarning(student, session?.stoppedAt ?? bridge.now))
  const finished = ['saved', 'empty'].includes(bridge.saveState)
  const connect = async () => { if (!(await bridge.connect(true))) setInstallOpen(true) }
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await document.documentElement.requestFullscreen()
    } catch { setError('브라우저에서 전체화면 요청을 허용하지 않았습니다.') }
  }
  if (!session) return <div className={`${styles.root} ${styles.liveEmpty}`}>
    <Activity size={30} /><h1>Heart Care</h1><p>{error ?? (loading ? '세션을 불러오는 중...' : '진행 중인 측정이 없습니다.')}</p>
    <Button asChild><Link href="/school/heart-rate"><ArrowLeft size={15} />심박기록관리</Link></Button>
  </div>

  return <div className={`${styles.root} ${styles.live}`} data-heart-care-live>
    <header className={styles.liveHeader}>
      <Image src="/image/logo_atvcms.svg" width={108} height={26} alt="atvcms" className={styles.logo} unoptimized />
      <span className={styles.headerRule} /><h1>{session.context.grade}학년 {session.context.class_no}반 · 실시간 심박</h1>
      <div className={styles.liveStatus} data-state={bridge.state} title={bridge.statusText}>
        <i /><span>{finished ? '측정 완료' : bridge.sessionActive ? `측정 중 · ${received.length}명 수신` : bridge.state === 'connecting' ? '연결 중 ···' : '수신 대기'}</span>
      </div>
      <div className={styles.liveTools}><ZoneLegend /><div className={styles.elapsed}><span>경과</span><strong>{formatDuration(elapsed)}</strong></div>
        <Button variant="outline" onClick={toggleFullscreen}>{fullscreen ? <Minimize size={15} /> : <Maximize size={15} />}{fullscreen ? '전체화면 종료' : '전체화면'}</Button>
        {!finished && bridge.saveState === 'idle' && <Button className={styles.stopButton} onClick={() => bridge.stop()} disabled={bridge.state === 'connecting'}><CircleStop size={15} />측정 종료 · 저장</Button>}
        {finished && <Button asChild variant="outline"><Link href="/school/heart-rate"><ArrowLeft size={15} />월별 기록</Link></Button>}
      </div>
    </header>
    {(bridge.state !== 'open' || bridge.saveState !== 'idle' || error || bridge.persistenceError) && <div className={styles.notice} role="status">
      <span>{error ?? bridge.persistenceError ?? bridge.statusText}</span>
      {bridge.state !== 'open' && session.stoppedAt === null && <Button variant="outline" disabled={bridge.state === 'connecting'} onClick={connect}><RefreshCw size={15} />{bridge.state === 'connecting' ? '연결 중 ···' : '다시 연결'}</Button>}
      <SaveActions bridge={bridge} />
      {bridge.saveState === 'uncertain' && <Button asChild variant="ghost"><Link href="/school/heart-rate">월별 기록 확인</Link></Button>}
    </div>}
    {warnings.length > 0 && <div className={styles.warningBanner} role="status">최대·주의 구간 2분 초과 · {warnings.map(student => `${student.participant.no}번 ${student.participant.name}`).join(', ')}</div>}
    {selected ? <div className={styles.focusLayout} key="focus">
      <StudentFocus live={selected} elapsed={elapsed} onClear={() => selectFocus(null)} />
      <aside className={styles.rail}><div className={styles.railHeader}><h2>나머지 {remaining.length}명</h2>
        <ToggleGroup type="single" value={sort} onValueChange={value => { if (value) setSort(value) }} aria-label="학생 정렬">
          <ToggleGroupItem value="number" aria-label="번호순">번호</ToggleGroupItem><ToggleGroupItem value="bpm" aria-label="심박 높은 순">심박<ArrowDown size={13} /></ToggleGroupItem>
        </ToggleGroup></div>
        <div className={styles.railList}>{remaining.map(live => {
          const zone = live.cur === null ? null : zoneOf(live.cur, live.participant.age)
          return <button key={live.participant.no} className={styles.railRow} onClick={() => selectFocus(live.participant.no)} data-rail-student={live.participant.no}>
            <strong>{live.participant.no} {live.participant.name}</strong><b style={{ color: zone?.color }}>{valueText(live.cur)}</b><HeartRateChart live={live} rail />
            <span style={{ color: zone?.color }}>{zone?.label ?? '신호 없음'}</span><i style={{ background: zone?.band ?? '#dcd8d8' }} />
          </button>
        })}</div>
      </aside>
    </div> : <div className={styles.liveGrid} key="grid">{students.map(live => <StudentTile key={live.participant.no} live={live} warning={isWarning(live, bridge.now)} onFocus={() => selectFocus(live.participant.no)} />)}</div>}
    <InstallDialog open={installOpen} onOpenChange={setInstallOpen} />
  </div>
}
