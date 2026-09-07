import { randomUUID } from 'node:crypto'
import {
  PAPS_REFERENCE_NOTICE, emptyMonths, emptyRecords, makeFixtures,
  type FixtureState, type HeartMonth, type StudentRecords,
} from './fixtures'
import { PAPS_GRADE_REFERENCES } from './paps-reference'
import { PreviewError, bodyOf, classroom, fail, integer, keys, object, queryClass, sameClass, string, studentInput, uniqueStudent } from './validation'

export type SchoolDataScope = {
  school: {
    id: string; name: string; group_no: string; school_type: number
    recognition_key?: string; has_linkable?: boolean; contents?: unknown[]
  }
  contents: unknown[]
  devices: unknown[]
}

export function makeSchoolData(schoolId: string, seeded = true): FixtureState {
  if (!seeded) return { students: [], records: new Map(), mappings: [], devices: [] }
  const state = makeFixtures()
  const prefix = encodeURIComponent(schoolId)
  const records = new Map<string, StudentRecords>()
  for (const student of state.students) {
    const originalId = student.id
    student.id = `${prefix}:${originalId}`
    student.school_id = schoolId
    records.set(student.id, state.records.get(originalId)!)
  }
  state.records = records
  state.devices = state.devices.map(device => ({ ...device, id: `${prefix}:${device.id}` }))
  return state
}

type Route = { methods: string[]; kind: string; id?: string }
export function schoolDataRouteFor(path: string): Route | null {
  const routes: Record<string, Route> = {
    '/api/school/info': { methods: ['GET'], kind: 'info' },
    '/api/school/dashboard/overview': { methods: ['GET'], kind: 'overview' },
    '/api/school/students': { methods: ['GET', 'POST'], kind: 'students' },
    '/api/school/exercises': { methods: ['GET'], kind: 'exercises' },
    '/api/school/paps': { methods: ['GET'], kind: 'paps' },
    '/api/school/paps/grade-reference': { methods: ['GET'], kind: 'references' },
    '/api/school/heart-rate': { methods: ['GET', 'POST'], kind: 'heart' },
    '/api/school/heart-rate-mappings': { methods: ['GET', 'POST'], kind: 'mappings' },
    '/api/school/contents': { methods: ['GET'], kind: 'contents' },
    '/api/school/devices': { methods: ['GET'], kind: 'devices' },
    '/api/school/school-devices': { methods: ['GET'], kind: 'school-devices' },
    '/api/school/device-pages': { methods: ['GET', 'POST'], kind: 'unsupported' },
    '/api/school/device-page-blocks': { methods: ['POST'], kind: 'unsupported' },
    '/api/school/device-assets': { methods: ['GET', 'POST', 'DELETE'], kind: 'unsupported' },
    '/api/device/ingest': { methods: ['POST'], kind: 'unsupported' },
  }
  if (Object.hasOwn(routes, path)) return routes[path]
  const student = /^\/api\/school\/students\/([^/]+)$/.exec(path)
  if (student) return { methods: ['PATCH', 'DELETE'], kind: 'student', id: student[1] }
  const device = /^\/api\/school\/school-devices\/([^/]+)$/.exec(path)
  if (device) return { methods: ['PATCH'], kind: 'memo', id: device[1] }
  if (/^\/api\/school\/(device-pages|device-page-blocks)\/[^/]+$/.test(path)) return { methods: ['PATCH', 'DELETE'], kind: 'unsupported' }
  if (/^\/api\/school\/(device-pages|device-page-blocks)\/[^/]+\/image$/.test(path)) return { methods: ['POST', 'DELETE'], kind: 'unsupported' }
  return null
}

