'use client'
import { useEffect, useState } from 'react'
import Image from 'next/image'
import { ArrowDown, ArrowLeft, CircleStop, Maximize, Minimize } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { createSerialDisplaySlots, getSerialDisplaySlotState, serialDisplaySlotStateLabel } from '@/lib/heart-rate/serial-display'
import { isWarning, type Session } from '@/lib/heart-rate/session'
import { formatDuration, zoneOf } from '@/lib/heart-rate/zones'
import { HeartRateChart, ZoneLegend } from './HeartRateChart'
import { EmptyStudentTile, StudentFocus, StudentTile } from './StudentHeartRateViews'
import styles from './heart-care.module.css'
const valueText = (value: number | null) => value === null ? '--' : Math.round(value)
export function SerialHeartCareView({ session, now, state, statusText, error, busy, onStop, onBack }: {
 session: Session | null; now: number; state: string; statusText: string; error: string | null; busy: boolean; onStop: () => void; onBack: () => void
}) {
 const [focusNo, setFocusNo] = useState<number | null>(null)
 const [sort, setSort] = useState('number')
 const [fullscreen, setFullscreen] = useState(false)
 const selectFocus = setFocusNo
 useEffect(() => {
  const change = () => setFullscreen(Boolean(document.fullscreenElement))
  const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && !document.querySelector('[role="dialog"]')) setFocusNo(null) }
  change(); document.addEventListener('fullscreenchange', change); document.addEventListener('keydown', key)
  return () => { document.removeEventListener('fullscreenchange', change); document.removeEventListener('keydown', key) }
 }, [])
 const toggleFullscreen = async () => { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen() }
 const [fullscreenError, setFullscreenError] = useState<string | null>(null)
 const students = session?.students ?? []
 const slots = session ? createSerialDisplaySlots(students) : []
 const selected = students.find(student => student.participant.no === focusNo)
 const remaining = slots.filter(slot => slot.no !== focusNo).sort((a, b) => sort === 'bpm'
  ? (b.live?.cur ?? -1) - (a.live?.cur ?? -1) || a.no - b.no : a.no - b.no)
 const elapsed = session ? Math.max(0, ((session.stoppedAt ?? now) - session.startedAt) / 1000) : 0
 const warnings = students.filter(student => isWarning(student, session?.stoppedAt ?? now))
 return <div className={`${styles.root} ${styles.live} max-[760px]:!h-dvh max-[760px]:!overflow-y-auto`} data-heart-care-live>
  <header className={styles.liveHeader}>
   <Image src="/image/logo_atvcms.svg" width={108} height={26} alt="atvcms" className={styles.logo} unoptimized />
   <span className={styles.headerRule} /><h1>{session ? `${session.context.grade}학년 ${session.context.class_no}반 · 실시간 심박` : '실시간 심박 측정'}</h1>
   <div className={styles.liveStatus} data-state={state === 'running' ? 'open' : state}><i /><span>{statusText}</span></div>
   <div className={styles.liveTools}><ZoneLegend /><div className={styles.elapsed}><span>경과</span><strong>{formatDuration(elapsed)}</strong></div>
    <Button variant="outline" onClick={() => { void toggleFullscreen().catch(() => setFullscreenError('전체화면 요청을 허용하지 않았습니다.')) }}>{fullscreen ? <Minimize size={15} /> : <Maximize size={15} />}{fullscreen ? '전체화면 종료' : '전체화면'}</Button>
    <Button variant="outline" onClick={onBack} disabled={busy}><ArrowLeft size={15} />월별 기록</Button>
    <Button className={styles.stopButton} onClick={onStop} disabled={busy}><CircleStop size={15} />{busy ? '측정 준비·종료 중' : '측정 종료 · 저장'}</Button>
   </div>
  </header>
  {(error || fullscreenError || !session) && <div className={styles.notice} role="status">{error ?? fullscreenError ?? statusText}</div>}
    {warnings.length > 0 && <div className={styles.warningBanner} role="status">최대·주의 구간 2분 초과 · {warnings.map(student => `${student.participant.no}번 ${student.participant.name}`).join(', ')}</div>}
    {selected ? <div className={`${styles.focusLayout} max-[760px]:!block max-[760px]:!flex-none`} key="focus">
      <StudentFocus live={selected} elapsed={elapsed} onClear={() => selectFocus(null)} />
      <aside className={styles.rail}><div className={styles.railHeader}><h2>나머지 {remaining.length}개 자리</h2>
        <ToggleGroup type="single" value={sort} onValueChange={value => { if (value) setSort(value) }} aria-label="학생 정렬">
          <ToggleGroupItem value="number" aria-label="번호순">번호</ToggleGroupItem><ToggleGroupItem value="bpm" aria-label="심박 높은 순">심박<ArrowDown size={13} /></ToggleGroupItem>
        </ToggleGroup></div>
        <div className={styles.railList}>{remaining.map(slot => {
          const live = slot.live
          if (!live) return <div role="group" key={slot.no} className={`${styles.railRow} ${styles.unregisteredRailRow}`} data-rail-student={slot.no} data-slot-state="unregistered" aria-label={`${slot.no}번, 학생 미등록`}>
            <strong>{slot.no} 학생 미등록</strong><b>--</b><span aria-hidden /><span>학생 미등록</span><i />
          </div>
          const state = getSerialDisplaySlotState(live)
          const zone = state === 'live' ? zoneOf(live.cur!, live.participant.age) : null
          const stateText = zone?.label ?? serialDisplaySlotStateLabel(state)
          return <button key={live.participant.no} className={styles.railRow} onClick={() => selectFocus(live.participant.no)} data-rail-student={live.participant.no} data-slot-state={state}>
            <strong>{live.participant.no} {live.participant.name}</strong><b style={{ color: zone?.color }}>{valueText(live.cur)}</b><HeartRateChart live={live} rail carryMissing />
            <span style={{ color: zone?.color }}>{stateText}</span><i style={{ background: zone?.band ?? '#dcd8d8' }} />
          </button>
        })}</div>
      </aside>
    </div> : <div className={styles.liveGrid} key="grid">{slots.map(slot => slot.live
      ? <StudentTile key={slot.no} live={slot.live} warning={isWarning(slot.live, now)} onFocus={() => selectFocus(slot.no)} />
      : <EmptyStudentTile key={slot.no} no={slot.no} />)}</div>}

 </div>
}
