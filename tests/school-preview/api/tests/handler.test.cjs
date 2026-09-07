/* eslint-disable @typescript-eslint/no-require-imports */
require('./register.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync, readdirSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { handlePreviewRequest, PREVIEW_COOKIE_NAME, SESSION_TTL_MS, MAX_SESSIONS } = require('../handler.ts')
const origin = 'http://127.0.0.1:18475'
const classroom = '?year=2026&grade=1&class_no=1'
const scope = { year: 2026, grade: 1, class_no: 1 }
const credentials = { username: 'preview_teacher', password: 'preview-only' }

function browser(initialCookie = '') {
  let cookie = initialCookie
  return {
    get cookie() { return cookie },
    async request(path, method = 'GET', body, extras = {}) {
      const headers = new Headers(extras.headers)
      if (cookie) headers.set('cookie', cookie)
      if (method !== 'GET' && method !== 'HEAD' && !headers.has('origin')) headers.set('origin', origin)
      if (body !== undefined) headers.set('content-type', 'application/json')
      const response = await handlePreviewRequest(new Request(`${origin}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }))
      const setCookie = response.headers.get('set-cookie')
      if (setCookie) cookie = setCookie.split(';')[0]
      const text = await response.text()
      return { response, code: response.status, data: text ? JSON.parse(text) : null }
    },
  }
}
async function firstStudent(client, query = classroom) {
  const result = await client.request(`/api/school/students${query}`)
  assert.equal(result.code, 200)
  return result.data.students[0]
}
function heartResult(student, overrides = {}) {
  return { student_id: student.id, student_no: student.student_no, name: student.name, year: 2026, month: 10, avg_bpm: 120, min_bpm: 80, max_bpm: 160, record_count: 60, ...overrides }
}

test('first request establishes synthetic auth, UTF-8 school info, cookie and no-cache headers', async () => {
  const client = browser('op-access-token=ignored-real-cookie; acting_school_id=ignored')
  const status = await client.request('/api/preview/status')
  assert.equal(status.code, 200)
  assert.equal(status.data.schoolId, 'school-preview-1')
  assert.equal(status.data.schoolName, '올댓비젼초등학교 (샘플)')
  assert.equal(status.data.authenticated, true)
  assert.deepEqual(status.data.counts, { students: 84, heartMonths: 588, mappings: 30, devices: 2 })
  assert.match(client.cookie, new RegExp(`^${PREVIEW_COOKIE_NAME}=[0-9a-f-]{36}$`))
  const setCookie = status.response.headers.get('set-cookie')
  assert.match(setCookie, /HttpOnly; SameSite=Strict/)
  assert.doesNotMatch(setCookie, /Domain=|op-access-token|acting_school/)
  for (const path of ['/api/auth/me', '/api/school/info', '/api/school/devices', '/api/school/contents']) {
    const result = await client.request(path)
    assert.equal(result.code, 200)
    assert.match(result.response.headers.get('cache-control'), /no-store/)
    assert.match(result.response.headers.get('content-type'), /charset=utf-8/)
    assert.equal(result.response.headers.get('access-control-allow-origin'), null)
    assert.equal(result.response.headers.get('set-cookie'), null)
  }
  assert.equal((await client.request('/api/auth/me')).data.user.role, 'school')
})

test('signout persists through reload/status; only documented credentials restore the same state', async () => {
  const client = browser()
  const student = await firstStudent(client)
  await client.request(`/api/school/students/${student.id}`, 'PATCH', { name: '로그인 검증 학생' })
  assert.equal((await client.request('/api/auth/signout', 'POST')).code, 200)
  const reload = browser(client.cookie)
  assert.equal((await reload.request('/api/preview/status')).data.authenticated, false)
  for (const path of ['/api/auth/me', '/api/school/info', '/api/school/students' + classroom]) assert.equal((await reload.request(path)).code, 401)
  assert.equal((await reload.request('/api/preview/reset', 'POST')).code, 401)
  for (const login of [{ username: 'admin', password: 'admin' }, { ...credentials, password: 'wrong' }, { username: 'teacher', password: 'preview-only' }]) {
    assert.equal((await reload.request('/api/auth/signin', 'POST', login)).code, 401)
  }
  assert.equal((await reload.request('/api/auth/signin', 'POST', credentials)).code, 200)
  assert.equal((await firstStudent(reload)).name, '로그인 검증 학생')
  const stale = browser(`${PREVIEW_COOKIE_NAME}=unknown`)
  assert.equal((await stale.request('/api/auth/me')).code, 401)
  const invalidFirstLogin = browser()
  assert.equal((await invalidFirstLogin.request('/api/auth/signin', 'POST', { username: 'admin', password: 'bad' })).code, 401)
  assert.equal((await invalidFirstLogin.request('/api/auth/me')).code, 401)
})

test('year, grade, class and all-years filters have independent populations; other valid filters are empty', async () => {
  const client = browser()
  const seen = new Set()
  for (const year of [2025, 2026]) for (const grade of [1, 2]) {
    const query = `?year=${year}&grade=${grade}&class_no=1`
    const students = (await client.request('/api/school/students' + query)).data.students
    assert.equal(students.length, grade === 1 ? 30 : 12)
    for (const student of students) {
      assert.equal(student.year, year); assert.equal(student.grade, grade); assert.equal(student.class_no, 1)
      assert.equal(seen.has(student.id), false); seen.add(student.id)
    }
    for (const path of ['exercises', 'paps', 'heart-rate']) assert.equal((await client.request(`/api/school/${path}${query}`)).data.rows.length, students.length)
  }
  for (const query of ['?year=2026&grade=3&class_no=1', '?year=2026&grade=1&class_no=2', '?year=2024&grade=1&class_no=1']) {
    assert.deepEqual((await client.request('/api/school/students' + query)).data, { students: [] })
    for (const path of ['exercises', 'paps', 'heart-rate']) assert.deepEqual((await client.request(`/api/school/${path}${query}`)).data, { rows: [] })
  }
  assert.equal((await client.request('/api/school/students?grade=1&class_no=1&all_years=1')).data.students.length, 60)
  assert.equal((await client.request('/api/school/students')).code, 204)
  assert.equal((await client.request('/api/school/exercises')).code, 400)
  for (const query of ['?year=x&grade=1&class_no=1', '?year=2026&grade=1.5&class_no=1', '?year=2026&grade=1&class_no=', '?year=2026&grade=1&grade=2&class_no=1']) {
    assert.equal((await client.request('/api/school/students' + query)).code, 400)
  }
})

test('monthly zero is retained separately from null and identities always come from current students', async () => {
  const client = browser()
  const student = await firstStudent(client)
  for (const path of ['exercises', 'paps', 'heart-rate']) {
    const row = (await client.request(`/api/school/${path}${classroom}`)).data.rows[0]
    for (const [key, values] of Object.entries(row)) if (Array.isArray(values)) {
      assert.equal(values.length, 12, key); assert.equal(values[0], null, key); assert.equal(values[5], 0, key)
    }
  }
  const exercise = (await client.request('/api/school/exercises' + classroom)).data.rows[0]
  assert.equal(exercise.minutes[2], 34)
  assert.deepEqual([exercise.minutes_c1[2], exercise.minutes_c2[2], exercise.minutes_c3[2]], [12, 14, 8])
  assert.equal(exercise.avg_bpm[2], 124)
  assert.equal((await client.request(`/api/school/students/${student.id}`, 'PATCH', { name: '수정된 학생', height_cm: 0, weight_kg: null })).code, 200)
  const edited = await firstStudent(browser(client.cookie))
  assert.equal(edited.height_cm, 0); assert.equal(edited.weight_kg, null)
  for (const path of ['exercises', 'paps', 'heart-rate']) assert.equal((await client.request(`/api/school/${path}${classroom}`)).data.rows[0].name, '수정된 학생')
  assert.equal((await firstStudent(browser())).name, '김민준')
})

test('CRUD validates data and duplicates, creates empty records and deletes dependent data', async () => {
  const client = browser()
  const payload = { ...scope, class_no: 2, student_no: 1, name: '신규 샘플', gender: null, birth_date: '2020-02-29', email: null, height_cm: 0, weight_kg: null, notes: '한글 메모' }
  const created = await client.request('/api/school/students', 'POST', payload)
  assert.equal(created.code, 201)
  const id = created.data.student.id
  assert.equal((await client.request('/api/school/students', 'POST', payload)).code, 409)
  const query = '?year=2026&grade=1&class_no=2'
  for (const path of ['exercises', 'paps', 'heart-rate']) {
    const rows = (await client.request(`/api/school/${path}${query}`)).data.rows
    assert.equal(rows.length, 1)
    for (const values of Object.values(rows[0])) if (Array.isArray(values)) assert.deepEqual(values, Array(12).fill(null))
  }
  for (const change of [{ name: '' }, { name: 9 }, { grade: '1' }, { grade: 7 }, { student_no: -1 }, { student_no: null }, { year: 2024 }, { gender: 'X' }, { birth_date: '2026-02-30' }, { email: 'bad' }, { height_cm: '0' }, { height_cm: -1 }, { notes: {} }, { school_id: 'real-school' }, { id: 'hijack' }]) {
    assert.equal((await client.request(`/api/school/students/${id}`, 'PATCH', change)).code, 400, JSON.stringify(change))
  }
  assert.equal((await client.request('/api/school/students', 'POST', { ...payload, student_no: 0 })).code, 400)
  assert.equal((await client.request(`/api/school/students/${id}`, 'PATCH', {})).code, 400)
  assert.equal((await client.request(`/api/school/students/${id}`, 'DELETE')).code, 200)
  assert.equal((await client.request(`/api/school/students/${id}`, 'DELETE')).code, 404)
  for (const path of ['exercises', 'paps', 'heart-rate']) assert.deepEqual((await client.request(`/api/school/${path}${query}`)).data.rows, [])
})

test('legacy zero buffer and current vacant 31 buffer support student swaps without moving record ownership', async () => {
  for (const buffer of [0, 31]) {
    const client = browser()
    const students = (await client.request('/api/school/students' + classroom)).data.students
    const first = students[0], second = students[1]
    assert.equal((await client.request(`/api/school/students/${first.id}`, 'PATCH', { student_no: 2 })).code, 409)
    assert.equal((await client.request(`/api/school/students/${second.id}`, 'PATCH', { student_no: buffer })).code, 200)
    assert.equal((await client.request(`/api/school/students/${first.id}`, 'PATCH', { student_no: 2, name: '번호 교환' })).code, 200)
    assert.equal((await client.request(`/api/school/students/${second.id}`, 'PATCH', { student_no: 1 })).code, 200)
    const row = (await client.request('/api/school/exercises' + classroom)).data.rows.find(item => item.student_id === first.id)
    assert.equal(row.student_no, 2); assert.equal(row.name, '번호 교환'); assert.equal(row.minutes[2], 34)
  }
})

test('moving class changes all record filters; moving academic year does not relabel measurement years', async () => {
  const client = browser()
  const student = await firstStudent(client)
  await client.request(`/api/school/students/${student.id}`, 'PATCH', { grade: 3, year: 2025 })
  for (const path of ['exercises', 'paps', 'heart-rate']) {
    assert.equal((await client.request(`/api/school/${path}${classroom}`)).data.rows.length, 29)
    const row = (await client.request(`/api/school/${path}?year=2025&grade=3&class_no=1`)).data.rows[0]
    for (const values of Object.values(row)) if (Array.isArray(values)) assert.deepEqual(values, Array(12).fill(null))
  }
})

test('monthly heart save uses real session envelope, weighted merge, extrema and reload persistence', async () => {
  const client = browser()
  const student = await firstStudent(client)
  const save = results => client.request('/api/school/heart-rate', 'POST', { ...scope, results })
  assert.deepEqual((await save([heartResult(student)])).data, { success: true, count: 1 })
  assert.equal((await save([heartResult(student, { avg_bpm: 150, min_bpm: 90, max_bpm: 180, record_count: 120 })])).code, 200)
  let row = (await browser(client.cookie).request('/api/school/heart-rate' + classroom)).data.rows[0]
  assert.equal(row.avg_bpm[9], 140); assert.equal(row.min_bpm[9], 80); assert.equal(row.max_bpm[9], 180)
  assert.equal(row.avg_bpm[10], null)
  assert.equal((await save([heartResult(student, { year: 2027, month: 1, avg_bpm: 0, min_bpm: 0, max_bpm: 0 })])).code, 200)
  assert.equal((await save([heartResult(student, { year: 2027, month: 1, avg_bpm: 100, min_bpm: 80, max_bpm: 120 })])).code, 200)
  row = (await client.request('/api/school/heart-rate' + classroom)).data.rows[0]
  assert.equal(row.avg_bpm[0], 50); assert.equal(row.min_bpm[0], 0); assert.equal(row.max_bpm[0], 120)
  assert.equal((await browser().request('/api/school/heart-rate' + classroom)).data.rows[0].avg_bpm[9], null)
})

test('heart save creates absent participants and resolves missing IDs by selected class number', async () => {
  const client = browser()
  const result = heartResult({ id: '', student_no: 1, name: '새 심박 학생' })
  const context = { ...scope, grade: 3 }
  assert.equal((await client.request('/api/school/heart-rate', 'POST', { ...context, results: [result] })).code, 200)
  assert.equal((await client.request('/api/school/heart-rate', 'POST', { ...context, results: [{ ...result, avg_bpm: 140 }] })).code, 200)
  const students = (await client.request('/api/school/students?year=2026&grade=3&class_no=1')).data.students
  assert.equal(students.length, 1)
  assert.equal(students[0].name, '새 심박 학생')
  const row = (await client.request('/api/school/heart-rate?year=2026&grade=3&class_no=1')).data.rows[0]
  assert.equal(row.student_id, students[0].id); assert.equal(row.avg_bpm[9], 130)
})

test('heart validation rejects partial/bad batches atomically, duplicates and mismatched student/calendar scope', async () => {
  const client = browser()
  const student = await firstStudent(client)
  const result = heartResult(student)
  const changes = [{ year: 2025 }, { month: 13 }, { month: '10' }, { record_count: 0 }, { record_count: null }, { avg_bpm: null }, { avg_bpm: '120' }, { min_bpm: 150 }, { max_bpm: 90 }, { student_no: 2 }, { extra: true }]
  for (const change of changes) assert.equal((await client.request('/api/school/heart-rate', 'POST', { ...scope, results: [{ ...result, ...change }] })).code, 400, JSON.stringify(change))
  assert.equal((await client.request('/api/school/heart-rate', 'POST', { ...scope, results: [result, result] })).code, 409)
  assert.equal((await client.request('/api/school/heart-rate', 'POST', { ...scope, results: [{ ...result, student_id: 'foreign' }] })).code, 404)
  const before = (await client.request('/api/preview/status')).data.counts
  const batch = [heartResult({ id: '', student_no: 1, name: '미저장 학생' }), heartResult({ id: '', student_no: 2, name: '오류 학생' }, { min_bpm: -1 })]
  assert.equal((await client.request('/api/school/heart-rate', 'POST', { ...scope, grade: 3, results: batch })).code, 400)
  assert.deepEqual((await client.request('/api/preview/status')).data.counts, before)
  assert.equal((await client.request('/api/school/heart-rate' + classroom)).data.rows[0].avg_bpm[9], null)
})

test('settings memo and sensor mappings persist with atomic duplicate checks, trimming and empty clear', async () => {
  const client = browser()
  const devices = (await client.request('/api/school/school-devices')).data.items
  assert.equal(devices.length, 2)
  assert.equal((await client.request(`/api/school/school-devices/${devices[0].id}`, 'PATCH', { memo: '새 체육관 메모' })).code, 200)
  assert.equal((await browser(client.cookie).request('/api/school/school-devices')).data.items[0].memo, '새 체육관 메모')
  const valid = [{ student_no: 1, device_id: ' new-sensor ' }, { student_no: 2, device_id: '' }]
  assert.equal((await client.request('/api/school/heart-rate-mappings', 'POST', { mappings: valid })).code, 200)
  assert.deepEqual((await browser(client.cookie).request('/api/school/heart-rate-mappings')).data.mappings, [{ student_no: 1, device_id: 'new-sensor' }])
  for (const mappings of [[{ student_no: 1, device_id: 'a' }, { student_no: 1, device_id: 'b' }], [{ student_no: 1, device_id: 'a' }, { student_no: 2, device_id: 'a' }]]) {
    assert.equal((await client.request('/api/school/heart-rate-mappings', 'POST', { mappings })).code, 409)
  }
  assert.deepEqual((await client.request('/api/school/heart-rate-mappings')).data.mappings, [{ student_no: 1, device_id: 'new-sensor' }])
  assert.equal((await client.request('/api/school/heart-rate-mappings', 'POST', { mappings: [{ student_no: '1', device_id: 'x' }] })).code, 400)
  assert.equal((await client.request('/api/school/heart-rate-mappings', 'POST', { mappings: [] })).code, 200)
  assert.deepEqual((await client.request('/api/school/heart-rate-mappings')).data.mappings, [])
  assert.equal((await browser().request('/api/school/heart-rate-mappings')).data.mappings.length, 30)
})

test('reset restores only the requesting session and returns schoolId for browser storage cleanup', async () => {
  const a = browser(), b = browser()
  const studentA = await firstStudent(a), studentB = await firstStudent(b)
  await a.request(`/api/school/students/${studentA.id}`, 'DELETE')
  await b.request(`/api/school/students/${studentB.id}`, 'PATCH', { name: '다른 브라우저' })
  await a.request('/api/school/heart-rate-mappings', 'POST', { mappings: [] })
  const reset = await a.request('/api/preview/reset', 'POST')
  assert.equal(reset.code, 200); assert.equal(reset.data.schoolId, 'school-preview-1')
  assert.equal(reset.data.counts.students, 84); assert.equal(reset.data.counts.mappings, 30)
  assert.equal((await firstStudent(a)).name, '김민준')
  assert.equal((await firstStudent(b)).name, '다른 브라우저')
})

test('PAPS references preserve all 97 local SQL rows and expose source, not newly invented official thresholds', async () => {
  const refs = (await browser().request('/api/school/paps/grade-reference')).data.refs
  assert.equal(refs.length, 97)
  assert.deepEqual(refs[0], { id: 100, exercise_id: 1, school_id: 1, grade: 1, sex: 1, grade5: [0, 2, 4, 6], grade4: [10, 14, 17, 21], grade3: [26, 30, 34, 39], grade2: [49, 59, 69, 79], grade1: [90, 100, 110, 120] })
  const sql = readFileSync(resolve(__dirname, '../../../../temp/insert_paps_grade.sql'), 'utf8')
  // Independent comparison to the untouched SQL text, not the preview tuple conversion.
  for (const row of refs) {
    const values = ['id', 'exercise_id', 'school_id', 'grade', 'sex'].map(key => row[key])
    const arrays = ['grade5', 'grade4', 'grade3', 'grade2', 'grade1'].map(key => `ARRAY[${row[key].join(',')}]`)
    assert.ok(sql.includes(`(${[...values, ...arrays].join(',')})`), `SQL reference row ${row.id}`)
  }
  for (const grade of [1, 2]) for (const sex of [1, 2]) for (const exercise of [1, 2, 3, 4, 5]) {
    assert.ok(refs.some(row => row.exercise_id === exercise && (exercise === 4 || row.school_id === 1 && row.grade === grade && row.sex === sex)))
  }
})

test('unknown routes fail closed, known wrong methods return Allow, optional operations return 501 without mutations', async () => {
  const client = browser()
  const before = (await client.request('/api/preview/status')).data.counts
  for (const path of ['/api/admin/accounts', '/api/unknown', '/api/school/students/id/extra', '/api/school/device-pages/id/image/extra']) {
    const response = await client.request(path)
    assert.equal(response.code, 404); assert.match(response.response.headers.get('cache-control'), /no-store/)
  }
  const wrong = await client.request('/api/school/students', 'DELETE')
  assert.equal(wrong.code, 405); assert.equal(wrong.response.headers.get('allow'), 'GET, POST')
  for (const [path, method] of [['/api/school/device-pages', 'GET'], ['/api/school/device-pages', 'POST'], ['/api/school/device-pages/id', 'PATCH'], ['/api/school/device-page-blocks/id/image', 'DELETE'], ['/api/device/ingest', 'POST']]) {
    const result = await client.request(path, method)
    assert.equal(result.code, 501); assert.equal(result.data.success, undefined)
  }
  assert.deepEqual((await client.request('/api/preview/status')).data.counts, before)
  assert.equal((await client.request('/api/preview/status', 'HEAD')).code, 405)
  assert.equal((await client.request('/api/preview/status', 'OPTIONS')).code, 405)
})

test('Next15 internal localhost URL accepts original loopback Host only at the same port; write Origin stays exact', async () => {
  const internal = 'http://localhost:18475'
  const headers = { host: '127.0.0.1:18475', 'x-forwarded-host': '127.0.0.1:18475', 'x-forwarded-proto': 'http', 'x-forwarded-port': '18475' }
  const status = await handlePreviewRequest(new Request(`${internal}/api/preview/status`, { headers }))
  assert.equal(status.status, 200)
  const cookie = status.headers.get('set-cookie').split(';')[0]
  const reset = await handlePreviewRequest(new Request(`${internal}/api/preview/reset`, { method: 'POST', headers: { ...headers, cookie, origin } }))
  assert.equal(reset.status, 200)
  const wrongOrigin = await handlePreviewRequest(new Request(`${internal}/api/preview/reset`, { method: 'POST', headers: { ...headers, cookie, origin: internal } }))
  assert.equal(wrongOrigin.status, 403)
  for (const changes of [{ host: '127.0.0.1:18476' }, { host: 'example.com:18475' }, { 'x-forwarded-host': 'example.com:18475' }, { 'x-forwarded-port': '18476' }, { host: '127.0.0.1:99999' }]) {
    assert.equal((await handlePreviewRequest(new Request(`${internal}/api/preview/status`, { headers: { ...headers, ...changes } }))).status, 403)
  }
})

test('external, cross-origin, missing-Origin and proxy-spoofed requests are rejected before session creation', async () => {
  for (const url of ['http://example.com/api/preview/status', 'http://192.168.0.1/api/preview/status']) assert.equal((await handlePreviewRequest(new Request(url))).status, 403)
  const variants = [
    { host: 'localhost.example.com:18475' }, { host: '127.0.0.1:18475@evil.test' },
    { 'x-forwarded-host': 'evil.test' }, { 'x-forwarded-proto': 'https' }, { forwarded: 'host=evil.test' },
    { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' },
  ]
  for (const headers of variants) {
    const response = await handlePreviewRequest(new Request(`${origin}/api/preview/status`, { headers }))
    assert.equal(response.status, 403); assert.equal(response.headers.get('set-cookie'), null)
  }
  for (const suppliedOrigin of [null, 'null', 'http://127.0.0.1:18476', 'http://localhost:18475', 'https://evil.test']) {
    const headers = suppliedOrigin === null ? {} : { origin: suppliedOrigin }
    assert.equal((await handlePreviewRequest(new Request(`${origin}/api/preview/reset`, { method: 'POST', headers }))).status, 403)
  }
  const ipv6 = await handlePreviewRequest(new Request('http://[::1]:18475/api/preview/status'))
  assert.equal(ipv6.status, 200)
  const secure = await handlePreviewRequest(new Request('https://localhost:18475/api/preview/status'))
  assert.match(secure.headers.get('set-cookie'), /; Secure/)
})

test('malformed JSON and non-object/wrong content types do not mutate state', async () => {
  const client = browser()
  const student = await firstStudent(client)
  for (const [body, contentType, code] of [['{', 'application/json', 400], ['null', 'application/json', 400], ['[]', 'application/json', 400], ['{}', 'text/plain', 415]]) {
    const response = await handlePreviewRequest(new Request(`${origin}/api/school/students/${student.id}`, { method: 'PATCH', headers: { cookie: client.cookie, origin, 'content-type': contentType }, body }))
    assert.equal(response.status, code)
  }
  assert.equal((await firstStudent(client)).name, '김민준')
})

test('owned files are valid UTF-8, catchall is local-only, and runtime has no network/DB/production API dependency', () => {
  const root = resolve(__dirname, '..')
  for (const entry of readdirSync(root)) if (/\.(ts|md)$/.test(entry)) {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(join(root, entry)))
    assert.ok(!text.includes('\uFFFD'), entry)
    if (entry.endsWith('.ts')) assert.doesNotMatch(text, /from ['"](?:@\/|.*src\/|next\/|@supabase)|\bfetch\s*\(|process\.env/, entry)
  }
  const catchall = require('../../app/api/[...path]/route.ts')
  for (const method of ['GET', 'POST', 'PATCH', 'DELETE', 'PUT', 'HEAD', 'OPTIONS']) assert.equal(catchall[method], handlePreviewRequest)
})

test('idle sessions expire, expired cookies remain signed out, and capacity is bounded without evicting active data', async t => {
  const client = browser()
  const student = await firstStudent(client)
  await client.request(`/api/school/students/${student.id}`, 'PATCH', { name: '만료 이전' })
  const future = Date.now() + SESSION_TTL_MS + 1
  t.mock.method(Date, 'now', () => future)
  const expired = await client.request('/api/preview/status')
  assert.equal(expired.code, 200); assert.equal(expired.data.authenticated, false)
  await client.request('/api/auth/signin', 'POST', credentials)
  assert.equal((await firstStudent(client)).name, '김민준')
  let created = 0
  for (let i = 0; i < MAX_SESSIONS; i++) {
    const result = await browser().request('/api/preview/status')
    if (result.code === 200) created++
    else assert.equal(result.code, 503)
  }
  assert.equal(created, MAX_SESSIONS - 1)
  assert.equal((await firstStudent(client)).name, '김민준')
})
