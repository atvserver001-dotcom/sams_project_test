import type { Sample } from './session'

export const Y_MIN = 60
export const Y_MAX = 200
export const chartY = (bpm: number, height: number) => (Y_MAX - Math.max(Y_MIN, Math.min(Y_MAX, bpm))) / (Y_MAX - Y_MIN) * height

export function movingAverage(samples: Sample[], seconds = 5): Sample[] {
  const window: number[] = []
  return samples.map(sample => {
    if (sample.bpm === null) { window.length = 0; return sample }
    window.push(sample.bpm)
    if (window.length > seconds) window.shift()
    return { ...sample, bpm: window.reduce((sum, value) => sum + value, 0) / window.length }
  })
}

// A bin containing any gap stays a gap, including after coarse tile decimation.
export function tileSamples(samples: Sample[], limit = 45): Sample[] {
  const step = Math.max(1, Math.ceil(samples.length / limit))
  const output: Sample[] = []
  for (let start = 0; start < samples.length; start += step) {
    const bin = samples.slice(start, start + step)
    const values = bin.map(point => point.bpm)
    output.push({ ...bin[bin.length - 1], bpm: values.some(value => value === null) ? null
      : (values as number[]).reduce((sum, value) => sum + value, 0) / values.length })
  }
  return output
}

export function chartGeometry(samples: Sample[], width: number, height: number, firstSec?: number, lastSec?: number) {
  const start = firstSec ?? samples[0]?.sec ?? 0
  const end = lastSec ?? samples[samples.length - 1]?.sec ?? start + 1
  const x = (sec: number) => (sec - start) / Math.max(1, end - start) * width
  const segments: { x: number; y: number; sec: number; bpm: number }[][] = []
  const gaps: { x: number; width: number }[] = []
  let segment: typeof segments[number] = []
  for (const sample of samples) {
    if (sample.bpm === null) {
      if (segment.length) segments.push(segment)
      segment = []
    } else segment.push({ x: x(sample.sec), y: chartY(sample.bpm, height), sec: sample.sec, bpm: sample.bpm })
  }
  if (segment.length) segments.push(segment)
  for (let index = 0; index < samples.length; index++) {
    if (samples[index].bpm !== null) continue
    const begin = index
    while (index + 1 < samples.length && samples[index + 1].bpm === null) index++
    const left = x(samples[begin].sec)
    const right = index + 1 < samples.length ? x(samples[index + 1].sec) : width
    gaps.push({ x: left, width: Math.max(1, right - left) })
  }
  const area = segments.map(points => `M${points[0].x},${height} ${points.map(p => `L${p.x},${p.y}`).join(' ')} L${points[points.length - 1].x},${height} Z`).join(' ')
  const line = segments.map(points => `M${points.map(p => `${p.x},${p.y}`).join(' L')}`).join(' ')
  return { segments, gaps, area, line, x }
}

export function rawExtrema(samples: Sample[]) {
  type Extreme = { bpm: number; sec: number }
  let min: Extreme | null = null
  let max: Extreme | null = null
  for (const sample of samples) {
    if (sample.min !== null && (min === null || sample.min < min.bpm)) min = { bpm: sample.min, sec: sample.sec }
    if (sample.max !== null && (max === null || sample.max > max.bpm)) max = { bpm: sample.max, sec: sample.sec }
  }
  return { min, max }
}

export function placeExtremeLabel(x: number, y: number, width: number, height: number, occupied: { x: number; y: number }[], labelWidth = 154) {
  const left = Math.max(24, Math.min(width - labelWidth - 24, x - labelWidth / 2))
  const clamp = (top: number) => Math.max(0, Math.min(height - 30, top))
  const candidates = [y - 46, y + 20, y - 82, y + 56].map(clamp)
  const top = candidates.find(candidate => !occupied.some(box => Math.abs(box.x - left) < labelWidth + 4 && Math.abs(box.y - candidate) < 34)) ?? candidates[0]
  return { x: left, y: top }
}

export function relativeTimeLabel(startSec: number, endSec: number, fraction: number) {
  if (fraction === 1) return '현재'
  const duration = endSec - startSec + 1
  const remaining = Math.max(1, Math.floor(duration * (1 - fraction)))
  if (duration < 600 && remaining >= 60 && remaining % 60 !== 0) return `−${Math.floor(remaining / 60)}분 ${remaining % 60}초`
  return remaining >= 60 ? `−${Math.floor(remaining / 60)}분` : `−${remaining}초`
}
