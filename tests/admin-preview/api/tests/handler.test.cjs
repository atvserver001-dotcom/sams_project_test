/* eslint-disable @typescript-eslint/no-require-imports */
require('./register.cjs')
const { test, beforeEach, after } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync, readdirSync } = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { handleAdminPreviewRequest, PREVIEW_COOKIE_NAME, SESSION_TTL_MS, MAX_SESSIONS } = require('../handler.ts')
const { makeAdminFixtures, PREVIEW_CREDENTIALS, PREVIEW_ADMIN_ID } = require('../fixtures.ts')
const { handlePreviewRequest, PREVIEW_COOKIE_NAME: SCHOOL_COOKIE } = require('../../../school-preview/api/handler.ts')
const origin = 'http://127.0.0.1:18476'
const store = globalThis[Symbol.for('atvcms.admin-preview.sessions.v1')]
const nativeFetch = globalThis.fetch
globalThis.fetch = () => { throw new Error('External or loopback fetch is prohibited in unit tests.') }
after(() => { globalThis.fetch = nativeFetch })
beforeEach(() => { store.clear() })

function client(initialCookie = '') {
  return {
    cookie: initialCookie,
    async send(route, method = 'GET', body, options = {}) {
      const headers = new Headers({ host: '127.0.0.1:18476' })
      if (this.cookie) headers.set('cookie', this.cookie)
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) headers.set('origin', origin)
      if (body !== undefined) headers.set('content-type', 'application/json')
      for (const [key, value] of Object.entries(options.headers || {})) {
        if (value === null) headers.delete(key)
        else headers.set(key, value)
      }
      const request = new Request(options.url || origin + route, { method, headers, body: options.rawBody ?? (body === undefined ? undefined : JSON.stringify(body)) })
      const response = await handleAdminPreviewRequest(request)
      const cookie = response.headers.get('set-cookie')
      if (cookie) this.cookie = cookie.split(';')[0]
      assert.match(response.headers.get('cache-control'), /no-store/)
      assert.equal(response.headers.get('x-admin-preview'), 'synthetic')
      const text = await response.text()
      return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers }
    },
  }
}
async function bootstrap() {
  const c = client()
  const result = await c.send('/api/preview/status')
  assert.equal(result.status, 200)
  assert.equal(result.body.authenticated, true)
  return c
}
async function acting(c, group = '1001') {
  const result = await c.send(`/api/admin/act-as?group_no=${group}`)
  assert.equal(result.status, 200)
  return result.body.school
}
async function snapshot(c) {
  const result = {}
  for (const key of ['schools', 'accounts', 'contents', 'devices', 'school-details']) result[key] = (await c.send(`/api/admin/${key}?pageSize=1000`)).body
  return result
}
function assignments(school) {
  return school.contents.map(content => ({
    content_id: content.content_id, start_date: content.start_date, end_date: content.end_date, is_unlimited: content.is_unlimited,
    device_quantities: [...new Set(content.devices.map(device => device.device_id))].map(device_id => ({ device_id, quantity: content.devices.filter(device => device.device_id === device_id).length })),
    remove_school_device_ids: [],
  }))
}
const studentsPath = '/api/school/students?year=2026&grade=1&class_no=1'

test('bootstrap exposes documented synthetic admin and unique canonical school fixtures', async () => {
  const c = await bootstrap()
  assert.match(c.cookie, new RegExp(`^${PREVIEW_COOKIE_NAME}=`))
  assert.notEqual(PREVIEW_COOKIE_NAME, SCHOOL_COOKIE)
  const me = await c.send('/api/auth/me')
  assert.deepEqual(me.body.user, { id: PREVIEW_ADMIN_ID, username: 'preview_admin', role: 'admin', schoolId: null, isActive: true })
  assert.deepEqual((await c.send('/api/school/info')).body, { school: null })
  assert.equal((await c.send(studentsPath)).status, 403)
  const fixtures = makeAdminFixtures()
  assert.deepEqual(fixtures.schools.map(school => school.group_no), ['1001', '1002', '1003'])
  assert.equal(new Set(fixtures.schools.flatMap(school => school.data.students.map(student => student.id))).size, fixtures.schools.reduce((n, school) => n + school.data.students.length, 0))
  assert.equal(new Set(fixtures.schools.flatMap(school => school.data.devices.map(device => device.auth_key))).size, 13)
  for (const school of fixtures.schools) {
    assert(school.data.students.every(student => student.school_id === school.id))
    assert(school.data.students.every(student => school.data.records.has(student.id)))
    assert(school.data.devices.every(device => school.assignments.some(item => item.id === device.school_content_id)))
    assert(school.data.mappings.every(mapping => mapping.device_id.includes(school.id)))
    const entryAge = [6, 12, 15][school.school_type - 1]
    assert(school.data.students.every(student => student.birth_date === `${student.year - student.grade - entryAge}-04-03`))
  }
  const schools = (await c.send('/api/admin/schools')).body.items
  assert.equal(schools[1].min_end_date, '2025-02-28')
  assert.equal(schools[0].has_linkable, true)
})

