require('./register.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { handlePreviewRequest } = require('../handler.ts')
const origin = 'http://127.0.0.1:18575'
const scope = { year: 2026, grade: 1, class_no: 1 }
const list = '/api/school/students?year=2026&grade=1&class_no=1'
function client() {
  let cookie = ''
  return async (path, method = 'GET', data) => {
    const response = await handlePreviewRequest(new Request(origin + path, {
      method, headers: { cookie, origin, 'content-type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data),
    }))
    cookie = response.headers.get('set-cookie')?.split(';')[0] || cookie
    return { status: response.status, data: await response.json(), headers: response.headers }
  }
}
const payload = (student, changes = {}) => ({ ...scope, id: student.id, source_student_no: student.student_no,
  student_no: student.student_no, name: student.name, gender: null, birth_date: null, email: null,
  height_cm: null, weight_kg: null, notes: null, ...changes })

test('save-slot exact route keeps method, origin and auth guards', async () => {
  const request = client()
  assert.equal((await request('/api/school/students/save-slot')).status, 405)
  const response = await handlePreviewRequest(new Request(origin + '/api/school/students/save-slot', { method: 'POST' }))
  assert.equal(response.status, 403)
  await request('/api/auth/signout', 'POST')
  assert.equal((await request('/api/school/students/save-slot', 'POST', {})).status, 401)
})

test('occupied swap is atomic and exercise records stay with student IDs', async () => {
  const request = client()
  const [one, two] = (await request(list)).data.students
  const before = (await request('/api/school/exercises?year=2026&grade=1&class_no=1&category_type=all')).data.rows
  const response = await request('/api/school/students/save-slot', 'POST', payload(one, { student_no: 2, name: '번호 교환 학생', height_cm: 150.25 }))
  assert.equal(response.status, 200)
  assert.equal(response.data.student.id, one.id)
  const after = (await request(list)).data.students
  assert.equal(after.find(s => s.id === one.id).student_no, 2)
  assert.equal(after.find(s => s.id === two.id).student_no, 1)
  assert.equal(new Set(after.map(s => s.student_no)).size, 30)
  const records = (await request('/api/school/exercises?year=2026&grade=1&class_no=1&category_type=all')).data.rows
  assert.deepEqual(records.find(s => s.student_id === one.id).minutes, before.find(s => s.student_id === one.id).minutes)
  assert.deepEqual(records.find(s => s.student_id === two.id).minutes, before.find(s => s.student_id === two.id).minutes)
})

test('create, same-slot upsert, empty-source relocation and delete preserve IDs and isolation', async () => {
  const request = client(), other = client()
  const beforeOther = (await other(list)).data
  const one = (await request(list)).data.students[0]
  const upsert = await request('/api/school/students/save-slot', 'POST', payload(one, { id: '', name: '같은 슬롯' }))
  assert.equal(upsert.data.student.id, one.id)
  const last = (await request(list)).data.students.at(-1)
  await request('/api/school/students/' + last.id, 'DELETE')
  const moved = await request('/api/school/students/save-slot', 'POST', payload(one, { id: '', source_student_no: 30, name: '빈 슬롯에서 생성' }))
  assert.equal(moved.status, 200)
  assert.notEqual(moved.data.student.id, one.id)
  assert.equal((await request(list)).data.students.find(s => s.id === one.id).student_no, 30)
  assert.equal((await request('/api/school/students/' + moved.data.student.id, 'DELETE')).status, 200)
  const fresh = await request('/api/school/students/save-slot', 'POST', payload(one, { id: '', source_student_no: 1, student_no: 1, name: '신규 학생' }))
  assert.equal(fresh.status, 200)
  assert.equal((await request(list)).data.students.length, 30)
  assert.deepEqual((await other(list)).data, beforeOther)
})

test('failed validation/source collision never partially mutates the class', async () => {
  const request = client()
  const before = (await request(list)).data
  const one = before.students[0]
  for (const [changes, status] of [[{ id: '', source_student_no: 2 }, 409], [{ student_no: 31 }, 400],
    [{ id: 'foreign' }, 400], [{ height_cm: 'bad' }, 400], [{ name: '' }, 400]]) {
    assert.equal((await request('/api/school/students/save-slot', 'POST', payload(one, changes))).status, status)
    assert.deepEqual((await request(list)).data, before)
  }
})
