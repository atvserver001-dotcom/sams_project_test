/* eslint-disable @typescript-eslint/no-require-imports */
require('../../src/lib/heart-rate/tests/register.cjs')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { installPreviewTransport } = require('./transport.ts')
const { HeartRateBridge } = require('../../src/lib/heart-rate/bridge.ts')
const { sessionResults } = require('../../src/lib/heart-rate/session.ts')

const ENDPOINT = 'ws://localhost:8888'
const STORAGE_KEY = 'sams-school-preview:heart-fit-transport:v1'
const START = Date.parse('2026-09-05T00:00:00Z')
const classData = (prefix = 'preview') => ({ grade: 1, class_no: 2,
  students: Array.from({ length: 30 }, (_, index) => ({ id: `${prefix}-${index + 1}`, no: index + 1,
    name: `${prefix} student ${index + 1}`, device_id: String(31482 + index).padStart(7, '0') })) })
const context = (data = classData()) => ({ schoolId: 'preview-school', year: 2026, grade: data.grade,
  class_no: data.class_no, schoolType: 2, students: data.students.map(student => ({ ...student, age: 13, estimatedAge: false })) })
const flush = () => new Promise(resolve => setImmediate(resolve))

class MemoryStorage {
  values = new Map()
  get length() { return this.values.size }
  key(index) { return [...this.values.keys()][index] ?? null }
  getItem(key) { return this.values.get(key) ?? null }
  setItem(key, value) { this.values.set(key, String(value)) }
  removeItem(key) { this.values.delete(key) }
}

// Run the real bridge against a browser-like clock without opening ports or contacting devices.
function environment(t, sessionStorage = new MemoryStorage(), options, start = START) {
  let now = start
  let nextId = 0
  const jobs = new Map()
  const schedule = (callback, delay = 0, interval = false) => {
    const id = ++nextId
    jobs.set(id, { callback, at: now + delay, interval: interval ? delay : 0 })
    return id
  }
  t.mock.method(global, 'setTimeout', (callback, delay) => schedule(callback, delay))
  t.mock.method(global, 'setInterval', (callback, delay) => schedule(callback, delay, true))
  t.mock.method(global, 'clearTimeout', id => jobs.delete(id))
  t.mock.method(global, 'clearInterval', id => jobs.delete(id))
  t.mock.method(Date, 'now', () => now)
  const nativeCalls = []
  class NativeSocket extends EventTarget {
    static CONNECTING = 0
    static OPEN = 1
    static CLOSING = 2
    static CLOSED = 3
    readyState = 0
    constructor(...args) { super(); nativeCalls.push(args); this.url = String(args[0]) }
    close() { this.readyState = 3 }
  }
  const window = Object.assign(new EventTarget(), { sessionStorage,
    location: { assign: () => assert.fail('The simulation must never launch fitness-bridge') } })
  const replacements = { window, WebSocket: NativeSocket, localStorage: new MemoryStorage() }
  if (!global.CloseEvent) replacements.CloseEvent = class CloseEvent extends Event {
    constructor(type, options) { super(type); Object.assign(this, options) }
  }
  const restoreGlobals = []
  const finalizers = []
  for (const [key, value] of Object.entries(replacements)) {
    const descriptor = Object.getOwnPropertyDescriptor(global, key)
    Object.defineProperty(global, key, { configurable: true, writable: true, value })
    restoreGlobals.push(() => {
      if (descriptor) Object.defineProperty(global, key, descriptor)
      else delete global[key]
    })
  }
  Object.defineProperty(window, 'WebSocket', { get: () => global.WebSocket, set: value => { global.WebSocket = value } })
  t.mock.method(global, 'fetch', async () => assert.fail('Unexpected network request'))
  const cleanup = installPreviewTransport(options)
  t.after(() => {
    for (const finalize of finalizers.reverse()) finalize()
    cleanup()
    for (const restore of restoreGlobals) restore()
  })
  function tick(ms = 0) {
    const end = now + ms
    for (;;) {
      const next = [...jobs].filter(([, job]) => job.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0]
      if (!next) break
      const [id, job] = next
      now = job.at
      if (job.interval) job.at += job.interval
      else jobs.delete(id)
      job.callback()
    }
    now = end
  }
  function open(data = classData(), start = true) {
    const socket = new WebSocket(ENDPOINT)
    const messages = []
    socket.addEventListener('message', event => messages.push(JSON.parse(event.data)))
    socket.onopen = () => {
      socket.send(JSON.stringify({ command: 'set_class_data', data }))
      if (start) socket.send(JSON.stringify({ command: 'start_session' }))
    }
    tick()
    return { socket, messages }
  }
  return { window, nativeCalls, NativeSocket, cleanup, tick, open, jobs, sessionStorage, after: callback => finalizers.push(callback) }
}

