import type { ExerciseRow } from '../../src/components/exercises/exercise-data'
import { advanceSession, createSession, ingestSample, type Session } from '../../src/lib/heart-rate/session'

export type Scenario = 'normal' | 'missing' | 'zero' | 'spike' | 'flat' | 'range' | 'disconnect'

export const SCENARIOS: { value: Scenario; label: string }[] = [
  { value: 'normal', label: '정상' },
  { value: 'missing', label: '결측' },
  { value: 'zero', label: '0값' },
  { value: 'spike', label: '급등락' },
  { value: 'flat', label: '동일값' },
  { value: 'range', label: '범위 경계' },
  { value: 'disconnect', label: '연결 끊김' },
]

export const LAB_YEAR = 2025
export const LAB_START = Date.UTC(2025, 8, 5, 3)

type MonthlyCell = Record<'minutes' | 'minutes_c1' | 'minutes_c2' | 'minutes_c3' | 'avg_bpm' | 'max_bpm' | 'accuracy' | 'calories', number | null>

const MONTH_LOAD = [11, 12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const
const RANGE_BPM = [30, 45, 60, 104, 131, 132, 158, 159, 185, 186, 200, 220, 240] as const
const SESSION_IDS = {
  normal: '20250905-0000-4000-8000-000000000001',
  missing: '20250905-0000-4000-8000-000000000002',
  zero: '20250905-0000-4000-8000-000000000003',
  spike: '20250905-0000-4000-8000-000000000004',
  flat: '20250905-0000-4000-8000-000000000005',
  range: '20250905-0000-4000-8000-000000000006',
  disconnect: '20250905-0000-4000-8000-000000000007',
} as const
const nameOf = (no: number) => `검증 학생 ${String(no).padStart(2, '0')}`
const emptyMonth = (): MonthlyCell => ({ minutes: null, minutes_c1: null, minutes_c2: null, minutes_c3: null, avg_bpm: null, max_bpm: null, accuracy: null, calories: null })

function monthlyCell(scenario: Scenario, no: number, index: number): MonthlyCell {
  const offset = (no - 1) % 3
  if (scenario === 'missing' && (index === 4 || index === 8 || (index === 6 && offset === 2))) return emptyMonth()
  if (scenario === 'disconnect' && (index < 2 || index >= 8)) return emptyMonth()
  if (scenario === 'zero') return { minutes: 0, minutes_c1: 0, minutes_c2: 0, minutes_c3: 0, avg_bpm: 0, max_bpm: 0, accuracy: 0, calories: 0 }
  if (scenario === 'flat') return { minutes: 40, minutes_c1: 10, minutes_c2: 20, minutes_c3: 10, avg_bpm: 130, max_bpm: 130, accuracy: 90, calories: 160 }

  const load = scenario === 'range' ? (index % 2 ? 50 : 1) : MONTH_LOAD[index]
  const cell = {
    minutes_c1: load + offset, minutes_c2: 2 * load + offset, minutes_c3: load,
    minutes: 4 * load + 2 * offset, avg_bpm: 110 + load + 5 * offset,
    max_bpm: 135 + load + 5 * offset, accuracy: 80 + load + offset,
    calories: 4 * (4 * load + 2 * offset),
  }
  if (scenario === 'spike' && index === 6 && no === 30) {
    cell.minutes_c1 += 600
    cell.minutes_c2 += 300
    cell.minutes_c3 += 100
    cell.minutes += 1000
    cell.calories += 4000
    cell.avg_bpm = 200
    cell.max_bpm = 220
    cell.accuracy = 100
  }
  if (scenario === 'range') {
    cell.avg_bpm = index % 2 ? 220 : 45
    cell.max_bpm = index % 2 ? 240 : 60
    cell.accuracy = index % 2 ? 100 : 0
  }
  return cell
}

export function makeMonthlyRows(scenario: Scenario): ExerciseRow[] {
  return Array.from({ length: 30 }, (_, studentIndex) => {
    const no = studentIndex + 1
    const cells = Array.from({ length: 12 }, (_, index) => monthlyCell(scenario, no, index))
    return {
      student_id: `chart-lab-student-${no}`, student_no: no, name: nameOf(no),
      minutes: cells.map(cell => cell.minutes), minutes_c1: cells.map(cell => cell.minutes_c1),
      minutes_c2: cells.map(cell => cell.minutes_c2), minutes_c3: cells.map(cell => cell.minutes_c3),
      avg_bpm: cells.map(cell => cell.avg_bpm), max_bpm: cells.map(cell => cell.max_bpm),
      accuracy: cells.map(cell => cell.accuracy), calories: cells.map(cell => cell.calories),
    }
  })
}

// Closed-form oracle: no generated rows, production summaries, or cell builder.
// All academic-year months are past at the verification cutoff, March 1, 2026.
export function expectedMonthly(scenario: Scenario) {
  return Array.from({ length: 12 }, (_, ordinal) => {
    const index = (ordinal + 2) % 12
    const metadata = {
      month: `${index + 1}월`, index,
      calendarMonth: `${index < 2 ? 2026 : 2025}.${String(index + 1).padStart(2, '0')}`,
      future: false,
    }
    const missing = scenario === 'missing' && (ordinal === 2 || ordinal === 6)
      || scenario === 'disconnect' && ordinal >= 6
    if (missing) return { ...metadata, minutes: null, minutes_c1: null, minutes_c2: null, minutes_c3: null, avg_bpm: null, max_bpm: null, accuracy: null, calories: null }
    if (scenario === 'zero') return { ...metadata, minutes: 0, minutes_c1: 0, minutes_c2: 0, minutes_c3: 0, avg_bpm: 0, max_bpm: 0, accuracy: 0, calories: 0 }
    if (scenario === 'flat') return { ...metadata, minutes: 1200, minutes_c1: 300, minutes_c2: 600, minutes_c3: 300, avg_bpm: 130, max_bpm: 130, accuracy: 90, calories: 4800 }

    const partial = scenario === 'missing' && ordinal === 4
    const count = partial ? 20 : 30
    const offsetSum = partial ? 10 : 30
    const largestOffset = partial ? 1 : 2
    const load = scenario === 'range' ? (ordinal % 2 ? 50 : 1) : ordinal + 1
    const spike = scenario === 'spike' && ordinal === 4
    const minutes = 4 * load * count + 2 * offsetSum + (spike ? 1000 : 0)
    return {
      ...metadata, minutes,
      minutes_c1: load * count + offsetSum + (spike ? 600 : 0),
      minutes_c2: 2 * load * count + offsetSum + (spike ? 300 : 0),
      minutes_c3: load * count + (spike ? 100 : 0),
      avg_bpm: scenario === 'range' ? (ordinal % 2 ? 220 : 45)
        : ((110 + load) * count + 5 * offsetSum + (spike ? 200 - (120 + load) : 0)) / count,
      max_bpm: scenario === 'range' ? (ordinal % 2 ? 240 : 60) : spike ? 220 : 135 + load + 5 * largestOffset,
      accuracy: scenario === 'range' ? (ordinal % 2 ? 100 : 0)
        : ((80 + load) * count + offsetSum + (spike ? 100 - (82 + load) : 0)) / count,
      calories: minutes * 4,
    }
  })
}

export function sampleAt(scenario: Scenario, studentNo: number, sec: number): number | null {
  switch (scenario) {
    case 'zero': return 0
    case 'flat': return 130
    case 'range': return RANGE_BPM[Math.floor(sec / 5) % RANGE_BPM.length]
    case 'spike': return sec % 60 === 15 ? 45 : sec % 60 === 45 ? 220 : 130
    case 'missing': if (sec % 60 >= 20 && sec % 60 < 30) return null; break
    case 'disconnect': if (sec >= 60) return null; break
  }
  return 110 + (sec + studentNo * 3) % 41
}

// throughSec is inclusive; replaying an already elapsed second is a no-op.
export function advanceLab(session: Session, scenario: Scenario, throughSec: number): void {
  for (let sec = session.lastSec + 1; sec <= throughSec; sec++) {
    const now = session.startedAt + sec * 1000
    for (const live of session.students) {
      const bpm = sampleAt(scenario, live.participant.no, sec)
      if (bpm !== null) ingestSample(session, live.participant.device_id, bpm, now, 'ANT', 90, now)
    }
    advanceSession(session, now)
  }
}

// seconds is a count: 120 creates seconds 0..119; 0 creates an empty session.
export function makeLabSession(scenario: Scenario, seconds = 120): Session {
  const session = createSession({
    schoolId: 'chart-lab-school', year: LAB_YEAR, grade: 1, class_no: 1, schoolType: 2,
    students: Array.from({ length: 30 }, (_, index) => ({
      id: `chart-lab-student-${index + 1}`, no: index + 1, name: nameOf(index + 1),
      device_id: `chart-lab-device-${index + 1}`, age: 13, estimatedAge: false,
    })),
  }, LAB_START, SESSION_IDS[scenario])
  advanceLab(session, scenario, seconds - 1)
  return session
}