test('bootstrap cookie is reused for parallel requests without creating other sessions', async () => {
  const c = await bootstrap()
  const cookie = c.cookie
  const results = await Promise.all(['/api/auth/me', '/api/admin/accounts', '/api/admin/schools', '/api/admin/contents', '/api/admin/devices'].map(route => c.send(route)))
  assert(results.every(result => result.status === 200 && !result.headers.has('set-cookie')))
  assert.equal(c.cookie, cookie)
  assert.equal(store.size, 1)
})

test('school device catalog contains one row per device while issued instances retain keys, memos and counts', async () => {
  const c = await bootstrap()
  await acting(c)
  const before = (await c.send('/api/school/school-devices')).body.items
  const catalog = (await c.send('/api/school/devices')).body.items
  assert.equal(before.length, 5)
  assert.equal(catalog.length, 3)
  assert.equal(new Set(catalog.map(device => device.device_id)).size, catalog.length)
  assert.equal(catalog.filter(device => device.device_id === 'admin-preview-device-1').length, 1)
  const contents = (await c.send('/api/school/contents')).body.items
  // The unchanged menu generates these candidate IDs; route deduplication only removes candidates.
  const menuIds = [...contents.map(content => `content-${content.school_content_id}`), ...catalog.map(device => `device-${device.device_id}`)]
  assert.equal(new Set(menuIds).size, menuIds.length)
  for (const device of catalog) assert.deepEqual(Object.keys(device).sort(), ['device_id', 'device_name', 'end_date', 'limited_period', 'start_date'])
  assert.equal((await c.send('/api/admin/school-details?search=1001')).body.items[0].device_count, 5)
  assert.equal((await c.send('/api/admin/schools/1001')).body.contents.flatMap(content => content.devices).length, 5)
  assert.deepEqual((await c.send('/api/school/school-devices')).body.items, before)
  await c.send('/api/admin/devices/admin-preview-device-1', 'PUT', { device_name: 'Updated catalog label' })
  assert.equal((await c.send('/api/school/devices')).body.items.find(device => device.device_id === 'admin-preview-device-1').device_name, 'Updated catalog label')
  assert.deepEqual((await c.send('/api/school/school-devices')).body.items.map(({ id, auth_key, memo }) => ({ id, auth_key, memo })), before.map(({ id, auth_key, memo }) => ({ id, auth_key, memo })))
})

test('school device catalog aggregates issued assignment periods without treating quantities as catalog rows', async () => {
  const c = await bootstrap()
  await acting(c, '1002')
  const deviceId = 'admin-preview-device-1'
  const read = async () => (await c.send('/api/school/devices')).body.items.filter(device => device.device_id === deviceId)
  const row = (start_date, end_date, limited_period) => ({ device_id: deviceId, device_name: '스마트미러', start_date, end_date, limited_period })
  // An expired assignment must not override an unlimited assignment of the same catalog device.
  const instances = (await c.send('/api/school/school-devices')).body.items
  assert.equal(instances.filter(device => device.device_id === deviceId).length, 3)
  assert.deepEqual(await read(), [row(null, null, false)])
  assert.deepEqual((await c.send('/api/school/school-devices')).body.items, instances)
  const school = (await c.send('/api/admin/schools/1002')).body
  const update = assignments(school)
  update[0] = { ...update[0], is_unlimited: false, start_date: '2024-03-01', end_date: '2025-02-28' }
  update[1] = { ...update[1], is_unlimited: false, start_date: '2026-03-01', end_date: '2027-02-28' }
  const save = async (values = update) => assert.equal((await c.send('/api/admin/schools/1002', 'PUT', { content_assignments: values })).status, 200)
  await save()
  assert.deepEqual(await read(), [row('2024-03-01', '2027-02-28', true)])
  await save([...update].reverse())
  assert.deepEqual(await read(), [row('2024-03-01', '2027-02-28', true)])
  update[1].end_date = '2025-06-30'
  update[1].start_date = '2025-03-01'
  await save()
  assert.deepEqual(await read(), [row('2024-03-01', '2025-06-30', true)])
  update[1].end_date = null
  await save()
  assert.deepEqual(await read(), [row('2024-03-01', null, true)])
  update[0].start_date = null
  await save()
  assert.deepEqual(await read(), [row(null, null, true)])
  update[1].is_unlimited = true
  await save()
  assert.deepEqual(await read(), [row(null, null, false)])
  // A catalog relation with zero issued quantity must not contribute unlimited access.
  update[1].device_quantities[0].quantity = 0
  await save()
  assert.deepEqual(await read(), [row(null, '2025-02-28', true)])
  update[0].device_quantities[0].quantity = 0
  await save()
  assert.deepEqual(await read(), [])
  assert.equal((await c.send('/api/school/school-devices')).body.items.length, 2)
})

