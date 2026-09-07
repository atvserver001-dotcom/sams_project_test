/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const { Activity, ChartNoAxesCombined, HeartPulse, Package } = require('lucide-react')

const filename = join(__dirname, '../assigned-menu.ts')
const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: filename,
})
const loaded = new Module(filename, module)
loaded.paths = module.paths
loaded._compile(compiled.outputText, filename)
const { buildAssignedMenu } = loaded.exports

const now = new Date(2026, 8, 5, 12).getTime()
const heartRoute = '/school/heart-rate'
const expiredNotice = '이 항목의 이용 기간이 만료되었습니다.'
const content = (name = 'Heart Care', overrides = {}) => ({
  school_content_id: 'c1', name, is_unlimited: false, end_date: '2026-09-30', ...overrides,
})
const device = (device_name = '심박계', overrides = {}) => ({
  device_id: 'd1', device_name, limited_period: true, end_date: '2026-09-30', ...overrides,
})
function menu(contents = [], devices = [], at = now) {
  const notices = []
  const items = buildAssignedMenu(contents, devices, message => notices.push(message), at)
  return { items, notices }
}
function assertHeart(items, isExpired = false) {
  assert.equal(items.length, 1)
  assert.equal(items[0].label, 'Heart Care')
  assert.equal(items[0].href, heartRoute)
  assert.equal(items[0].icon, HeartPulse)
  assert.equal(items[0].expired, isExpired)
  // AppShell renders a link only for a destination that is not expired.
  assert.equal(Boolean(items[0].href && !items[0].expired), !isExpired)
}

test('content and device heart assignments produce one canonical functional item', () => {
  const { items, notices } = menu([content()], [device()])
  assertHeart(items)
  assert.equal(items[0].id, 'content-c1')
  assert.deepEqual(notices, [])
})

for (const source of ['content', 'device']) {
  test(`${source}-only heart assignment retains the canonical label and destination`, () => {
    const { items } = source === 'content' ? menu([content()]) : menu([], [device()])
    assertHeart(items)
    assert.equal(items[0].id, source === 'content' ? 'content-c1' : 'device-d1')
  })
}

for (const expiredSource of ['content', 'device']) {
  test(`expired ${expiredSource} cannot hide an available same-route assignment`, () => {
    const { items, notices } = menu(
      [content('Heart Care', { end_date: expiredSource === 'content' ? '2026-09-04' : '2026-09-30' })],
      [device('심박계', { end_date: expiredSource === 'device' ? '2026-09-04' : '2026-09-30' })],
    )
    assertHeart(items)
    items[0].onClick()
    assert.deepEqual(notices, ['준비 중입니다.'])
  })
}

test('all expired heart assignments retain one expired item and its notice', () => {
  const { items, notices } = menu(
    [content('Heart Care', { end_date: '2026-09-04' })],
    [device('심박계', { end_date: '2026-08-31' })],
  )
  assertHeart(items, true)
  items[0].onClick()
  assert.deepEqual(notices, [expiredNotice])
})

test('duplicates within either source and later expired entries keep any available access', () => {
  for (const source of ['content', 'device']) {
    const make = source === 'content' ? content : device
    const records = ['2026-09-04', '2026-09-30', '2026-08-31'].map((end_date, index) =>
      make('하트 케어', { school_content_id: `c${index}`, device_id: `d${index}`, end_date }),
    )
    assertHeart(source === 'content' ? menu(records).items : menu([], records).items)
    records[1].end_date = '2026-09-01'
    assertHeart(source === 'content' ? menu(records).items : menu([], records).items, true)
  }
})

test('no assignments and blank or placeholder assignments produce no functional entries', () => {
  assert.deepEqual(menu().items, [])
  assert.deepEqual(menu(['', ' \t ', ' - '].map(name => content(name)), ['', '-', '\n'].map(name => device(name))).items, [])
})

