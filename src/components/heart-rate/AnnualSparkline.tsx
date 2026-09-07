import { useId } from 'react'
import { isEvaluableHeartRate, type HeartRateRow } from '@/lib/heart-rate/monthly'
import { monthOrderIdx, zoneOf } from '@/lib/heart-rate/zones'
import { chartY } from '@/lib/heart-rate/chart'

export function AnnualSparkline({ row, age }: { row: HeartRateRow; age: number }) {
  const id = useId().replace(/:/g, '')
  const points = monthOrderIdx.map((month, index) => ({ x: 3 + index * 70 / 11,
    max: isEvaluableHeartRate(row.max_bpm[month]) ? row.max_bpm[month] : null,
    avg: isEvaluableHeartRate(row.avg_bpm[month]) ? row.avg_bpm[month] : null,
  }))
  const path = (key: 'max' | 'avg') => {
    let connected = false
    return points.map(point => {
      const value = point[key]
      if (value === null || value === undefined) { connected = false; return '' }
      const command = `${connected ? 'L' : 'M'}${point.x},${3 + chartY(value, 28)}`
      connected = true
      return command
    }).join(' ')
  }
  const maxima = points.filter((point): point is typeof point & { max: number } => typeof point.max === 'number')
  const maximum = maxima.length ? Math.max(...maxima.map(point => point.max)) : null
  const peak = maxima.find(point => point.max === maximum)
  return <svg viewBox="0 0 76 34" width="76" height="34" role="img" aria-label={`${row.name} 연간 최고·평균 심박 추이`}>
    <defs><clipPath id={id}><rect width="76" height="34" /></clipPath></defs>
    {maximum !== null && zoneOf(maximum, age).key === 'near_max' && <rect width="76" height="7" fill="#fff2ef" />}
    <g clipPath={`url(#${id})`}>
      <path d={path('max')} fill="none" stroke={maximum === null ? '#605d5d' : zoneOf(maximum, age).color} strokeWidth="2" />
      <path d={path('avg')} fill="none" stroke="#605d5d" strokeWidth="1.5" strokeDasharray="3 2" />
      {peak && <circle cx={peak.x} cy={3 + chartY(peak.max, 28)} r="2.5" fill={zoneOf(peak.max, age).color} />}
    </g>
  </svg>
}