test('school CRUD creates empty data, retains old keys, removes selected instances and derives counts', async () => {
  const c = await bootstrap()
  const content = (await c.send('/api/admin/contents')).body.items.find(item => item.id.endsWith('-1'))
  const payload = { group_no: '2345', name: '새 샘플학교', school_type: 1, content_assignments: [{ content_id: content.id, is_unlimited: false, start_date: '2026-03-01', end_date: '2027-02-28', device_quantities: [{ device_id: content.devices[0].id, quantity: 3 }] }] }
  const created = await c.send('/api/admin/schools', 'POST', payload)
  assert.equal(created.status, 201)
  const school = created.body.item
  await acting(c, '2345')
  assert.deepEqual((await c.send(studentsPath)).body.students, [])
  assert.deepEqual((await c.send('/api/school/heart-rate-mappings')).body.mappings, [])
  assert.equal((await c.send('/api/school/school-devices')).body.items.length, 3)
  const update = assignments(school)
  const instances = school.contents[0].devices
  update[0].remove_school_device_ids = [instances[0].id]
  update[0].device_quantities[0].quantity = 2
  assert.equal((await c.send('/api/admin/schools/2345', 'PUT', { group_no: '2346', name: '수정 샘플학교', content_assignments: update })).status, 200)
  assert.equal((await c.send('/api/admin/schools/2345')).status, 404)
  const modified = (await c.send('/api/admin/schools/2346')).body
  assert.deepEqual(modified.contents[0].devices.map(device => device.auth_key).sort(), instances.slice(1).map(device => device.auth_key).sort())
  assert.equal(modified.recognition_key, school.recognition_key)
  assert.equal((await c.send('/api/school/info')).body.school.name, '수정 샘플학교')
  const details = (await c.send('/api/admin/school-details?search=2346')).body
  assert.equal(details.items[0].device_count, 2)
  assert.equal(details.total, 1)
  assert.equal((await c.send('/api/admin/schools/2346', 'DELETE')).status, 200)
  assert.deepEqual((await c.send('/api/school/info')).body, { school: null })
  assert.equal((await c.send('/api/admin/school-details?search=2346')).body.total, 0)
})

test('school assignment quantities keep oldest keys, add uniquely and remove omitted contents/devices', async () => {
  const c = await bootstrap()
  const initial = (await c.send('/api/admin/schools/1001')).body
  const original = initial.contents[0].devices
  const update = assignments(initial)
  update[0].device_quantities[0].quantity = 4
  assert.equal((await c.send('/api/admin/schools/1001', 'PUT', { content_assignments: update })).status, 200)
  let school = (await c.send('/api/admin/schools/1001')).body
  assert.deepEqual(school.contents[0].devices.slice(0, 2).map(device => device.auth_key), original.map(device => device.auth_key))
  assert.equal(new Set(school.contents[0].devices.map(device => device.auth_key)).size, 4)
  update[0].device_quantities[0].quantity = 1
  assert.equal((await c.send('/api/admin/schools/1001', 'PUT', { content_assignments: update.slice(0, 1) })).status, 200)
  school = (await c.send('/api/admin/schools/1001')).body
  assert.equal(school.contents.length, 1)
  assert.equal(school.contents[0].devices[0].auth_key, original[0].auth_key)
  assert.equal(school.has_linkable, false)
  await acting(c)
  assert.equal((await c.send('/api/school/contents')).body.items.length, 1)
  assert.equal((await c.send('/api/school/school-devices')).body.items.length, 1)
  update[0].device_quantities = []
  assert.equal((await c.send('/api/admin/schools/1001', 'PUT', { content_assignments: update.slice(0, 1) })).status, 200)
  assert.equal((await c.send('/api/school/school-devices')).body.items.length, 0)
})

test('invalid staged school writes never mutate basics, relationships, keys or counts', async () => {
  const c = await bootstrap()
  const school = (await c.send('/api/admin/schools/1001')).body
  const foreign = (await c.send('/api/admin/schools/1002')).body.contents[0].devices[0].id
  const baseline = await snapshot(c)
  const variants = [
    update => { update[1].device_quantities[0].quantity = -1 },
    update => { update[1].device_quantities[0].quantity = 1.5 },
    update => { update[1].device_quantities[0].device_id = 'missing' },
    update => { update[1].remove_school_device_ids = [foreign] },
    update => { update[1].remove_school_device_ids = [school.contents[0].devices[0].id] },
    update => { update[1].remove_school_device_ids = ['missing'] },
    update => { update[1].start_date = '2026-02-30' },
    update => { update[1].is_unlimited = false; update[1].start_date = '2027-01-01'; update[1].end_date = '2026-01-01' },
    update => { update.push(update[0]) },
    update => { update[1].device_quantities.push(update[1].device_quantities[0]) },
  ]
  for (const change of variants) {
    const update = assignments(school)
    update[0].device_quantities[0].quantity = 0
    change(update)
    const result = await c.send('/api/admin/schools/1001', 'PUT', { name: 'MUST NOT SAVE', group_no: '9999', content_assignments: update })
    assert([400, 404, 409].includes(result.status), JSON.stringify(result))
    assert.deepEqual(await snapshot(c), baseline)
  }
  for (const body of [{ group_no: '10A1', name: 'bad', school_type: 1 }, { group_no: '1002', name: 'bad', school_type: 1 }, { group_no: '5555', name: 'bad', school_type: 4 }, { group_no: '5555', name: 'bad', school_type: 1, content_assignments: [{ content_id: 'missing' }] }]) {
    assert([400, 404, 409].includes((await c.send('/api/admin/schools', 'POST', body)).status))
    assert.deepEqual(await snapshot(c), baseline)
  }
})

