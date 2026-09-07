/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { chromium, expect } = require('@playwright/test')
const base = process.env.PERFORMANCE_BASE_URL || 'http://127.0.0.1:18587'
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), 'Only an isolated synthetic preview is permitted')

function installAuthLatencyFixture() {
  const nativeFetch = window.fetch.bind(window)
  const info = []
  const counts = {}
  const fixture = {
    user: { id: 'teacher-a', username: 'teacher-a', role: 'school', schoolId: 'a', isActive: true }, info, counts,
    release(index, id) { info[index].resolve(new Response(JSON.stringify({ school: id ? { id, name: `합성 ${id}`, school_type: 1 } : null }), { headers: { 'Content-Type': 'application/json' } })) },
  }
  window.__authPerformance = fixture
  window.fetch = (input, options = {}) => {
    const pathname = new URL(typeof input === 'string' ? input : input.url, location.origin).pathname
    counts[pathname] = (counts[pathname] || 0) + 1
    if (pathname === '/api/school/info') {
      // Deliberately ignore abort in this fake transport so stale-response
      // ownership, not just the browser's fetch cancellation, is exercised.
      return new Promise(resolve => info.push({ resolve, signal: options.signal }))
    }
    if (pathname === '/api/auth/me') return Promise.resolve(new Response(JSON.stringify({ user: fixture.user }), { headers: { 'Content-Type': 'application/json' } }))
    if (pathname === '/api/auth/signout') return Promise.resolve(new Response('{}', { headers: { 'Content-Type': 'application/json' } }))
    return nativeFetch(input, options)
  }
}

async function browserFixture(run) {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  try {
    const status = await (await context.request.get(`${base}/api/preview/status`)).json()
    assert.equal(status.synthetic, true)
    await context.addInitScript(installAuthLatencyFixture)
    const page = await context.newPage()
    await page.goto(`${base}/school/heart-rate`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => window.__authPerformance.info.length === 1)
    await expect(page.locator('#preview-auth-state')).toHaveAttribute('data-loading', 'false')
    await expect(page.getByRole('heading', { name: 'Heart Care', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '측정 시작', exact: true })).toBeEnabled()
    await run(page)
  } finally { await browser.close() }
}

test('actual AuthProvider renders the page while school metadata waits; class changes reuse metadata and mappings', { timeout: 60000 }, async () => {
  await browserFixture(async page => {
    const before = await page.evaluate(() => ({ ...window.__authPerformance.counts }))
    assert.ok(before['/api/school/students'] > 0)
    assert.ok(before['/api/school/heart-rate'] > 0)
    assert.equal(before['/api/school/info'], 1)
    await page.evaluate(() => window.__authPerformance.release(0, 'a'))
    await expect(page.locator('#preview-auth-state')).toHaveAttribute('data-school', 'a')
    await page.getByRole('combobox', { name: '학년', exact: true }).click()
    await page.getByRole('option', { name: '2학년', exact: true }).click()
    await expect(page.getByRole('heading', { name: /학년도 · 2학년 1반/ })).toBeVisible()
    await page.waitForFunction(count => window.__authPerformance.counts['/api/school/students'] > count, before['/api/school/students'])
    const after = await page.evaluate(() => ({ ...window.__authPerformance.counts }))
    assert.equal(after['/api/school/info'], 1)
    assert.equal(after['/api/school/heart-rate-mappings'], before['/api/school/heart-rate-mappings'])
  })
})

test('actual AuthProvider ignores late metadata on acting-context refresh and logout', { timeout: 60000 }, async () => {
  await browserFixture(async page => {
    await page.evaluate(() => {
      window.__authPerformance.user = { id: 'admin', username: 'admin', role: 'admin', schoolId: null, isActive: true }
      window.dispatchEvent(new Event('preview:refresh-auth'))
    })
    await page.waitForFunction(() => window.__authPerformance.info.length === 2)
    await page.evaluate(() => window.__authPerformance.release(1, 'b'))
    await expect(page.locator('#preview-auth-state')).toHaveAttribute('data-user', 'admin')
    await expect(page.locator('#preview-auth-state')).toHaveAttribute('data-school', 'b')
    await page.evaluate(() => window.__authPerformance.release(0, 'a'))
    await expect(page.locator('#preview-auth-state')).toHaveAttribute('data-school', 'b')
    await page.evaluate(() => window.dispatchEvent(new Event('preview:refresh-auth')))
    await page.waitForFunction(() => window.__authPerformance.info.length === 3)
    await page.getByRole('button', { name: '로그아웃', exact: true }).click()
    await expect(page.locator('#preview-auth-state')).toHaveAttribute('data-user', '')
    await page.evaluate(() => window.__authPerformance.release(2, 'b'))
    await expect(page.locator('#preview-auth-state')).toHaveAttribute('data-school', '')
    await expect(page.getByLabel('아이디', { exact: true })).toBeVisible()
  })
})