test('development-only JumpRope and BodyComposition entries are omitted without mutating assignments', () => {
  for (const label of ['JumpRope', 'Jump Rope', 'BodyComposition', 'Body Composition']) {
    const contents = Object.freeze([Object.freeze(content(label)), Object.freeze(content('Heart Care', { school_content_id: 'c2' }))])
    const devices = Object.freeze([Object.freeze(device(label, { end_date: '2020-01-01' }))])
    const before = structuredClone({ contents, devices })
    const { items, notices } = menu(contents, devices)
    assertHeart(items)
    assert.deepEqual(notices, [])
    assert.deepEqual({ contents, devices }, before)
  }
})

test('existing Korean heart aliases and whitespace variants resolve for both sources', () => {
  for (const alias of ['심박기록관리', '심박 기록 관리', '하트케어', '하트 케어', '심박계', 'ANT 심박계 장치']) {
    assertHeart(menu([content(alias)]).items)
    assertHeart(menu([], [device(alias)]).items)
  }
  for (const alias of ['HeartCare', 'Heart Care', 'Heart\tCare']) {
    assertHeart(menu([content(alias)]).items)
  }
})

test('existing exercise and PAPS mappings, labels, and icons remain unchanged', () => {
  const cases = [
    ['운동기록관리', '/school/exercises', Activity],
    ['운동 기록 관리', '/school/exercises', Activity],
    ['헬스케어', '/school/exercises', Activity],
    ['헬스 케어', '/school/exercises', Activity],
    ['PAPS기록관리', '/school/paps', ChartNoAxesCombined],
    ['PAPS 기록 관리', '/school/paps', ChartNoAxesCombined],
    ['PAPSCare', '/school/paps', ChartNoAxesCombined],
    ['PAPS Care', '/school/paps', ChartNoAxesCombined],
  ]
  for (const [label, href, icon] of cases) {
    for (const items of [menu([content(label)]).items, menu([], [device(label)]).items]) {
      assert.equal(items.length, 1)
      assert.equal(items[0].label, label)
      assert.equal(items[0].href, href)
      assert.equal(items[0].icon, icon)
      assert.equal(items[0].expired, false)
    }
  }
  for (const label of ['HealthCare', 'Health Care']) {
    const [item] = menu([content(label)]).items
    assert.equal(item.label, label)
    assert.equal(item.href, '/school/exercises')
    assert.equal(item.icon, Activity)
  }
})

test('English heart and health aliases remain content-only and matching stays case-sensitive', () => {
  const records = ['HeartCare', 'Heart Care', 'HealthCare', 'Health Care'].map((label, index) =>
    device(label, { device_id: `d${index}` }),
  )
  const { items, notices } = menu([content('heartcare'), content('healthcare', { school_content_id: 'c2' })], records)
  assert.equal(items.length, 6)
  assert.deepEqual(items.map(item => item.label), ['heartcare', 'healthcare', ...records.map(record => record.device_name)])
  for (const item of items) {
    assert.equal(item.href, undefined)
    assert.equal(item.icon, Package)
    item.onClick()
  }
  assert.deepEqual(notices, Array(6).fill('준비 중입니다.'))
})

test('other duplicate destinations consolidate without changing first label or route order', () => {
  const { items } = menu(
    [content('PAPS Care'), content('운동기록관리', { school_content_id: 'c2', end_date: '2026-09-04' }), content('Heart Care', { school_content_id: 'c3' })],
    [device('헬스케어'), device('PAPS기록관리', { device_id: 'd2' }), device('심박계', { device_id: 'd3' })],
  )
  assert.deepEqual(items.map(item => [item.id, item.label, item.href, item.expired]), [
    ['content-c1', 'PAPS Care', '/school/paps', false],
    ['content-c2', '운동기록관리', '/school/exercises', false],
    ['content-c3', 'Heart Care', heartRoute, false],
  ])
})

