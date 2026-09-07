/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { chromium, expect } = require('@playwright/test')

const base = process.env.HEART_SERIAL_BASE_URL || 'http://127.0.0.1:18575'
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), 'Only the local synthetic preview may be targeted')
const output = path.join(__dirname, 'heart-serial-browser-artifacts')
const sessionEndpoint = '/api/school/heart-rate/sessions'
const sparseStudentNumbers = [1, 4, 6, 10, 11]
const mappings = [1, 2].map(studentNo => ({ student_no: studentNo, device_id: String(750477 + studentNo).padStart(7, '0') }))

function installGateway() {
  const commands = []
  const events = []
  const sockets = []
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  let controller
  let timer
  let generation = 0
  let runId = null
  let seq = 0
  let tick = 0
  let openCount = 0
  let closeCount = 0
  let requestCount = 0
  let samplesStartedAt = null
  let canceled = false
  const enqueue = message => {
    if (!canceled) controller.enqueue(encoder.encode(JSON.stringify(message) + '\n'))
  }
  const port = {
    readable: null,
    writable: null,
    async open() {
      openCount++
      canceled = false
      this.readable = new ReadableStream({ start(next) { controller = next }, cancel() { canceled = true } })
      this.writable = new WritableStream({ write(chunk) {
        const request = JSON.parse(decoder.decode(chunk).trim())
        commands.push({ ...request, at: Date.now() })
        if (request.kind === 'hello') {
          enqueue({ v: 1, kind: 'caps', request_id: request.request_id, product: 'ATV_CL830_WEB_SERIAL_GATEWAY', protocol: 1,
            state: runId ? 'running' : 'ready', baud: 115200, rx_line_max: 255, lease_min_ms: 1000,
            lease_default_ms: 5000, lease_max_ms: 15000, gateway_id: 'gateway-browser', boot_id: 'boot-browser',
            capabilities: ['cl830_a1_a2', 'run_gate', 'heartbeat_lease', 'fresh_event_sequence'] })
        } else if (request.kind === 'run_start') {
          runId = request.run_id
          generation++
          seq = 0
          enqueue({ v: 1, kind: 'ack', request_id: request.request_id, command: 'run_start', run_id: runId,
            boot_id: 'boot-browser', generation, state: 'running', lease_remaining_ms: 4999 })
        } else if (request.kind === 'ping') {
          enqueue({ v: 1, kind: 'pong', request_id: request.request_id, run_id: runId, boot_id: 'boot-browser', generation, state: 'running', lease_remaining_ms: 4999 })
        } else if (request.kind === 'run_stop') {
          clearInterval(timer)
          enqueue({ v: 1, kind: 'ack', request_id: request.request_id, command: 'run_stop', run_id: request.run_id,
            boot_id: 'boot-browser', generation, state: 'ready', lease_remaining_ms: 0 })
          runId = null
        } else {
          throw new Error('Unexpected serial command: ' + request.kind)
        }
      } })
    },
    async close() { closeCount++; clearInterval(timer); this.readable = null; this.writable = null },
    getInfo() { return { usbVendorId: 0x10c4, usbProductId: 0xea60 } },
  }
  const serial = new EventTarget()
  serial.getPorts = async () => []
  serial.requestPort = async () => { requestCount++; return port }
  Object.defineProperty(navigator, 'serial', { configurable: true, value: serial })

  // Observe constructors even when the preview wraps WebSocket. No transport is simulated here.
  const observeSocket = Constructor => new Proxy(Constructor, {
    construct(target, args) {
      const url = String(args[0])
      sockets.push(url)
      if (!url.includes('/_next/webpack-hmr')) throw new Error('Unexpected application WebSocket: ' + url)
      return Reflect.construct(target, args)
    },
  })
  let observedSocket = observeSocket(window.WebSocket)
  Object.defineProperty(window, 'WebSocket', { configurable: true, get: () => observedSocket, set: value => { observedSocket = observeSocket(value) } })
  window.__heartSerial = {
    commands, events, sockets,
    stats: () => ({ openCount, closeCount, requestCount, samplesStartedAt, runId, generation }),
    startSamples() {
      clearInterval(timer)
      samplesStartedAt = Date.now()
      const sample = () => {
        if (!runId) return
        tick++
        for (let index = 0; index < 2; index++) {
          const decimal = 750478 + index
          const bytes = new DataView(new ArrayBuffer(4))
          bytes.setUint32(0, decimal)
          const event = { v: 1, kind: 'heart_rate', boot_id: 'boot-browser', run_id: runId, generation,
            source_key: 'cl830:' + decimal.toString(16).padStart(8, '0'),
            aliases: { be_decimal: String(decimal), be_decimal_min7: String(decimal).padStart(7, '0'), le_decimal: String(bytes.getUint32(0, true)) },
            bpm: 105 + index + tick % 12, battery_percent: 80, seq: ++seq, fresh: true }
          events.push({ studentNo: index + 1, at: Date.now(), bpm: event.bpm, seq: event.seq })
          enqueue(event)
        }
      }
      sample()
      timer = setInterval(sample, 500)
    },
    pauseSamples() { clearInterval(timer) },
  }
}

