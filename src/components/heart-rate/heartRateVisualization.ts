import type { ChartOptions } from 'chart.js'

import type { HeartRateMinutePoint as CollectorHeartRateMinutePoint } from '../../lib/heartRateCollector'
import {
  HEART_RATE_SESSION_MAX_BPM,
  HEART_RATE_SESSION_MIN_BPM,
  deriveHeartRateZone,
} from '../../lib/heartRateSession'
import type { HeartRateZone as SessionHeartRateZone } from '../../lib/heartRateSession'

export type HeartRateBatteryLevel = 1 | 2 | 3 | 4

export type HeartRateMinutePoint = Pick<
  CollectorHeartRateMinutePoint,
  'minuteIndex' | 'averageBpm' | 'sampleCount' | 'isPartial'
>

export interface HeartRateBpmScale {
  min: number
  max: number
}

export type HeartRateVisualizationZone = SessionHeartRateZone | 'neutral'

export const DEFAULT_HEART_RATE_SCALE: HeartRateBpmScale = { min: 60, max: 160 }

export function createHeartRateMinuteChartOptions(
  scale: HeartRateBpmScale,
): ChartOptions<'bar'> {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    events: [],
    normalized: true,
    devicePixelRatio: 1,
    layout: { padding: { top: 5 } },
    plugins: {
      legend: { display: false },
      tooltip: { enabled: false },
    },
    scales: {
      x: {
        display: false,
        grid: { display: false },
        border: { display: false },
      },
      y: {
        display: false,
        min: scale.min,
        max: scale.max,
        grid: { color: 'rgba(148, 163, 184, 0.16)', drawTicks: false },
        border: { display: false },
      },
    },
  }
}

export function getHeartRateBatteryLevel(
  percent: number | null | undefined,
): HeartRateBatteryLevel | null {
  if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 100) {
    return null
  }
  if (percent <= 25) return 1
  if (percent <= 50) return 2
  if (percent <= 75) return 3
  return 4
}

export function getHeartRateZone(
  bpm: number,
  estimatedHrMax: number | null,
): HeartRateVisualizationZone {
  if (
    !Number.isFinite(bpm)
    || bpm < HEART_RATE_SESSION_MIN_BPM
    || bpm > HEART_RATE_SESSION_MAX_BPM
    || !estimatedHrMax
    || estimatedHrMax <= 0
  ) {
    return 'neutral'
  }
  return deriveHeartRateZone(bpm, estimatedHrMax)
}

export function calculateSharedBpmScale(
  points: Iterable<HeartRateMinutePoint>,
): HeartRateBpmScale {
  let observedMin = DEFAULT_HEART_RATE_SCALE.min
  let observedMax = DEFAULT_HEART_RATE_SCALE.max

  for (const point of points) {
    if (
      point.isPartial ||
      !Number.isFinite(point.averageBpm) ||
      point.averageBpm < HEART_RATE_SESSION_MIN_BPM ||
      point.averageBpm > HEART_RATE_SESSION_MAX_BPM
    ) {
      continue
    }
    observedMin = Math.min(observedMin, point.averageBpm)
    observedMax = Math.max(observedMax, point.averageBpm)
  }

  return {
    min: Math.max(HEART_RATE_SESSION_MIN_BPM, Math.floor(observedMin / 10) * 10),
    max: Math.min(HEART_RATE_SESSION_MAX_BPM, Math.ceil(observedMax / 10) * 10),
  }
}
