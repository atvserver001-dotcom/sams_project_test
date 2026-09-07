import { performance as nodePerformance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'
import { type Page, type TestInfo } from '@playwright/test'
import { expect, lastSec, openLab, openLive, selectStudent } from './browser'

export const PROPOSED_LIMITS = {
  sampleBuffer: 3000, frameGapP95Ms: 250, commitToFrameP95Ms: 250,
  maxFrameGapMs: 5000, maxCommitGapMs: 5000,
  heapGrowthBytes: 128 * 1024 * 1024, heapPeakBytes: 512 * 1024 * 1024,
}

export async function measureReplay(page: Page, testInfo: TestInfo, seconds: number, speed: 1 | 60) {
  const root = await openLab(page)
  const grid = await openLive(page)
  await page.getByRole('button', { name: '처음으로', exact: true }).click()
  await expect(root).toHaveAttribute('data-last-sec', '0')
  await page.getByLabel('재생 속도', { exact: true }).selectOption(String(speed))
  await grid.scrollIntoViewIfNeeded()
  const id = await root.getAttribute('data-session-id')
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Performance.enable')
  const heapBefore = await cdp.send('Runtime.getHeapUsage')
  const heaps = [{ wallSec: 0, usedSize: heapBefore.usedSize }]
  const focusSwitches: { no: number; latencyMs: number; wallSec: number }[] = []
  let start: number | undefined
  // Observation only: closure-owned measurements, no app globals, state injection or synthetic clock ticks.
  const observation = page.evaluate(durationMs => new Promise<{
    frameCount: number; frameGapP95Ms: number; maxFrameGapMs: number;
    commits: number; commitToFrameP95Ms: number; maxCommitGapMs: number;
    maxBuffer: number; hidden: boolean; longTaskCount: number; longestTaskMs: number;
    observedWallSeconds: number;
  }>(resolve => {
    const root = document.querySelector('[data-testid="chart-lab"]')!
    const histogram = new Uint32Array(10_001)
    const paintHistogram = new Uint32Array(10_001)
    let frames = 0, paints = 0, previous = 0, maxGap = 0
    let lastCommit = previous, commits = 0, maxCommitGap = 0
    let maxBuffer = Number(root.getAttribute('data-buffer-size')), hidden = document.hidden
    let longTaskCount = 0, longestTaskMs = 0, frame = 0
    let runningStart: number | undefined
    let deadline: number | undefined
    const visibility = () => { hidden ||= document.hidden }
    const raf = (now: number) => {
      const gap = now - previous
      histogram[Math.min(10_000, Math.ceil(gap))]++
      frames++; maxGap = Math.max(maxGap, gap); previous = now
      frame = requestAnimationFrame(raf)
    }
    const observer = new MutationObserver(records => {
      const running = root.getAttribute('data-running') === 'true'
      if (runningStart === undefined) {
        if (!running) return
        begin()
      }
      if (!running) { finish(); return }
      if (!records.some(record => record.attributeName === 'data-revision')) return
      const now = window.performance.now()
      maxBuffer = Math.max(maxBuffer, Number(root.getAttribute('data-buffer-size')))
      maxCommitGap = Math.max(maxCommitGap, now - lastCommit)
      lastCommit = now; commits++
      requestAnimationFrame(paint => { paintHistogram[Math.min(10_000, Math.ceil(Math.max(0, paint - now)))]++; paints++ })
    })
    observer.observe(root, { attributes: true, attributeFilter: ['data-revision', 'data-running'] })
    const tasks = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) { longTaskCount++; longestTaskMs = Math.max(longestTaskMs, entry.duration) }
    })
    const p95 = (buckets: Uint32Array, count: number) => {
      if (!count) return -1
      let sum = 0
      for (let i = 0; i < buckets.length; i++) { sum += buckets[i]; if (sum >= Math.ceil(count * .95)) return i }
      return -1
    }
    const finish = () => {
      window.clearTimeout(deadline)
      cancelAnimationFrame(frame); observer.disconnect(); tasks.disconnect()
      document.removeEventListener('visibilitychange', visibility)
      resolve({ frameCount: frames, frameGapP95Ms: p95(histogram, frames), maxFrameGapMs: maxGap,
        commits, commitToFrameP95Ms: p95(paintHistogram, paints), maxCommitGapMs: Math.max(maxCommitGap, window.performance.now() - lastCommit),
        maxBuffer, hidden, longTaskCount, longestTaskMs,
        observedWallSeconds: (window.performance.now() - runningStart!) / 1000 })
    }
    const atDeadline = () => {
      const remaining = durationMs - (window.performance.now() - runningStart!)
      if (remaining > 0) { deadline = window.setTimeout(atDeadline, Math.ceil(remaining)); return }
      finish()
    }
    const begin = () => {
      runningStart = window.performance.now()
      previous = runningStart
      lastCommit = runningStart
      hidden = document.hidden
      document.addEventListener('visibilitychange', visibility)
      frame = requestAnimationFrame(raf)
      tasks.observe({ entryTypes: ['longtask'] })
      deadline = window.setTimeout(atDeadline, durationMs)
    }
    // Arm before clicking Play, but measure only after the public running state.
    if (root.getAttribute('data-running') === 'true') begin()
  }), seconds * 1000)
  // Attach the rejection handler now, including for a renderer crash mid-soak.
  const settledObservation = observation.then(value => ({ value }), error => ({ error }))
  let metrics: Awaited<typeof observation> | undefined
  try {
    await page.getByRole('button', { name: '재생', exact: true }).click()
    await expect(root).toHaveAttribute('data-running', 'true')
    start = nodePerformance.now()
    let sampleAt = 0
    let lastProgressMinute = 0
    while (nodePerformance.now() - start < seconds * 1000) {
      await delay(Math.min(5000, Math.max(1, seconds * 1000 - (nodePerformance.now() - start))))
      const heap = await cdp.send('Runtime.getHeapUsage')
      const wallSec = (nodePerformance.now() - start) / 1000
      heaps.push({ wallSec, usedSize: heap.usedSize })
      await expect(root).toHaveAttribute('data-session-id', id!)
      await expect(root).toHaveAttribute('data-running', 'true')
      const current = await lastSec(page)
      expect(current).toBeGreaterThanOrEqual(sampleAt)
      sampleAt = current
      const bufferSize = Number(await root.getAttribute('data-buffer-size'))
      expect(bufferSize).toBeLessThanOrEqual(PROPOSED_LIMITS.sampleBuffer)
      const elapsedMinute = Math.floor(wallSec / 60)
      if (seconds >= 300 && elapsedMinute > lastProgressMinute) {
        console.log(`[chart-soak] wallSec=${wallSec.toFixed(1)} logicalSec=${current} buffer=${bufferSize} heapMiB=${(heap.usedSize / 1024 / 1024).toFixed(1)}`)
        lastProgressMinute = elapsedMinute
      }
      await expect(grid.locator('svg[data-chart="tile"]')).toHaveCount(30)
      const no = focusSwitches.length % 30 + 1
      const focusStart = nodePerformance.now()
      await selectStudent(page, no)
      await expect(root).toHaveAttribute('data-session-id', id!)
      await expect(grid.locator('svg[data-chart="tile"]')).toHaveCount(30)
      focusSwitches.push({ no, latencyMs: nodePerformance.now() - focusStart, wallSec: (nodePerformance.now() - start) / 1000 })
      await grid.scrollIntoViewIfNeeded()
    }
    await page.getByRole('button', { name: '일시정지', exact: true }).click()
    metrics = await observation
    const elapsed = (nodePerformance.now() - start) / 1000
    const logicalSeconds = await lastSec(page)
    await testInfo.attach('replay-metrics', { contentType: 'application/json', body: JSON.stringify({
      kind: speed === 1 ? 'WALL-CLOCK' : '60X-LOGICAL-REPLAY',
      proposedOnly: true, limits: PROPOSED_LIMITS, targetWallSeconds: seconds,
      actualWallSeconds: elapsed, speed, logicalSeconds, ...metrics, heaps, focusSwitches,
      caveat: 'Commit-to-next-rAF is not complete input-to-paint latency. CDP heap is JS heap, not process/GPU memory. No hardware or real-sensor guarantee.',
    }, null, 2) })
    expect(elapsed).toBeGreaterThanOrEqual(seconds)
    expect(metrics.observedWallSeconds, 'Browser observation must cover the full requested running duration').toBeGreaterThanOrEqual(seconds)
    expect(logicalSeconds).toBeGreaterThanOrEqual(Math.floor((seconds - 2) * speed))
    expect(logicalSeconds).toBeLessThanOrEqual(Math.ceil((elapsed + 1) * speed))
    expect(metrics.hidden, 'Background-tab throttling invalidates this performance sample').toBe(false)
    expect(metrics.frameCount).toBeGreaterThan(seconds)
    expect(metrics.commits, 'The real chart must commit repeatedly, not merely preload data').toBeGreaterThan(seconds * 2)
    expect(metrics.frameGapP95Ms).toBeGreaterThanOrEqual(0)
    expect(metrics.frameGapP95Ms).toBeLessThanOrEqual(PROPOSED_LIMITS.frameGapP95Ms)
    expect(metrics.commitToFrameP95Ms).toBeGreaterThanOrEqual(0)
    expect(metrics.commitToFrameP95Ms).toBeLessThanOrEqual(PROPOSED_LIMITS.commitToFrameP95Ms)
    expect(metrics.maxFrameGapMs).toBeLessThanOrEqual(PROPOSED_LIMITS.maxFrameGapMs)
    expect(metrics.maxCommitGapMs).toBeLessThanOrEqual(PROPOSED_LIMITS.maxCommitGapMs)
    expect(metrics.maxBuffer).toBeLessThanOrEqual(PROPOSED_LIMITS.sampleBuffer)
    expect(Math.max(...heaps.map(heap => heap.usedSize))).toBeLessThanOrEqual(PROPOSED_LIMITS.heapPeakBytes)
    expect(heaps.at(-1)!.usedSize - heaps[0].usedSize).toBeLessThanOrEqual(PROPOSED_LIMITS.heapGrowthBytes)
    if (seconds * speed >= 3600) await expect(root).toHaveAttribute('data-buffer-size', '3000')
    const paused = await lastSec(page)
    await delay(1100)
    await expect(root).toHaveAttribute('data-last-sec', String(paused))
  } finally {
    // The public pause state terminates observers immediately, not at the hour deadline.
    if (!page.isClosed()) {
      const pause = page.getByRole('button', { name: '일시정지', exact: true })
      if (await pause.count()) await pause.click({ timeout: 2000 }).catch(() => {})
    }
    const stopped = await Promise.race([settledObservation.then(() => true), delay(1500).then(() => false)])
    if (!stopped && !page.isClosed()) await page.close()
    const observed = await settledObservation
    if (!metrics) await testInfo.attach('replay-incomplete', { contentType: 'application/json', body: JSON.stringify({
      completed: false, wallSeconds: start === undefined ? 0 : (nodePerformance.now() - start) / 1000, speed, heaps, focusSwitches,
      ...( 'value' in observed ? observed.value : { observationError: String(observed.error) }),
    }) })
    await cdp.detach().catch(() => {})
  }
}