const samples = messages => messages.filter(message => message.type === 'data')
const results = messages => messages.filter(message => message.type === 'session_result')
const stop = socket => socket.send(JSON.stringify({ command: 'stop_session' }))

test('installation is synchronous and only the exact Heart Fit endpoint is intercepted', t => {
  const env = environment(t)
  const Constructor = WebSocket
  assert.notEqual(Constructor, env.NativeSocket)
  assert.deepEqual(['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].map(key => Constructor[key]), [0, 1, 2, 3])
  for (const url of [ENDPOINT, `${ENDPOINT}/`, new URL(ENDPOINT)]) {
    const socket = new WebSocket(url)
    assert.ok(socket instanceof WebSocket)
    assert.ok(socket instanceof EventTarget)
    assert.equal(socket.readyState, WebSocket.CONNECTING)
    assert.equal(socket.url, `${ENDPOINT}/`)
  }
  assert.equal(env.nativeCalls.length, 0)
  const protocols = ['hmr', 'next']
  const urls = ['ws://127.0.0.1:18476/_next/webpack-hmr', 'ws://localhost:18476/_next/webpack-hmr',
    'wss://preview.example/_next/webpack-hmr', 'ws://localhost:8888/_next/webpack-hmr',
    'ws://localhost:8888?other=true', 'ws://127.0.0.1:8888', 'wss://localhost:8888']
  for (const url of urls) {
    const socket = new WebSocket(url, protocols)
    assert.ok(socket instanceof env.NativeSocket)
    assert.ok(socket instanceof WebSocket)
  }
  assert.deepEqual(env.nativeCalls, urls.map(url => [url, protocols]))
  env.cleanup()
  assert.equal(WebSocket, env.NativeSocket)
  assert.equal(env.jobs.size, 0)
  assert.equal(new Constructor(ENDPOINT).readyState, 3, 'retained constructors stay synthetic after disposal')
  assert.equal(env.nativeCalls.length, urls.length)
})

test('the exact class/start protocol emits deterministic one-second data and accurate scoped results', t => {
  const env = environment(t)
  const data = classData()
  const { socket, messages } = env.open(data, false)
  env.tick(3000)
  assert.equal(samples(messages).length, 0)
  assert.equal(messages.at(-1).sessionActive, false)
  socket.send(JSON.stringify({ command: 'start_session' }))
  env.tick(999)
  assert.equal(samples(messages).length, 0)
  env.tick(1)
  assert.equal(samples(messages).length, 30)
  env.tick(11000)
  assert.equal(samples(messages).length, 360)
  assert.equal(messages.findLast(message => message.type === 'status').sessionActive, true)
  for (const item of samples(messages)) {
    assert.ok(['ant_heartrate', 'ble_heartrate'].includes(item.dataType))
    assert.ok(Number.isInteger(item.data.heartRate) && item.data.heartRate >= 30 && item.data.heartRate <= 240)
    assert.ok(Number.isFinite(Date.parse(item.data.timestamp)))
    assert.ok(item.data.battery >= 0 && item.data.battery <= 100)
  }
  stop(socket)
  assert.equal(results(messages).length, 0, 'result delivery must be asynchronous')
  env.tick()
  assert.equal(results(messages).length, 1)
  assert.equal(messages.findLast(message => message.type === 'status').sessionActive, false)
  const rows = results(messages)[0].data
  assert.equal(rows.length, 30)
  for (const student of data.students) {
    const values = samples(messages).filter(item => item.data.deviceId === student.device_id).map(item => item.data.heartRate)
    assert.deepEqual(rows.find(row => row.student_no === student.no), {
      student_id: student.id, student_no: student.no, name: student.name,
      year: new Date(START).getFullYear(), month: new Date(START).getMonth() + 1,
      avg_bpm: Math.round(values.reduce((a, b) => a + b, 0) / values.length * 10) / 10,
      min_bpm: Math.min(...values), max_bpm: Math.max(...values), record_count: values.length,
    })
  }
  const before = samples(messages).length
  stop(socket)
  env.tick(20000)
  assert.equal(samples(messages).length, before)
  assert.equal(results(messages).length, 1)
  assert.equal(env.jobs.size, 0)
  socket.send(JSON.stringify({ command: 'start_session' }))
  env.tick(1000)
  assert.deepEqual(samples(messages).slice(-30).map(item => item.data.heartRate), samples(messages).slice(0, 30).map(item => item.data.heartRate))
  stop(socket)
  env.tick()
  assert.ok(results(messages).at(-1).data.every(row => row.record_count === 1))
})

test('stop before the first sample produces an empty result and no later samples', t => {
  const env = environment(t)
  const { socket, messages } = env.open()
  stop(socket)
  env.tick(20000)
  assert.deepEqual(results(messages), [{ type: 'session_result', data: [] }])
  assert.equal(samples(messages).length, 0)
  assert.equal(env.jobs.size, 0)
})

test('missing identities, sensors and ambiguous mappings never manufacture participant results', t => {
  const env = environment(t)
  const data = classData()
  data.students[0].device_id = ''
  data.students[1].device_id = '   '
  data.students[2].id = ''
  data.students[3].device_id = '00:ab-CD'
  data.students[4].device_id = '00ab-cd'
  data.students[5].id = data.students[6].id
  const { socket, messages } = env.open(data)
  env.tick(1000)
  assert.equal(samples(messages).length, 23)
  stop(socket)
  env.tick()
  assert.deepEqual(results(messages)[0].data.map(row => row.student_no), Array.from({ length: 23 }, (_, index) => index + 8))
  const missing = classData('missing')
  missing.students.forEach(student => { student.device_id = '' })
  const empty = env.open(missing)
  env.tick(2000)
  stop(empty.socket)
  env.tick()
  assert.equal(samples(empty.messages).length, 0)
  assert.deepEqual(results(empty.messages)[0].data, [])
})

test('closed sockets cancel opening, queued results and sample timers', t => {
  const env = environment(t)
  const unopened = new WebSocket(ENDPOINT)
  let opens = 0, closes = 0
  unopened.onopen = () => { opens++ }
  unopened.onclose = event => { closes++; assert.equal(event.code, 1000) }
  assert.throws(() => unopened.send('{}'), { name: 'InvalidStateError' })
  unopened.close()
  assert.equal(unopened.readyState, WebSocket.CLOSING)
  env.tick(1000)
  assert.equal(opens, 0)
  assert.equal(closes, 1)
  assert.equal(unopened.readyState, WebSocket.CLOSED)
  const { socket, messages } = env.open()
  env.tick(1000)
  stop(socket)
  socket.close()
  socket.send(JSON.stringify({ command: 'start_session' }))
  env.tick(20000)
  assert.equal(samples(messages).length, 30)
  assert.equal(results(messages).length, 0)
  assert.equal(env.jobs.size, 0)
})

test('disconnect and reload resume only matching class data without phantom offline samples', t => {
  const env = environment(t)
  const original = env.open()
  env.tick(3000)
  original.socket.close()
  env.tick(10000)
  assert.equal(env.jobs.size, 0)
  const checkpoint = JSON.parse(env.sessionStorage.getItem(STORAGE_KEY))
  assert.equal(checkpoint.active, true)
  assert.equal(checkpoint.step, 3)
  env.cleanup()
  const cleanupReload = installPreviewTransport()
  env.after(cleanupReload)
  const resumed = env.open(classData(), false)
  assert.equal(resumed.messages.at(-1).sessionActive, true)
  env.tick(2000)
  stop(resumed.socket)
  env.tick()
  assert.equal(samples(resumed.messages).length, 60)
  assert.ok(results(resumed.messages)[0].data.every(row => row.record_count === 5))
  const allSamples = [...samples(original.messages), ...samples(resumed.messages)]
  for (const row of results(resumed.messages)[0].data) {
    const values = allSamples.filter(item => item.data.deviceId === classData().students[row.student_no - 1].device_id).map(item => item.data.heartRate)
    assert.equal(row.avg_bpm, Math.round(values.reduce((sum, value) => sum + value, 0) / 5 * 10) / 10)
    assert.equal(row.min_bpm, Math.min(...values))
    assert.equal(row.max_bpm, Math.max(...values))
  }
  cleanupReload()
  const cleanupStopped = installPreviewTransport()
  env.after(cleanupStopped)
  const stopped = env.open(classData(), false)
  env.tick(2000)
  assert.equal(stopped.messages.at(-1).sessionActive, false)
  assert.equal(samples(stopped.messages).length, 0)
})

test('a different participant roster cannot resume or stop another class session', t => {
  const env = environment(t)
  const first = env.open()
  env.tick(2000)
  const second = env.open(classData('other-school'), false)
  assert.equal(second.messages.at(-1).sessionActive, false)
  env.tick(2000)
  assert.equal(samples(first.messages).length, 60)
  assert.equal(samples(second.messages).length, 0)
  second.socket.send(JSON.stringify({ command: 'start_session' }))
  stop(first.socket)
  env.tick(1000)
  stop(second.socket)
  env.tick()
  assert.equal(results(first.messages).length, 0)
  assert.ok(results(second.messages)[0].data.every(row => row.student_id.startsWith('other-school-') && row.record_count === 1))
})

test('multiple sockets share one sampling clock and cleanup is reference-counted and idempotent', t => {
  const env = environment(t)
  const constructor = WebSocket
  const secondCleanup = installPreviewTransport()
  assert.equal(WebSocket, constructor)
  const first = env.open()
  const second = env.open(classData(), false)
  assert.equal([...env.jobs.values()].filter(job => job.interval).length, 1)
  env.tick(2000)
  assert.equal(samples(first.messages).length, 60)
  assert.deepEqual(samples(first.messages), samples(second.messages))
  first.socket.close()
  env.tick(1000)
  assert.equal(samples(second.messages).length, 90)
  env.cleanup()
  env.cleanup()
  assert.equal(WebSocket, constructor)
  secondCleanup()
  assert.equal(WebSocket, env.NativeSocket)
  assert.equal(second.socket.readyState, WebSocket.CLOSED)
  assert.equal(env.jobs.size, 0)
  env.tick(10000)
  assert.equal(samples(second.messages).length, 90)
})

test('StrictMode cleanup before open cancels callbacks and allows immediate reinstall', t => {
  const env = environment(t)
  const pending = new WebSocket(ENDPOINT)
  pending.onopen = () => assert.fail('An uninstalled transport cannot finish opening')
  pending.onclose = () => assert.fail('Teardown cannot trigger the bridge launch/retry path')
  env.cleanup()
  assert.equal(pending.readyState, WebSocket.CLOSED)
  assert.equal(env.jobs.size, 0)
  const cleanup = installPreviewTransport()
  env.after(cleanup)
  const { socket, messages } = env.open()
  env.tick(1000)
  assert.equal(samples(messages).length, 30)
  stop(socket)
  env.tick()
  assert.ok(results(messages)[0].data.every(row => row.record_count === 1))
  assert.equal(env.nativeCalls.length, 0)
})

test('stopping during a sample callback prevents the rest of that tick from emitting', t => {
  const env = environment(t)
  const { socket, messages } = env.open()
  socket.onmessage = event => { if (JSON.parse(event.data).type === 'data') stop(socket) }
  env.tick(10000)
  assert.equal(samples(messages).length, 1)
  assert.equal(results(messages)[0].data.length, 1)
  assert.equal(results(messages)[0].data[0].record_count, 1)
  assert.equal(env.jobs.size, 0)
})

test('malformed commands and corrupt/unavailable preview storage are safe', t => {
  const env = environment(t)
  env.sessionStorage.setItem(STORAGE_KEY, '{bad json')
  const { socket, messages } = env.open()
  for (const value of ['{', 'null', '[]', '{"command":"start_unknown"}', '{"command":"set_class_data","data":null}',
    '{"command":"set_class_data","data":{"students":[null]}}']) assert.doesNotThrow(() => socket.send(value))
  socket.send(new Uint8Array([1]))
  env.tick(1000)
  assert.equal(samples(messages).length, 30)
  env.cleanup()
  Object.defineProperty(env.window, 'sessionStorage', { configurable: true, get() { throw new Error('Storage denied') } })
  const cleanup = installPreviewTransport()
  env.after(cleanup)
  const restricted = env.open()
  env.tick(1000)
  stop(restricted.socket)
  env.tick()
  assert.ok(results(restricted.messages)[0].data.every(row => row.record_count === 1))
})

test('the unchanged production bridge connects, restores and saves exact simulated aggregates once', async t => {
  const env = environment(t)
  const posts = []
  t.mock.method(global, 'fetch', async (url, options) => {
    posts.push({ url, body: JSON.parse(options.body) })
    return { ok: true, json: async () => ({ success: true }) }
  })
  const bridge = new HeartRateBridge()
  env.after(() => bridge.dispose())
  bridge.begin(context())
  const connected = bridge.connect(true)
  env.tick()
  assert.equal(await connected, true)
  env.tick(3000)
  assert.equal(bridge.sessionActive, true)
  assert.ok(bridge.session.students.every(student => student.agg.n === 3))
  const sessionId = bridge.session.id
  bridge.dispose()
  env.cleanup()
  const cleanupReload = installPreviewTransport()
  env.after(cleanupReload)
  const restored = new HeartRateBridge()
  env.after(() => restored.dispose())
  restored.restore('preview-school')
  const reconnected = restored.connect(true)
  env.tick()
  assert.equal(await reconnected, true)
  env.tick(2000)
  assert.equal(restored.session.id, sessionId)
  assert.ok(restored.session.students.every(student => student.agg.n === 5))
  const expected = sessionResults(restored.session)
  restored.stop()
  assert.equal(restored.saveState, 'waiting')
  assert.equal(posts.length, 0)
  env.tick()
  await flush()
  env.tick(20000)
  assert.equal(restored.saveState, 'saved', 'late stop deadline must not override save success')
  assert.equal(restored.sessionActive, false)
  assert.deepEqual(posts, [{ url: '/api/school/heart-rate', body: { results: expected, grade: 1, class_no: 2, year: 2026 } }])
  assert.equal(env.nativeCalls.length, 0)
  assert.equal(env.jobs.size, 0)
})

test('the production bridge handles an immediate empty stop without posting or timing out', async t => {
  const env = environment(t)
  const bridge = new HeartRateBridge()
  env.after(() => bridge.dispose())
  bridge.begin(context())
  const connected = bridge.connect(true)
  env.tick()
  await connected
  bridge.stop()
  env.tick(20000)
  assert.equal(bridge.saveState, 'empty')
  assert.equal(bridge.session.students.every(student => student.agg.n === 0), true)
  assert.equal(env.nativeCalls.length, 0)
  assert.equal(env.jobs.size, 0)
})

test('result rows use the measurement calendar year while the save envelope keeps the roster year', async t => {
  const env = environment(t)
  const posts = []
  t.mock.method(global, 'fetch', async (_url, options) => {
    posts.push(JSON.parse(options.body))
    return { ok: true, json: async () => ({ success: true }) }
  })
  const bridge = new HeartRateBridge()
  env.after(() => bridge.dispose())
  bridge.begin({ ...context(), year: 2025 })
  const connected = bridge.connect(true)
  env.tick()
  await connected
  env.tick(1000)
  bridge.stop()
  env.tick()
  await flush()
  assert.equal(posts[0].year, 2025)
  assert.ok(posts[0].results.every(row => row.year === 2026 && row.month === new Date(START).getMonth() + 1))
  assert.deepEqual(posts[0].results, sessionResults(bridge.session))
})

test('logical academic year is captured only at start and never changes the real sample clock', t => {
  let selected = 2026, calls = 0
  const env = environment(t, undefined, { academicYear: () => { calls++; return selected } })
  const { socket, messages } = env.open(classData(), false)
  assert.equal(calls, 0)
  selected = 2025
  socket.send(JSON.stringify({ command: 'start_session' }))
  selected = 2026
  env.tick(2000)
  const saved = JSON.parse(env.sessionStorage.getItem(STORAGE_KEY))
  assert.equal(saved.startedAt, START)
  assert.equal(saved.academicYear, 2025)
  assert.equal(calls, 1)
  assert.equal(samples(messages)[0].data.timestamp, new Date(START + 1000).toISOString())
  assert.equal(samples(messages).at(-1).data.timestamp, new Date(START + 2000).toISOString())
  stop(socket)
  env.tick()
  assert.ok(results(messages)[0].data.every(row => row.year === 2025 && row.month === 9 && row.record_count === 2))
  socket.send(JSON.stringify({ command: 'start_session' }))
  env.tick(1000)
  stop(socket)
  env.tick()
  assert.equal(calls, 2)
  assert.ok(results(messages)[1].data.every(row => row.year === 2026 && row.record_count === 1))
})

test('logical report years roll forward only for real January and February start months', async t => {
  for (const [academicYear, month, year] of [[2025, 1, 2026], [2026, 2, 2027], [2025, 3, 2025], [2026, 9, 2026]]) {
    await t.test(`${academicYear} academic year, month ${month}`, t => {
      const start = new Date(2026, month - 1, 5, 12).getTime()
      const env = environment(t, undefined, { academicYear: () => academicYear }, start)
      const { socket, messages } = env.open()
      env.tick(1000)
      stop(socket)
      env.tick()
      assert.ok(results(messages)[0].data.every(row => row.year === year && row.month === month))
      assert.equal(samples(messages)[0].data.timestamp, new Date(start + 1000).toISOString())
    })
  }
})

test('unsupported or absent academic year options fall back to the real calendar on a new start', t => {
  let selected = 2025
  const env = environment(t, undefined, { academicYear: () => selected })
  const { socket, messages } = env.open()
  env.tick(1000)
  stop(socket)
  env.tick()
  for (const value of [undefined, 2024, 2027, 2025.5, '2025', null, NaN]) {
    selected = value
    socket.send(JSON.stringify({ command: 'start_session' }))
    env.tick(1000)
    stop(socket)
    env.tick()
    assert.ok(results(messages).at(-1).data.every(row => row.year === new Date(START).getFullYear()))
    assert.equal(Object.hasOwn(JSON.parse(env.sessionStorage.getItem(STORAGE_KEY)), 'academicYear'), false)
  }
})

test('matching-class resume preserves captured academic year without consulting the new callback', t => {
  const env = environment(t, undefined, { academicYear: () => 2025 })
  const original = env.open()
  env.tick(2000)
  original.socket.close()
  env.tick()
  env.cleanup()
  const cleanupReload = installPreviewTransport({ academicYear: () => assert.fail('Resume must keep the captured year') })
  env.after(cleanupReload)
  const resumed = env.open(classData(), false)
  assert.equal(resumed.messages.at(-1).sessionActive, true)
  env.tick(1000)
  stop(resumed.socket)
  env.tick()
  assert.ok(results(resumed.messages)[0].data.every(row => row.year === 2025 && row.record_count === 3))
  assert.equal(JSON.parse(env.sessionStorage.getItem(STORAGE_KEY)).startedAt, START)
})

test('legacy checkpoints preserve calendar behavior and invalid persisted academic years are rejected', t => {
  const env = environment(t)
  env.open()
  env.tick(1000)
  env.cleanup()
  const legacy = JSON.parse(env.sessionStorage.getItem(STORAGE_KEY))
  assert.equal(Object.hasOwn(legacy, 'academicYear'), false)
  for (const value of [undefined, 2024, 2027, '2025', null, 2025.5]) {
    env.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...legacy, academicYear: value }))
    const cleanup = installPreviewTransport({ academicYear: () => 2025 })
    env.after(cleanup)
    const resumed = env.open(classData(), false)
    assert.equal(resumed.messages.at(-1).sessionActive, value === undefined)
    env.tick(1000)
    if (value === undefined) {
      stop(resumed.socket)
      env.tick()
      assert.ok(results(resumed.messages)[0].data.every(row => row.year === 2026 && row.record_count === 2))
    } else assert.equal(samples(resumed.messages).length, 0)
    cleanup()
  }
})