function getRecords(state: FixtureState, url: URL, kind: string) {
  const scope = queryClass(url.searchParams)
  const category = url.searchParams.get('category_type') ?? 'all'
  if (kind === 'exercises' && !['all', '1', '2', '3', '4'].includes(category)) fail(400, 'Invalid category_type.')
  const students = state.students.filter(student => sameClass(student, scope)).sort((a, b) => a.student_no - b.student_no)
  return { rows: students.map(student => {
    const identity = { student_id: student.id, student_no: student.student_no, name: student.name }
    const records = state.records.get(student.id) ?? emptyRecords(scope.year)
    if (kind === 'heart') {
      const row = { ...identity, avg_bpm: emptyMonths(), min_bpm: emptyMonths(), max_bpm: emptyMonths() }
      for (const value of records.heart.values()) {
        if (value.year !== scope.year + (value.month <= 2 ? 1 : 0)) continue
        for (const field of ['avg_bpm', 'min_bpm', 'max_bpm'] as const) row[field][value.month - 1] = value[field]
      }
      return row
    }
    const measured = records.year === scope.year ? records : emptyRecords(scope.year)
    if (kind === 'paps') return { ...identity, ...measured.paps }
    if (category === 'all') return { ...identity, ...measured.exercises }
    const field = category === '2' ? 'minutes_c2' : category === '3' ? 'minutes_c3' : 'minutes_c1'
    // Synthetic categories use equal sample counts/BPM/accuracy, and one third of total calories each.
    return {
      ...identity, ...measured.exercises, minutes: measured.exercises[field],
      minutes_c1: field === 'minutes_c1' ? measured.exercises.minutes_c1 : emptyMonths(),
      minutes_c2: field === 'minutes_c2' ? measured.exercises.minutes_c2 : emptyMonths(),
      minutes_c3: field === 'minutes_c3' ? measured.exercises.minutes_c3 : emptyMonths(),
      calories: measured.exercises.calories.map(value => value === null ? null : value / 3),
    }
  }) }
}

function saveMappings(state: FixtureState, body: Record<string, unknown>) {
  keys(body, ['mappings'])
  if (!Array.isArray(body.mappings) || body.mappings.length > 30) fail(400, 'mappings: array of at most 30 entries required.')
  const numbers = new Set<number>(), devices = new Set<string>()
  const mappings = body.mappings.map(value => {
    const item = object(value)
    keys(item, ['student_no', 'device_id'])
    const student_no = integer(item.student_no, 'student_no', 1, 30)
    const device_id = string(item.device_id, 'device_id', 128, true).trim()
    if (numbers.has(student_no) || (device_id && devices.has(device_id))) fail(409, 'Duplicate student number or sensor ID.')
    numbers.add(student_no)
    if (device_id) devices.add(device_id)
    return { student_no, device_id }
  }).filter(item => item.device_id).sort((a, b) => a.student_no - b.student_no)
  state.mappings = mappings
  return { success: true, count: mappings.length }
}

