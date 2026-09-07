import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, expect } from '@playwright/test'
import sharp from 'sharp'

// Standalone diagnostic only. Requires an already-running chart lab; never updates baselines.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.resolve(root, process.argv[2] ?? 'output/chart-raster-probe')
const baseURL = process.env.CHART_LAB_URL ?? 'http://127.0.0.1:18474'
const fixedTime = '2026-09-05T03:00:00.000Z'
const args = ['--disable-lcd-text', '--font-render-hinting=none', '--force-color-profile=srgb', '--disable-gpu']
const fontsDir = path.join(root, 'tests/chart-verification/fonts')
const candidateDir = path.join(root, 'tests/chart-verification/baseline-candidates/software-v1/win32/chrome-1920/screenshots.spec.ts')
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const sourceFiles = [
  'scripts/check-chart-raster.mjs', 'package-lock.json', 'src/app/globals.css',
  'src/components/exercises/exercise-charts.tsx', 'src/components/heart-rate/HeartRateChart.tsx',
  'tests/chart-lab/app/page.tsx', 'tests/chart-lab/app/page.module.css',
  'tests/chart-lab/fixtures.ts', 'tests/chart-verification/fonts/manifest.json',
]
const sourceHashes = async () => Object.fromEntries(await Promise.all(sourceFiles.map(async file =>
  [file, sha256(await readFile(path.join(root, file)))])))

