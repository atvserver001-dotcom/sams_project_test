'use client'

import { useEffect, useId, useState } from 'react'
import { chartGeometry, chartY, movingAverage, placeExtremeLabel, rawExtrema, relativeTimeLabel, tileSamples } from '@/lib/heart-rate/chart'
import { average, windowSamples, type LiveStudent } from '@/lib/heart-rate/session'
import { formatDuration, HR_ZONES, zoneBounds, zoneOf } from '@/lib/heart-rate/zones'
import styles from './heart-care.module.css'

export function HeartRateChart({ live, detail = false, rail = false }: { live: LiveStudent; detail?: boolean; rail?: boolean }) {
  const id = useId().replace(/:/g, '')
  const [compact, setCompact] = useState(false)
  useEffect(() => {
    if (!detail) return
    const media = window.matchMedia('(max-width: 760px)')
    const update = () => setCompact(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [detail])
  const raw = windowSamples(live)
  const points = detail ? movingAverage(raw) : tileSamples(raw)
  const width = detail ? compact ? 400 : 1200 : 264
  const height = detail ? 320 : 64
  const start = raw[0]?.sec ?? 0
  const end = Math.max(start + 1, raw[raw.length - 1]?.sec ?? 1)
  const geometry = chartGeometry(points, width, height, start, end)
  const bounds = zoneBounds(live.participant.age)
  const extrema = rawExtrema(raw)
  const outside = [extrema.max && extrema.max.bpm > 200 ? { ...extrema.max, high: true } : null,
    extrema.min && extrema.min.bpm < 60 ? { ...extrema.min, high: false } : null].filter(Boolean) as { bpm: number; sec: number; high: boolean }[]
  const mean = average(live)
  const current = live.cur === null ? undefined : raw.findLast(sample => sample.bpm !== null)
  const lastSegment = geometry.segments[geometry.segments.length - 1]
  const endpoint = lastSegment?.[lastSegment.length - 1]
  const markers = detail ? [extrema.max && { ...extrema.max, high: true }, extrema.min && { ...extrema.min, high: false }].filter(Boolean) as { bpm: number; sec: number; high: boolean }[] : []
  const labelBoxes: { x: number; y: number }[] = []
  const timeTicks = raw.length <= 1 ? [0] : end - start < 4 ? [0, 1] : compact ? [0, .5, 1] : [0, .25, .5, .75, 1]

  return <svg className={detail ? styles.detailChart : rail ? styles.railChart : styles.tileChart}
    viewBox={detail ? compact ? '0 0 480 380' : '0 0 1300 380' : '0 0 264 64'} role="img"
    aria-label={`${live.participant.no}번 ${live.participant.name} 심박 파형, 60부터 200 bpm${mean === null ? ', 수신 기록 없음' : `, 세션 평균 ${mean} bpm`}`}
    data-chart={detail ? 'focus' : rail ? 'rail' : 'tile'}>
    <defs>
      <clipPath id={`${id}-area`}><path d={geometry.area} /></clipPath>
      <clipPath id={`${id}-plot`}><rect width={width} height={height} /></clipPath>
      <pattern id={`${id}-gap`} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="2" height="8" fill="#201e1d" opacity=".04" />
      </pattern>
    </defs>
    <g transform={detail ? compact ? 'translate(60 20)' : 'translate(70 20)' : undefined}>
      {!rail && <rect width={width} height={height} fill="#f3f2f2" />}
      {!rail && <g clipPath={`url(#${id}-area)`} data-zone-clipping="area">
        {HR_ZONES.map((zone, index) => {
          const top = chartY(index === HR_ZONES.length - 1 ? 200 : bounds[index], height)
          const bottom = chartY(index === 0 ? 60 : bounds[index - 1], height)
          return <rect key={zone.key} y={top} width={width} height={Math.max(0, bottom - top)} fill={zone.band} />
        })}
      </g>}
      {!rail && bounds.slice(0, -1).filter(bound => bound >= 60 && bound <= 200).map(bound =>
        <line key={bound} y1={chartY(bound, height)} y2={chartY(bound, height)} x2={width} stroke="rgba(32,30,29,.22)" />)}
      {!rail && geometry.gaps.map((gap, index) => <rect key={index} x={gap.x} width={gap.width} height={height} fill={`url(#${id}-gap)`} data-signal-gap />)}
      <g clipPath={`url(#${id}-plot)`}>
        {detail && mean !== null && <line x2={width} y1={chartY(mean, height)} y2={chartY(mean, height)} stroke="#201e1d" strokeWidth="2" strokeDasharray="8 5" />}
        {geometry.segments.length === 1
          ? <polyline points={geometry.segments[0].map(point => `${point.x},${point.y}`).join(' ')} fill="none" stroke="#201e1d" strokeWidth={detail ? 2.5 : rail ? 3.5 : 1.5} />
          : <path d={geometry.line} fill="none" stroke="#201e1d" strokeWidth={detail ? 2.5 : rail ? 3.5 : 1.5} />}
      </g>
      {!detail && outside.map(point => {
        const x = Math.max(3, Math.min(width - 3, geometry.x(point.sec)))
        return <g key={point.high ? 'above' : 'below'} data-out-of-range={point.high ? 'above' : 'below'}>
        <title>{`${point.bpm} bpm · 표시 범위 ${point.high ? '상한 200 초과' : '하한 60 미만'}`}</title>
        <path d={point.high ? `M${x - 3},7 l3,-5 l3,5 Z` : `M${x - 3},${height - 7} l3,5 l3,-5 Z`} fill="#ae1800" />
      </g>})}
      {detail && <>
        {HR_ZONES.map((zone, index) => {
          const top = chartY(index === HR_ZONES.length - 1 ? 200 : bounds[index], height)
          const bottom = chartY(index === 0 ? 60 : bounds[index - 1], height)
          if (bottom - top < 12) return null
          const range = index === 0 ? `<${bounds[0]}` : index === HR_ZONES.length - 1 ? `≥${bounds[3]}` : `${bounds[index - 1]}–${bounds[index] - 1}`
          return <text key={zone.key} x={width - 8} y={top + (compact ? 18 : 14)} textAnchor="end" fontSize={compact ? 16 : 12} fontWeight="700" fill={index >= HR_ZONES.length - 2 ? '#ae1800' : '#605d5d'}>{zone.label} {range}</text>
        })}
        <line y2={height} stroke="#201e1d66" strokeWidth="2" />
        <line y1={height} y2={height} x2={width} stroke="#201e1d66" strokeWidth="2" />
        {[60, ...bounds.slice(0, -1).filter(bound => bound > 60 && bound < 200), 200].map(value =>
          <text key={value} x="-12" y={chartY(value, height) + 4} textAnchor="end" fontSize={compact ? 17 : 12} fill="#605d5d">{value}</text>)}
        {timeTicks.map(fraction =>
          <text key={fraction} x={fraction * width} y={height + 24} textAnchor={compact && fraction === 1 ? 'end' : 'middle'} fontSize={compact ? 17 : 12} fill="#605d5d">{raw.length <= 1 ? '현재' : relativeTimeLabel(start, end, fraction)}</text>)}
      </>}
      {markers.map(marker => {
        const x = geometry.x(marker.sec)
        const y = chartY(marker.bpm, height)
        const labelWidth = compact ? 180 : 154
        const { x: labelX, y: labelY } = placeExtremeLabel(x, y, width, height, labelBoxes, labelWidth)
        labelBoxes.push({ x: labelX, y: labelY })
        const color = marker.high ? '#ae1800' : '#201e1d'
        return <g key={marker.high ? 'max' : 'min'} data-extreme={marker.high ? 'max' : 'min'}>
          {marker.high && <line x1={x} x2={x} y1={y} y2={height} stroke={color} strokeWidth="1.5" strokeDasharray="5 4" />}
          {marker.bpm > 200 || marker.bpm < 60 ? <g data-out-of-range={marker.bpm > 200 ? 'above' : 'below'}>
            <title>{`${marker.bpm} bpm · 표시 범위 ${marker.bpm > 200 ? '상한 200 초과' : '하한 60 미만'}`}</title>
            <path d={marker.bpm > 200 ? `M${x - 7},${y + 10} L${x},${y} L${x + 7},${y + 10} Z` : `M${x - 7},${y - 10} L${x},${y} L${x + 7},${y - 10} Z`} fill={color} />
          </g> : <>
            <circle cx={x} cy={y} r={marker.high ? 6 : 5.5} fill={marker.high ? color : '#fff'} stroke={color} strokeWidth={marker.high ? 0 : 3} />
            {marker.high && <circle cx={x} cy={y} r="12" fill="none" stroke={color} strokeWidth="2" />}
          </>}
          <rect x={labelX} y={labelY} width={labelWidth} height="30" fill={color} />
          <text x={labelX + 10} y={labelY + 20} fill="#fff" fontSize={compact ? 18 : marker.high ? 15 : 14} fontWeight="800">{marker.bpm > 200 ? '↑ ' : marker.bpm < 60 ? '↓ ' : ''}{marker.high ? '최고' : '최저'} {marker.bpm} · {formatDuration(marker.sec)}</text>
        </g>
      })}
      {current && endpoint && !rail && <g>
        <circle cx={endpoint.x} cy={endpoint.y} r={detail ? 7 : 3.5} fill={detail ? '#ec3013' : zoneOf(current.bpm!, live.participant.age).color} />
        {detail && <circle className={styles.currentPulse} cx={endpoint.x} cy={endpoint.y} r="14" fill="none" stroke="#ec3013" strokeWidth="2" opacity=".45" />}
      </g>}
    </g>
  </svg>
}

export function ZoneLegend({ age }: { age?: number }) {
  const bounds = age === undefined ? null : zoneBounds(age)
  return <div className={styles.legend} aria-label="심박 구간">
    {HR_ZONES.map((zone, index) => <span key={zone.key} title={bounds ? `${zone.label}: ${index ? bounds[index - 1] : 0}${index === HR_ZONES.length - 1 ? ' 이상' : `–${bounds[index] - 1}`} bpm` : undefined}>
      <i style={{ background: zone.band }} />{zone.label}
    </span>)}
  </div>
}