function makeSession(students, schoolType, request) {
  const age = request.grade + (schoolType === 1 ? 6 : schoolType === 2 ? 12 : 15)
  return {
    session: { id: randomUUID(), ...request, school_type: schoolType, age_years: age,
      age_source: 'school_type_grade_proxy', age_policy_version: 'school_grade_age_v1', zone_policy_version: 'aha_youth_relative_v1',
      quality_policy_version: 'cl830_stable_5s_5samples_v1', stabilization_seconds: 5, stabilization_min_samples: 5,
      stabilization_max_gap_ms: 2000, valid_bpm_min: 40, valid_bpm_max: 220, bucket_seconds: 60,
      status: 'recording', started_at: new Date().toISOString(), measurement_started_at: null, stable_started_at: null,
      gateway_run_id: null, transport_received_event_count: 0, transport_sequence_gap_count: 0,
      transport_rejected_sequence_count: 0, transport_last_event_at: null, stopped_at: null, finalized_at: null },
    participants: students.map(student => ({ participant_id: randomUUID(), student_id: student.id, student_no: student.student_no,
      name: student.name, age_years: age, age_source: 'school_type_grade_proxy', age_policy_version: 'school_grade_age_v1', predicted_max_bpm: Math.round((208 - 0.7 * age) * 10) / 10 })),
    points: [], results: [],
  }
}

async function assertOverflow(page, label, fhd = false) {
  const box = await page.evaluate(() => {
    const root = document.querySelector('[data-heart-care-live]')
    const rect = root?.getBoundingClientRect()
    const sidebar = document.querySelector('.console-sidebar')
    return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight, live: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
      sidebarHidden: sidebar ? getComputedStyle(sidebar).display === 'none' : false }
  })
  assert.ok(box.scrollWidth <= box.width, `${label}: horizontal overflow ${JSON.stringify(box)}`)
  if (fhd) {
    assert.ok(box.scrollHeight <= box.height, `${label}: FHD vertical overflow`)
    assert.deepEqual(box.live, { x: 0, y: 0, width: 1920, height: 1080 })
    assert.equal(box.sidebarHidden, true)
  }
  return box
}