function saveHeart(state: FixtureState, body: Record<string, unknown>, schoolId: string) {
  keys(body, ['year', 'grade', 'class_no', 'results'])
  const scope = classroom(body)
  if (!Array.isArray(body.results) || !body.results.length || body.results.length > 30) fail(400, 'results: 1 to 30 monthly results required.')
  // Validate and stage the whole batch before committing any newly created student or monthly result.
  const stagedStudents = [...state.students]
  const stagedRecords = new Map<string, StudentRecords>()
  const duplicateKeys = new Set<string>()
  for (const value of body.results) {
    const result = object(value)
    keys(result, ['student_id', 'student_no', 'name', 'year', 'month', 'avg_bpm', 'min_bpm', 'max_bpm', 'record_count'])
    const year = integer(result.year, 'result.year', 1900, 9999)
    const month = integer(result.month, 'month', 1, 12)
    if (year !== scope.year + (month <= 2 ? 1 : 0)) fail(400, 'Result calendar month must belong to the selected academic year (March through February).')
    const student_no = integer(result.student_no, 'student_no', 1, 30)
    const id = string(result.student_id, 'student_id', 128, true)
    let student = id ? stagedStudents.find(item => item.id === id) : stagedStudents.find(item => sameClass(item, scope) && item.student_no === student_no)
    if (id && !student) fail(404, 'Student not found in this preview session.')
    if (student && (!sameClass(student, scope) || student.student_no !== student_no)) fail(400, 'Student does not match the selected classroom and number.')
    if (!student) {
      student = studentInput({ ...scope, student_no, name: result.name ?? `${student_no}번 학생` }, `preview-created-${randomUUID()}`, schoolId)
      uniqueStudent(stagedStudents, student)
      stagedStudents.push(student)
    }
    if (result.name !== undefined) string(result.name, 'name', 100)
    const key = `${year}-${month}`
    const uniqueKey = `${student.id}/${key}`
    if (duplicateKeys.has(uniqueKey)) fail(409, 'Duplicate student/month result.')
    duplicateKeys.add(uniqueKey)
    const count = integer(result.record_count, 'record_count', 1, 100000000)
    const bpm = (value: unknown, label: string) => {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 300) fail(400, `${label}: number from 0 to 300 required.`)
      return value
    }
    const avg = bpm(result.avg_bpm, 'avg_bpm'), min = bpm(result.min_bpm, 'min_bpm'), max = bpm(result.max_bpm, 'max_bpm')
    if (min > avg || avg > max) fail(400, 'BPM must satisfy min <= avg <= max.')
    const current = stagedRecords.get(student.id) ?? state.records.get(student.id) ?? emptyRecords(scope.year)
    const previous = current.heart.get(key)
    const oldCount = previous?.record_count ?? 0
    const record_count = integer(oldCount + count, 'total record_count', 1, Number.MAX_SAFE_INTEGER)
    const record: HeartMonth = {
      year, month, record_count,
      avg_bpm: previous?.avg_bpm == null ? avg : Math.round((previous.avg_bpm * oldCount + avg * count) / record_count * 10) / 10,
      min_bpm: previous?.min_bpm == null ? min : Math.min(previous.min_bpm, min),
      max_bpm: previous?.max_bpm == null ? max : Math.max(previous.max_bpm, max),
    }
    const heart = new Map(current.heart)
    heart.set(key, record)
    stagedRecords.set(student.id, { ...current, heart })
  }
  state.students = stagedStudents
  for (const [id, records] of stagedRecords) state.records.set(id, records)
  return { success: true, count: body.results.length }
}

