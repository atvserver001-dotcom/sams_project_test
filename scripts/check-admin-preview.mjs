import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium, expect as baseExpect } from '@playwright/test'

const expect = baseExpect.configure({ timeout: 15000 })
const target = new URL(process.env.ADMIN_PREVIEW_URL || 'http://127.0.0.1:18476')
assert.ok(target.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) &&
  Number(target.port) >= 1024 && Number(target.port) <= 65535 && target.pathname === '/' &&
  !target.username && !target.password && !target.search && !target.hash,
  'ADMIN_PREVIEW_URL must be a loopback HTTP origin with an explicit preview port')
const baseURL = target.origin
const output = path.resolve('output/playwright/admin-preview')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome' })
const context = await browser.newContext({ baseURL, viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
const page = await context.newPage()
const checks = [], errors = [], consoleErrors = [], remoteData = [], securitySoftwareRequests = [], sockets = [], geometry = [], contentColors = []
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
context.on('request', request => {
  const url = new URL(request.url())
  if (['fetch', 'xhr', 'websocket'].includes(request.resourceType()) && url.origin !== baseURL) {
    if (url.hostname === 'gc.kis.v2.scr.kaspersky-labs.com') securitySoftwareRequests.push(request.url())
    else remoteData.push(request.url())
  }
})
page.on('websocket', socket => { if (!socket.url().includes('/_next/')) sockets.push(socket.url()) })
page.on('dialog', dialog => dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss())
const read = async url => {
  const response = await context.request.get(url)
  assert.equal(response.status(), 200, url)
  return response.json()
}
const shot = async name => {
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: path.join(output, `${name}.png`), animations: 'disabled' })
}
const check = async (name, action) => { await action(); checks.push(name); console.log(`PASS ${name}`) }
async function layoutCheck(theme = 'admin') {
  await expect(page.locator('.console-shell')).toHaveAttribute('data-console-theme', theme)
  await expect(page.locator('.console-nav [aria-current="page"]')).toHaveCount(1)
  await expect(page.locator('.console-nav [aria-current="page"]')).toHaveCSS('color', theme === 'admin' ? 'rgb(29, 78, 216)' : 'rgb(236, 48, 19)')
  const result = await page.evaluate(() => {
    const brand = document.querySelector('.console-brand').getBoundingClientRect()
    const header = document.querySelector('.console-page-header').getBoundingClientRect()
    return { path: location.pathname, width: innerWidth, delta: brand.bottom - header.bottom, overflow: document.documentElement.scrollWidth - innerWidth,
      images: [...document.images].every(image => image.complete && image.naturalWidth > 0),
      destructive: getComputedStyle(document.documentElement).getPropertyValue('--destructive').trim(),
      chart: getComputedStyle(document.documentElement).getPropertyValue('--chart-1').trim() }
  })
  assert.equal(result.delta, 0)
  assert.equal(result.overflow, 0)
  assert.equal(result.images, true)
  assert.equal(result.destructive, '#ae1800')
  assert.equal(result.chart, '#ec3013')
  geometry.push(result)
}
async function dialogCheck(name, action = '저장') {
  const dialog = page.getByRole('dialog', { name, exact: true })
  await expect(dialog).toBeVisible()
  const box = await dialog.boundingBox(), viewport = page.viewportSize()
  assert.ok(Math.abs(box.x + box.width / 2 - viewport.width / 2) <= 1)
  assert.ok(Math.abs(box.y + box.height / 2 - viewport.height / 2) <= 1)
  await expect(dialog.getByRole('button', { name: action, exact: true })).toHaveCSS('background-color', 'rgb(29, 78, 216)')
  return dialog
}
const schoolRow = name => page.getByRole('row').filter({ has: page.getByText(name, { exact: true }) })
async function contentColorCheck() {
  const schools = (await read('/api/admin/schools')).items
  const identities = {
    '운동기록관리': { kind: 'exercise', color: 'rgb(37, 99, 235)', shape: 'lucide-dumbbell' },
    'PAPS기록관리': { kind: 'paps', color: 'rgb(15, 118, 110)', shape: 'lucide-clipboard-check' },
    '심박기록관리': { kind: 'heart', color: 'rgb(225, 29, 72)', shape: 'lucide-heart-pulse' },
    '체력측정관리': { kind: 'fitness', color: 'rgb(124, 58, 237)', shape: 'lucide-gauge' },
  }
  const expected = schools.flatMap(school => school.contents.map(content => identities[content.name] ||
    { kind: 'custom', color: 'rgb(96, 93, 93)', shape: 'lucide-package' }))
  const actual = await page.evaluate(() => {
    const describe = selector => [...document.querySelectorAll(selector)].map(element => {
      const css = getComputedStyle(element), icon = element.querySelector('.school-content-icon')
      const svg = icon.matches('svg') ? icon : icon.querySelector('svg')
      const box = icon.getBoundingClientRect()
      return { background: css.backgroundColor, border: css.borderColor,
        identity: { kind: icon.getAttribute('data-content-kind'), color: getComputedStyle(icon).color,
          shape: [...svg.classList].find(name => name.startsWith('lucide-')) },
        hidden: svg.getAttribute('aria-hidden'), shapes: svg.children.length,
        width: box.width, height: box.height, keys: [...element.querySelectorAll('code')].map(code => getComputedStyle(code).color) }
    })
    const reference = document.createElement('span')
    reference.style.display = 'none'
    document.body.append(reference)
    reference.style.color = 'color-mix(in oklab, #eae9e9 40%, transparent)'
    const badgeBackground = getComputedStyle(reference).color
    reference.style.color = 'color-mix(in oklab, rgba(32, 30, 29, .4) 45%, transparent)'
    const border = getComputedStyle(reference).color
    reference.remove()
    return { cards: describe('.school-content-device-card'), badges: describe('.school-content-badge'), badgeBackground, border }
  })
  assert.ok(expected.length > 0)
  assert.deepEqual(actual.cards.map(card => card.identity), expected)
  assert.deepEqual(actual.badges.map(badge => badge.identity), expected)
  for (const badge of actual.badges) assert.equal(badge.background, actual.badgeBackground)
  for (const card of actual.cards) {
    assert.equal(card.background, 'rgb(255, 255, 255)')
    assert.ok(card.keys.every(color => color === 'rgb(174, 24, 0)'))
  }
  for (const item of [...actual.cards, ...actual.badges]) {
    assert.equal(item.border, actual.border)
    assert.equal(item.width, 16)
    assert.equal(item.height, 16)
    assert.equal(item.hidden, 'true')
    assert.ok(item.shapes > 0)
  }
  assert.equal(schools.flatMap(school => school.contents).find(content => content.name === '추가 콘텐츠 (샘플)').color_hex, '#DCFCE7')
  await expect(page.getByText(/기간종료/).first()).toHaveCSS('color', 'rgb(174, 24, 0)')
  contentColors.push(actual)
}
async function enterSchool(name) {
  await page.goto('/admin/school-details')
  await schoolRow(name).getByRole('button', { name: '이동', exact: true }).click()
  await expect(page).toHaveURL(`${baseURL}/school`)
  await expect(page.locator('.acting-banner')).toContainText(name)
  await expect(page.locator('.console-account')).toContainText(name)
  await expect(page.locator('.recharts-bar').first()).toBeVisible()
  await expect(page.locator('.console-nav').getByRole('button', { name: '스마트미러', exact: true })).toHaveCount(1)
  await layoutCheck('school')
}
async function backToAdmin() {
  await page.getByRole('button', { name: '관리자로 돌아가기', exact: true }).click()
  await expect(page).toHaveURL(`${baseURL}/admin/accounts`)
  await expect(page.locator('.acting-banner')).toHaveCount(0)
  await layoutCheck()
}

