'use client'

import { useEffect, useMemo, useState } from 'react'
import { Badge } from '../ui/badge'

import {
  JUMP_ROPE_PROFILE,
  JumpRopeMode,
  JumpRopeSnapshotEvent,
  getJumpRopeCardRule,
  getJumpRopeModePresentation,
  getJumpRopeSignalState,
} from '../../lib/jumpRopeSerial'
import { WebSerialJumpRopeState } from './useWebSerialJumpRope'
import { getJumpRopeSlotLifecycleLabel } from './jumpRopeUiState'

interface JumpRopeBoardStudent {
  id: string
  student_no: number
  name: string
}

export interface JumpRopeSnapshotView {
  event: JumpRopeSnapshotEvent
  receivedAt: number
}

interface JumpRopeTestBoardProps {
  students: JumpRopeBoardStudent[]
  mode: JumpRopeMode
  target: number
  snapshotsBySlot: Record<number, JumpRopeSnapshotView>
  connectionState: WebSerialJumpRopeState
  statusText: string
  connectionError: string | null
}

type BatteryLevel = 1 | 2 | 3 | 4

const connectionPresentation: Record<WebSerialJumpRopeState, { label: string; classes: string }> = {
  idle: { label: '연결 대기', classes: 'bg-muted text-muted-foreground' },
  connecting: { label: '포트 탐색 중', classes: 'bg-accent text-accent-foreground' },
  handshaking: { label: '핸드셰이크 중', classes: 'bg-amber-100 text-amber-800' },
  configuring: { label: 'JR203 준비 중', classes: 'bg-amber-100 text-amber-800' },
  connected: { label: '기기 연결됨', classes: 'bg-accent text-accent-foreground' },
  reconnecting: { label: 'JR203 재연결 중', classes: 'bg-amber-100 text-amber-800' },
  starting: { label: '시작 신호 전송 중', classes: 'bg-amber-100 text-amber-800' },
  running: { label: '측정 중', classes: 'bg-emerald-100 text-emerald-800' },
  finishing: { label: '끝 신호 전송 중', classes: 'bg-amber-100 text-amber-800' },
  disconnecting: { label: '연결 해제 중', classes: 'bg-muted text-muted-foreground' },
  error: { label: '연결 오류', classes: 'bg-destructive/10 text-destructive' },
}

const signalPresentation = {
  waiting: { label: '신호 대기', dot: 'bg-muted-foreground/40', text: 'text-muted-foreground' },
  fresh: { label: '수신 중', dot: 'bg-emerald-500', text: 'text-emerald-700' },
  stale: { label: '신호 지연', dot: 'bg-amber-400', text: 'text-amber-700' },
  offline: { label: '오프라인', dot: 'bg-rose-500', text: 'text-rose-700' },
} as const

const batteryLevel = (percent: number | null | undefined): BatteryLevel | null => {
  if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 100) return null
  if (percent <= 25) return 1
  if (percent <= 50) return 2
  if (percent <= 75) return 3
  return 4
}

function JumpRopeBatteryIcon({ percent }: { percent: number | null | undefined }) {
  const level = batteryLevel(percent)
  const available = level !== null
  const label = available ? `배터리 ${Math.round(percent as number)}퍼센트, ${level}단계` : '배터리 정보 없음'
  const color = level === 1
    ? 'text-rose-500'
    : level === 2
      ? 'text-amber-500'
      : level === 3
        ? 'text-emerald-500'
        : level === 4
          ? 'text-emerald-600'
          : 'text-gray-400'

  return (
    <span role="img" aria-label={label} title={label} className={`inline-flex shrink-0 items-center gap-1 ${color}`}>
      <svg viewBox="0 0 30 14" className="h-3.5 w-[30px]" fill="none" aria-hidden="true">
        <rect x="1" y="1" width="24" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M26 4.5h2a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-2v-5Z" fill="currentColor" />
        {[0, 1, 2, 3].map((segment) => (
          <rect
            key={segment}
            x={3.5 + segment * 5.25}
            y="3.5"
            width="3.75"
            height="7"
            rx="0.75"
            className={available && segment < level ? 'fill-current' : 'fill-muted'}
          />
        ))}
      </svg>
      <span className="text-[10px] font-bold">{available ? `${Math.round(percent as number)}%` : '?'}</span>
    </span>
  )
}

