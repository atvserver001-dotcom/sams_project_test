/* eslint-disable @typescript-eslint/no-require-imports */
require('./register.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { handleSchoolDataRequest, makeSchoolData, schoolDataRouteFor } = require('../school-data.ts')
const { makeFixtures, PREVIEW_SCHOOL, CONTENTS, emptyRecords } = require('../fixtures.ts')
const { handlePreviewRequest, PREVIEW_COOKIE_NAME } = require('../handler.ts')

const origin = 'http://127.0.0.1:18476'
const classroom = { year: 2026, grade: 1, class_no: 1 }
const query = '?year=2026&grade=1&class_no=1'
function school(id, seeded = true) {
  const state = makeSchoolData(id, seeded)
  const scope = {
    school: { id, name: `${id} 학교`, group_no: `group-${id}`, school_type: 2 },
    contents: [{ school_content_id: `${id}-assignment`, name: '심박기록관리', start_date: '2026-09-01', end_date: null }],
    devices: [{ device_id: `${id}-device`, device_name: '하트 케어', start_date: '2026-09-01', end_date: '2026-12-31', limited_period: true }],
  }
  return { state, scope, request: (path, method = 'GET', body, headers = {}) => {
    if (body !== undefined) headers = { 'content-type': 'application/json', ...headers }
    return handleSchoolDataRequest(new Request(`${origin}${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    }), state, scope)
  } }
}
const json = async response => (await response).json()
function heartResult(student, changes = {}) {
  return { student_id: student.id, student_no: student.student_no, name: student.name,
    year: 2026, month: 10, avg_bpm: 120, min_bpm: 80, max_bpm: 160, record_count: 60, ...changes }
}
function assertHeaders(response) {
  assert.equal(response.headers.get('set-cookie'), null)
  assert.equal(response.headers.get('cache-control'), 'no-store, no-cache, max-age=0, must-revalidate')
  assert.equal(response.headers.get('pragma'), 'no-cache')
  assert.equal(response.headers.get('expires'), '0')
  assert.equal(response.headers.get('vary'), 'Cookie, Origin')
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(response.headers.get('access-control-allow-origin'), null)
}

test('school factory preserves every sample but namespaces student, record and school-device identities', () => {
  const original = makeFixtures(), a = makeSchoolData('school-a'), b = makeSchoolData('school-b')
  const aIds = new Set(a.students.map(student => student.id))
  assert.equal(a.students.length, 84)
  assert.equal(a.records.size, 84)
  assert.equal([...a.records.values()].reduce((count, records) => count + records.heart.size, 0), 588)
  assert.equal(a.mappings.length, 30)
  assert.equal(a.devices.length, 2)
  for (let i = 0; i < original.students.length; i++) {
    const before = original.students[i], studentA = a.students[i], studentB = b.students[i]
    assert.equal(studentA.school_id, 'school-a')
    assert.equal(studentB.school_id, 'school-b')
    assert.ok(studentA.id.includes('school-a'))
    assert.equal(aIds.has(studentB.id), false)
    assert.equal(a.records.has(before.id), false)
    assert.deepEqual(studentA, { ...before, school_id: 'school-a', id: studentA.id })
    assert.deepEqual(a.records.get(studentA.id), original.records.get(before.id))
    assert.deepEqual(b.records.get(studentB.id), original.records.get(before.id))
    assert.notEqual(a.records.get(studentA.id), b.records.get(studentB.id))
    assert.notEqual(a.records.get(studentA.id).exercises.minutes, b.records.get(studentB.id).exercises.minutes)
    assert.notEqual(a.records.get(studentA.id).heart.get(`${before.year}-3`), b.records.get(studentB.id).heart.get(`${before.year}-3`))
  }
  assert.deepEqual([...a.records.keys()], [...aIds])
  assert.deepEqual(a.mappings, original.mappings)
  for (let i = 0; i < a.devices.length; i++) {
    assert.notEqual(a.devices[i].id, b.devices[i].id)
    assert.notEqual(a.devices[i], b.devices[i])
    assert.deepEqual(a.devices[i], { ...original.devices[i], id: a.devices[i].id })
  }
  assert.deepEqual(makeSchoolData('school-a'), a)
  assert.deepEqual(makeFixtures(), original)
})

test('empty school factory has fresh, independently mutable empty collections', async () => {
  const a = school('empty-a', false), b = school('empty-b', false)
  assert.deepEqual(a.state, { students: [], records: new Map(), mappings: [], devices: [] })
  for (const key of ['students', 'records', 'mappings', 'devices']) assert.notEqual(a.state[key], b.state[key])
  for (const path of ['students', 'exercises', 'paps', 'heart-rate']) {
    assert.deepEqual(await json(a.request(`/api/school/${path}${query}`)), path === 'students' ? { students: [] } : { rows: [] })
  }
  assert.deepEqual(await json(a.request('/api/school/school-devices')), { items: [] })
  assert.deepEqual(await json(a.request('/api/school/heart-rate-mappings')), { mappings: [] })
})

test('metadata and assignment lists are injected exactly; canonical school devices remain state-owned', async () => {
  const a = school('school-a'), b = school('school-b')
  a.scope.school.recognition_key = 'injected-recognition'
  a.scope.school.has_linkable = false
  a.scope.school.contents = [{ id: 'metadata-only-content' }]
  const before = structuredClone(b.state)
  for (const client of [a, b]) {
    assert.deepEqual(await json(client.request('/api/school/info')), { school: client.scope.school })
    assert.deepEqual(await json(client.request('/api/school/contents')), { items: client.scope.contents })
    assert.deepEqual(await json(client.request('/api/school/devices')), { items: client.scope.devices })
    assert.deepEqual(await json(client.request('/api/school/school-devices')), { items: client.state.devices })
  }
  const devices = a.state.devices, device = devices[0]
  const assignmentLists = structuredClone({ contents: a.scope.contents, devices: a.scope.devices })
  const response = await a.request(`/api/school/school-devices/${device.id}`, 'PATCH', { memo: '공유 기기 메모' })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { item: { id: device.id, memo: '공유 기기 메모' } })
  assert.equal(a.state.devices, devices)
  assert.equal(a.state.devices[0], device)
  assert.equal(device.memo, '공유 기기 메모')
  assert.equal((await json(a.request('/api/school/school-devices'))).items[0].memo, device.memo)
  assert.deepEqual({ contents: a.scope.contents, devices: a.scope.devices }, assignmentLists)
  assert.deepEqual(b.state, before)
  a.scope.contents = []
  a.scope.devices = []
  assert.deepEqual(await json(a.request('/api/school/contents')), { items: [] })
  assert.deepEqual(await json(a.request('/api/school/devices')), { items: [] })
  assert.equal((await json(a.request('/api/school/school-devices'))).items.length, 2)
})

test('student creation, PATCH and deletion use the injected school and leave the other school unchanged', async () => {
  const a = school('school-a', false), b = school('school-b', false)
  const payload = { ...classroom, student_no: 1, name: '신규 학생', birth_date: '2020-02-29', height_cm: 0, weight_kg: null }
  const createdA = await a.request('/api/school/students', 'POST', payload)
  const createdB = await b.request('/api/school/students', 'POST', payload)
  assert.equal(createdA.status, 201)
  assert.equal(createdB.status, 201)
  const studentA = (await createdA.json()).student, studentB = (await createdB.json()).student
  assert.equal(studentA.school_id, a.scope.school.id)
  assert.equal(studentB.school_id, b.scope.school.id)
  assert.notEqual(studentA.id, studentB.id)
  assert.deepEqual(a.state.records.get(studentA.id), emptyRecords(2026))
  const before = structuredClone(b.state)
  const records = a.state.records.get(studentA.id)
  for (const student_no of [0, 31, 50, 1]) {
    const changed = await a.request(`/api/school/students/${studentA.id}`, 'PATCH', { student_no, name: '변경 학생', notes: '한글 유지' })
    assert.equal(changed.status, 200)
    const student = (await changed.json()).student
    assert.equal(student.school_id, a.scope.school.id)
    assert.equal(student.student_no, student_no)
    assert.equal(student.height_cm, 0)
    assert.equal(student.weight_kg, null)
    assert.equal(a.state.records.get(student.id), records)
  }
  assert.equal((await a.request(`/api/school/students/${studentA.id}`, 'DELETE')).status, 200)
  assert.equal(a.state.students.length, 0)
  assert.equal(a.state.records.size, 0)
  assert.deepEqual(b.state, before)
})

test('foreign seeded and created student IDs and school-device IDs are rejected before any write', async () => {
  const a = school('school-a'), b = school('school-b')
  const created = await b.request('/api/school/students', 'POST', { ...classroom, class_no: 2, student_no: 1, name: 'Foreign created student' })
  const students = [b.state.students.find(student => student.year === 2026), (await created.json()).student]
  const beforeA = structuredClone(a.state), beforeB = structuredClone(b.state)
  for (const student of students) {
    for (const method of ['PATCH', 'DELETE']) {
      const response = await a.request(`/api/school/students/${student.id}`, method, method === 'PATCH' ? { name: 'Foreign write' } : undefined)
      assert.equal(response.status, 404)
      assert.deepEqual(await response.json(), { error: 'Student not found in this preview session.' })
    }
    const response = await a.request('/api/school/heart-rate', 'POST', { ...classroom, results: [heartResult(student)] })
    assert.equal(response.status, 404)
  }
  assert.equal((await a.request(`/api/school/school-devices/${b.state.devices[0].id}`, 'PATCH', { memo: 'Foreign memo' })).status, 404)
  assert.deepEqual(a.state, beforeA)
  assert.deepEqual(b.state, beforeB)
})

test('heart-created students, ID-less resolution, weighted sampling and calendar months stay school-scoped', async () => {
  const a = school('school-a', false), b = school('school-b', false)
  const missing = heartResult({ id: '', student_no: 1, name: '심박 학생' })
  const save = (client, result) => client.request('/api/school/heart-rate', 'POST', { ...classroom, results: [result] })
  assert.equal((await save(a, missing)).status, 200)
  assert.equal((await save(b, missing)).status, 200)
  const studentA = a.state.students[0], studentB = b.state.students[0]
  assert.equal(studentA.school_id, 'school-a')
  assert.equal(studentB.school_id, 'school-b')
  assert.notEqual(studentA.id, studentB.id)
  const beforeB = structuredClone(b.state)
  assert.equal((await save(a, { ...missing, avg_bpm: 150, min_bpm: 90, max_bpm: 180, record_count: 120 })).status, 200)
  assert.equal(a.state.students.length, 1)
  const october = a.state.records.get(studentA.id).heart.get('2026-10')
  assert.deepEqual(october, { year: 2026, month: 10, avg_bpm: 140, min_bpm: 80, max_bpm: 180, record_count: 180 })
  const january = heartResult(studentA, { year: 2027, month: 1, avg_bpm: 0, min_bpm: 0, max_bpm: 0 })
  assert.equal((await save(a, january)).status, 200)
  assert.equal((await save(a, { ...january, avg_bpm: 100, min_bpm: 80, max_bpm: 120 })).status, 200)
  const row = (await json(a.request('/api/school/heart-rate' + query))).rows[0]
  assert.equal(row.student_id, studentA.id)
  assert.equal(row.avg_bpm[9], 140)
  assert.equal(row.avg_bpm[0], 50)
  assert.equal(row.min_bpm[0], 0)
  assert.equal(row.max_bpm[0], 120)
  assert.equal(row.avg_bpm[1], null)
  const beforeA = structuredClone(a.state)
  assert.equal((await save(a, { ...january, year: 2026 })).status, 400)
  assert.deepEqual(a.state, beforeA)
  assert.deepEqual(b.state, beforeB)
})

test('heart validation stages existing records and synthesized students atomically including foreign IDs', async () => {
  const a = school('school-a'), b = school('school-b')
  const student = a.state.students.find(student => student.year === 2026)
  const good = heartResult(student)
  const before = structuredClone(a.state)
  for (const result of [
    { ...good, student_id: b.state.students.find(student => student.year === 2026).id },
    { ...good, month: 11, avg_bpm: null },
    { ...good, month: 11, record_count: 0 },
    { ...good, month: 11, min_bpm: 150 },
    good,
  ]) {
    const response = await a.request('/api/school/heart-rate', 'POST', { ...classroom, results: [good, result] })
    assert.equal(response.ok, false)
    assert.deepEqual(a.state, before)
  }
  const synthesized = heartResult({ id: '', student_no: 1, name: '미저장 학생' })
  const response = await a.request('/api/school/heart-rate', 'POST', {
    ...classroom, grade: 3, results: [synthesized, { ...synthesized, student_no: 2, month: 13 }],
  })
  assert.equal(response.status, 400)
  assert.deepEqual(a.state, before)
  const unnamed = { ...synthesized }
  delete unnamed.name
  assert.equal((await a.request('/api/school/heart-rate', 'POST', { ...classroom, grade: 3, results: [unnamed] })).status, 200)
  assert.equal(a.state.students.at(-1).name, '1번 학생')
  assert.equal(a.state.students.at(-1).school_id, 'school-a')
})

test('student validation retains date, zero, missing, duplicate and unsupported-field contracts atomically', async () => {
  const a = school('school-a')
  const student = a.state.students.find(student => student.year === 2026)
  const before = structuredClone(a.state)
  for (const changes of [
    { school_id: 'school-b' }, { id: 'foreign' }, { name: '' }, { gender: 'X' },
    { birth_date: '2026-02-30' }, { birth_date: '' }, { height_cm: -1 }, { height_cm: '0' },
    { student_no: null }, { student_no: 51 }, { student_no: 2 }, { notes: {} }, { year: 2024 }, {},
  ]) {
    assert.equal((await a.request(`/api/school/students/${student.id}`, 'PATCH', changes)).status, changes.student_no === 2 ? 409 : 400)
    assert.deepEqual(a.state, before)
  }
  const response = await a.request(`/api/school/students/${student.id}`, 'PATCH', { birth_date: '2020-02-29', height_cm: 0, weight_kg: null })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).student.school_id, 'school-a')
})

test('mappings and memo validation mutate only the selected school and preserve invalid batches', async () => {
  const a = school('school-a'), b = school('school-b')
  const beforeB = structuredClone(b.state)
  assert.equal((await a.request('/api/school/heart-rate-mappings', 'POST', { mappings: [
    { student_no: 3, device_id: ' sensor-c ' }, { student_no: 1, device_id: 'sensor-a' }, { student_no: 2, device_id: ' ' },
  ] })).status, 200)
  assert.deepEqual(a.state.mappings, [{ student_no: 1, device_id: 'sensor-a' }, { student_no: 3, device_id: 'sensor-c' }])
  const beforeA = structuredClone(a.state)
  for (const mappings of [
    [{ student_no: 1, device_id: 'a' }, { student_no: 1, device_id: 'b' }],
    [{ student_no: 1, device_id: 'a' }, { student_no: 2, device_id: ' a ' }],
    [{ student_no: '1', device_id: 'a' }],
  ]) {
    assert.equal((await a.request('/api/school/heart-rate-mappings', 'POST', { mappings })).ok, false)
    assert.deepEqual(a.state, beforeA)
  }
  for (const payload of [{ memo: null }, { memo: 'x'.repeat(4001) }, { memo: 'new', device_id: 'foreign' }]) {
    assert.equal((await a.request(`/api/school/school-devices/${a.state.devices[0].id}`, 'PATCH', payload)).status, 400)
    assert.deepEqual(a.state, beforeA)
  }
  assert.equal((await a.request('/api/school/heart-rate-mappings', 'POST', { mappings: [] })).status, 200)
  assert.deepEqual(a.state.mappings, [])
  assert.deepEqual(b.state, beforeB)
})

test('exercise categories, PAPS and heart keep fixture numbers, zero/null and current student identities', async () => {
  const a = school('school-a')
  for (const path of ['exercises', 'paps', 'heart-rate']) {
    const rows = (await json(a.request(`/api/school/${path}${query}`))).rows
    assert.equal(rows.length, 30)
    for (const row of rows) {
      assert.ok(a.state.records.has(row.student_id))
      for (const values of Object.values(row)) if (Array.isArray(values)) {
        assert.equal(values.length, 12)
        assert.equal(values[0], null)
        assert.equal(values[5], 0)
      }
    }
  }
  const all = (await json(a.request('/api/school/exercises' + query))).rows[0]
  assert.equal(all.minutes[2], 34)
  for (const [category, field] of [['1', 'minutes_c1'], ['2', 'minutes_c2'], ['3', 'minutes_c3'], ['4', 'minutes_c1']]) {
    const row = (await json(a.request(`/api/school/exercises${query}&category_type=${category}`))).rows[0]
    assert.deepEqual(row.minutes, all[field])
    assert.deepEqual(row.calories, all.calories.map(value => value === null ? null : value / 3))
  }
  assert.equal((await a.request(`/api/school/exercises${query}&category_type=5`)).status, 400)
  const student = a.state.students.find(student => student.id === all.student_id)
  assert.equal((await a.request(`/api/school/students/${student.id}`, 'PATCH', { name: '기록 이름', grade: 3, year: 2025 })).status, 200)
  for (const path of ['exercises', 'paps', 'heart-rate']) {
    const row = (await json(a.request(`/api/school/${path}?year=2025&grade=3&class_no=1`))).rows[0]
    assert.equal(row.name, '기록 이름')
    for (const values of Object.values(row)) if (Array.isArray(values)) assert.deepEqual(values, Array(12).fill(null))
  }
})

test('missing queries, invalid queries, HEAD and JSON errors keep status, content type and no-store headers', async () => {
  const a = school('school-a')
  const before = structuredClone(a.state)
  const empty = await a.request('/api/school/students')
  assert.equal(empty.status, 204)
  assert.equal(await empty.text(), '')
  assert.equal(empty.headers.get('content-type'), null)
  assertHeaders(empty)
  const head = await a.request('/api/school/students', 'HEAD')
  assert.equal(head.status, 405)
  assert.equal(head.headers.get('allow'), 'GET, POST')
  assert.equal(head.headers.get('content-type'), null)
  assert.equal(await head.text(), '')
  assertHeaders(head)
  for (const path of ['/api/school/exercises', `/api/school/students${query}&all_years=x`, `/api/school/students${query}&grade=2`]) {
    const response = await a.request(path)
    assert.equal(response.status, 400)
    assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8')
    assertHeaders(response)
  }
  assert.equal((await json(a.request('/api/school/students?grade=1&class_no=1&all_years=1'))).students.length, 60)
  for (const [body, contentType, status, error] of [
    ['{', 'application/json', 400, 'Invalid JSON body.'],
    ['null', 'application/json', 400, 'JSON object required.'],
    ['[]', 'application/json', 400, 'JSON object required.'],
    ['{}', 'text/plain', 415, 'Content-Type application/json required.'],
    ['{}', null, 415, 'Content-Type application/json required.'],
  ]) {
    const response = await handleSchoolDataRequest(new Request(`${origin}/api/school/students`, {
      method: 'POST', headers: contentType === null ? {} : { 'content-type': contentType }, body,
    }), a.state, a.scope)
    assert.equal(response.status, status)
    assert.deepEqual(await response.json(), { error })
    assertHeaders(response)
  }
  const accepted = await a.request('/api/school/heart-rate-mappings', 'POST', { mappings: [] }, { 'content-type': 'Application/JSON; charset=UTF-8' })
  assert.equal(accepted.status, 200)
  assert.deepEqual({ ...a.state, mappings: before.mappings }, before)
})

test('known routes keep method allowlists; every optional route remains explicit 501 without writes', async () => {
  const a = school('school-a')
  const before = structuredClone(a.state)
  const optional = [
    ['/api/school/device-pages', ['GET', 'POST']],
    ['/api/school/device-page-blocks', ['POST']],
    ['/api/school/device-assets', ['GET', 'POST', 'DELETE']],
    ['/api/device/ingest', ['POST']],
    ['/api/school/device-pages/id', ['PATCH', 'DELETE']],
    ['/api/school/device-page-blocks/id', ['PATCH', 'DELETE']],
    ['/api/school/device-pages/id/image', ['POST', 'DELETE']],
    ['/api/school/device-page-blocks/id/image', ['POST', 'DELETE']],
  ]
  const routes = [
    ['/api/school/info', ['GET']], ['/api/school/students', ['GET', 'POST']],
    ['/api/school/students/id', ['PATCH', 'DELETE']], ['/api/school/exercises', ['GET']],
    ['/api/school/paps', ['GET']], ['/api/school/paps/grade-reference', ['GET']],
    ['/api/school/heart-rate', ['GET', 'POST']], ['/api/school/heart-rate-mappings', ['GET', 'POST']],
    ['/api/school/contents', ['GET']], ['/api/school/devices', ['GET']],
    ['/api/school/school-devices', ['GET']], ['/api/school/school-devices/id', ['PATCH']], ...optional,
  ]
  for (const [path, methods] of routes) {
    assert.deepEqual(schoolDataRouteFor(path).methods, methods)
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE', 'PUT', 'HEAD', 'OPTIONS']) {
      if (methods.includes(method)) continue
      const response = await a.request(path, method)
      assert.equal(response.status, 405, `${method} ${path}`)
      assert.equal(response.headers.get('allow'), methods.join(', '))
      assertHeaders(response)
      if (method !== 'HEAD') assert.deepEqual(await response.json(), { error: 'Method not allowed in preview.' })
    }
  }
  for (const [path, methods] of optional) for (const method of methods) {
    const response = await a.request(path, method)
    assert.equal(response.status, 501)
    assert.deepEqual(await response.json(), { error: 'This optional page/block/image/ingest operation is not implemented in the isolated preview. No data was saved.' })
    assertHeaders(response)
  }
  assert.deepEqual(a.state, before)
})

test('unknown paths and caller-owned auth, preview and admin routes stay 404 without side effects', async () => {
  const a = school('school-a')
  const before = structuredClone(a.state)
  for (const path of [
    '/api/auth/me', '/api/auth/signin', '/api/preview/status', '/api/preview/reset', '/api/admin/schools',
    '/api/unknown', '/api/school/info/', '/api/school/students/id/extra', '/api/school/school-devices/id/extra',
    '/api/school/device-pages/id/image/extra', '/api/school/device-assets/id', '/api/device/ingest/extra', '/toString',
  ]) {
    assert.equal(schoolDataRouteFor(path), null)
    const response = await a.request(path)
    assert.equal(response.status, 404)
    assert.deepEqual(await response.json(), { error: 'Unknown preview API route.' })
    assertHeaders(response)
  }
  assert.deepEqual(a.state, before)
})

test('direct data calls neither authenticate nor create cookies or network traffic, including failures', async t => {
  const a = school('school-a')
  t.mock.method(globalThis, 'fetch', () => assert.fail('School data cannot contact the network'))
  for (const path of ['/api/school/info', '/api/school/contents', '/api/school/devices', '/api/school/paps/grade-reference']) {
    const response = await a.request(path, 'GET', undefined, { cookie: `${PREVIEW_COOKIE_NAME}=signed-out; acting_school_id=school-b` })
    assert.equal(response.status, 200)
    assertHeaders(response)
    assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8')
    if (path.endsWith('grade-reference')) assert.equal((await response.json()).refs.length, 97)
  }
  const response = await handleSchoolDataRequest(new Request(`${origin}/api/school/info`), a.state, {
    ...a.scope, get school() { throw new Error('Private internal detail') },
  })
  assert.equal(response.status, 500)
  assert.deepEqual(await response.json(), { error: 'Isolated preview request failed.' })
  assertHeaders(response)
})

test('legacy wrapper preserves default fixture IDs, metadata, assignments and cookies on first data responses', async () => {
  for (const [path, status, expected] of [
    ['/api/school/info', 200, { school: PREVIEW_SCHOOL }],
    ['/api/school/contents', 200, { items: CONTENTS }],
    ['/api/school/devices', 200, { items: makeFixtures().devices.map(device => ({ device_id: device.device_id, device_name: device.device_name, start_date: '2025-03-01', end_date: null, limited_period: false })) }],
    ['/api/school/school-devices', 200, { items: makeFixtures().devices }],
    ['/api/school/students', 204, null],
    ['/api/school/exercises', 400, { error: 'year: required integer query parameter.' }],
    ['/api/school/device-pages', 501, { error: 'This optional page/block/image/ingest operation is not implemented in the isolated preview. No data was saved.' }],
  ]) {
    const response = await handlePreviewRequest(new Request(`${origin}${path}`))
    assert.equal(response.status, status)
    assert.match(response.headers.get('set-cookie'), new RegExp(`^${PREVIEW_COOKIE_NAME}=[0-9a-f-]{36}; Path=/; HttpOnly; SameSite=Strict$`))
    assert.deepEqual(status === 204 ? null : await response.json(), expected)
  }
  const response = await handlePreviewRequest(new Request(`${origin}/api/school/students${query}`))
  const students = (await response.json()).students
  assert.deepEqual(students, makeFixtures().students.filter(student => student.year === 2026 && student.grade === 1))
})

test('legacy wrapper still checks unknown paths and methods before session cookies and authentication', async () => {
  const signedOut = await handlePreviewRequest(new Request(`${origin}/api/auth/signout`, { method: 'POST', headers: { origin } }))
  const cookie = signedOut.headers.get('set-cookie').split(';')[0]
  for (const headers of [{ origin }, { origin, cookie }]) {
    for (const [path, method, status] of [
      ['/api/admin/schools', 'GET', 404], ['/api/school/students/id/extra', 'GET', 404],
      ['/api/school/students', 'DELETE', 405], ['/api/school/device-assets', 'PUT', 405],
    ]) {
      const response = await handlePreviewRequest(new Request(`${origin}${path}`, { method, headers }))
      assert.equal(response.status, status)
      assert.equal(response.headers.get('set-cookie'), null)
    }
  }
  for (const [path, method] of [['/api/school/info', 'GET'], ['/api/school/device-assets', 'POST']]) {
    const response = await handlePreviewRequest(new Request(`${origin}${path}`, { method, headers: { origin, cookie } }))
    assert.equal(response.status, 401)
    assert.deepEqual(await response.json(), { error: 'Preview teacher is signed out.' })
    assert.equal(response.headers.get('set-cookie'), null)
  }
})

test('owned module, validation, wrapper and focused tests are strict UTF-8 without replacement characters', () => {
  for (const path of ['../school-data.ts', '../validation.ts', '../handler.ts', './school-data.test.cjs']) {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(resolve(__dirname, path)))
    assert.ok(!text.includes('\uFFFD'), path)
  }
})