test('unknown entries remain separate with original labels, order, and per-entry notices', () => {
  const { items, notices } = menu(
    [content('준비 항목'), content('Heart Care', { school_content_id: 'c2' }), content('준비 항목', { school_content_id: 'c3', end_date: '2026-09-04' })],
    [device('준비 항목'), device('심박계', { device_id: 'd2' }), device('새 장치', { device_id: 'd3' })],
  )
  assert.deepEqual(items.map(item => [item.id, item.label]), [
    ['content-c1', '준비 항목'], ['content-c2', 'Heart Care'], ['content-c3', '준비 항목'],
    ['device-d1', '준비 항목'], ['device-d3', '새 장치'],
  ])
  for (const index of [0, 2, 3, 4]) {
    assert.equal(items[index].href, undefined)
    assert.equal(items[index].icon, Package)
    items[index].onClick()
  }
  assert.deepEqual(notices, ['준비 중입니다.', expiredNotice, '준비 중입니다.', '준비 중입니다.'])
})

test('overlapping aliases retain live exercise-before-heart-before-PAPS precedence', () => {
  assert.equal(menu([content('심박계 헬스케어')]).items[0].href, '/school/exercises')
  assert.equal(menu([], [device('심박계 PAPS Care')]).items[0].href, heartRoute)
  assert.equal(menu([content('Heart Care PAPS Care')]).items[0].href, heartRoute)
  assert.equal(menu([], [device('Heart Care PAPS Care')]).items[0].href, '/school/paps')
})

test('unlimited, missing, invalid, and future dates keep the original expiry behavior', () => {
  for (const end_date of [null, '', 'not-a-date', '2026-09-30']) {
    assertHeart(menu([content('Heart Care', { end_date })]).items)
    assertHeart(menu([], [device('심박계', { end_date })]).items)
  }
  assertHeart(menu([content('Heart Care', { is_unlimited: true, end_date: '2020-01-01' })]).items)
  assertHeart(menu([], [device('심박계', { limited_period: false, end_date: '2020-01-01' })]).items)
})

test('expiry still uses local end-of-day with a strict less-than comparison', () => {
  const end = new Date(2026, 8, 5, 23, 59, 59).getTime()
  for (const [at, isExpired] of [[end - 1, false], [end, false], [end + 1, true]]) {
    assertHeart(menu([content('Heart Care', { end_date: '2026-09-05' })], [], at).items, isExpired)
    assertHeart(menu([], [device('심박계', { end_date: '2026-09-05' })], at).items, isExpired)
  }
})

test('frozen assignment records stay immutable and repeated builds return fresh menu items', () => {
  const contents = Object.freeze([
    Object.freeze(content('Heart Care', { end_date: '2026-09-04' })),
    Object.freeze(content('원본 콘텐츠', { school_content_id: 'c2' })),
  ])
  const devices = Object.freeze([
    Object.freeze(device()),
    Object.freeze(device('원본 장치', { device_id: 'd2' })),
  ])
  const before = structuredClone({ contents, devices })
  const first = menu(contents, devices)
  const second = menu(contents, devices)
  assert.deepEqual({ contents, devices }, before)
  assert.notEqual(first.items[0], contents[0])
  assert.notEqual(first.items[0], second.items[0])
  first.items[0].label = 'changed output'
  first.items[0].expired = true
  assert.equal(second.items[0].label, 'Heart Care')
  assert.equal(second.items[0].expired, false)
  assert.deepEqual({ contents, devices }, before)
})

test('owned files strictly decode as UTF-8 and preserve literal Korean labels and notices', () => {
  for (const file of ['../layout.tsx', '../assigned-menu.ts', 'assigned-menu.test.cjs']) {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(join(__dirname, file)))
    assert.ok(!text.includes('\uFFFD'), file)
    if (file === '../layout.tsx') assert.ok(text.includes('일부 메뉴 조회 실패'))
    else {
      assert.ok(text.includes('심박기록관리'))
      assert.ok(text.includes(expiredNotice))
    }
  }
})