test('account CRUD validates references and propagates teacher totals including inactive accounts', async () => {
  const c = await bootstrap()
  const baseline = await snapshot(c)
  const schools = baseline.schools.items
  const created = await c.send('/api/admin/accounts', 'POST', { username: 'local_teacher', password: 'synthetic-secret', role: 'school', school_id: schools[0].id })
  assert.equal(created.status, 201)
  const account = created.body.item
  assert.equal((await c.send('/api/admin/school-details?search=1001')).body.items[0].teacher_accounts, 2)
  assert.equal((await c.send(`/api/admin/accounts/${account.id}`, 'PUT', { school_id: schools[2].id, is_active: false })).status, 200)
  assert.equal((await c.send('/api/admin/school-details?search=1001')).body.items[0].teacher_accounts, 1)
  assert.equal((await c.send('/api/admin/school-details?search=1003')).body.items[0].teacher_accounts, 2)
  const staged = await snapshot(c)
  for (const body of [{ username: 'preview_admin' }, { school_id: 'missing', username: 'MUST NOT SAVE' }, { role: 'root' }, { is_active: 'false' }]) {
    assert([400, 404, 409].includes((await c.send(`/api/admin/accounts/${account.id}`, 'PUT', body)).status))
    assert.deepEqual(await snapshot(c), staged)
  }
  assert.equal((await c.send('/api/admin/schools/1003', 'DELETE')).status, 409)
  assert.equal((await c.send(`/api/admin/accounts/${account.id}`, 'DELETE')).status, 200)
  assert.deepEqual(await snapshot(c), baseline)
})

test('current-account deletion/deactivation follows source contract and never silently restores admin', async () => {
  const c = await bootstrap()
  assert.equal((await c.send(`/api/admin/accounts/${PREVIEW_ADMIN_ID}`, 'PUT', { is_active: false })).status, 200)
  assert.equal((await c.send('/api/auth/me')).status, 403)
  assert.equal((await c.send('/api/admin/schools')).status, 403)
  assert.equal((await c.send('/api/preview/reset', 'POST')).status, 403)
  assert.equal((await c.send('/api/preview/status')).body.authenticated, false)
  const second = await bootstrap()
  assert.equal((await second.send(`/api/admin/accounts/${PREVIEW_ADMIN_ID}`, 'DELETE')).status, 200)
  assert.equal((await second.send('/api/auth/me')).status, 404)
  assert.equal((await second.send('/api/preview/reset', 'POST')).status, 404)
  assert.equal((await second.send('/api/auth/signin', 'POST', PREVIEW_CREDENTIALS)).status, 401)
})

test('content/device CRUD, order and labels propagate to assigned school views without changing keys', async () => {
  const c = await bootstrap()
  await acting(c)
  const before = (await c.send('/api/school/school-devices')).body.items
  const contentId = 'admin-preview-content-1', deviceId = 'admin-preview-device-1'
  assert.equal((await c.send(`/api/admin/devices/${deviceId}`, 'PUT', { device_name: '새 기기 이름' })).status, 200)
  assert.equal((await c.send(`/api/admin/contents/${contentId}`, 'PUT', { name: '새 콘텐츠 이름', color_hex: '#123456' })).status, 200)
  const catalog = (await c.send(`/api/admin/contents/${contentId}`)).body.item
  assert.equal(catalog.devices[0].name, '새 기기 이름')
  const school = (await c.send('/api/admin/schools/1001')).body
  assert.equal(school.contents[0].name, '새 콘텐츠 이름')
  assert.equal(school.contents[0].color_hex, '#123456')
  const after = (await c.send('/api/school/school-devices')).body.items
  assert.deepEqual(after.map(device => device.auth_key), before.map(device => device.auth_key))
  assert.equal(after[0].device_name, '새 기기 이름')
  assert.equal(after[0].content_name, '새 콘텐츠 이름')
  assert.equal((await c.send('/api/school/contents')).body.items[0].color_hex, '#123456')
  const device = (await c.send('/api/admin/devices', 'POST', { device_name: 'Test device', linkable: true })).body.item
  const content = (await c.send('/api/admin/contents', 'POST', { name: 'Test content', device_ids: [device.id], color_hex: '#102030' })).body.item
  const order = (await c.send('/api/admin/devices')).body.items.map(item => item.id).reverse()
  assert.equal((await c.send('/api/admin/devices', 'PUT', { order })).status, 200)
  assert.deepEqual((await c.send('/api/admin/devices')).body.items.map(item => item.id), order)
  assert.equal((await c.send(`/api/admin/devices/${device.id}`, 'DELETE')).status, 409)
  assert.equal((await c.send(`/api/admin/contents/${content.id}`, 'PUT', { device_ids: [] })).status, 200)
  assert.equal((await c.send(`/api/admin/contents/${content.id}`, 'DELETE')).status, 200)
  assert.equal((await c.send(`/api/admin/devices/${device.id}`, 'DELETE')).status, 200)
})

