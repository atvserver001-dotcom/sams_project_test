import { HR_ZONES, studentAge, zoneIndexOf } from './zones'

export const WINDOW_SEC = 3000
export const SIGNAL_TIMEOUT_MS = 5000
export type SchoolStudent = { id: string; student_no: number; name: string; birth_date: string | null }
export type Mapping = { student_no: number; device_id: string }
export type Participant = { id: string; no: number; name: string; device_id: string; age: number; estimatedAge: boolean }
export type SessionContext = { schoolId: string; year: number; grade: number; class_no: number; schoolType: number; students: Participant[] }
export type Sample = { sec: number; bpm: number | null; min: number | null; max: number | null }
export type Aggregate = { min: number | null; max: number | null; minSec: number; maxSec: number; sum: number; n: number; zoneSec: number[] }
export type LiveStudent = {
  participant: Participant
  buf: (Sample | null)[]
  head: number
  size: number
  cur: number | null
  lastSeenAt: number | null
  lastSourceAt: number | null
  tech: 'ANT' | 'BLE' | null
  battery: number | null
  agg: Aggregate
  maximumSince: number | null
}
export type Session = { id: string; context: SessionContext; startedAt: number; lastSec: number; stoppedAt: number | null; students: LiveStudent[] }
export type SessionResult = {
  student_id: string; student_no: number; name: string; year: number; month: number
  avg_bpm: number; min_bpm: number; max_bpm: number; record_count: number
}

export function makeParticipants(students: SchoolStudent[], mappings: Mapping[], grade: number, schoolType: number, now = new Date()): Participant[] {
  return Array.from({ length: 30 }, (_, index) => {
    const no = index + 1
    const student = students.find(item => item.student_no === no)
    return { id: student?.id ?? '', no, name: student?.name ?? `${no}번 학생`,
      device_id: mappings.find(item => item.student_no === no)?.device_id ?? '',
      age: studentAge(student?.birth_date ?? null, grade, schoolType, now), estimatedAge: !student?.birth_date }
  })
}

export function createSession(context: SessionContext, startedAt = Date.now(), id = crypto.randomUUID()): Session {
  return { id, context, startedAt, stoppedAt: null, lastSec: -1, students: context.students.map(participant => ({
    participant, buf: Array(WINDOW_SEC).fill(null), head: 0, size: 0, cur: null, lastSeenAt: null,
    lastSourceAt: null, tech: null, battery: null, maximumSince: null,
    agg: { min: null, max: null, minSec: 0, maxSec: 0, sum: 0, n: 0, zoneSec: HR_ZONES.map(() => 0) },
  })) }
}

export const deviceKey = (value: string | number) => {
  const key = String(value).trim().toLowerCase()
  return /^\d+$/.test(key) ? key.replace(/^0+(?=\d)/, '') : key.replace(/[:-]/g, '')
}

function append(live: LiveStudent, sample: Sample) {
  live.buf[live.head] = sample
  live.head = (live.head + 1) % WINDOW_SEC
  live.size = Math.min(WINDOW_SEC, live.size + 1)
}

// Advance the time axis, never synthesize held values into measured statistics.
export function advanceSession(session: Session, now: number) {
  if (session.stoppedAt !== null) return
  const sec = Math.max(0, Math.floor((now - session.startedAt) / 1000))
  const first = Math.max(session.lastSec + 1, sec - WINDOW_SEC + 1)
  for (const live of session.students) {
    for (let next = first; next <= sec; next++) append(live, { sec: next, bpm: null, min: null, max: null })
    if (live.lastSeenAt === null || now - live.lastSeenAt >= SIGNAL_TIMEOUT_MS) {
      live.cur = null
      live.maximumSince = null
    }
  }
  session.lastSec = Math.max(session.lastSec, sec)
}

export function ingestSample(session: Session, deviceId: string | number, bpm: number, now: number,
  tech: 'ANT' | 'BLE', battery: number | null = null, sourceAt: number | null = null) {
  if (session.stoppedAt !== null || !Number.isInteger(bpm) || (bpm !== 0 && bpm < 30) || bpm > 240) return false
  const matches = session.students.filter(live => live.participant.device_id && deviceKey(live.participant.device_id) === deviceKey(deviceId))
  if (matches.length !== 1) return false
  const live = matches[0]
  if (sourceAt !== null && live.lastSourceAt !== null && sourceAt <= live.lastSourceAt) return false
  if (sourceAt !== null && (sourceAt < session.startedAt || sourceAt > now + SIGNAL_TIMEOUT_MS || now - sourceAt >= SIGNAL_TIMEOUT_MS)) return false
  advanceSession(session, now)
  const sec = session.lastSec
  live.lastSourceAt = sourceAt
  live.lastSeenAt = now
  live.tech = tech
  live.battery = battery
  const slot = live.buf[(live.head + WINDOW_SEC - 1) % WINDOW_SEC]!
  const previousZone = slot.bpm === null ? null : zoneIndexOf(slot.bpm, live.participant.age)
  // Sensor zero is a received no-contact signal, not a measured zero-bpm value.
  live.cur = bpm === 0 ? null : bpm
  if (previousZone !== null) live.agg.zoneSec[previousZone]--
  if (bpm === 0) { slot.bpm = null; live.maximumSince = null; return true }
  slot.bpm = bpm
  slot.min = Math.min(slot.min ?? bpm, bpm)
  slot.max = Math.max(slot.max ?? bpm, bpm)
  const zone = zoneIndexOf(bpm, live.participant.age)
  live.agg.zoneSec[zone]++
  if (live.agg.min === null || bpm < live.agg.min) { live.agg.min = bpm; live.agg.minSec = sec }
  if (live.agg.max === null || bpm > live.agg.max) { live.agg.max = bpm; live.agg.maxSec = sec }
  live.agg.sum += bpm
  live.agg.n++
  if (zone === HR_ZONES.length - 1) live.maximumSince ??= now
  else live.maximumSince = null
  return true
}

export function windowSamples(live: LiveStudent): Sample[] {
  return Array.from({ length: live.size }, (_, index) => live.buf[(live.head - live.size + index + WINDOW_SEC) % WINDOW_SEC]!)
}

export function sessionResults(session: Session): SessionResult[] {
  const date = new Date(session.startedAt)
  return session.students.filter(live => live.agg.n > 0).map(({ participant, agg }) => ({
    student_id: participant.id, student_no: participant.no, name: participant.name,
    year: date.getFullYear(), month: date.getMonth() + 1,
    avg_bpm: Math.round(agg.sum / agg.n * 10) / 10, min_bpm: agg.min!, max_bpm: agg.max!, record_count: agg.n,
  }))
}

export const average = (live: LiveStudent) => live.agg.n ? Math.round(live.agg.sum / live.agg.n) : null
export const isWarning = (live: LiveStudent, now: number) => live.cur !== null && live.maximumSince !== null && now - live.maximumSince > 120000