// The caller owns loopback, authentication and session checks; this module owns only school data.
export async function handleSchoolDataRequest(request: Request, state: FixtureState, scope: SchoolDataScope): Promise<Response> {
  const headers = new Headers({ 'Cache-Control': 'no-store, no-cache, max-age=0, must-revalidate', Pragma: 'no-cache', Expires: '0', Vary: 'Cookie, Origin', 'X-Content-Type-Options': 'nosniff', 'X-School-Preview': 'synthetic' })
  const respond = (body: unknown, status = 200) => {
    if (request.method === 'HEAD' || status === 204) return new Response(null, { status, headers })
    headers.set('Content-Type', 'application/json; charset=utf-8')
    return new Response(JSON.stringify(body), { status, headers })
  }
  try {
    const url = new URL(request.url)
    const route = schoolDataRouteFor(url.pathname)
    if (!route) fail(404, 'Unknown preview API route.')
    if (!route.methods.includes(request.method)) {
      headers.set('Allow', route.methods.join(', '))
      return respond({ error: 'Method not allowed in preview.' }, 405)
    }
    switch (route.kind) {
      case 'info': return respond({ school: scope.school })
      case 'overview': {
        const year = integer(Number(url.searchParams.get('year')), 'year', 1900, 9998)
        const roster = state.students.filter(student => student.year === year && student.grade >= 1
          && student.grade <= (scope.school.school_type === 1 ? 6 : 3) && student.class_no >= 1 && student.class_no <= 10)
        const classrooms = [...new Set(roster.map(student => `${student.grade}:${student.class_no}`))]
          .map(key => key.split(':').map(Number)).sort((a, b) => a[0] - b[0] || a[1] - b[1])
        const classes = classrooms.map(([grade, classNo]) => {
          const selection = new URL(url)
          selection.search = new URLSearchParams({ year: String(year), grade: String(grade), class_no: String(classNo), category_type: 'all' }).toString()
          return { grade, classNo, students: roster.filter(student => student.grade === grade && student.class_no === classNo).sort((a, b) => a.student_no - b.student_no), rows: getRecords(state, selection, 'exercises').rows }
        })
        const contents = scope.contents as Array<{ school_content_id: string; name: string; start_date: string | null; end_date: string | null; is_unlimited: boolean }>
        const devices = scope.devices as Array<{ device_id: string; device_name: string; start_date: string | null; end_date: string | null; limited_period: boolean }>
        return respond({ school: scope.school, classes, licenses: [
          ...contents.map(item => ({ key: `content-${item.school_content_id}`, name: item.name, kind: '콘텐츠', start: item.start_date, end: item.end_date, unlimited: item.is_unlimited })),
          ...devices.map((item, index) => ({ key: `device-${item.device_id}-${index}`, name: item.device_name, kind: '디바이스', start: item.start_date, end: item.end_date, unlimited: !item.limited_period })),
        ] })
      }
      case 'contents': return respond({ items: scope.contents })
      case 'references': return respond({ refs: PAPS_GRADE_REFERENCES, preview: { source: 'temp/insert_paps_grade.sql', notice: PAPS_REFERENCE_NOTICE } })
      case 'school-devices': return respond({ items: state.devices })
      case 'devices': return respond({ items: scope.devices })
      case 'unsupported': fail(501, 'This optional page/block/image/ingest operation is not implemented in the isolated preview. No data was saved.')
      case 'students': {
        if (request.method === 'GET') {
          if (!url.searchParams.has('grade') || !url.searchParams.has('class_no')) return respond(null, 204)
          const allYears = url.searchParams.get('all_years')
          if (allYears !== null && allYears !== '0' && allYears !== '1') fail(400, 'Invalid all_years.')
          const scope = queryClass(url.searchParams, true)
          return respond({ students: state.students.filter(student => sameClass(student, scope, allYears === '1')).sort((a, b) => a.student_no - b.student_no || a.year - b.year) })
        }
        const student = studentInput(await bodyOf(request), `preview-created-${randomUUID()}`, scope.school.id)
        uniqueStudent(state.students, student)
        state.students.push(student)
        state.records.set(student.id, emptyRecords(student.year))
        return respond({ student }, 201)
      }
      case 'student': {
        const previous = state.students.find(student => student.id === route.id)
        if (!previous) fail(404, 'Student not found in this preview session.')
        if (request.method === 'DELETE') {
          state.students = state.students.filter(student => student.id !== previous.id)
          state.records.delete(previous.id)
          return respond({ success: true })
        }
        const student = studentInput(await bodyOf(request), previous.id, scope.school.id, previous)
        uniqueStudent(state.students, student)
        state.students = state.students.map(item => item.id === student.id ? student : item)
        return respond({ student })
      }
      case 'exercises': case 'paps': return respond(getRecords(state, url, route.kind))
      case 'heart': return respond(request.method === 'GET' ? getRecords(state, url, 'heart') : saveHeart(state, await bodyOf(request), scope.school.id))
      case 'mappings': return respond(request.method === 'GET' ? { mappings: state.mappings } : saveMappings(state, await bodyOf(request)))
      case 'memo': {
        const device = state.devices.find(device => device.id === route.id)
        if (!device) fail(404, 'School device not found.')
        const body = await bodyOf(request)
        keys(body, ['memo'])
        device.memo = string(body.memo, 'memo', 4000, true)
        return respond({ item: { id: device.id, memo: device.memo } })
      }
      default: fail(404, 'Unknown preview API route.')
    }
  } catch (error) {
    if (error instanceof PreviewError) return respond({ error: error.message }, error.status)
    return respond({ error: 'Isolated preview request failed.' }, 500)
  }
}