test('invalid catalog relationships, reorder and protected reference deletes are atomic', async () => {
  const c = await bootstrap()
  const baseline = await snapshot(c)
  const d = 'admin-preview-device-1', content = 'admin-preview-content-1'
  const operations = [
    ['/api/admin/contents', 'POST', { name: 'MUST NOT SAVE', device_ids: ['missing'] }],
    [`/api/admin/contents/${content}`, 'PUT', { name: 'MUST NOT SAVE', device_ids: ['missing'] }],
    [`/api/admin/contents/${content}`, 'PUT', { name: 'MUST NOT SAVE', color_hex: 'red' }],
    ['/api/admin/devices', 'PUT', { order: ['admin-preview-device-3', 'missing'] }],
    ['/api/admin/devices', 'PUT', { order: [d, d] }],
    [`/api/admin/devices/${d}`, 'PUT', { device_name: 'MUST NOT SAVE', linkable: 1 }],
    [`/api/admin/devices/${d}`, 'DELETE'],
    [`/api/admin/contents/${content}`, 'DELETE'],
    ['/api/admin/schools/1001', 'DELETE'],
  ]
  for (const args of operations) {
    assert([400, 404, 409].includes((await c.send(...args)).status))
    assert.deepEqual(await snapshot(c), baseline)
  }
})

test('memo edits share canonical instances in both directions and are school/session isolated', async () => {
  const c = await bootstrap(), other = await bootstrap()
  await acting(c)
  const device = (await c.send('/api/school/school-devices')).body.items[0]
  assert.equal((await c.send(`/api/admin/school-devices/${device.id}`, 'PATCH', { memo: '관리자 메모' })).status, 200)
  assert.equal((await c.send('/api/school/school-devices')).body.items[0].memo, '관리자 메모')
  assert.equal((await c.send(`/api/school/school-devices/${device.id}`, 'PATCH', { memo: '학교 메모' })).status, 200)
  assert.equal((await c.send('/api/admin/schools/1001')).body.contents[0].devices[0].memo, '학교 메모')
  assert.notEqual((await other.send('/api/admin/schools/1001')).body.contents[0].devices[0].memo, '학교 메모')
  await acting(c, '1002')
  assert.equal((await c.send(`/api/school/school-devices/${device.id}`, 'PATCH', { memo: 'MUST NOT SAVE' })).status, 404)
  assert.equal((await c.send('/api/admin/schools/1001')).body.contents[0].devices[0].memo, '학교 메모')
})

test('act-as preserves admin role, isolates students/records/mappings and returns to admin', async () => {
  const c = await bootstrap()
  assert.equal((await c.send('/api/admin/act-as', 'POST')).status, 400)
  const school = await acting(c)
  assert.deepEqual(school, { id: 'admin-preview-school-1', group_no: '1001', name: '샘플초등학교' })
  assert.equal((await c.send('/api/auth/me')).body.user.role, 'admin')
  assert.equal((await c.send('/api/auth/me')).body.user.schoolId, school.id)
  assert.equal((await c.send('/api/admin/act-as', 'POST')).status, 200)
  const students = (await c.send(studentsPath)).body.students
  const first = students[0]
  assert.equal((await c.send(`/api/school/students/${first.id}`, 'PATCH', { name: '수정 학생' })).status, 200)
  assert.equal((await c.send('/api/school/heart-rate-mappings', 'POST', { mappings: [{ student_no: 1, device_id: 'local-sensor' }] })).status, 200)
  const savedHeart = { year: 2026, grade: 1, class_no: 1, results: [{ student_id: first.id, student_no: 1, year: 2026, month: 10, avg_bpm: 110, min_bpm: 80, max_bpm: 140, record_count: 10 }] }
  assert.equal((await c.send('/api/school/heart-rate', 'POST', savedHeart)).status, 200)
  await acting(c, '1002')
  assert.equal((await c.send(`/api/school/students/${first.id}`, 'DELETE')).status, 404)
  assert.equal((await c.send('/api/school/heart-rate', 'POST', savedHeart)).status, 404)
  const second = (await c.send(studentsPath)).body.students[0]
  assert.notEqual(second.id, first.id)
  assert.notEqual(second.name, '수정 학생')
  assert.notEqual((await c.send('/api/school/heart-rate-mappings')).body.mappings[0].device_id, 'local-sensor')
  assert.equal((await c.send('/api/admin/act-as?group_no=9999')).status, 404)
  assert.equal((await c.send('/api/auth/me')).body.user.schoolId, 'admin-preview-school-2')
  await acting(c)
  assert.equal((await c.send(studentsPath)).body.students[0].name, '수정 학생')
  assert.equal((await c.send('/api/school/heart-rate?year=2026&grade=1&class_no=1')).body.rows[0].avg_bpm[9], 110)
  assert.equal((await c.send('/api/admin/act-as', 'DELETE')).status, 200)
  assert.equal((await c.send('/api/auth/me')).body.user.role, 'admin')
  assert.equal((await c.send('/api/auth/me')).body.user.schoolId, null)
  assert.deepEqual((await c.send('/api/school/info')).body, { school: null })
  assert.equal((await c.send(studentsPath)).status, 403)
})

