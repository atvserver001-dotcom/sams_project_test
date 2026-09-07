import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium, expect as baseExpect } from '@playwright/test'

const expect = baseExpect.configure({ timeout: 15000 })
const origin = 'http://127.0.0.1:18475'
const output = 'output/playwright/paps-class'
const baseline = JSON.parse(await readFile('tests/paps-report/class-may-baseline.json', 'utf8'))
await mkdir(output, { recursive: true })
await mkdir('output/pdf', { recursive: true })
const browser = await chromium.launch({ channel: 'chrome' })
const context = await browser.newContext({ baseURL: origin, viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
const checks = [], errors = []
context.on('page', page => page.on('pageerror', error => errors.push(error.message)))
await context.addInitScript(() => {
  window.__classPrints = []
  new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) {
      if (node instanceof HTMLIFrameElement && node.contentWindow) {
        node.contentWindow.print = () => window.__classPrints.push(node.contentDocument.documentElement.outerHTML)
      }
    }
  }).observe(document, { childList: true, subtree: true })
})
const page = await context.newPage()
async function capture(month) {
  await page.goto('/school/paps')
  await page.getByRole('button', { name: '결과지 출력', exact: true }).click()
  await page.getByRole('button', { name: /학급 전체/ }).click()
  const dialog = page.getByRole('dialog', { name: '학급 전체 기록지 출력' })
  await dialog.getByRole('combobox', { name: '출력할 월 선택' }).click()
  await page.getByRole('option', { name: `${month}월`, exact: true }).click()
  await dialog.getByRole('button', { name: '출력', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.__classPrints.length)).toBe(1)
  return page.evaluate(() => window.__classPrints[0])
}
async function render(html) {
  const report = await context.newPage()
  await report.setViewportSize({ width: 1123, height: 794 })
  await report.setContent(html.replace('<head>', `<head><base href="${origin}/">`), { waitUntil: 'networkidle' })
  await report.evaluate(() => document.fonts.ready)
  assert.ok(await report.evaluate(() => [...document.images].every(image => image.complete && image.naturalWidth > 0)))
  return report
}
async function inspect(report) {
  const geometry = await report.evaluate(() => {
    const sheets = [...document.querySelectorAll('.class-report-page')]
    const cells = [...document.querySelectorAll('.student-row > *')]
    const walker = document.createTreeWalker(document.querySelector('main'), NodeFilter.SHOW_TEXT)
    const textOverflow = []
    while (walker.nextNode()) {
      const node = walker.currentNode
      if (!node.textContent.trim()) continue
      const range = document.createRange()
      range.selectNodeContents(node)
      const parent = node.parentElement.getBoundingClientRect()
      for (const rect of range.getClientRects()) {
        if (rect.left < parent.left - 1 || rect.right > parent.right + 1 || rect.top < parent.top - 2 || rect.bottom > parent.bottom + 2) textOverflow.push(node.textContent.trim())
      }
    }
    return {
      sheets: sheets.map(sheet => ({ height: sheet.getBoundingClientRect().height, rows: sheet.querySelectorAll('tbody tr').length, header: sheet.querySelectorAll('thead').length })),
      widths: [...document.querySelectorAll('.student-row')].map(row => [...row.children].map(cell => { const r = cell.getBoundingClientRect(); return [r.x, r.width] })),
      overflow: cells.filter(cell => cell.scrollWidth > cell.clientWidth + 1).map(cell => cell.className),
      textOverflow,
      centers: cells.every(cell => getComputedStyle(cell).textAlign === 'center' && getComputedStyle(cell).verticalAlign === 'middle'),
      headerText: [...document.querySelectorAll('thead tr')].map(row => [...row.children].map(cell => cell.textContent.trim())),
    }
  })
  assert.equal(geometry.sheets.length, 2)
  assert.ok(geometry.sheets.every(sheet => sheet.rows === 15 && sheet.header === 1 && sheet.height <= 190 * 96 / 25.4))
  for (const columns of geometry.widths) assert.deepEqual(columns, geometry.widths[0])
  assert.deepEqual(geometry.headerText[0], geometry.headerText[1])
  assert.deepEqual(geometry.overflow, [])
  assert.deepEqual(geometry.textOverflow, [])
  assert.equal(geometry.centers, true)
  return geometry
}
try {
  const status = await context.request.get('/api/preview/status', { maxRedirects: 0 })
  assert.equal(status.headers()['x-school-preview'], 'synthetic')
  assert.equal((await status.json()).synthetic, true)
  const html = await capture(5)
  const normal = await render(html)
  const actual = await normal.locator('.student-row').evaluateAll(rows => rows.map(row => [
    row.querySelector('.cell-no').textContent.trim(), row.querySelector('.cell-name').textContent.trim(),
    ...[...row.querySelectorAll('.cell-data')].map(cell => {
      const paired = [...cell.querySelectorAll('.attempt dd')]
      const value = paired.length ? paired.map(el => el.textContent.trim()).join(' / ') : cell.querySelector('.measurement-single').textContent.trim()
      return `${cell.querySelector('.result-label').textContent.trim()} ${value}`
    }), row.querySelector('.cell-total').textContent.trim(),
  ]))
  assert.deepEqual(actual, baseline)
  const geometry = await inspect(normal)
  const text = await normal.locator('body').innerText()
  assert.ok(!text.includes('http') && !text.includes('페이지'))
  assert.equal(await normal.locator('.header-logo').count(), 2)
  await normal.pdf({ path: 'output/pdf/paps-class-a4.pdf', preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false })
  await writeFile(`${output}/normal.html`, html.replace('<head>', `<head><base href="${origin}/">`), 'utf8')
  checks.push('All 30 student records and grades equal the original May baseline; two aligned 15-row sheets with repeated headers')
  await normal.locator('.header-school').evaluateAll(elements => elements.forEach(el => { el.textContent = '올댓비젼 미래체육 연구시범학교 (샘플)' }))
  await normal.locator('.cell-name').first().evaluate(el => { el.textContent = '긴이름김민준학생테스트' })
  await inspect(normal)
  checks.push('Long school and student names wrap within the same page budget without clipping')
  await normal.close()

  await context.route('**/api/school/paps/grade-reference', async route => {
    const response = await route.fetch()
    const data = await response.json()
    await route.fulfill({ response, json: { ...data, refs: data.refs.filter(ref => ref.exercise_id !== 1) } })
  })
  const missing = await render(await capture(5))
  await expect(missing.locator('[data-exercise-id="1"] .result-label').first()).toHaveText('-')
  await expect(missing.locator('[data-exercise-id="1"] .measurement-single').first()).toHaveText('50')
  await expect(missing.locator('.cell-total').first()).toHaveText('-')
  await inspect(missing)
  await missing.close()
  await context.unroute('**/api/school/paps/grade-reference')
  checks.push('Missing assessment reference preserves measurements and leaves the overall grade unassigned')

  const zero = await render(await capture(6))
  await expect(zero.locator('[data-exercise-id="1"] .measurement-single').first()).toHaveText('0')
  await expect(zero.locator('[data-exercise-id="2"] .attempt dd').first()).toHaveText('0.0')
  await inspect(zero)
  await zero.close()
  const empty = await render(await capture(10))
  assert.ok((await empty.locator('.result-label, .cell-total, .measurement-single, .attempt dd').allTextContents()).every(text => text.trim() === '-'))
  await inspect(empty)
  await empty.close()
  checks.push('Measured zero remains numeric; missing month remains blank instead of zero or a fabricated grade')
  assert.deepEqual(errors, [])
  await writeFile(`${output}/checks.json`, JSON.stringify({ checks, geometry, errors }, null, 2))
  for (const check of checks) console.log(`PASS ${check}`)
} finally { await browser.close() }