async function settle(page) {
  await page.evaluate(async () => {
    for (const weight of [400, 500, 600, 700, 800]) {
      const loaded = await document.fonts.load(`${weight} 14px Pretendard`, '\uC6D4\uBCC4 \uAC80\uC99D 0123456789')
      if (!loaded.length || loaded.some(font => font.status !== 'loaded')) throw new Error(`Font weight ${weight} not loaded`)
    }
    await document.fonts.ready
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
}

async function scenario(page, name) {
  await page.getByLabel('\uAC80\uC99D \uB370\uC774\uD130', { exact: true }).selectOption(name)
  await expect(page.getByTestId('chart-lab')).toHaveAttribute('data-scenario', name, { timeout: 15000 })
  await expect(page.getByTestId('chart-lab')).toHaveAttribute('data-running', 'false')
  await settle(page)
}

async function textMetrics(region) {
  return region.evaluate(element => {
    const rect = box => ({ x: box.x, y: box.y, width: box.width, height: box.height })
    const matrix = value => value ? Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f'].map(key => [key, value[key]])) : null
    return {
      regionRect: rect(element.getBoundingClientRect()), scroll: { x: scrollX, y: scrollY },
      text: Array.from(element.querySelectorAll('h2, svg text')).map((node, index) => {
        const style = getComputedStyle(node)
        const svg = typeof node.getNumberOfChars === 'function'
        const result = {
          index, tag: node.tagName, textContent: node.textContent,
          clientRect: rect(node.getBoundingClientRect()),
          bbox: svg ? rect(node.getBBox()) : null,
          computedFont: Object.fromEntries(['font', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle',
            'fontStretch', 'fontKerning', 'fontFeatureSettings', 'fontVariationSettings',
            'fontVariantNumeric', 'fontSynthesis', 'letterSpacing', 'lineHeight', 'textRendering',
            'webkitFontSmoothing'].map(key => [key, style[key]])),
          transform: { css: style.transform, origin: style.transformOrigin,
            attribute: node.getAttribute('transform'), ctm: svg ? matrix(node.getCTM()) : null,
            screenCTM: svg ? matrix(node.getScreenCTM()) : null },
          chars: [],
        }
        if (svg) {
          result.charIndexConvention = 'SVG addressable character index; text hint uses UTF-16 indexing'
          for (let i = 0; i < node.getNumberOfChars(); i++) {
            try {
              const start = node.getStartPositionOfChar(i)
              const end = node.getEndPositionOfChar(i)
              result.chars.push({ index: i, textHint: node.textContent[i], rect: rect(node.getExtentOfChar(i)),
                start: { x: start.x, y: start.y }, end: { x: end.x, y: end.y }, rotation: node.getRotationOfChar(i) })
            } catch (error) { result.chars.push({ index: i, unavailable: String(error) }) }
          }
        } else {
          const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
          let textNode
          while ((textNode = walker.nextNode())) {
            for (let i = 0; i < textNode.length; i++) {
              const range = document.createRange()
              range.setStart(textNode, i)
              range.setEnd(textNode, i + 1)
              result.chars.push({ index: result.chars.length, textHint: textNode.data[i], rect: rect(range.getBoundingClientRect()) })
            }
          }
        }
        return result
      }),
    }
  })
}

async function capture(page, cdp, round, id, name) {
  const region = page.getByTestId(id)
  await expect(region).toBeVisible()
  await expect(region.locator('svg.recharts-surface, svg[data-chart]')).toHaveCount(1)
  await region.scrollIntoViewIfNeeded()
  await settle(page)
  await page.mouse.move(0, 0)
  const png = `round-${round}-${name}.png`
  await region.screenshot({ path: path.join(output, png), animations: 'disabled', caret: 'hide', scale: 'css', timeout: 15000 })
  const metrics = await textMetrics(region)
  const { root: document } = await cdp.send('DOM.getDocument')
  const { nodeIds } = await cdp.send('DOM.querySelectorAll', {
    nodeId: document.nodeId, selector: `[data-testid="${id}"] h2, [data-testid="${id}"] svg text`,
  })
  if (nodeIds.length !== metrics.text.length) throw new Error('DOM changed between text and platform-font collection')
  for (let i = 0; i < nodeIds.length; i++) {
    metrics.text[i].platformFonts = (await cdp.send('CSS.getPlatformFontsForNode', { nodeId: nodeIds[i] })).fonts
  }
  return { name, png, pngSha256: sha256(await readFile(path.join(output, png))),
    platformFontsScope: 'All region h2 and SVG text nodes; glyphCount is per node/font, not a per-character font mapping.',
    ...metrics }
}

async function rawDiff(left, right) {
  const a = await sharp(left).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const b = await sharp(right).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const size = image => ({ width: image.info.width, height: image.info.height, channels: image.info.channels })
  if (JSON.stringify(size(a)) !== JSON.stringify(size(b))) {
    return { sameDimensions: false, left: size(a), right: size(b), differingPixels: null }
  }
  let differingPixels = 0
  let minX = a.info.width, minY = a.info.height, maxX = -1, maxY = -1
  for (let i = 0; i < a.data.length; i += a.info.channels) {
    let different = false
    for (let c = 0; c < a.info.channels; c++) if (a.data[i + c] !== b.data[i + c]) different = true
    if (!different) continue
    differingPixels++
    const pixel = i / a.info.channels, x = pixel % a.info.width, y = Math.floor(pixel / a.info.width)
    minX = Math.min(minX, x); minY = Math.min(minY, y)
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
  }
  return { sameDimensions: true, ...size(a), differingPixels,
    totalPixels: a.info.width * a.info.height,
    boundsInclusive: differingPixels ? { minX, minY, maxX, maxY } : null }
}

async function main() {
  const manifest = JSON.parse(await readFile(path.join(fontsDir, 'manifest.json'), 'utf8'))
  const assets = await Promise.all(manifest.assets.map(async asset => {
    const bytes = await readFile(path.join(fontsDir, asset.file))
    if (sha256(bytes) !== asset.sha256) throw new Error(`Pinned asset hash mismatch: ${asset.file}`)
    return { ...asset, bytes }
  }))
  // Non-recursive exclusive creation refuses existing output, including symlinks.
  await mkdir(output)
  const report = {
    diagnosticOnly: true, userApproved: false, status: 'running',
    warning: 'Not an approval, baseline update, functional test or strict screenshot verdict. Raw RGBA differences only.',
    startedAt: new Date().toISOString(), baseURL, fixedTime, args,
    legacyScreenshotRequested: Boolean(process.env.PLAYWRIGHT_LEGACY_SCREENSHOT),
    viewport: { width: 1920, height: 1080 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul', deviceScaleFactor: 1,
    node: process.version, platform: process.platform, arch: process.arch,
    pinnedAssets: manifest.assets, rounds: [], comparisons: [],
  }
  let browser
  try {
    report.sourceHashesBefore = await sourceHashes()
    for (let round = 1; round <= 3; round++) {
      browser = await chromium.launch({ channel: 'chrome', headless: true, args, timeout: 20000 })
      const context = await browser.newContext({ baseURL, viewport: report.viewport, locale: report.locale,
        timezoneId: report.timezoneId, deviceScaleFactor: 1, colorScheme: 'light', reducedMotion: 'reduce', serviceWorkers: 'block' })
      const page = await context.newPage()
      page.setDefaultTimeout(10000)
      page.setDefaultNavigationTimeout(15000)
      const evidence = { round, browserVersion: browser.version(), pageErrors: [], captures: [] }
      report.rounds.push(evidence)
      page.on('pageerror', error => evidence.pageErrors.push(error.message))
      page.on('crash', () => evidence.pageErrors.push('Page crashed'))
      for (const asset of assets) await page.route(asset.url, route => route.fulfill({ status: 200,
        contentType: asset.mime, headers: { 'access-control-allow-origin': '*' }, body: asset.bytes }))
      await page.clock.setFixedTime(new Date(fixedTime))
      await page.goto('/')
      await expect(page.getByTestId('chart-lab')).toHaveAttribute('data-ready', 'true', { timeout: 15000 })
      const cdp = await context.newCDPSession(page)
      await cdp.send('DOM.enable')
      await cdp.send('CSS.enable')
      for (const name of ['normal', 'spike']) {
        await scenario(page, name)
        for (const id of ['monthly-bars', 'monthly-lines']) evidence.captures.push(await capture(page, cdp, round, id, `${name}-${id}`))
      }
      await scenario(page, 'normal')
      await page.getByRole('tab', { name: '\uC2E4\uC2DC\uAC04 \uD30C\uD615', exact: true }).click()
      await expect(page.getByTestId('live-grid').locator('button[data-student-no]')).toHaveCount(30)
      await page.getByTestId('live-grid').locator('button[data-student-no="1"]').click()
      evidence.captures.push(await capture(page, cdp, round, 'live-detail', 'normal-live-detail'))
      evidence.environment = await page.evaluate(() => ({ devicePixelRatio, userAgent: navigator.userAgent,
        fonts: Array.from(document.fonts, font => ({ family: font.family, weight: font.weight, status: font.status })) }))
      await browser.close()
      browser = null
      await writeFile(path.join(output, `round-${round}.json`), JSON.stringify(evidence, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' })
    }
    for (const round of report.rounds) {
      for (const captured of round.captures) {
        const actual = path.join(output, captured.png)
        const candidate = path.join(candidateDir, `${captured.name}.png`)
        const bytes = await readFile(candidate)
        report.comparisons.push({ kind: 'existing-candidate', actual: captured.png, candidate,
          candidateSha256: sha256(bytes), ...await rawDiff(actual, bytes) })
        for (const earlier of report.rounds.filter(item => item.round < round.round)) {
          const previous = earlier.captures.find(item => item.name === captured.name)
          report.comparisons.push({ kind: 'between-rounds', left: previous.png, right: captured.png,
            ...await rawDiff(path.join(output, previous.png), actual) })
        }
      }
    }
    report.status = report.rounds.some(round => round.pageErrors.length) ? 'completed-with-page-errors' : 'completed'
    if (report.status !== 'completed') process.exitCode = 1
  } catch (error) {
    report.status = 'incomplete'
    report.error = error.stack ?? String(error)
    process.exitCode = 1
  } finally {
    if (browser) await browser.close().catch(error => { report.closeError = String(error) })
    report.endedAt = new Date().toISOString()
    report.sourceHashesAfter = await sourceHashes()
    report.sourceChangedDuringRun = JSON.stringify(report.sourceHashesBefore) !== JSON.stringify(report.sourceHashesAfter)
    if (report.sourceChangedDuringRun) process.exitCode = 1
    await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' })
  }
  console.log(JSON.stringify({ status: report.status, diagnosticOnly: true, output,
    rounds: report.rounds.length, comparisons: report.comparisons.length,
    differingComparisons: report.comparisons.filter(item => !item.sameDimensions || item.differingPixels > 0).length }))
}

main().catch(error => { console.error(error.message); process.exitCode = 1 })