export default function JumpRopeTestBoard({
  students,
  mode,
  target,
  snapshotsBySlot,
  connectionState,
  statusText,
  connectionError,
}: JumpRopeTestBoardProps) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [])

  const studentsByNumber = useMemo(
    () => new Map(students.map((student) => [student.student_no, student])),
    [students],
  )
  const connection = connectionPresentation[connectionState]
  const receivingCount = Object.values(snapshotsBySlot).filter(
    (snapshot) => getJumpRopeSignalState(snapshot.receivedAt, now) === 'fresh',
  ).length
  return (
    <section className="min-w-0 font-sans text-[13px] text-foreground" aria-labelledby="jump-rope-board-title">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-6 gap-y-3 border-b-2 border-border pb-3">
        <div className="min-w-0 flex-1 basis-72">
          <h2 id="jump-rope-board-title" className="text-base font-bold text-foreground">JR203 줄넘기 실시간 현황</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            학생 카드 30개 · 현재 펌웨어 동시 연결 1대 · 신호 수신 {receivingCount}대
          </p>
          <p className="mt-1 text-xs font-semibold text-accent-foreground">
            최초 자동 식별 중에는 테스트할 JR203 줄넘기 1대만 켜 두세요.
          </p>
        </div>
        <div className="flex min-w-0 max-w-xl flex-wrap items-center gap-2" aria-live="polite">
          <Badge variant="secondary" className={`rounded-none px-2 py-1 text-[11px] font-semibold ${connection.classes}`}>
            {(connectionState === 'connected' || connectionState === 'running') && (
              <span className="mr-1 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500 motion-safe:animate-pulse" />
            )}
            {connection.label}
          </Badge>
          <span className="min-w-0 text-xs text-muted-foreground [overflow-wrap:anywhere]">{statusText}</span>
        </div>
      </div>

      {connectionError && (
        <div className="mt-4 border-l-2 border-destructive bg-destructive/5 px-4 py-3 text-[13px] break-words text-destructive" role="alert">
          {connectionError}
        </div>
      )}

      <div className="mt-4 grid auto-rows-fr grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 30 }).map((_, index) => {
          const slot = index + 1
          const student = studentsByNumber.get(slot)
          const snapshot = snapshotsBySlot[slot]
          const event = snapshot?.event
          const signalState = getJumpRopeSignalState(snapshot?.receivedAt, now)
          const signal = signalPresentation[signalState]
          const modePresentation = getJumpRopeModePresentation(mode, event?.mode)
          const isCurrentGatewaySlot = slot === JUMP_ROPE_PROFILE.slot
          const lifecycleLabel = getJumpRopeSlotLifecycleLabel(connectionState)
          const signalLabel = isCurrentGatewaySlot && lifecycleLabel
            ? lifecycleLabel
            : event
              ? signal.label
              : connectionState === 'running' && isCurrentGatewaySlot
                ? '신호 대기'
                : '미연결'

          return (
            <article
              key={slot}
              className={`flex min-h-52 min-w-0 flex-col border bg-card p-3 text-card-foreground transition-colors ${signalState === 'fresh' ? 'border-emerald-500' : 'border-border'}`}
              aria-label={`${slot}번 슬롯 ${student?.name ?? '학생'} 줄넘기 현황`}
            >
              <div className="flex items-center justify-between gap-2 border-b border-border/40 pb-2">
                <h3 className="min-w-0 flex-1 truncate text-[13px] font-bold text-card-foreground" title={student?.name ?? `${slot}번 학생`}>
                  {student?.name ?? `${slot}번 학생`}
                </h3>
                <Badge variant="secondary" className="rounded-none bg-accent text-[11px] font-semibold text-accent-foreground">
                  #{slot} 슬롯
                </Badge>
              </div>

              <div className="mt-3 text-center">
                <p className={`text-xs font-semibold ${modePresentation.state === 'mismatch' ? 'text-destructive' : 'text-foreground'}`}>
                  {modePresentation.label}
                </p>
                <p className={`mt-1 min-h-8 text-[11px] leading-4 ${modePresentation.state === 'mismatch' ? 'font-bold text-destructive' : 'text-muted-foreground'}`}>
                  {modePresentation.warning ?? getJumpRopeCardRule(mode, target, event)}
                </p>
              </div>

              <div className="flex flex-1 items-baseline justify-center py-3">
                <span className={`text-[32px] leading-none font-bold tabular-nums ${event ? 'text-primary' : 'text-muted-foreground/50'}`}>
                  {event?.count.toLocaleString('ko-KR') ?? '--'}
                </span>
                <span className="ml-1.5 text-xs font-semibold text-muted-foreground">회</span>
              </div>

              <div className="flex items-center justify-between gap-2 border-t border-border/40 pt-2 text-[10px]">
                <span className={`inline-flex min-w-0 items-center gap-1 truncate font-semibold ${event ? signal.text : 'text-muted-foreground'}`}>
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${event ? signal.dot : 'bg-muted-foreground/40'}`} />
                  {signalLabel}
                </span>
                <JumpRopeBatteryIcon percent={event?.battery_percent} />
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
