export type ExerciseStudentIdentity = {
  id: string
  student_no: number
  name: string
}

export type ExerciseMonthlyRow = {
  student_id: string
  exercise_type: 'endurance' | 'flexibility' | 'strength'
  year: number
  month: number
  avg_duration_seconds: number | null
  avg_accuracy: number | null
  avg_bpm: number | null
  avg_max_bpm: number | null
  avg_calories: number | null
  record_count: number
}

export type AggregatedExerciseRow = {
  student_id: string
  student_no: number
  name: string
  minutes: (number | null)[]
  avg_bpm: (number | null)[]
  max_bpm: (number | null)[]
  accuracy: (number | null)[]
  calories: (number | null)[]
  minutes_c1: (number | null)[]
  minutes_c2: (number | null)[]
  minutes_c3: (number | null)[]
}

export function aggregateExerciseRows(students: ExerciseStudentIdentity[], records: ExerciseMonthlyRow[]): AggregatedExerciseRow[] {

  // 칼로리는 쿼리된 category_type 범위 내(record_type=5) 값만 합산하여 사용합니다.

  const studentIdToRow: Record<string, AggregatedExerciseRow> = {}
  for (const s of students ?? []) {
    studentIdToRow[s.id] = {
      student_id: s.id,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      student_no: (s as any).student_no ?? 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      name: (s as any).name ?? '',
      minutes: Array.from({ length: 12 }, () => null),
      avg_bpm: Array.from({ length: 12 }, () => null),
      max_bpm: Array.from({ length: 12 }, () => null),
      accuracy: Array.from({ length: 12 }, () => null),
      calories: Array.from({ length: 12 }, () => null),
      minutes_c1: Array.from({ length: 12 }, () => null),
      minutes_c2: Array.from({ length: 12 }, () => null),
      minutes_c3: Array.from({ length: 12 }, () => null),
    }
  }

  // 평균 계산을 위한 가중 누적 버퍼(record_count 기준)
  const avgSumMap: Record<string, number[]> = {}
  const avgCntMap: Record<string, number[]> = {}
  const ensureAvgBuffers = (studentId: string) => {
    if (!avgSumMap[studentId]) avgSumMap[studentId] = Array.from({ length: 12 }, () => 0)
    if (!avgCntMap[studentId]) avgCntMap[studentId] = Array.from({ length: 12 }, () => 0)
  }

  // 정확도(%) 평균 계산을 위한 가중 누적 버퍼(record_count 기준)
  const accSumMap: Record<string, number[]> = {}
  const accCntMap: Record<string, number[]> = {}
  const ensureAccBuffers = (studentId: string) => {
    if (!accSumMap[studentId]) accSumMap[studentId] = Array.from({ length: 12 }, () => 0)
    if (!accCntMap[studentId]) accCntMap[studentId] = Array.from({ length: 12 }, () => 0)
  }

  for (const r of records ?? []) {
    const row = studentIdToRow[r.student_id]
    if (!row) continue
    const idx = Math.max(0, Math.min(11, (r.month ?? 1) - 1))

    const count = typeof r.record_count === 'number' ? r.record_count : 0
    const durationMinutes = typeof r.avg_duration_seconds === 'number' && count > 0
      ? (r.avg_duration_seconds * count) / 60
      : null
    const caloriesTotal = typeof r.avg_calories === 'number' && count > 0
      ? r.avg_calories * count
      : null

    // 전체 minutes 합산
    if (durationMinutes != null) {
      const cur = row.minutes[idx]
      row.minutes[idx] = cur == null ? durationMinutes : cur + durationMinutes
    }

    // 카테고리별 스택: 1=strength, 2=endurance, 3=flexibility
    const target = r.exercise_type === 'strength' ? row.minutes_c1 : r.exercise_type === 'endurance' ? row.minutes_c2 : row.minutes_c3
    if (durationMinutes != null) {
      const curC = target[idx]
      target[idx] = curC == null ? durationMinutes : curC + durationMinutes
    }

    // 평균 bpm 가중 누적
    if (typeof r.avg_bpm === 'number' && count > 0) {
      ensureAvgBuffers(r.student_id)
      avgSumMap[r.student_id][idx] += r.avg_bpm * count
      avgCntMap[r.student_id][idx] += count
    }

    // 최대 bpm 은 최대값 유지
    if (typeof r.avg_max_bpm === 'number') {
      const curMax = row.max_bpm[idx]
      row.max_bpm[idx] = curMax == null ? r.avg_max_bpm : Math.max(curMax, r.avg_max_bpm)
    }

    // 정확도 평균 가중 누적
    if (typeof r.avg_accuracy === 'number' && count > 0) {
      ensureAccBuffers(r.student_id)
      accSumMap[r.student_id][idx] += r.avg_accuracy * count
      accCntMap[r.student_id][idx] += count
    }

    // 칼로리 합계
    if (caloriesTotal != null) {
      const curCal = row.calories[idx]
      row.calories[idx] = curCal == null ? caloriesTotal : curCal + caloriesTotal
    }
  }

  // 평균 심박 산출 (가중 평균)
  for (const [studentId, row] of Object.entries(studentIdToRow)) {
    const sumArr = avgSumMap[studentId]
    const cntArr = avgCntMap[studentId]
    if (!sumArr || !cntArr) continue
    for (let i = 0; i < 12; i++) {
      const c = cntArr[i]
      row.avg_bpm[i] = c > 0 ? Math.round((sumArr[i] / c) * 10) / 10 : row.avg_bpm[i]
    }
  }

  // 정확도 평균 산출 (% 값으로 가정, 가중 평균)
  for (const [studentId, row] of Object.entries(studentIdToRow)) {
    const sumArr = accSumMap[studentId]
    const cntArr = accCntMap[studentId]
    if (!sumArr || !cntArr) continue
    for (let i = 0; i < 12; i++) {
      const c = cntArr[i]
      row.accuracy[i] = c > 0 ? Math.round((sumArr[i] / c) * 10) / 10 : row.accuracy[i]
    }
  }

  const rows: AggregatedExerciseRow[] = Object.values(studentIdToRow).sort((a, b) => (a.student_no ?? 0) - (b.student_no ?? 0))


  return rows
}
