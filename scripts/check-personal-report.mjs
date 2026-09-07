import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium, expect as baseExpect } from '@playwright/test'

const expect = baseExpect.configure({ timeout: 15000 })
const origin = 'http://127.0.0.1:18475'
const output = 'output/playwright/paps-personal'
await mkdir(output, { recursive: true })
await mkdir('output/pdf', { recursive: true })
const browser = await chromium.launch({ channel: 'chrome' })
const context = await browser.newContext({ baseURL: origin, viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
const errors = [], checks = []
context.on('page', page => page.on('pageerror', error => errors.push(error.message)))
await context.addInitScript(() => {
  window.__reportPrints = []
  new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) {
      if (node instanceof HTMLIFrameElement && node.contentWindow) {
        node.contentWindow.print = () => window.__reportPrints.push(node.contentDocument.documentElement.outerHTML)
      }
    }
  }).observe(document, { childList: true, subtree: true })
})
const page = await context.newPage()
async function capture(month) {
  await page.goto('/school/paps')
  await page.getByRole('button', { name: '결과지 출력', exact: true }).click()
  await page.getByRole('button', { name: /학생 개인/ }).click()
  const row = page.getByRole('dialog').getByRole('row').filter({ hasText: '김민준' })
  await row.getByRole('combobox').click()
  await page.getByRole('option', { name: `${month}월`, exact: true }).click()
  await row.getByRole('button', { name: '출력', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.__reportPrints.length)).toBe(1)
  return page.evaluate(() => window.__reportPrints[0])
}
async function render(html) {
  const document = await context.newPage()
  await document.setViewportSize({ width: 794, height: 1123 })
  await document.setContent(html.replace('<head>', `<head><base href="${origin}/">`), { waitUntil: 'networkidle' })
  await document.evaluate(() => globalThis.document.fonts.ready)
  assert.ok(await document.evaluate(() => [...globalThis.document.images].every(img => img.complete && img.naturalWidth > 0)))
  return document
}
async function inspect(document) {
  const geometry = await document.evaluate(() => {
    const root = globalThis.document
    const rows = [...root.querySelectorAll('.category-row')]
    const overflow = [...root.querySelectorAll('main, section, header, dl, li')].filter(el => el.scrollWidth > el.clientWidth + 1).map(el => el.className)
    const textOverflow = []
    const walker = root.createTreeWalker(root.querySelector('main'), NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const node = walker.currentNode
      if (!node.textContent.trim()) continue
      const range = root.createRange()
      range.selectNodeContents(node)
      const parent = node.parentElement.getBoundingClientRect()
      for (const rect of range.getClientRects()) {
        if (rect.left < parent.left - 1 || rect.right > parent.right + 1 || rect.top < parent.top - 2 || rect.bottom > parent.bottom + 2) textOverflow.push(node.textContent.trim())
      }
    }
    return {
      columns: rows.map(row => [...row.children].map(cell => { const r = cell.getBoundingClientRect(); return [r.x, r.width] })),
      overflow, textOverflow,
      icons: root.querySelectorAll('.grade-icon svg, .badge-icon svg, .badge-indicator svg').length,
      emptyIcons: [...root.querySelectorAll('svg')].filter(svg => !svg.querySelector('path, circle, rect')).length,
      font: getComputedStyle(root.body).fontFamily,
    }
  })
  assert.equal(geometry.columns.length, 5)
  for (const columns of geometry.columns) assert.deepEqual(columns, geometry.columns[0])
  assert.deepEqual(geometry.overflow, [])
  assert.deepEqual(geometry.textOverflow, [])
  assert.equal(geometry.icons, 15)
  assert.equal(geometry.emptyIcons, 0)
  assert.match(geometry.font, /Pretendard/)
  return geometry
}
try {
  const response = await context.request.get('/api/preview/status', { maxRedirects: 0 })
  assert.equal(response.headers()['x-school-preview'], 'synthetic')
  assert.equal((await response.json()).synthetic, true)
  const html = await capture(5)
  const normal = await render(html)
  await expect(normal.locator('.score-value')).toHaveText(['12', '16', '17', '11', '11'])
  await expect(normal.locator('.summary-score')).toHaveText('67/100')
  await expect(normal.locator('.summary-grade')).toHaveText('2등급')
  await expect(normal.locator('.measurement-value')).toHaveText(['50', '21.5'])
  await expect(normal.locator('.attempt dd')).toHaveText(['167.5', '173.2', '11.6', '13.7'])
  await expect(normal.locator('.step-pei dd')).toHaveText('64.3')
  await expect(normal.locator('.step-reading dd')).toHaveText(['113', '90', '77'])
  const geometry = await inspect(normal)
  await normal.pdf({ path: 'output/pdf/paps-personal-a4.pdf', preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false })
  await normal.screenshot({ path: `${output}/preview.png`, fullPage: true })
  await writeFile(`${output}/normal.html`, html.replace('<head>', `<head><base href="${origin}/">`), 'utf8')
  checks.push('May 2026 original values, four-column alignment, font, logo, vector icons and unclipped text')
  await normal.locator('.header-school').evaluate(el => { el.textContent = '올댓비젼 미래체육교육 연구시범 초등학교 (샘플)' })
  await normal.locator('.student-details strong').evaluate(el => { el.textContent = '긴이름학생김민준테스트' })
  await inspect(normal)
  checks.push('Long school and student metadata wrap without overlapping or clipping')
  await normal.close()

  await context.route('**/api/school/paps/grade-reference', async route => {
    const result = await route.fetch()
    const data = await result.json()
    await route.fulfill({ response: result, json: { ...data, refs: data.refs.filter(ref => ref.exercise_id !== 1) } })
  })
  const missing = await render(await capture(5))
  await expect(missing.locator('.score-value').first()).toHaveText('-')
  await expect(missing.locator('.result-value').first()).toHaveText('-')
  await expect(missing.locator('.summary-score')).toHaveText('-/100')
  await expect(missing.locator('.summary-grade')).toHaveText('-')
  await inspect(missing)
  await missing.close()
  await context.unroute('**/api/school/paps/grade-reference')
  checks.push('Missing reference stays unassessed, not a fabricated zero or grade five')

  const zero = await render(await capture(6))
  await expect(zero.locator('.measurement-value').first()).toHaveText('0')
  await expect(zero.locator('.score-value').first()).toHaveText('0')
  await expect(zero.locator('.attempt dd')).toHaveText(['0.0', '0.0', '0.0', '0.0'])
  await inspect(zero)
  await zero.close()
  checks.push('Measured zero and paired zero remain numeric')
  assert.deepEqual(errors, [])
  await writeFile(`${output}/checks.json`, JSON.stringify({ checks, geometry, errors }, null, 2))
  for (const check of checks) console.log(`PASS ${check}`)
} finally {
  await browser.close()
}
