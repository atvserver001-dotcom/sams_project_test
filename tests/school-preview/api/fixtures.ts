// Synthetic data only. Shapes and month placement follow tests/redesign/fixtures.ts.
export const PREVIEW_YEAR = 2026
export const PREVIEW_YEARS = [2025, 2026] as const
export const PREVIEW_CREDENTIALS = { username: 'preview_teacher', password: 'preview-only' } as const
export const PREVIEW_SCHOOL = {
  id: 'school-preview-1', name: '올댓비젼초등학교 (샘플)', group_no: 'PREVIEW-001',
  school_type: 1, recognition_key: 'synthetic-preview-only', has_linkable: true, contents: [],
}

export const PAPS_REFERENCE_NOTICE = 'Read-only snapshot of the 97 existing repository reference rows in temp/insert_paps_grade.sql; not independently certified official thresholds. Synthetic student measurements are not real assessments. Personal and class printouts distinguish missing assessments from zero; the original grading rules still require independent validation.'

export type Student = {
  id: string; school_id: string; year: number; grade: number; class_no: number
  student_no: number; name: string; gender: 'M' | 'F' | null; birth_date: string | null
  email: string | null; height_cm: number | null; weight_kg: number | null; notes: string | null
}
export type Monthly = (number | null)[]
export const EXERCISE_FIELDS = ['minutes', 'minutes_c1', 'minutes_c2', 'minutes_c3', 'avg_bpm', 'max_bpm', 'accuracy', 'calories'] as const
export const PAPS_FIELDS = ['muscular_endurance', 'power_1', 'power_2', 'flexibility_1', 'flexibility_2', 'cardio_1min', 'cardio_2min', 'cardio_3min', 'bmi'] as const
export type Exercise = Record<typeof EXERCISE_FIELDS[number], Monthly>
export type Paps = Record<typeof PAPS_FIELDS[number], Monthly>
export type HeartMonth = {
  year: number; month: number; avg_bpm: number | null; min_bpm: number | null
  max_bpm: number | null; record_count: number
}
export type StudentRecords = { year: number; exercises: Exercise; paps: Paps; heart: Map<string, HeartMonth> }
export type SensorMapping = { student_no: number; device_id: string }
export type SchoolDevice = ReturnType<typeof makeDevices>[number]
export type FixtureState = { students: Student[]; records: Map<string, StudentRecords>; mappings: SensorMapping[]; devices: SchoolDevice[] }

const names = [
  '김민준', '이서연', '박지호', '최수아', '정하윤', '강태윤', '윤서준', '임채원', '오지훈', '한소민',
  '배시우', '노아린', '조은우', '문가온', '서다인', '홍유찬', '신예원', '권도현', '황지우', '안유진',
  '류하준', '전소율', '고민서', '남태호', '심아윤', '하준서', '유채린', '곽시현', '성지안', '우다온',
]

export const CONTENTS = ['운동기록관리', 'PAPS기록관리', '심박기록관리', '체력측정관리'].map((name, i) => ({
  school_content_id: `preview-assignment-${i + 1}`, content_id: `preview-content-${i + 1}`,
  name, color_hex: '#ec3013', start_date: '2025-03-01', end_date: null, is_unlimited: true,
}))

function makeDevices() {
  return ['스마트미러', '하트 케어'].map((name, i) => ({
    id: `preview-school-device-${i + 1}`, device_id: `preview-device-${i + 1}`, device_name: name,
    device_icon_url: null, auth_key: `synthetic-device-key-${i + 1}`, memo: i ? '심박 센서 (샘플)' : '체육관 (샘플)',
    status: 'active', created_at: '2025-03-01T00:00:00.000Z', content_name: CONTENTS[i ? 2 : 0].name,
    content_color_hex: '#ec3013', link_group_id: null, is_primary: true,
  }))
}

export function emptyMonths(): Monthly { return Array.from({ length: 12 }, () => null) }
export function emptyRecords(year: number): StudentRecords {
  return {
    year,
    exercises: Object.fromEntries(EXERCISE_FIELDS.map(key => [key, emptyMonths()])) as Exercise,
    paps: Object.fromEntries(PAPS_FIELDS.map(key => [key, emptyMonths()])) as Paps,
    heart: new Map(),
  }
}

function months(value: number): Monthly {
  return [null, null, value, value + 2, value + 3, 0, value + 5, value + 4, value + 7, null, null, null]
}

export function makeFixtures(): FixtureState {
  const students: Student[] = []
  const records = new Map<string, StudentRecords>()
  for (const year of PREVIEW_YEARS) for (const grade of [1, 2]) {
    for (let i = 0; i < (grade === 1 ? 30 : 12); i++) {
      const student: Student = {
        id: `preview-student-${year}-${grade}-1-${i + 1}`, school_id: PREVIEW_SCHOOL.id,
        year, grade, class_no: 1, student_no: i + 1, name: names[i], gender: i % 2 ? 'F' : 'M',
        birth_date: `${year - grade - 6}-04-03`, email: null, height_cm: 122.5 + i / 10,
        weight_kg: 23.2 + i / 10, notes: null,
      }
      const seed = i + (grade - 1) * 4 + (year - 2025) * 2
      const data = emptyRecords(year)
      const c1 = months(10 + seed), c2 = months(12 + seed), c3 = months(6 + seed)
      data.exercises = {
        minutes: c1.map((v, month) => v === null ? null : v + c2[month]! + c3[month]!),
        minutes_c1: c1, minutes_c2: c2, minutes_c3: c3, avg_bpm: months(122 + seed),
        max_bpm: months(152 + seed), accuracy: months(82 + seed % 8), calories: months(120 + seed * 4),
      }
      data.paps = {
        muscular_endurance: months(45 + seed), power_1: months(162.5 + seed), power_2: months(168.2 + seed),
        flexibility_1: months(8.4 + seed / 10), flexibility_2: months(10.5 + seed / 10),
        cardio_1min: months(108 + seed), cardio_2min: months(85 + seed), cardio_3min: months(72 + seed), bmi: months(18.3 + seed / 10),
      }
      const avg = months(128 + seed % 20), max = months(170 + seed % 20), min = months(72 + seed)
      for (let m = 0; m < 12; m++) if (avg[m] !== null) data.heart.set(`${year}-${m + 1}`, {
        year, month: m + 1, avg_bpm: avg[m], max_bpm: max[m], min_bpm: min[m], record_count: 60,
      })
      students.push(student)
      records.set(student.id, data)
    }
  }
  return { students, records, devices: makeDevices(), mappings: names.map((_, i) => ({ student_no: i + 1, device_id: `sensor-${i + 1}` })) }
}