test('school accounts created by CRUD sign in to their own school and cannot become admin', async () => {
  const c = await bootstrap()
  const created = await c.send('/api/admin/accounts', 'POST', { username: 'created_teacher', password: 'local-only', role: 'school', school_id: 'admin-preview-school-2' })
  assert.equal(created.status, 201)
  await acting(c)
  assert.equal((await c.send('/api/auth/signin', 'POST', { username: 'created_teacher', password: 'local-only' })).body.user.role, 'school')
  assert.equal((await c.send('/api/school/info')).body.school.group_no, '1002')
  assert.equal((await c.send(studentsPath)).body.students[0].school_id, 'admin-preview-school-2')
  for (const [route, method] of [['/api/admin/accounts', 'GET'], ['/api/admin/act-as?group_no=1001', 'GET'], ['/api/admin/act-as', 'DELETE'], ['/api/preview/reset', 'POST']]) assert.equal((await c.send(route, method)).status, 403)
  assert.equal((await c.send('/api/auth/signin', 'POST', PREVIEW_CREDENTIALS)).body.user.role, 'admin')
  assert.equal((await c.send('/api/auth/me')).body.user.schoolId, null)
  assert.equal((await c.send('/api/auth/signin', 'POST', { username: 'preview_school_inactive', password: 'preview-only' })).status, 403)
})

test('signout and stale/empty cookies remain signed out; reset is authenticated and session isolated', async () => {
  const c = await bootstrap(), other = await bootstrap()
  await c.send('/api/admin/schools/1001', 'PUT', { name: 'Changed' })
  await acting(c)
  await c.send('/api/school/heart-rate-mappings', 'POST', { mappings: [] })
  await other.send('/api/admin/schools/1001', 'PUT', { name: 'Other session' })
  const cookie = c.cookie
  assert.equal((await c.send('/api/auth/signout', 'POST')).status, 200)
  assert.equal(c.cookie, cookie)
  assert.equal((await c.send('/api/auth/me')).status, 401)
  assert.equal((await c.send('/api/preview/reset', 'POST')).status, 401)
  assert.equal((await c.send('/api/preview/status')).body.authenticated, false)
  assert.equal((await c.send('/api/auth/signin', 'POST', { username: 'preview_admin', password: 'wrong' })).status, 401)
  assert.equal((await c.send('/api/auth/signin', 'POST', PREVIEW_CREDENTIALS)).status, 200)
  assert.equal((await c.send('/api/admin/schools/1001')).body.name, 'Changed')
  assert.equal((await c.send('/api/preview/reset', 'POST')).status, 200)
  assert.equal((await c.send('/api/auth/me')).body.user.schoolId, null)
  assert.equal((await c.send('/api/admin/schools/1001')).body.name, '샘플초등학교')
  await acting(c)
  assert.equal((await c.send('/api/school/heart-rate-mappings')).body.mappings.length, 30)
  assert.equal((await other.send('/api/admin/schools/1001')).body.name, 'Other session')
  for (const stale of [`${PREVIEW_COOKIE_NAME}=unknown`, `${PREVIEW_COOKIE_NAME}=`]) {
    const browser = client(stale)
    assert.equal((await browser.send('/api/preview/status')).body.authenticated, false)
    assert.equal((await browser.send('/api/auth/me')).status, 401)
    assert.equal((await browser.send('/api/auth/signin', 'POST', PREVIEW_CREDENTIALS)).status, 200)
  }
  const fresh = client()
  await fresh.send('/api/auth/signout', 'POST')
  assert.equal((await fresh.send('/api/preview/status')).body.authenticated, false)
})

