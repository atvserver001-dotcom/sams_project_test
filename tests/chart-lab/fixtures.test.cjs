/* eslint-disable @typescript-eslint/no-require-imports */
require('../../src/lib/heart-rate/tests/register.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { SCENARIOS, LAB_YEAR, LAB_START, makeMonthlyRows, expectedMonthly, sampleAt, makeLabSession, advanceLab } = require('./fixtures.ts')
const { monthlySummary, hasRecord, MONTH_ORDER } = require('../../src/components/exercises/exercise-data.ts')
const { WINDOW_SEC, windowSamples, sessionResults, average } = require('../../src/lib/heart-rate/session.ts')

const fields = ['minutes', 'minutes_c1', 'minutes_c2', 'minutes_c3', 'avg_bpm', 'max_bpm', 'accuracy', 'calories']
const cutoff = new Date(2026, 2, 1)

// Independent scenario definition, never sampleAt or production accumulation.
function oracleSample(scenario, no, sec) {
  if (scenario === 'zero') return 0
  if (scenario === 'flat') return 130
  if (scenario === 'range') {
    const cycle = [30, 45, 60, 104, 131, 132, 158, 159, 185, 186, 200, 220, 240]
    return cycle[Math.trunc(sec / 5) % 13]
  }
  if (scenario === 'spike') {
    const position = sec - Math.trunc(sec / 60) * 60
    if (position === 15) return 45
    if (position === 45) return 220
    return 130
  }
  if (scenario === 'missing' && Math.trunc((sec % 60) / 10) === 2) return null
  if (scenario === 'disconnect' && sec > 59) return null
  const phase = sec + 3 * no
  return 110 + phase - Math.trunc(phase / 41) * 41
}

function accumulate(scenario, no, seconds) {
  const agg = { min: null, max: null, minSec: 0, maxSec: 0, sum: 0, n: 0, zoneSec: [0, 0, 0, 0, 0] }
  let lastReceipt = null
  let lastValue = null
  const tail = []
  for (let sec = 0; sec < seconds; sec++) {
    const value = oracleSample(scenario, no, sec)
    if (value !== null) { lastReceipt = sec; lastValue = value === 0 ? null : value }
    const bpm = value === 0 ? null : value
    if (bpm !== null) {
      agg.sum += bpm
      agg.n++
      if (agg.min === null || bpm < agg.min) { agg.min = bpm; agg.minSec = sec }
      if (agg.max === null || bpm > agg.max) { agg.max = bpm; agg.maxSec = sec }
      const zone = bpm < 104 ? 0 : bpm < 132 ? 1 : bpm < 159 ? 2 : bpm < 186 ? 3 : 4
      agg.zoneSec[zone]++
    }
    if (sec >= Math.max(0, seconds - 3000)) tail.push({ sec, bpm, min: bpm, max: bpm })
  }
  return {
    agg, tail, lastSeenAt: lastReceipt === null ? null : LAB_START + 1000 * lastReceipt,
    cur: lastReceipt === null || seconds - 1 - lastReceipt >= 5 ? null : lastValue,
  }
}

test('fixed year, stable scenario IDs, 30 synthetic participants, and fresh session state', () => {
  assert.equal(LAB_YEAR, 2025)
  assert.equal(new Date(LAB_START).toISOString(), '2025-09-05T03:00:00.000Z')
  assert.deepEqual(SCENARIOS.map(item => item.value), ['normal', 'missing', 'zero', 'spike', 'flat', 'range', 'disconnect'])
  assert.equal(new Set(SCENARIOS.map(item => item.label)).size, 7)
  const ids = new Set()
  for (const { value: scenario } of SCENARIOS) {
    const first = makeLabSession(scenario)
    const second = makeLabSession(scenario)
    assert.equal(first.id, `20250905-0000-4000-8000-00000000000${ids.size + 1}`)
    assert.deepEqual(first, second)
    assert.notEqual(first.students[0].buf, second.students[0].buf)
    assert.equal(first.lastSec, 119)
    assert.equal(first.startedAt, LAB_START)
    assert.equal(first.context.year, 2025)
    assert.equal(first.students.length, 30)
    assert.equal(first.context.students.length, 30)
    assert.equal(new Set(first.students.map(live => live.participant.device_id)).size, 30)
    first.students.forEach(({ participant }, index) => {
      assert.equal(participant.no, index + 1)
      assert.equal(participant.name, `검증 학생 ${String(index + 1).padStart(2, '0')}`)
      assert.equal(participant.age, 13)
    })
    ids.add(first.id)
  }
  assert.equal(ids.size, 7)
  const empty = makeLabSession('normal', 0)
  assert.equal(empty.lastSec, -1)
  assert.ok(empty.students.every(live => live.size === 0 && live.agg.n === 0))
})

for (const { value: scenario } of SCENARIOS) {
  test(`${scenario}: monthly shapes, category totals, academic order, and independent expected arithmetic`, () => {
    const rows = makeMonthlyRows(scenario)
    assert.equal(rows.length, 30)
    for (const [index, row] of rows.entries()) {
      assert.equal(row.student_no, index + 1)
      assert.equal(row.name, `검증 학생 ${String(index + 1).padStart(2, '0')}`)
      for (const field of fields) {
        assert.equal(row[field].length, 12)
        assert.ok(row[field].every(value => value === null || Number.isFinite(value)))
      }
      for (let month = 0; month < 12; month++) {
        const values = fields.map(field => row[field][month])
        if (row.minutes[month] === null) assert.ok(values.every(value => value === null))
        else {
          assert.ok(values.every(value => value !== null))
          assert.equal(row.minutes[month], row.minutes_c1[month] + row.minutes_c2[month] + row.minutes_c3[month])
          assert.ok(row.avg_bpm[month] <= row.max_bpm[month])
          assert.ok(row.accuracy[month] >= 0 && row.accuracy[month] <= 100)
        }
      }
    }
    const result = monthlySummary(rows, LAB_YEAR, cutoff)
    assert.deepEqual(result, expectedMonthly(scenario))
    assert.deepEqual(result.map(item => item.index), [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 0, 1])
    assert.deepEqual(result.map(item => item.calendarMonth), ['2025.03', '2025.04', '2025.05', '2025.06', '2025.07', '2025.08', '2025.09', '2025.10', '2025.11', '2025.12', '2026.01', '2026.02'])
    assert.deepEqual([...MONTH_ORDER], result.map(item => item.index))
    for (const month of result) if (month.minutes !== null) {
      assert.equal(month.minutes, month.minutes_c1 + month.minutes_c2 + month.minutes_c3)
    }
    rows[0].minutes[2] = -999
    assert.notEqual(makeMonthlyRows(scenario)[0].minutes[2], -999)
    assert.deepEqual(monthlySummary(makeMonthlyRows(scenario), LAB_YEAR, cutoff), expectedMonthly(scenario))
  })

  test(`${scenario}: 60 minutes match independent counts, extrema, zones, receipts, and bounded gap-aware ring`, () => {
    const session = makeLabSession(scenario, 3600)
    assert.equal(session.lastSec, 3599)
    assert.equal(WINDOW_SEC, 3000)
    const results = sessionResults(session)
    for (const live of session.students) {
      const no = live.participant.no
      const expected = accumulate(scenario, no, 3600)
      for (let sec = 0; sec < 3600; sec++) {
        const value = sampleAt(scenario, no, sec)
        assert.equal(value, oracleSample(scenario, no, sec))
        assert.ok(value === null || value === 0 || Number.isInteger(value) && value >= 30 && value <= 240)
      }
      assert.deepEqual(live.agg, expected.agg)
      assert.equal(live.agg.zoneSec.reduce((sum, value) => sum + value, 0), expected.agg.n)
      assert.equal(average(live), expected.agg.n ? Math.round(expected.agg.sum / expected.agg.n) : null)
      assert.equal(live.lastSeenAt, expected.lastSeenAt)
      assert.equal(live.lastSourceAt, expected.lastSeenAt)
      assert.equal(live.cur, expected.cur)
      assert.equal(live.buf.length, 3000)
      assert.equal(live.size, 3000)
      assert.equal(live.head, 600)
      const window = windowSamples(live)
      assert.deepEqual(window, expected.tail)
      assert.equal(window[0].sec, 600)
      assert.equal(window.at(-1).sec, 3599)
      const result = results.find(item => item.student_no === no)
      if (!expected.agg.n) assert.equal(result, undefined)
      else assert.deepEqual(result, {
        student_id: live.participant.id, student_no: no, name: live.participant.name,
        year: 2025, month: 9, avg_bpm: Math.round(expected.agg.sum / expected.agg.n * 10) / 10,
        min_bpm: expected.agg.min, max_bpm: expected.agg.max, record_count: expected.agg.n,
      })
    }
  })
}

test('monthly zero is present, missing has internal and partial gaps, and normal arithmetic is anchored', () => {
  const zeros = makeMonthlyRows('zero')
  for (const row of zeros) for (let index = 0; index < 12; index++) {
    assert.equal(hasRecord(row, index), true)
    assert.ok(fields.every(field => row[field][index] === 0))
  }
  const missing = makeMonthlyRows('missing')
  for (const row of missing) {
    assert.equal(hasRecord(row, 4), false)
    assert.equal(hasRecord(row, 8), false)
    assert.equal(hasRecord(row, 3), true)
    assert.equal(hasRecord(row, 5), true)
    assert.equal(hasRecord(row, 9), true)
  }
  assert.equal(missing.filter(row => hasRecord(row, 6)).length, 20)
  const march = monthlySummary(makeMonthlyRows('normal'), LAB_YEAR, cutoff)[0]
  assert.deepEqual(fields.map(field => march[field]), [180, 60, 90, 30, 116, 146, 82, 720])
  const july = monthlySummary(missing, LAB_YEAR, cutoff)[4]
  assert.deepEqual(fields.map(field => july[field]), [420, 110, 210, 100, 117.5, 145, 85.5, 1680])
})

test('120-second scenarios expose gaps, no-contact zero, spikes, flat values, valid range boundaries, and disconnect', () => {
  assert.equal(sampleAt('missing', 1, 19), oracleSample('normal', 1, 19))
  assert.equal(sampleAt('missing', 1, 20), null)
  assert.equal(sampleAt('missing', 1, 29), null)
  assert.equal(sampleAt('missing', 1, 30), oracleSample('normal', 1, 30))
  assert.equal(sampleAt('spike', 1, 15), 45)
  assert.equal(sampleAt('spike', 1, 45), 220)
  const range = Array.from({ length: 120 }, (_, sec) => sampleAt('range', 1, sec))
  assert.equal(Math.min(...range), 30)
  assert.equal(Math.max(...range), 240)
  const counts = { normal: 120, missing: 100, zero: 0, spike: 120, flat: 120, range: 120, disconnect: 60 }
  for (const [scenario, count] of Object.entries(counts)) {
    const session = makeLabSession(scenario)
    assert.ok(session.students.every(live => live.agg.n === count && live.size === 120))
  }
  const zero = makeLabSession('zero').students[0]
  assert.equal(zero.lastSeenAt, LAB_START + 119000)
  assert.equal(zero.cur, null)
  assert.equal(zero.agg.min, null)
  assert.equal(zero.agg.max, null)
  assert.equal(zero.agg.sum, 0)
  assert.ok(windowSamples(zero).every(point => point.bpm === null))
  const disconnected = makeLabSession('disconnect').students[0]
  assert.equal(disconnected.lastSeenAt, LAB_START + 59000)
  assert.equal(disconnected.cur, null)
  assert.equal(disconnected.agg.n, 60)
  assert.ok(windowSamples(disconnected).slice(60).every(point => point.bpm === null))
})

test('incremental advance is inclusive, idempotent, and preserves session identity and focus references', () => {
  for (const { value: scenario } of SCENARIOS) {
    const session = makeLabSession(scenario, 0)
    const id = session.id
    const students = session.students
    const selected = session.students[9]
    const buffer = selected.buf
    advanceLab(session, scenario, 0)
    assert.equal(session.lastSec, 0)
    assert.equal(selected.size, 1)
    for (const through of [19, 24, 29, 59, 64, 119]) advanceLab(session, scenario, through)
    assert.deepEqual(session, makeLabSession(scenario, 120))
    advanceLab(session, scenario, 119)
    advanceLab(session, scenario, 0)
    assert.deepEqual(session, makeLabSession(scenario, 120))
    advanceLab(session, scenario, 179)
    assert.deepEqual(session, makeLabSession(scenario, 180))
    assert.equal(session.id, id)
    assert.equal(session.students, students)
    assert.equal(session.students[9], selected)
    assert.equal(selected.buf, buffer)
  }
})

test('five-second missing receipt timeout and gap recovery never synthesize held measurements', () => {
  const session = makeLabSession('missing', 20)
  const live = session.students[0]
  advanceLab(session, 'missing', 23)
  assert.notEqual(live.cur, null)
  assert.equal(live.agg.n, 20)
  advanceLab(session, 'missing', 24)
  assert.equal(live.cur, null)
  assert.equal(live.lastSeenAt, LAB_START + 19000)
  advanceLab(session, 'missing', 30)
  assert.equal(live.agg.n, 21)
  assert.equal(live.cur, sampleAt('normal', 1, 30))
  assert.ok(windowSamples(live).slice(20, 30).every(point => point.bpm === null))
})

test('owned fixture files are valid UTF-8 and retain the literal synthetic Korean names', () => {
  for (const file of ['fixtures.ts', 'fixtures.test.cjs', 'README-fixtures.md']) {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(join(__dirname, file)))
    assert.ok(!text.includes('\uFFFD'))
    if (file !== 'README-fixtures.md') assert.ok(text.includes('검증 학생 '))
  }
})
