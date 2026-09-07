'use client'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getSerialDisplaySlotState, serialDisplaySlotStateLabel } from '@/lib/heart-rate/serial-display'
import { average, type LiveStudent } from '@/lib/heart-rate/session'
import { formatDuration, HR_ZONES, hrMax, zoneOf } from '@/lib/heart-rate/zones'
import { HeartRateChart } from './HeartRateChart'
import HeartRateBatteryIcon from './HeartRateBatteryIcon'
import styles from './heart-care.module.css'

const valueText = (value: number | null) => value === null ? '--' : Math.round(value)

export function StudentTile({ live, warning, onFocus }: { live: LiveStudent; warning: boolean; onFocus: () => void }) {
  const state = getSerialDisplaySlotState(live)
  const zone = state === 'live' ? zoneOf(live.cur!, live.participant.age) : null
  const stateText = zone?.label ?? serialDisplaySlotStateLabel(state)
  return <button type="button" className={`${styles.tile} ${zone ? '' : styles.noSignal} ${state === 'unassigned' ? styles.unassignedTile : ''} ${warning ? styles.warningTile : ''}`}
    onClick={onFocus} data-student-no={live.participant.no} data-slot-state={state} aria-label={`${live.participant.no}번 ${live.participant.name}, ${zone ? `${live.cur} bpm, ${zone.label}` : stateText}, 상세 보기`}>
    <div className={styles.tileIdentity}><strong>{live.participant.no} {live.participant.name}</strong><span style={{ color: zone?.color }}>{stateText} {state !== 'unassigned' && <HeartRateBatteryIcon percent={live.battery} stale={state !== 'live'} />}</span></div>
    <div className={styles.tileReading}><strong style={{ color: zone?.color }}>{valueText(live.cur)}</strong><span>bpm</span><span className={styles.percent}>{live.cur === null ? '--' : `${Math.round(live.cur / hrMax(live.participant.age) * 100)}%`} HRmax</span></div>
    <HeartRateChart live={live} carryMissing />
    <div className={styles.tileStats}>
      <span>최저 <b>{valueText(live.agg.min)}</b></span><span>평균 <b>{valueText(average(live))}</b></span>
      <span>최고 <b style={{ color: live.agg.max === null ? undefined : zoneOf(live.agg.max, live.participant.age).color }}>{valueText(live.agg.max)}</b></span>
    </div>
  </button>
}

export function EmptyStudentTile({ no }: { no: number }) {
  return <div role="group" className={`${styles.tile} ${styles.noSignal} ${styles.unregisteredTile}`} data-student-no={no} data-slot-state="unregistered" aria-label={`${no}번, 학생 미등록`}>
    <div className={styles.tileIdentity}><strong>{no} 학생 미등록</strong><span>측정 대상 아님</span></div>
    <div className={styles.tileReading}><strong>--</strong><span>bpm</span><span className={styles.percent}>-- HRmax</span></div>
    <div className={styles.emptySlotBody}>DB 명단에 등록된 학생이 없습니다.</div>
    <div className={styles.tileStats}><span>최저 <b>--</b></span><span>평균 <b>--</b></span><span>최고 <b>--</b></span></div>
  </div>
}

export function StudentFocus({ live, elapsed, onClear }: { live: LiveStudent; elapsed: number; onClear: () => void }) {
  const { participant, agg } = live
  const state = getSerialDisplaySlotState(live)
  const zone = state === 'live' ? zoneOf(live.cur!, participant.age) : null
  const stateText = zone?.label ?? serialDisplaySlotStateLabel(state)
  const observed = agg.zoneSec.reduce((sum, seconds) => sum + seconds, 0)
  const target = agg.zoneSec.slice(1).reduce((sum, seconds) => sum + seconds, 0)
  return <section className={styles.focusDetail} aria-label={`${participant.no}번 학생 상세`}>
    <div className={styles.focusIdentity}>
      <span className={styles.overline}>선택 학생</span><h2>{participant.no}번 {participant.name}</h2>
      <span>{participant.estimatedAge ? '학년 기준' : '만'} {participant.age}세 · HRmax {hrMax(participant.age)} · 센서 {participant.device_id || '미배정'}</span>
      <Button variant="ghost" onClick={onClear}><X size={15} />선택 해제 · 30명 보기</Button>
    </div>
    <div className={styles.focusKpis}>
      <div className={styles.currentKpi}><div><strong style={{ color: zone?.color }}>{valueText(live.cur)}</strong><span>bpm</span></div>
        <div><b className={styles.zoneChip} style={{ background: zone?.color ?? '#605d5d' }}>{stateText}{state === 'live' && ` · ${Math.round(live.cur! / hrMax(participant.age) * 100)}%`}</b><span>현재 심박</span></div></div>
      <div><span>세션 최저</span><strong className={styles.muted}>{valueText(agg.min)}</strong><small>{agg.min === null ? '--' : `${zoneOf(agg.min, participant.age).label} · ${formatDuration(agg.minSec)}`}</small></div>
      <div><span>세션 평균</span><strong>{valueText(average(live))}</strong><small>{agg.n ? `${agg.n.toLocaleString()}회 수신` : '--'}</small></div>
      <div><span>세션 최고</span><strong style={{ color: agg.max === null ? undefined : zoneOf(agg.max, participant.age).color }}>{valueText(agg.max)}</strong><small>{agg.max === null ? '--' : `${zoneOf(agg.max, participant.age).label} · ${formatDuration(agg.maxSec)}`}</small></div>
    </div>
    <div className={styles.waveform}>
      <div className={styles.waveformHeading}><h3>세션 심박 파형 · 최근 50분 창</h3><span><i />세션 평균 {valueText(average(live))}</span></div>
      <HeartRateChart live={live} detail carryMissing />
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