test('admin and school preview cookies/stores never share mutations or authentication', async () => {
  const c = await bootstrap()
  const schoolResponse = await handlePreviewRequest(new Request('http://127.0.0.1:18475/api/preview/status'))
  const schoolCookie = schoolResponse.headers.get('set-cookie').split(';')[0]
  const mixed = client(`${c.cookie}; ${schoolCookie}; acting_school_id=school-preview-1; op-access-token=ignored`)
  assert.equal((await mixed.send('/api/auth/me')).body.user.role, 'admin')
  assert.deepEqual((await mixed.send('/api/school/info')).body, { school: null })
  await mixed.send('/api/auth/signout', 'POST')
  const schoolMe = await handlePreviewRequest(new Request('http://127.0.0.1:18475/api/auth/me', { headers: { cookie: schoolCookie } }))
  assert.equal(schoolMe.status, 200)
  assert.equal((await schoolMe.json()).user.role, 'school')
})

test('TTL is twelve hours, idle expiry does not auto-authenticate, capacity is bounded', async () => {
  assert.equal(SESSION_TTL_MS, 12 * 60 * 60 * 1000)
  assert.equal(MAX_SESSIONS, 128)
  const nativeNow = Date.now
  let now = nativeNow()
  Date.now = () => now
  try {
    const c = await bootstrap()
    now += SESSION_TTL_MS - 1
    assert.equal((await c.send('/api/auth/me')).status, 200)
    now += SESSION_TTL_MS
    assert.equal((await c.send('/api/auth/me')).status, 401)
    assert.equal((await c.send('/api/preview/status')).body.authenticated, false)
    store.clear()
    for (let i = 0; i < MAX_SESSIONS; i++) await bootstrap()
    const overflow = client()
    const response = await overflow.send('/api/preview/status')
    assert.equal(response.status, 503)
    assert.equal(response.headers.has('set-cookie'), false)
    assert.equal(store.size, 128)
    now += SESSION_TTL_MS
    assert.equal((await overflow.send('/api/preview/status')).status, 200)
    assert.equal(store.size, 1)
  } finally { Date.now = nativeNow }
})

test('loopback Host/Origin/forwarding guards reject cross-origin requests before session allocation', async () => {
  const invalid = [
    { url: 'http://example.com:18476/api/preview/status' },
    { headers: { host: 'example.com:18476' } },
    { headers: { host: 'localhost.evil:18476' } },
    { headers: { host: '127.0.0.1:18475' } },
    { headers: { host: '127.0.0.1:99999' } },
    { headers: { origin: 'https://example.com' } },
    { headers: { 'sec-fetch-site': 'cross-site' } },
    { headers: { 'sec-fetch-site': 'same-site' } },
    { headers: { 'x-forwarded-host': 'evil.test' } },
    { headers: { 'x-forwarded-proto': 'https' } },
    { headers: { 'x-forwarded-port': '18475' } },
    { headers: { forwarded: 'host=127.0.0.1:18476' } },
  ]
  for (const options of invalid) {
    const result = await client().send('/api/preview/status', 'GET', undefined, options)
    assert.equal(result.status, 403, JSON.stringify(options))
    assert.equal(result.headers.has('set-cookie'), false)
  }
  assert.equal(store.size, 0)
  const c = await bootstrap()
  for (const originHeader of [null, 'null', 'http://localhost:18476', 'http://127.0.0.1:18475']) {
    assert.equal((await c.send('/api/preview/reset', 'POST', undefined, { headers: { origin: originHeader } })).status, 403)
  }
  const reconstructed = await c.send('/api/preview/reset', 'POST', undefined, { url: 'http://localhost:18476/api/preview/reset', headers: { 'x-forwarded-host': '127.0.0.1:18476', 'x-forwarded-port': '18476', 'x-forwarded-proto': 'http' } })
  assert.equal(reconstructed.status, 200)
  const alias = client(c.cookie)
  assert.equal((await alias.send('/api/preview/status', 'GET', undefined, { url: 'http://localhost:18476/api/preview/status', headers: { host: 'localhost:18476' } })).body.authenticated, false)
})

test('unknown routes, invalid methods and unsupported features never fake success', async () => {
  const c = await bootstrap()
  const baseline = await snapshot(c)
  for (const route of ['/api/unknown', '/api/admin/accounts/x/extra', '/api/school/missing', '/api/auth/signup', '/api/admin/devices/reorder/extra']) assert.equal((await c.send(route)).status, 404)
  for (const [route, method, allow] of [['/api/admin/accounts', 'PUT', 'GET, POST'], ['/api/admin/accounts/a', 'PATCH', 'PUT, DELETE'], ['/api/admin/schools/1001', 'POST', 'GET, PUT, DELETE'], ['/api/school/info', 'HEAD', 'GET'], ['/api/preview/status', 'OPTIONS', 'GET']]) {
    const result = await c.send(route, method)
    assert.equal(result.status, 405)
    assert.equal(result.headers.get('allow'), allow)
    if (method === 'HEAD') assert.equal(result.body, null)
  }
  for (const [route, method] of [['/api/admin/devices/admin-preview-device-1/icon', 'POST'], ['/api/admin/devices/admin-preview-device-1/icon', 'DELETE'], ['/api/admin/school-linking?school_id=admin-preview-school-1', 'GET'], ['/api/admin/school-linking', 'POST'], ['/api/admin/school-linking?group_id=x', 'DELETE'], ['/api/admin/heart-rate-test/stream', 'GET'], ['/api/device/ingest', 'POST']]) assert.equal((await c.send(route, method)).status, 501)
  await acting(c)
  for (const [route, method] of [['/api/school/device-pages', 'POST'], ['/api/school/device-assets', 'POST'], ['/api/school/device-page-blocks/x/image', 'POST']]) assert.equal((await c.send(route, method)).status, 501)
  assert.deepEqual(await snapshot(c), baseline)
})

