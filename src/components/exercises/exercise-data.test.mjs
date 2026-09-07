import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'

// Run the actual TypeScript helpers without adding a test/runtime dependency.
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const uri = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const exerciseUri = uri(compile(readFileSync(new URL('./exercise-data.ts', import.meta.url), 'utf8')))
const exercise = await import(exerciseUri)
const dashboard = await import(uri(compile(readFileSync(new URL('../dashboard/dashboard-data.ts', import.meta.url), 'utf8')).replace('../exercises/exercise-data', exerciseUri)))
const empty = () => Array(12).fill(null)
const makeRow = (id = 'student-1') => ({ student_id: id, student_no: 1, name: '검증학생', minutes: empty(), avg_bpm: empty(), max_bpm: empty(), accuracy: empty(), calories: empty(), minutes_c1: empty(), minutes_c2: empty(), minutes_c3: empty() })

test('academic years roll over in March, including next-year January and February', () => {
  assert.equal(exercise.academicYear(new Date(2027, 0, 1)), 2026)
  assert.equal(exercise.academicYear(new Date(2027, 1, 28)), 2026)
  assert.equal(exercise.academicYear(new Date(2027, 2, 1)), 2027)
  assert.deepEqual([...exercise.MONTH_ORDER], [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 0, 1])
  assert.equal(exercise.monthLabel(2026, 0), '2027.01')
})

test('zero remains a recorded numeric value; missing and nonfinite values are not zero', () => {
  assert.equal(exercise.sum([null, undefined]), null)
  assert.equal(exercise.sum([0, null]), 0)
  assert.equal(exercise.mean([0, 10, null]), 5)
  assert.equal(exercise.maximum([null, 0]), 0)
  assert.equal(exercise.formatValue(0), '0.0')
  assert.equal(exercise.formatValue(null), '—')
  assert.equal(exercise.sum([NaN, Infinity]), null)
  const row = makeRow()
  assert.equal(exercise.hasRecord(row), false)
  row.accuracy[0] = 0
  assert.equal(exercise.hasRecord(row), true)
  assert.equal(exercise.hasRecord(row, 0), true)
})

test('monthly summary sums duration and calories but averages accuracy and takes max bpm', () => {
  const one = makeRow('one')
  const two = makeRow('two')
  Object.assign(one, { minutes: [5, ...Array(11).fill(null)], calories: [10, ...Array(11).fill(null)], accuracy: [0, ...Array(11).fill(null)], max_bpm: [150, ...Array(11).fill(null)] })
  Object.assign(two, { minutes: [15, ...Array(11).fill(null)], calories: [20, ...Array(11).fill(null)], accuracy: [100, ...Array(11).fill(null)], max_bpm: [175, ...Array(11).fill(null)] })
  const result = exercise.monthlySummary([one, two], 2026, new Date(2026, 8, 5))
  assert.equal(result[10].minutes, 20)
  assert.equal(result[10].calories, 30)
  assert.equal(result[10].accuracy, 50)
  assert.equal(result[10].max_bpm, 175)
  assert.equal(result[10].future, true)
  assert.equal(result[6].future, false)
  assert.equal(result[0].minutes, null)
})

test('roster joins by student ID, retains actual names and includes student 31+', () => {
  const students = Array.from({ length: 35 }, (_, index) => ({ id: `s-${index}`, name: `실제학생${index}`, student_no: index + 1, grade: 1, class_no: 1 }))
  const record = { ...makeRow('s-34'), student_no: 35, name: '실제학생34' }
  record.minutes[2] = 0
  const joined = exercise.joinStudents(students, [record])
  assert.equal(joined.length, 35)
  assert.equal(joined[0].name, '실제학생0')
  assert.equal(joined[0].minutes[2], null)
  assert.equal(joined[34].minutes[2], 0)
})

test('export includes all five metrics, academic order, zero and blank missing cells', () => {
  const row = makeRow()
  row.minutes[2] = 0
  row.minutes[0] = 5
  row.avg_bpm[2] = 100
  row.avg_bpm[0] = 150
  row.max_bpm[2] = 160
  row.max_bpm[0] = 180
  const exported = exercise.exerciseExportRows([row])
  assert.equal(exported.length, 5)
  assert.equal(exported[0][3], 0)
  assert.equal(exported[0][4], null)
  assert.equal(exported[0][13], 5)
  assert.equal(exported[0][15], 5)
  assert.equal(exported[2][15], 125)
  assert.equal(exported[3][15], 180)
  assert.equal(exercise.CATEGORIES.at(-1).value, '4')
})

test('license expiry uses end of day and respects unlimited licenses', () => {
  const license = { start: '2026-03-01', end: '2026-09-05', unlimited: false }
  assert.equal(dashboard.licenseStatus(license, new Date(2026, 8, 5, 12)), '사용중')
  assert.equal(dashboard.licenseStatus(license, new Date(2026, 8, 6)), '기간만료')
  assert.equal(dashboard.licenseStatus({ ...license, unlimited: true }, new Date(2026, 8, 6)), '사용중')
})

test('class summary does not invent a day-level receipt date or record count', () => {
  const row = makeRow()
  row.minutes[0] = 0
  const summary = dashboard.classSummary({ grade: 1, classNo: 1, students: [{ id: 'student-1' }], rows: [row] }, 2026)
  assert.equal(summary.active, 1)
  assert.equal(summary.latest, '2027.01')
  assert.equal(summary.minutes, 0)
  assert.equal(summary.accuracy, null)
})

test('dashboard reads the overview once and preserves the returned records', async () => {
  const originalFetch = globalThis.fetch
  const signal = new AbortController().signal
  const row = makeRow()
  row.minutes[2] = 0
  const expected = {
    school: { id: 'school-1', school_type: 2, name: '검증학교' },
    classes: [{ grade: 1, classNo: 1, students: [{ id: row.student_id, student_no: 1, name: row.name }], rows: [row] }],
    licenses: [],
  }
  let requests = 0
  globalThis.fetch = async (path, init) => {
    requests++
    assert.equal(init.credentials, 'include')
    assert.equal(init.method, undefined)
    assert.equal(init.cache, 'no-store')
    assert.equal(init.signal, signal)
    const url = new URL(path, 'http://localhost')
    assert.equal(url.pathname, '/api/school/dashboard/overview')
    assert.equal(url.search, '?year=2026')
    return Response.json(expected)
  }
  try {
    const data = await dashboard.loadDashboard(2026, signal)
    assert.equal(requests, 1)
    assert.deepEqual(data, expected)
    assert.equal(data.classes[0].rows[0].minutes[2], 0)
    assert.equal(data.classes[0].rows[0].minutes[0], null)
  } finally { globalThis.fetch = originalFetch }
})

test('failed API reads reject instead of becoming a successful empty result', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => Response.json({ error: '접근 권한이 없습니다.' }, { status: 403 })
  try {
    await assert.rejects(exercise.readSchoolApi('/api/school/exercises', new AbortController().signal), /접근 권한/)
    await assert.rejects(dashboard.loadDashboard(2026, new AbortController().signal), /접근 권한/)
  } finally { globalThis.fetch = originalFetch }
})

test('request cancellation is passed through without an empty-data fallback', async () => {
  const originalFetch = globalThis.fetch
  const controller = new AbortController()
  controller.abort()
  globalThis.fetch = async (_path, init) => {
    assert.equal(init.signal, controller.signal)
    init.signal.throwIfAborted()
  }
  try {
    await assert.rejects(exercise.readSchoolApi('/api/school/exercises', controller.signal), { name: 'AbortError' })
  } finally { globalThis.fetch = originalFetch }
})
