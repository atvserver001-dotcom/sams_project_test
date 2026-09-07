import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium, expect as baseExpect } from '@playwright/test'

const expect = baseExpect.configure({ timeout: 15000 })

const baseURL = process.env.SCHOOL_PREVIEW_URL || 'http://127.0.0.1:18475'
const output = path.resolve('output/playwright/school-preview')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome' })
const context = await browser.newContext({ baseURL, viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
const page = await context.newPage()
const errors = [], remoteData = [], securitySoftwareRequests = [], realSockets = [], checks = [], geometry = []
page.on('pageerror', error => errors.push(error.message))
context.on('request', request => {
  const url = new URL(request.url())
  if (['fetch', 'xhr', 'websocket'].includes(request.resourceType()) && url.origin !== baseURL) {
    // Installed security software injects its own traffic. Keep it visible in evidence;
    // the assertion concerns app/backend traffic, not an OS-wide network isolation claim.
    if (url.hostname === 'gc.kis.v2.scr.kaspersky-labs.com') securitySoftwareRequests.push(request.url())
    else remoteData.push(request.url())
  }
})
page.on('websocket', socket => { if (!socket.url().includes('/_next/')) realSockets.push(socket.url()) })
page.on('dialog', dialog => dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss())
await context.addInitScript(() => {
  window.__previewPrinted = []
  new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) {
      if (node instanceof HTMLIFrameElement && node.contentWindow) {
        node.contentWindow.print = () => window.__previewPrinted.push(node.contentDocument.documentElement.outerHTML)
      }
    }
  }).observe(document, { childList: true, subtree: true })
})
const check = async (name, action) => {
  await action()
  checks.push(name)
  console.log(`PASS ${name}`)
}
const shot = async name => {
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: path.join(output, `${name}.png`), animations: 'disabled' })
}
async function classFilter(field, value) {
  await page.locator(`[data-class-filter="${field}"]`).getByRole('combobox').click()
  await page.getByRole('option', { name: value, exact: true }).click()
}
async function layoutCheck(route) {
  await expect(page.locator('.console-brand')).toBeVisible()
  await expect(page.locator('.console-nav [aria-current="page"]')).toHaveCount(1)
  await expect(page.locator('.console-nav [data-active="true"]')).toHaveCount(1)
  const result = await page.evaluate(() => {
    const brand = document.querySelector('.console-brand').getBoundingClientRect()
    const title = document.querySelector('.console-page-header').getBoundingClientRect()
    return {
      width: innerWidth, headerDelta: brand.bottom - title.bottom,
      overflow: document.documentElement.scrollWidth - innerWidth,
      images: [...document.images].every(image => image.complete && image.naturalWidth > 0),
      filters: [...document.querySelectorAll('[data-class-filter] button[role="combobox"]')].map(element => {
        const box = element.getBoundingClientRect(), css = getComputedStyle(element)
        return { width: box.width, height: box.height, radius: css.borderRadius, font: css.fontSize, background: css.backgroundColor }
      }),
    }
  })
  assert.equal(result.headerDelta, 0, route)
  assert.equal(result.overflow, 0, route)
  assert.equal(result.images, true, route)
  if (result.filters.length) {
    assert.deepEqual(result.filters.map(field => [field.width, field.height]), [[120, 36], [100, 36], [100, 36]])
    const prior = geometry.find(item => item.filters.length)
    if (prior) assert.deepEqual(result.filters, prior.filters)
  }
  geometry.push({ route, ...result })
}
try {
  await check('dashboard direct entry and synthetic school', async () => {
    await page.goto('/school')
    await expect(page.locator('.console-account')).toContainText('올댓비젼초등학교 (샘플)')
    await expect(page.locator('.recharts-bar').first()).toBeVisible()
    await layoutCheck('/school')
    await shot('01-dashboard-fhd')
  })
  await check('student edit modal centered and save survives reload', async () => {
    await page.getByRole('link', { name: '학생 정보입력', exact: true }).click()
    await page.getByRole('row').filter({ hasText: '김민준' }).getByRole('button', { name: '수정', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '학생 정보 수정' })
    await dialog.getByLabel('이름', { exact: true }).fill('김민준 확인')
    const box = await dialog.boundingBox()
    assert.ok(Math.abs(box.x + box.width / 2 - 960) <= 1)
    assert.ok(Math.abs(box.y + box.height / 2 - 540) <= 1)
    await shot('02-student-edit-fhd')
    await dialog.getByRole('button', { name: '저장', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole('cell', { name: '김민준 확인', exact: true })).toBeVisible()
    await layoutCheck('/school/students')
    await shot('03-students-fhd')
  })
  await check('year grade and empty-class filters use separate records', async () => {
    await classFilter('year', '2025년')
    await expect(page.getByRole('cell', { name: '김민준', exact: true })).toBeVisible()
    await classFilter('class', '2반')
    await expect(page.getByRole('cell', { name: '김민준', exact: true })).toHaveCount(0)
    await classFilter('class', '1반')
    await classFilter('year', '2026년')
    await expect(page.getByRole('cell', { name: '김민준 확인', exact: true })).toBeVisible()
  })
  await check('exercise chart and edit propagation', async () => {
    await page.getByRole('link', { name: '운동기록관리', exact: true }).click()
    await expect(page.getByRole('cell', { name: '김민준 확인', exact: true })).toBeVisible()
    await layoutCheck('/school/exercises')
    await page.getByRole('textbox', { name: '학생 이름 또는 번호 검색' }).fill('김민준 확인')
    await page.getByRole('radio', { name: '그래프 보기', exact: true }).click()
    await expect(page.getByRole('heading', { name: '1번 김민준 확인', exact: true })).toBeVisible()
    await shot('04-exercises-chart-fhd')
    const downloadEvent = page.waitForEvent('download')
    await page.getByRole('button', { name: '엑셀 내보내기', exact: true }).click()
    const download = await downloadEvent
    assert.match(download.suggestedFilename(), /\.xlsx$/)
    await download.saveAs(path.join(output, 'exercise-export.xlsx'))
  })
  await check('PAPS merged records grades and separate print modals', async () => {
    await page.getByRole('link', { name: 'PAPS기록관리', exact: true }).click()
    const name = page.getByRole('cell', { name: '김민준 확인', exact: true })
    await expect(name).toHaveCount(1)
    assert.ok(Number(await name.getAttribute('rowspan')) > 1)
    await layoutCheck('/school/paps')
    await shot('05-paps-records-fhd')
    await page.getByRole('radio', { name: '등급', exact: true }).click()
    await expect(page.getByRole('cell', { name: /등급/ }).first()).toBeVisible()
    await shot('06-paps-grades-fhd')
    await page.getByRole('button', { name: '결과지 출력', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveAccessibleName('출력 유형 선택')
    await shot('07-print-type-fhd')
    await page.getByRole('button', { name: /학생 개인/ }).click()
    await expect(page.getByRole('dialog')).toHaveCount(1)
    await expect(page.getByRole('dialog')).toHaveAccessibleName('결과지 출력')
    await shot('08-print-student-fhd')
  })
  await check('individual A4 print document and PDF rendering', async () => {
    await page.getByRole('dialog').getByRole('button', { name: '출력', exact: true }).first().click()
    await expect.poll(() => page.evaluate(() => window.__previewPrinted.length)).toBe(1)
    const html = await page.evaluate(() => window.__previewPrinted[0])
    assert.ok(html.includes('김민준 확인'))
    assert.ok(html.includes('@page { size: A4 portrait;'))
    await savePrint(html, 'individual')
    await page.keyboard.press('Escape')
  })
  await check('class A4 print and PAPS Excel download', async () => {
    await page.getByRole('button', { name: '결과지 출력', exact: true }).click()
    await page.getByRole('button', { name: /학급 전체/ }).click()
    await expect(page.getByRole('dialog')).toHaveAccessibleName('학급 전체 기록지 출력')
    await shot('09-print-class-fhd')
    await page.getByRole('dialog').getByRole('button', { name: /출력/ }).click()
    await expect.poll(() => page.evaluate(() => window.__previewPrinted.length)).toBe(2)
    await savePrint(await page.evaluate(() => window.__previewPrinted[1]), 'class')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: '엑셀 출력', exact: true }).click()
    const downloadEvent = page.waitForEvent('download')
    await page.getByRole('dialog').getByRole('button', { name: '다운로드', exact: true }).click()
    await (await downloadEvent).saveAs(path.join(output, 'paps-export.xlsx'))
    await page.keyboard.press('Escape')
  })
  await check('Heart Care monthly start grid focus save and monthly return', async () => {
    await page.getByRole('link', { name: '심박기록관리', exact: true }).click()
    await expect(page.getByRole('cell', { name: '김민준 확인', exact: true })).toBeVisible()
    const schoolMenu = page.getByRole('complementary', { name: '학교 메뉴' })
    await expect(schoolMenu.locator('a[href="/school/heart-rate"]')).toHaveCount(1)
    await expect(schoolMenu.locator('[aria-current="page"]')).toHaveCount(1)
    await expect(schoolMenu.getByRole('link', { name: '심박기록관리', exact: true })).toHaveAttribute('aria-current', 'page')
    await expect(schoolMenu.getByRole('link', { name: '하트 케어', exact: true })).toHaveCount(0)
    await layoutCheck('/school/heart-rate')
    await shot('10-heart-monthly-fhd')
    const before = await (await context.request.get('/api/school/heart-rate?year=2026&grade=1&class_no=1')).json()
    await page.getByRole('button', { name: '측정 시작', exact: true }).click()
    await expect(page.locator('[data-student-no]')).toHaveCount(30)
    await expect(page.getByText('측정 중 · 30명 수신', { exact: true })).toBeVisible()
    await expect.poll(() => page.evaluate(() => {
      const stored = localStorage.getItem('sams-heart-care-v1:school-preview-1')
      return stored ? JSON.parse(stored).session.students[0].agg.n : 0
    })).toBeGreaterThanOrEqual(5)
    await shot('11-heart-grid-fhd')
    await page.locator('[data-student-no="1"]').click()
    await expect(page.locator('[data-rail-student]')).toHaveCount(29)
    await expect(page.locator('section[aria-label="1번 학생 상세"]')).toBeVisible()
    await shot('12-heart-focus-fhd')
    const waveform = page.locator('svg[data-chart="focus"]')
    const prior = await waveform.innerHTML()
    await expect.poll(() => waveform.innerHTML()).not.toBe(prior)
    assert.equal(await page.locator('svg path').evaluateAll(paths => paths.some(p => /NaN|Infinity/.test(p.getAttribute('d') || ''))), false)
    await page.reload()
    await expect(page.locator('section[aria-label="1번 학생 상세"]')).toBeVisible()
    await page.getByRole('button', { name: '다시 연결', exact: true }).click()
    await expect(page.getByText('측정 중 · 30명 수신', { exact: true })).toBeVisible()
    await expect.poll(() => page.evaluate(() => {
      const stored = localStorage.getItem('sams-heart-care-v1:school-preview-1')
      return stored ? JSON.parse(stored).session.students[0].agg.n : 0
    })).toBeGreaterThanOrEqual(10)
    await shot('12b-heart-resumed-fhd')
    await page.getByRole('button', { name: '측정 종료 · 저장', exact: true }).click()
    await expect(page.getByText('측정 완료', { exact: true })).toBeVisible()
    const after = await (await context.request.get('/api/school/heart-rate?year=2026&grade=1&class_no=1')).json()
    assert.notDeepEqual(after.rows, before.rows)
    await page.getByRole('link', { name: '월별 기록', exact: true }).click()
    await expect(page.locator('.console-page-header')).toBeVisible()
  })
  await check('settings preserved and 1440 layout', async () => {
    await page.getByRole('link', { name: '디바이스 설정', exact: true }).click()
    await expect(page.locator('.console-page-header')).toBeVisible()
    await layoutCheck('/school/settings')
    await shot('13-settings-fhd')
    await page.setViewportSize({ width: 1440, height: 1024 })
    for (const route of ['/school/students', '/school/exercises', '/school/paps', '/school/heart-rate']) {
      await page.goto(route)
      await expect(page.locator('[data-class-filter="year"]')).toBeVisible()
      await layoutCheck(route)
    }
    await shot('14-heart-monthly-1440')
  })
  await check('unknown API denied and browser isolation', async () => {
    assert.equal((await context.request.get('/api/admin/accounts')).status(), 404)
    assert.equal((await context.request.post('/api/device/ingest', { data: {}, headers: { Origin: baseURL } })).status(), 501)
    const other = await browser.newContext({ baseURL })
    try {
      await other.request.get('/api/preview/status')
      const data = await (await other.request.get('/api/school/students?year=2026&grade=1&class_no=1')).json()
      assert.equal(data.students[0].name, '김민준')
    } finally { await other.close() }
    assert.deepEqual(remoteData, [])
    assert.deepEqual(realSockets, [])
    assert.deepEqual(errors, [])
  })
  await check('reset restores changed student and logout login flow', async () => {
    await page.goto('/preview')
    await page.getByRole('button', { name: '샘플 초기화', exact: true }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: '확인', exact: true }).click()
    await expect(page).toHaveURL(`${baseURL}/school`)
    await page.getByRole('link', { name: '학생 정보입력', exact: true }).click()
    await expect(page.getByRole('cell', { name: '김민준', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '로그아웃', exact: true }).click()
    await expect(page).toHaveURL(`${baseURL}/`)
    await page.getByLabel('아이디', { exact: true }).fill('preview_teacher')
    await page.getByLabel('비밀번호', { exact: true }).fill('preview-only')
    await page.getByRole('button', { name: '로그인', exact: true }).click()
    await expect(page).toHaveURL(`${baseURL}/school`)
    await expect(page.locator('.console-sidebar')).toBeVisible()
  })
  await check('past-year roster uses the selected synthetic academic year', async () => {
    await page.goto('/school/heart-rate')
    await classFilter('year', '2025학년도')
    await expect(page.getByRole('heading', { name: '2025학년도 · 1학년 1반', exact: true })).toBeVisible()
    const before = await (await context.request.get('/api/school/heart-rate?year=2025&grade=1&class_no=1')).json()
    await page.getByRole('button', { name: '측정 시작', exact: true }).click()
    await expect(page.getByText('측정 중 · 30명 수신', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '측정 종료 · 저장', exact: true }).click()
    await expect(page.getByText('측정 완료', { exact: true })).toBeVisible()
    const after = await (await context.request.get('/api/school/heart-rate?year=2025&grade=1&class_no=1')).json()
    assert.notDeepEqual(after.rows, before.rows)
  })
  await check('final browser errors and outbound boundaries after all flows', async () => {
    assert.deepEqual(remoteData, [])
    assert.deepEqual(realSockets, [])
    assert.deepEqual(errors, [])
  })
} catch (error) {
  await shot('failure').catch(() => {})
  throw error
} finally {
  await writeFile(path.join(output, 'checks.json'), JSON.stringify({ checks, geometry, errors, remoteData, securitySoftwareRequests, realSockets }, null, 2))
  await browser.close()
}

async function savePrint(html, name) {
  const print = await context.newPage()
  try {
    await print.setViewportSize({ width: 794, height: 1123 })
    // A clean document avoids replacing an active React root in the PDF verifier.
    await print.setContent(html.replace('<head>', `<head><base href="${baseURL}/">`), { waitUntil: 'networkidle' })
    await print.evaluate(() => document.fonts.ready)
    assert.ok(await print.evaluate(() => [...document.images].every(image => image.complete && image.naturalWidth > 0)))
    await print.pdf({ path: path.join(output, `${name}-a4.pdf`), preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false })
    await print.screenshot({ path: path.join(output, `${name}-print.png`), fullPage: true })
  } finally { await print.close() }
}
