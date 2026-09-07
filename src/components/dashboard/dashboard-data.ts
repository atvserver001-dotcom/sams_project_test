import { ExerciseRow, ExerciseSchool, ExerciseStudent, MONTH_ORDER, hasRecord, joinStudents, mean, monthLabel, readSchoolApi } from '../exercises/exercise-data'

export interface DashboardClass {
  grade: number
  classNo: number
  students: ExerciseStudent[]
  rows: ExerciseRow[]
}

export interface DashboardLicense {
  key: string
  name: string
  kind: '콘텐츠' | '디바이스'
  start: string | null
  end: string | null
  unlimited: boolean
}

interface ContentItem { school_content_id: string; name: string; start_date: string | null; end_date: string | null; is_unlimited: boolean }
interface DeviceItem { device_id: string; device_name: string; start_date: string | null; end_date: string | null; limited_period: boolean }

export interface DashboardData {
  school: ExerciseSchool
  classes: DashboardClass[]
  licenses: DashboardLicense[]
}

export async function loadDashboard(year: number, signal: AbortSignal): Promise<DashboardData> {
  const { school } = await readSchoolApi<{ school: ExerciseSchool }>('/api/school/info', signal)
  const { items: contents } = await readSchoolApi<{ items: ContentItem[] }>('/api/school/contents', signal)
  const { items: devices } = await readSchoolApi<{ items: DeviceItem[] }>('/api/school/devices', signal)
  // These read-only APIs require a class. Keep the same 1..10 class range as
  // student administration, with four workers to bound the school-wide scan.
  const targets = Array.from({ length: school.school_type === 1 ? 6 : 3 }, (_, gradeIndex) =>
    Array.from({ length: 10 }, (_, classIndex) => ({ grade: gradeIndex + 1, classNo: classIndex + 1 }))).flat()
  const classes: DashboardClass[] = []
  let cursor = 0
  async function worker() {
    while (cursor < targets.length) {
      signal.throwIfAborted()
      const target = targets[cursor++]
      const params = new URLSearchParams({ year: String(year), grade: String(target.grade), class_no: String(target.classNo) })
      const { students } = await readSchoolApi<{ students: ExerciseStudent[] }>(`/api/school/students?${params}`, signal)
      if (!students.length) continue
      params.set('category_type', 'all')
      const { rows } = await readSchoolApi<{ rows: ExerciseRow[] }>(`/api/school/exercises?${params}`, signal)
      classes.push({ ...target, students, rows: joinStudents(students, rows) })
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker))
  classes.sort((a, b) => a.grade - b.grade || a.classNo - b.classNo)
  return {
    school, classes,
    licenses: [
      ...contents.map(item => ({ key: `content-${item.school_content_id}`, name: item.name, kind: '콘텐츠' as const, start: item.start_date, end: item.end_date, unlimited: item.is_unlimited })),
      ...devices.map((item, index) => ({ key: `device-${item.device_id}-${index}`, name: item.device_name, kind: '디바이스' as const, start: item.start_date, end: item.end_date, unlimited: !item.limited_period })),
    ],
  }
}

export function licenseStatus(license: DashboardLicense, now = new Date()) {
  if (!license.unlimited && license.end && new Date(`${license.end}T23:59:59`) < now) return '기간만료'
  if (license.start && new Date(`${license.start}T00:00:00`) > now) return '사용 예정'
  return '사용중'
}

export function classSummary(item: DashboardClass, year: number) {
  const active = item.rows.filter(row => hasRecord(row)).length
  const latestMonth = [...MONTH_ORDER].reverse().find(index => item.rows.some(row => hasRecord(row, index)))
  return {
    label: `${item.grade}학년 ${item.classNo}반`, students: item.students.length, active,
    participation: item.students.length ? active / item.students.length * 100 : null,
    minutes: mean(item.rows.flatMap(row => row.minutes)),
    accuracy: mean(item.rows.flatMap(row => row.accuracy ?? [])),
    bpm: mean(item.rows.flatMap(row => row.avg_bpm)),
    latest: latestMonth === undefined ? null : monthLabel(year, latestMonth),
  }
}