test('search/pagination and malformed payloads report explicit errors with UTF-8/no-store', async () => {
  const c = await bootstrap()
  const result = await c.send('/api/admin/school-details?search=샘플&page=2&pageSize=2')
  assert.equal(result.body.total, 3)
  assert.equal(result.body.items[0].index, 3)
  assert.equal(result.body.items[0].group_no, '1003')
  assert.equal((await c.send('/api/admin/school-details?school_name=중학교')).body.items[0].group_no, '1002')
  assert.equal((await c.send('/api/admin/accounts?page=2&pageSize=2')).body.items.length, 2)
  for (const query of ['page=0', 'page=abc', 'pageSize=-1', 'pageSize=1.5']) assert.equal((await c.send(`/api/admin/school-details?${query}`)).status, 400)
  assert.match(result.headers.get('content-type'), /charset=utf-8/)
  const baseline = await snapshot(c)
  assert.equal((await c.send('/api/admin/accounts', 'POST', {}, { rawBody: '{' })).status, 400)
  assert.equal((await c.send('/api/admin/accounts', 'POST', [])).status, 400)
  assert.equal((await c.send('/api/admin/accounts', 'POST', {}, { headers: { 'content-type': 'text/plain' } })).status, 415)
  assert.equal((await c.send('/api/admin/schools/1001', 'PUT', { recognition_key: 'MUST NOT SAVE' })).status, 400)
  assert.deepEqual(await snapshot(c), baseline)
})

test('serialized concurrent writes retain every valid mutation and release queue after failure', async () => {
  const c = await bootstrap()
  const results = await Promise.all(Array.from({ length: 6 }, (_, i) => c.send('/api/admin/accounts', 'POST', { username: `parallel_${i}`, password: 'preview-only', role: 'admin' })))
  assert(results.every(result => result.status === 201))
  assert.equal((await c.send('/api/admin/accounts?pageSize=100')).body.total, 11)
  const duplicate = await Promise.all([0, 1].map(() => c.send('/api/admin/accounts', 'POST', { username: 'same', password: 'preview-only', role: 'admin' })))
  assert.deepEqual(duplicate.map(result => result.status), [201, 409])
  await acting(c)
  const first = (await c.send(studentsPath)).body.students[0]
  const saved = await Promise.all([
    c.send(`/api/school/students/${first.id}`, 'PATCH', { name: 'Concurrent student' }),
    c.send('/api/admin/schools/1001', 'PUT', { name: 'Concurrent school' }),
  ])
  assert(saved.every(result => result.status === 200))
  assert.equal((await c.send(studentsPath)).body.students[0].name, 'Concurrent student')
  assert.equal((await c.send('/api/school/info')).body.school.name, 'Concurrent school')
})

test('runtime import closure is test-only, UTF-8 and has no network/production imports', () => {
  const root = path.resolve(__dirname, '../../..')
  const allowed = [path.join(root, 'admin-preview/api') + path.sep, path.join(root, 'school-preview/api') + path.sep]
  const visited = new Set()
  function inspect(filename) {
    if (visited.has(filename)) return
    visited.add(filename)
    assert(allowed.some(prefix => filename.startsWith(prefix)), filename)
    const bytes = readFileSync(filename)
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    assert.equal(source.includes('\uFFFD'), false)
    const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.ES2022, true)
    function visit(node) {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        const target = node.moduleSpecifier?.text
        if (target) {
          if (target === 'node:crypto') return
          assert(target.startsWith('.'), `${filename}: external import ${target}`)
          inspect(path.resolve(path.dirname(filename), `${target}.ts`))
        }
      }
      if (ts.isCallExpression(node)) {
        assert.notEqual(node.expression.kind, ts.SyntaxKind.ImportKeyword, 'Dynamic imports are forbidden.')
        const expression = node.expression.getText(ast)
        assert(!/(^|\.)(fetch|require|eval)$/.test(expression), `Network/dynamic execution: ${expression}`)
      }
      if (ts.isNewExpression(node)) assert(!['WebSocket', 'EventSource', 'XMLHttpRequest'].includes(node.expression.getText(ast)))
      ts.forEachChild(node, visit)
    }
    visit(ast)
  }
  inspect(path.resolve(__dirname, '../handler.ts'))
  assert(visited.has(path.join(root, 'school-preview/api/school-data.ts')))
  for (const file of readdirSync(path.resolve(__dirname, '..'))) if (file.endsWith('.ts')) inspect(path.resolve(__dirname, '..', file))
})