try {
  const bootstrap = await context.request.get('/api/preview/status', { maxRedirects: 0 })
  assert.equal(bootstrap.status(), 200)
  assert.equal(bootstrap.headers()['x-admin-preview'], 'synthetic')
  const status = await bootstrap.json()
  assert.equal(status.synthetic, true)
  assert.equal(status.mode, 'admin')
  await check('admin direct entry and blue FHD shell', async () => {
    await page.goto('/admin')
    await expect(page.getByRole('cell', { name: 'preview_admin', exact: true })).toBeVisible()
    await layoutCheck()
    assert.equal((await read('/api/preview/status')).synthetic, true)
    await shot('01-accounts-fhd')
  })
  await check('account creation and editing persist in the sample session', async () => {
    await page.getByRole('button', { name: '생성', exact: true }).click()
    const dialog = await dialogCheck('계정 관리')
    await dialog.getByLabel('ID', { exact: true }).fill('preview_added_teacher')
    await dialog.getByLabel('비밀번호', { exact: true }).fill('preview-only')
    await dialog.getByLabel('학교 선택', { exact: true }).selectOption('admin-preview-school-1')
    await shot('02-account-modal-fhd')
    await dialog.getByRole('button', { name: '저장', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await page.reload()
    const row = schoolRow('preview_added_teacher')
    await row.getByRole('button', { name: '수정', exact: true }).click()
    await page.getByRole('dialog').getByLabel('ID', { exact: true }).fill('preview_added_teacher_checked')
    await page.getByRole('dialog').getByRole('button', { name: '저장', exact: true }).click()
    await expect(page.getByRole('cell', { name: 'preview_added_teacher_checked', exact: true })).toBeVisible()
  })
  await check('device catalog create edit and order persist', async () => {
    await page.getByRole('link', { name: '디바이스 관리', exact: true }).click()
    await page.getByRole('radio', { name: '디바이스 관리', exact: true }).click()
    await page.getByRole('button', { name: '디바이스 추가', exact: true }).click()
    const dialog = await dialogCheck('디바이스 관리')
    await dialog.getByLabel('디바이스 이름', { exact: true }).fill('추가 기기 (샘플)')
    await shot('03-device-modal-fhd')
    await dialog.getByRole('button', { name: '저장', exact: true }).click()
    const row = schoolRow('추가 기기 (샘플)')
    await row.getByRole('button', { name: '수정', exact: true }).click()
    await page.getByRole('dialog').getByLabel('디바이스 이름', { exact: true }).fill('추가 기기 확인 (샘플)')
    await page.getByRole('dialog').getByRole('button', { name: '저장', exact: true }).click()
    const response = page.waitForResponse(r => r.url().endsWith('/api/admin/devices') && r.request().method() === 'PUT')
    await schoolRow('추가 기기 확인 (샘플)').getByRole('button', { name: '▲', exact: true }).click()
    assert.equal((await response).status(), 200)
    await layoutCheck()
    await shot('04-devices-fhd')
    const devices = (await read('/api/admin/devices')).items
    assert.equal(devices.at(-2).device_name, '추가 기기 확인 (샘플)')
  })
  await check('content catalog links the new device and keeps its own color', async () => {
    await page.getByRole('radio', { name: '컨텐츠 관리', exact: true }).click()
    await page.getByRole('button', { name: '컨텐츠 추가', exact: true }).click()
    const dialog = await dialogCheck('콘텐츠 관리')
    await dialog.getByLabel('컨텐츠 이름', { exact: true }).fill('추가 콘텐츠 (샘플)')
    await dialog.getByLabel('설명', { exact: true }).fill('관리자 미리보기 확인용')
    await dialog.getByLabel('컨텐츠 색상 코드', { exact: true }).fill('#DCFCE7')
    await dialog.getByRole('checkbox', { name: '추가 기기 확인 (샘플)', exact: true }).check()
    await shot('05-content-modal-fhd')
    await dialog.getByRole('button', { name: '저장', exact: true }).click()
    await expect(schoolRow('추가 콘텐츠 (샘플)')).toContainText('추가 기기 확인 (샘플)')
    await shot('06-contents-fhd')
  })
  await check('school creation and assigned device quantity persist', async () => {
    await page.getByRole('link', { name: '학교관리', exact: true }).click()
    await page.getByRole('button', { name: '생성', exact: true }).click()
    const dialog = await dialogCheck('학교 관리')
    await dialog.getByLabel('그룹번호', { exact: true }).fill('1999')
    await dialog.getByLabel('학교 이름', { exact: true }).fill('추가초등학교 (샘플)')
    await dialog.getByRole('checkbox', { name: '추가 콘텐츠 (샘플)', exact: true }).check()
    await dialog.getByTitle('수량 증가', { exact: true }).click()
    await shot('07-school-create-fhd')
    await dialog.getByRole('button', { name: '저장', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await page.reload()
    await expect(schoolRow('추가초등학교 (샘플)')).toContainText('추가 기기 확인 (샘플)')
    await contentColorCheck()
    await layoutCheck()
  })
  await check('school edit and device memo persist without losing assignments', async () => {
    await schoolRow('샘플초등학교').getByRole('button', { name: '수정', exact: true }).click()
    const dialog = await dialogCheck('학교 관리')
    await expect(dialog.getByLabel('학교 이름', { exact: true })).toHaveValue('샘플초등학교')
    await dialog.getByLabel('학교 이름', { exact: true }).fill('샘플초등학교 확인')
    await dialog.getByRole('button', { name: '저장', exact: true }).click()
    await schoolRow('샘플초등학교 확인').getByRole('button', { name: '메모', exact: true }).first().click()
    const memo = await dialogCheck('디바이스 메모', '완료')
    await memo.getByPlaceholder('메모를 입력하세요').fill('관리자에서 변경한 샘플 메모')
    await shot('08-device-memo-fhd')
    await memo.getByRole('button', { name: '완료', exact: true }).click()
    await page.reload()
    await expect(schoolRow('샘플초등학교 확인')).toContainText('관리자에서 변경한 샘플 메모')
    await shot('09-schools-fhd')
  })
  await check('school details reflect accounts and allow red school acting context', async () => {
    await page.getByRole('link', { name: '학교 세부정보', exact: true }).click()
    const rows = (await read('/api/admin/school-details?page=1&pageSize=10')).items
    const first = rows.find(row => row.group_no === '1001')
    assert.equal(first.name, '샘플초등학교 확인')
    assert.equal(first.teacher_accounts, 2)
    await layoutCheck()
    await shot('10-school-details-fhd')
    await enterSchool('샘플초등학교 확인')
    await shot('11-acting-school-fhd')
    await page.getByRole('link', { name: '학생 정보입력', exact: true }).click()
    await schoolRow('김민준').getByRole('button', { name: '수정', exact: true }).click()
    await page.getByRole('dialog').getByLabel('이름', { exact: true }).fill('김민준 관리자 확인')
    await page.getByRole('dialog').getByRole('button', { name: '저장', exact: true }).click()
    await expect(page.getByRole('cell', { name: '김민준 관리자 확인', exact: true })).toBeVisible()
    await backToAdmin()
  })
  await check('switching schools isolates records and restores each selected school', async () => {
    await enterSchool('샘플중학교')
    await page.getByRole('link', { name: '학생 정보입력', exact: true }).click()
    await expect(page.getByRole('cell', { name: '김민준', exact: true })).toBeVisible()
    await expect(page.getByRole('cell', { name: '김민준 관리자 확인', exact: true })).toHaveCount(0)
    await backToAdmin()
    await enterSchool('샘플초등학교 확인')
    await page.getByRole('link', { name: '학생 정보입력', exact: true }).click()
    await expect(page.getByRole('cell', { name: '김민준 관리자 확인', exact: true })).toBeVisible()
    await page.getByRole('link', { name: '디바이스 설정', exact: true }).click()
    await expect(page.getByText('관리자에서 변경한 샘플 메모', { exact: true })).toBeVisible()
    await backToAdmin()
  })
  await check('sample deletions refresh lists and device references remain protected', async () => {
    await page.getByRole('link', { name: '학교관리', exact: true }).click()
    await schoolRow('추가초등학교 (샘플)').getByRole('button', { name: '수정', exact: true }).click()
    await page.getByRole('dialog', { name: '학교 관리', exact: true }).getByRole('button', { name: '삭제', exact: true }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: '확인', exact: true }).click()
    await expect(schoolRow('추가초등학교 (샘플)')).toHaveCount(0)
    await page.getByRole('link', { name: '계정관리', exact: true }).click()
    await schoolRow('preview_added_teacher_checked').getByRole('button', { name: '삭제', exact: true }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: '확인', exact: true }).click()
    await expect(page.getByRole('cell', { name: 'preview_added_teacher_checked', exact: true })).toHaveCount(0)
  })
  await check('separate browser receives an unchanged admin sample', async () => {
    const second = await browser.newContext({ baseURL })
    try {
      await second.request.get('/api/preview/status')
      const data = await (await second.request.get('/api/admin/schools')).json()
      assert.ok(data.items.some(school => school.name === '샘플초등학교'))
      assert.ok(!data.items.some(school => school.name === '샘플초등학교 확인'))
    } finally { await second.close() }
    assert.equal((await context.request.get('/api/not-implemented')).status(), 404)
  })
  await check('admin 1440 layout and authenticated reset', async () => {
    await page.setViewportSize({ width: 1440, height: 1024 })
    await page.goto('/admin/devices')
    await layoutCheck()
    await shot('12-admin-1440')
    await page.goto('/preview')
    await page.getByRole('button', { name: '샘플 초기화', exact: true }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: '확인', exact: true }).click()
    await expect(page).toHaveURL(`${baseURL}/admin/accounts`)
    const reset = await read('/api/admin/schools')
    assert.ok(reset.items.some(school => school.name === '샘플초등학교'))
    assert.equal(reset.items.length, 3)
  })
  await check('signout persists and documented admin credentials restore access', async () => {
    await page.getByRole('button', { name: '로그아웃', exact: true }).click()
    await expect(page).toHaveURL(`${baseURL}/`)
    assert.equal((await context.request.get('/api/admin/schools')).status(), 401)
    await page.getByRole('textbox', { name: '아이디', exact: true }).fill('preview_admin')
    await page.getByLabel('비밀번호', { exact: true }).fill('preview-only')
    await page.getByRole('button', { name: '로그인', exact: true }).click()
    await expect(page).toHaveURL(`${baseURL}/admin/accounts`)
    await layoutCheck()
  })
  await check('final app errors and remote backend or hardware connections', async () => {
    assert.deepEqual(errors, [])
    assert.deepEqual(consoleErrors, [])
    assert.deepEqual(remoteData, [])
    assert.deepEqual(sockets, [])
  })
} catch (error) {
  await shot('failed')
  throw error
} finally {
  await writeFile(path.join(output, 'checks.json'), JSON.stringify({ checks, geometry, contentColors, errors, consoleErrors, remoteData, securitySoftwareRequests, sockets }, null, 2), 'utf8')
  await browser.close()
}
