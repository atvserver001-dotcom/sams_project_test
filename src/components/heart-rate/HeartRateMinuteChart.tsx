'use client'

import { memo, useMemo } from 'react'
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  LinearScale,
  Plugin,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'

import {
  HeartRateBpmScale,
  HeartRateMinutePoint,
  HeartRateVisualizationZone,
  createHeartRateMinuteChartOptions,
  getHeartRateZone,
} from './heartRateVisualization'

export {
  DEFAULT_HEART_RATE_SCALE,
  calculateSharedBpmScale,
  getHeartRateZone,
} from './heartRateVisualization'
export type {
  HeartRateBpmScale,
  HeartRateMinutePoint,
  HeartRateVisualizationZone,
} from './heartRateVisualization'

ChartJS.register(BarElement, CategoryScale, LinearScale)

const zoneColors: Record<HeartRateVisualizationZone, string> = {
  low: '#3b82f6',
  moderate: '#10b981',
  high: '#f59e0b',
  near_max: '#e11d48',
  neutral: '#94a3b8',
}

interface HeartRateMinuteChartProps {
  points: HeartRateMinutePoint[]
  ageYears: number | null
  estimatedHrMax: number | null
  scale: HeartRateBpmScale
  studentName: string
}

function markerPlugin(maxIndex: number | null, minIndex: number | null): Plugin<'bar'> {
  return {
    id: 'heart-rate-extrema-markers',
    afterDatasetsDraw(chart) {
      const metadata = chart.getDatasetMeta(0)
      const context = chart.ctx

      const drawTriangle = (index: number, direction: 'down' | 'up', xOffset: number) => {
        const bar = metadata.data[index]
        if (!bar) return
        const properties = bar.getProps(['x', 'y'], true)
        const x = properties.x + xOffset
        const y = Math.max(chart.chartArea.top + 4, properties.y - 4)
        context.save()
        context.fillStyle = direction === 'down' ? '#111827' : '#7c3aed'
        context.beginPath()
        if (direction === 'down') {
          context.moveTo(x - 3, y - 4)
          context.lineTo(x + 3, y - 4)
          context.lineTo(x, y + 1)
        } else {
          context.moveTo(x, y - 4)
          context.lineTo(x + 3, y + 1)
          context.lineTo(x - 3, y + 1)
        }
        context.closePath()
        context.fill()
        context.restore()
      }

      if (maxIndex !== null) drawTriangle(maxIndex, 'down', maxIndex === minIndex ? -2 : 0)
      if (minIndex !== null) drawTriangle(minIndex, 'up', maxIndex === minIndex ? 2 : 0)
    },
  }
}

function HeartRateMinuteChart({
  points,
  ageYears,
  estimatedHrMax,
  scale,
  studentName,
}: HeartRateMinuteChartProps) {
  const { min: scaleMin, max: scaleMax } = scale
  const chartModel = useMemo(() => {
    const validPoints = points
      .filter((point) => (
        Number.isInteger(point.minuteIndex) &&
        point.minuteIndex > 0 &&
        Number.isFinite(point.averageBpm)
      ))
      .sort((left, right) => left.minuteIndex - right.minuteIndex)
    const totalMinutes = Math.max(40, validPoints.at(-1)?.minuteIndex ?? 0)
    const pointByMinute = new Map(validPoints.map((point) => [point.minuteIndex, point]))
    const labels = Array.from({ length: totalMinutes }, (_, index) => String(index + 1))
    const values = labels.map((_, index) => pointByMinute.get(index + 1)?.averageBpm ?? null)
    const colors = labels.map((_, index) => {
      const point = pointByMinute.get(index + 1)
      if (!point) return 'rgba(226, 232, 240, 0.45)'
      const color = zoneColors[getHeartRateZone(point.averageBpm, estimatedHrMax)]
      return point.isPartial ? `${color}80` : color
    })
    const completed = validPoints.filter((point) => !point.isPartial)
    const maximum = completed.length > 0
      ? completed.reduce((highest, point) => point.averageBpm > highest.averageBpm ? point : highest)
      : null
    const minimum = completed.length > 0
      ? completed.reduce((lowest, point) => point.averageBpm < lowest.averageBpm ? point : lowest)
      : null
    const maximumIndex = maximum ? maximum.minuteIndex - 1 : null
    const minimumIndex = minimum ? minimum.minuteIndex - 1 : null

    return {
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: colors,
          borderSkipped: false,
          borderRadius: totalMinutes <= 40 ? 1.5 : 0,
          barPercentage: totalMinutes <= 40 ? 0.82 : 0.96,
          categoryPercentage: totalMinutes <= 40 ? 0.9 : 1,
        }],
      },
      maximum,
      minimum,
      plugin: markerPlugin(maximumIndex, minimumIndex),
      totalMinutes,
    }
  }, [estimatedHrMax, points])

  const options = useMemo(
    () => createHeartRateMinuteChartOptions({ min: scaleMin, max: scaleMax }),
    [scaleMax, scaleMin],
  )

  const latestPoint = points.length > 0
    ? points.reduce((latest, point) => point.minuteIndex > latest.minuteIndex ? point : latest)
    : null
  const ageLabel = ageYears === null ? '학년 기준 추정 나이 없음' : `학년 기준 추정 나이 ${ageYears}세`
  const extremaLabel = chartModel.maximum && chartModel.minimum
    ? `1분 평균 최고 ${chartModel.maximum.averageBpm.toFixed(1)} BPM, 최저 ${chartModel.minimum.averageBpm.toFixed(1)} BPM`
    : '완료된 1분 평균 없음'
  const chartLabel = `${studentName}, ${ageLabel}, ${latestPoint?.minuteIndex ?? 0}분까지 심박 막대그래프, ${extremaLabel}`

  return (
    <div className="flex h-full min-h-0 flex-col" aria-label={`${studentName} 1분 평균 그래프 영역`}>
      <div className="mb-0.5 flex h-3 shrink-0 items-center justify-between text-[8px] leading-none text-gray-400" aria-hidden="true">
        <span>1분 평균 · 1–{chartModel.totalMinutes}분</span>
        <span>
          {chartModel.maximum ? `▲${Math.round(chartModel.maximum.averageBpm)}` : '▲--'}
          {' · '}
          {chartModel.minimum ? `◆${Math.round(chartModel.minimum.averageBpm)}` : '◆--'}
        </span>
      </div>
      <div className="relative min-h-0 w-full flex-1">
        <Bar
          data={chartModel.data}
          options={options}
          plugins={[chartModel.plugin]}
          role="img"
          aria-label={chartLabel}
        />
      </div>
    </div>
  )
}

export default memo(HeartRateMinuteChart)