test('the real bridge saves a 2025 roster measured in 2026 through the real preview API contract', async t => {
  const { handlePreviewRequest } = require('./api/handler.ts')
  const bridge = new HeartRateBridge()
  const env = environment(t, undefined, { academicYear: () => bridge.session?.context.year })
  env.after(() => bridge.dispose())
  const origin = 'http://127.0.0.1:18475'
  const status = await handlePreviewRequest(new Request(`${origin}/api/preview/status`))
  assert.equal(status.status, 200)
  const cookie = status.headers.get('set-cookie').split(';')[0]
  const { schoolId } = await status.json()
  const request = (url, options = {}) => handlePreviewRequest(new Request(`${origin}${url}`, {
    ...options, headers: { ...Object.fromEntries(new Headers(options.headers)), Cookie: cookie, Origin: origin },
  }))
  const query = '?year=2025&grade=1&class_no=1'
  const { students } = await (await request(`/api/school/students${query}`)).json()
  const { mappings } = await (await request('/api/school/heart-rate-mappings')).json()
  const before = await (await request(`/api/school/heart-rate${query}`)).json()
  const posts = [], statuses = []
  t.mock.method(global, 'fetch', async (url, options) => {
    assert.equal(url, '/api/school/heart-rate')
    posts.push(JSON.parse(options.body))
    const response = await request(url, options)
    statuses.push(response.status)
    return response
  })
  bridge.begin({ schoolId, year: 2025, grade: 1, class_no: 1, schoolType: 1,
    students: students.map(student => ({ id: student.id, no: student.student_no, name: student.name,
      device_id: mappings.find(mapping => mapping.student_no === student.student_no).device_id, age: 12, estimatedAge: false })) })
  const connected = bridge.connect(true)
  env.tick()
  assert.equal(await connected, true)
  env.tick(3000)
  assert.equal(bridge.session.startedAt, START)
  assert.equal(bridge.session.lastSec, 3)
  assert.ok(bridge.session.students.every(student => student.lastSourceAt === START + 3000 && student.agg.n === 3))
  const measured = sessionResults(bridge.session)
  assert.ok(measured.every(row => row.year === 2026))
  bridge.stop()
  env.tick()
  await flush()
  env.tick()
  assert.deepEqual(statuses, [200])
  assert.equal(bridge.saveState, 'saved')
  assert.equal(posts.length, 1)
  assert.equal(posts[0].year, 2025)
  assert.deepEqual(posts[0].results, measured.map(row => ({ ...row, year: 2025 })))
  const after = await (await request(`/api/school/heart-rate${query}`)).json()
  assert.notDeepEqual(after.rows, before.rows)
  assert.equal(env.nativeCalls.length, 0)
  assert.equal(env.jobs.size, 0)
})