for (const decision of ['finalize', 'discard']) {
  test(`real frontend serial lifecycle: ${decision}`, { timeout: 120000 }, async () => {
    fs.mkdirSync(output, { recursive: true })
    const browser = await chromium.launch({ headless: true, channel: process.env.HEART_SERIAL_BROWSER || 'chrome' })
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'reduce' })
    const page = await context.newPage()
    page.setDefaultTimeout(15000)
    const errors = []
    const requests = []
    const forbidden = []
    const boxes = {}
    let students = []
    let schoolType = 1
    let payload
    const storedPoints = new Map()
    const storePoints = points => {
      for (const point of points) storedPoints.set(`${point.participant_id}:${point.minute_index}`, point)
      payload.points = [...storedPoints.values()]
    }
    page.on('pageerror', error => errors.push(error.stack || error.message))
    page.on('request', request => {
      const url = new URL(request.url())
      if (url.pathname === '/api/school/heart-rate' && request.method() !== 'GET') forbidden.push({ url: request.url(), method: request.method() })
    })
    await context.addInitScript(installGateway)
    await context.route('**/api/school/heart-rate-mappings*', route => route.fulfill({ json: { mappings } }))
    await context.route('**/api/school/heart-rate/sessions{,/**}', async route => {
      const request = route.request()
      const url = new URL(request.url())
      const method = request.method()
      const body = request.postDataJSON()
      requests.push({ path: url.pathname, method, body, at: Date.now() })
      if (url.pathname === sessionEndpoint && method === 'POST') {
        assert.equal(payload, undefined, 'Exactly one session start is allowed')
        payload = makeSession(students, schoolType, body)
        await route.fulfill({ json: payload })
      } else if (url.pathname === `${sessionEndpoint}/${payload?.session.id}` && method === 'PATCH') {
        if (body.action === 'stabilize') {
          payload.session.gateway_run_id = body.gateway_run_id
          payload.session.measurement_started_at = body.run_started_at
          payload.session.stable_started_at = new Date(Date.parse(body.run_started_at) + 5000).toISOString()
        } else if (body.action === 'checkpoint') {
          storePoints(body.points)
          await route.fulfill({ json: { session_id: payload.session.id, status: 'recording', accepted_point_count: body.points.length, checked_at: new Date().toISOString() } })
          return
        } else if (body.action === 'stop') {
          payload.session.status = 'awaiting_decision'
          payload.session.stopped_at = new Date().toISOString()
          storePoints(body.points)
        } else if (body.action === 'finalize') {
          assert.equal(payload.session.status, 'awaiting_decision')
          payload.session.status = 'completed'
          payload.session.finalized_at = new Date().toISOString()
        } else throw new Error('Unexpected session action: ' + body.action)
        await route.fulfill({ json: payload })
      } else if (method === 'DELETE' && url.pathname === `${sessionEndpoint}/${payload?.session.id}`) {
        assert.equal(payload.session.status, 'awaiting_decision')
        await route.fulfill({ json: { session_id: payload.session.id, discarded: true, already_missing: false } })
      } else throw new Error(`Unexpected session request: ${method} ${url.pathname}`)
    })
    try {
      const status = await context.request.get(`${base}/api/preview/status`)
      const preview = await status.json()
      assert.equal(preview.preview, true)
      assert.equal(preview.synthetic, true, 'Never connect the harness to a real database deployment')
      await context.route('**/api/school/students*', async route => {
        const response = await route.fetch()
        const body = await response.json()
        await route.fulfill({ response, json: { ...body, students: body.students.filter(student => sparseStudentNumbers.includes(student.student_no)) } })
      })
      await page.goto(`${base}/school/heart-rate`, { waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('button', { name: '측정 시작', exact: true }).first()).toBeEnabled()
      await expect(page.locator('tbody tr').first().locator('td').nth(6)).toHaveText('0')
      const data = await page.evaluate(async () => {
        const now = new Date()
        const year = now.getFullYear() - (now.getMonth() < 2 ? 1 : 0)
        const [cohort, info] = await Promise.all([
          fetch(`/api/school/students?year=${year}&grade=1&class_no=1`).then(response => response.json()),
          fetch('/api/school/info').then(response => response.json()),
        ])
        return { students: cohort.students, schoolType: info.school.school_type }
      })
      students = data.students
      schoolType = data.schoolType
      assert.deepEqual(students.map(student => student.student_no), sparseStudentNumbers, 'Use a sparse subset of the existing preview cohort')
      assert.ok(mappings.filter(item => item.device_id).every(item => /^\d{7}$/.test(item.device_id)))
      await page.getByRole('button', { name: '측정 시작', exact: true }).first().click()
      await page.waitForURL('**/school/heart-rate/live')
      await expect(page.locator('[data-student-no]')).toHaveCount(30)
      await expect(page.getByRole('button', { name: '측정 종료 · 저장', exact: true })).toBeEnabled()
      assert.equal(requests.filter(request => request.method === 'POST').length, 1)
      assert.equal(payload.participants.length, 5)
      assert.deepEqual(await page.locator('[data-student-no]').evaluateAll(items => items.map(item => Number(item.dataset.studentNo))), Array.from({ length: 30 }, (_, index) => index + 1))
      assert.deepEqual(await page.locator('[data-student-no]:not([data-slot-state="unregistered"])').evaluateAll(items => items.map(item => Number(item.dataset.studentNo))), sparseStudentNumbers)
      await expect(page.locator('[data-student-no="1"]')).toHaveAttribute('data-slot-state', 'waiting')
      await expect(page.locator('[data-student-no="2"]')).toHaveAttribute('data-slot-state', 'unregistered')
      await expect(page.locator('[data-student-no="4"]')).toHaveAttribute('data-slot-state', 'unassigned')
      assert.equal(await page.locator('[data-student-no="2"]').evaluate(item => item.tagName), 'DIV')
      await page.locator('[data-student-no="2"]').click()
      await expect(page.locator('[data-chart="focus"]')).toHaveCount(0)
      await page.evaluate(() => window.__heartSerial.startSamples())
      await page.waitForTimeout(3000)
      await expect(page.locator('[data-student-no="1"]')).toHaveAttribute('aria-label', /수신 대기/)
      await expect(page.locator('[data-student-no="1"] [data-chart="tile"]')).toHaveAttribute('aria-label', /수신 기록 없음/)
      await page.screenshot({ path: path.join(output, `${decision}-warmup-fhd.png`) })
      await expect(page.locator('[data-student-no="1"]')).toHaveAttribute('aria-label', /\d+ bpm/, { timeout: 10000 })
      const firstVisibleAt = await page.evaluate(() => Date.now() - window.__heartSerial.stats().samplesStartedAt)
      assert.ok(firstVisibleAt >= 5000, 'No accepted waveform before the real 5-second sensor warmup')
      await page.waitForTimeout(1500)
      await expect(page.getByText('USB 수신기 연결됨 · 심박 수신 중', { exact: true })).toBeVisible()
      const waveform = page.locator('[data-student-no="1"] [data-chart="tile"] polyline')
      await expect(waveform).toBeAttached()
      assert.ok((await waveform.getAttribute('points')).trim().split(/\s+/).length >= 2)
      await expect(page.locator('[data-student-no="30"]')).toHaveAttribute('aria-label', /학생 미등록/)
      if (decision === 'finalize') {
        await page.evaluate(() => window.__heartSerial.pauseSamples())
        await expect(page.locator('[data-student-no="1"] [data-signal-carried]')).toBeAttached({ timeout: 4000 })
        await expect(page.locator('[data-student-no="1"]')).toHaveAttribute('aria-label', /\d+ bpm/)
        await expect(page.locator('[data-student-no="1"]')).toHaveAttribute('data-slot-state', 'no-signal', { timeout: 8000 })
        await expect(page.locator('[data-student-no="1"] [data-signal-gap]')).toBeAttached()
        await page.evaluate(() => window.__heartSerial.startSamples())
        await expect(page.locator('[data-student-no="1"]')).toHaveAttribute('aria-label', /\d+ bpm/, { timeout: 4000 })
      }
      boxes.grid = await assertOverflow(page, 'FHD grid', true)
      const lastTile = await page.locator('[data-student-no="30"]').boundingBox()
      assert.ok(lastTile.y + lastTile.height <= 1080, 'All 30 tiles fit in FHD')
      await page.screenshot({ path: path.join(output, `${decision}-grid-fhd.png`) })
      await page.locator('[data-student-no="1"]').click()
      await expect(page.locator('[data-chart="focus"]')).toBeVisible()
      await expect(page.locator('[data-rail-student]')).toHaveCount(29)
      await expect(page.locator('[data-chart="focus"] [data-extreme="max"]')).toBeAttached()
      boxes.focus = await assertOverflow(page, 'FHD focus', true)
      await page.screenshot({ path: path.join(output, `${decision}-focus-fhd.png`) })
      await page.setViewportSize({ width: 390, height: 844 })
      boxes.mobileFocus = await assertOverflow(page, 'mobile focus')
      const focusDetail = await page.getByRole('region', { name: '1번 학생 상세', exact: true }).boundingBox()
      const mobileRail = await page.locator('[data-rail-student="30"]').locator('..').locator('..').boundingBox()
      assert.ok(focusDetail.y + focusDetail.height <= mobileRail.y + 1, 'Mobile rail must follow the detail without overlap')
      await page.screenshot({ path: path.join(output, `${decision}-focus-mobile.png`), fullPage: true })
      await page.mouse.move(200, 500)
      await page.mouse.wheel(0, 6000)
      await expect.poll(async () => {
        const rect = await page.locator('[data-rail-student="30"]').boundingBox()
        return rect && rect.y >= -1 && rect.y + rect.height <= 845
      }, { message: 'Mobile focus must allow user scrolling to the final rail student' }).toBe(true)
      await page.screenshot({ path: path.join(output, `${decision}-focus-mobile-bottom.png`) })
      await page.getByRole('button', { name: '선택 해제 · 30명 보기' }).click()
      await expect(page.locator('[data-student-no]')).toHaveCount(30)
      boxes.mobileGrid = await assertOverflow(page, 'mobile grid')
      await page.screenshot({ path: path.join(output, `${decision}-grid-mobile.png`), fullPage: true })
      await page.mouse.move(200, 500)
      await page.mouse.wheel(0, 6000)
      await expect.poll(async () => {
        const rect = await page.locator('[data-student-no="30"]').boundingBox()
        return rect && rect.y >= -1 && rect.y + rect.height <= 845
      }, { message: 'Mobile grid must allow user scrolling to student 30' }).toBe(true)
      await page.screenshot({ path: path.join(output, `${decision}-grid-mobile-bottom.png`) })
      await page.setViewportSize({ width: 1920, height: 1080 })
      const before = await page.evaluate(() => ({ ...window.__heartSerial.stats(), stops: window.__heartSerial.commands.filter(command => command.kind === 'run_stop').length }))
      await page.getByRole('button', { name: '월별 기록', exact: true }).click()
      await page.waitForURL('**/school/heart-rate')
      await expect(page.getByRole('button', { name: '측정 중', exact: true })).toBeEnabled()
      await expect(page.getByRole('combobox', { name: '학년도', exact: true })).toBeDisabled()
      await page.waitForTimeout(1200)
      await page.screenshot({ path: path.join(output, `${decision}-monthly-active-fhd.png`) })
      await page.getByRole('button', { name: '측정 중', exact: true }).click()
      await page.waitForURL('**/school/heart-rate/live')
      await expect(page.locator('[data-student-no]')).toHaveCount(30)
      await expect(page.locator('[data-student-no="1"]')).toHaveAttribute('aria-label', /\d+ bpm/)
      const after = await page.evaluate(() => ({ ...window.__heartSerial.stats(), stops: window.__heartSerial.commands.filter(command => command.kind === 'run_stop').length }))
      assert.deepEqual(after, before, 'Monthly/resume must not reopen, close, restart or stop the gateway')
      assert.equal(after.openCount, 1)
      assert.equal(after.closeCount, 0)
      assert.equal(after.stops, 0)
      assert.equal(requests.filter(request => request.method === 'POST').length, 1)
      assert.equal(requests.filter(request => request.body?.action === 'stop').length, 0)
      await page.screenshot({ path: path.join(output, `${decision}-resumed-fhd.png`) })
      await page.getByRole('button', { name: '측정 종료 · 저장', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: '측정 결과를 저장하시겠습니까?' })
      await expect(dialog).toBeVisible()
      assert.equal(await page.evaluate(() => window.__heartSerial.commands.filter(command => command.kind === 'run_stop').length), 1)
      assert.equal(requests.filter(request => request.body?.action === 'stop').length, 1)
      const stop = requests.find(request => request.body?.action === 'stop').body
      assert.equal(payload.points.length, 1, 'Checkpoint plus final stop retain only the mapped real participant record')
      assert.ok(payload.points.every(point => point.sample_count > 0 && point.min_bpm >= 105 && point.max_bpm < 150))
      assert.ok(stop.transport_quality.received_event_count > 0)
      await page.screenshot({ path: path.join(output, `${decision}-stop-dialog-fhd.png`) })
      await dialog.getByRole('button', { name: decision === 'finalize' ? '저장하고 종료' : '저장하지 않고 종료', exact: true }).click()
      await page.waitForURL('**/school/heart-rate')
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(page.getByRole('button', { name: '측정 시작', exact: true }).first()).toBeEnabled()
      assert.equal(requests.filter(request => request.body?.action === 'finalize').length, decision === 'finalize' ? 1 : 0)
      assert.equal(requests.filter(request => request.method === 'DELETE').length, decision === 'discard' ? 1 : 0)
      const gateway = await page.evaluate(() => ({ commands: window.__heartSerial.commands, sockets: window.__heartSerial.sockets, stats: window.__heartSerial.stats(), events: window.__heartSerial.events.length }))
      assert.equal(gateway.commands.filter(command => command.kind === 'run_start').length, 1)
      assert.equal(gateway.commands.filter(command => command.kind === 'run_stop').length, 1)
      assert.ok(gateway.commands.some(command => command.kind === 'ping'))
      assert.deepEqual(gateway.sockets.filter(url => !url.includes('/_next/webpack-hmr')), [])
      assert.deepEqual(forbidden, [], 'No legacy heart-rate POST')
      assert.deepEqual(errors, [])
      fs.writeFileSync(path.join(output, `${decision}-report.json`), JSON.stringify({ decision, passed: true, firstVisibleAt, boxes, gateway, requests, forbidden, errors, physicalDevice: false }, null, 2))
    } catch (error) {
      await page.screenshot({ path: path.join(output, `${decision}-failure.png`), fullPage: true })
      console.error(JSON.stringify({ decision, error: error.message, body: (await page.locator('body').innerText()).slice(0, 1200), requests: requests.map(request => ({ ...request, body: { ...request.body, points: request.body?.points?.length } })), errors, gateway: await page.evaluate(() => {
        const ancestors = []
        let node = document.querySelector('[data-rail-student="30"]') || document.querySelector('[data-student-no="30"]')
        while (node) { const box = node.getBoundingClientRect(); ancestors.push({ className: node.className, y: box.y, height: box.height, scrollHeight: node.scrollHeight, scrollTop: node.scrollTop, overflowY: getComputedStyle(node).overflowY }); node = node.parentElement }
        return { stats: window.__heartSerial?.stats(), commands: window.__heartSerial?.commands, ancestors }
      }) }, null, 2))
      throw error
    } finally {
      await browser.close()
    }
  })
}
