'use client'

import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ExerciseMetric, ExerciseRow, METRICS, MONTH_ORDER, SERIES, formatValue, hasRecord, monthlySummary, numeric, sum } from './exercise-data'

const tick = { fill: 'rgba(32,30,29,.5)', fontSize: 10 }
const tooltipStyle = { background: '#fff', border: '1px solid #201e1d66', borderRadius: 0, fontSize: 12, color: '#201e1d' }

export function ExerciseLegend({ metric = 'minutes' }: { metric?: ExerciseMetric }) {
  const items = metric === 'minutes' ? SERIES : metric === 'bpm' ? [
    { key: 'max_bpm', label: '최대 심박', color: '#ec3013' }, { key: 'avg_bpm', label: '평균 심박', color: '#444141' },
  ] : [{ key: metric, label: METRICS[metric].label, color: '#ec3013' }]
  return <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-foreground/65">
    {items.map(item => <span key={item.key} className="inline-flex items-center gap-1.5"><span aria-hidden className={metric === 'bpm' ? 'inline-block h-[2px] w-[14px]' : 'inline-block h-2.5 w-2.5'} style={{ backgroundColor: item.color }} />{item.label}</span>)}
  </div>
}

export function MonthlyExerciseChart({ rows, year, metric, category = 'all', height = 220, dashboard = false }: {
  rows: ExerciseRow[]; year: number; metric: ExerciseMetric; category?: string; height?: number; dashboard?: boolean
}) {
  const data = monthlySummary(rows, year)
  const fields = METRICS[metric].fields
  const available = data.some(month => fields.some(field => numeric(month[field])))
  const isStacked = metric === 'minutes' && category === 'all'
  const axis = <>{!dashboard && <CartesianGrid vertical={false} stroke="rgba(32,30,29,.15)" strokeWidth={1} />}
    <XAxis dataKey="index" tickFormatter={index => String(Number(index) + 1)} tick={dashboard ? { ...tick, fontSize: 11 } : tick} axisLine={{ stroke: '#201e1d66', strokeWidth: 2 }} tickLine={false} interval={0} height={dashboard ? 38 : 24} tickMargin={dashboard ? 18 : 8} />
    {!dashboard && <YAxis tick={tick} axisLine={false} tickLine={false} width={40} tickCount={4} domain={[metric === 'bpm' ? 'auto' : 0, metric === 'accuracy' ? 100 : 'auto']} />}
    <Tooltip contentStyle={tooltipStyle} cursor={{ fill: '#201e1d08' }} formatter={value => `${formatValue(Number(value))} ${METRICS[metric].unit}`} labelFormatter={(_, payload) => payload?.[0]?.payload?.calendarMonth ?? ''} />
  </>
  return <div role="group" aria-label={`월별 ${METRICS[metric].label} 차트`} className="min-w-0" style={{ height }}>
    {!available ? <div className="flex h-full items-center justify-center border-b-2 border-[#201e1d]/40 text-xs text-[#605d5d]">수신된 {METRICS[metric].label} 기록이 없습니다.</div> : <ResponsiveContainer width="100%" height={height} minWidth={0} initialDimension={{ width: 1, height }}>
      {metric === 'minutes' || metric === 'calories' ? <BarChart accessibilityLayer data={data} margin={{ top: dashboard ? 0 : 20, right: dashboard ? 0 : 10, bottom: 0, left: 0 }} barCategoryGap={5}>
        {axis}
        {isStacked ? SERIES.map(series => <Bar key={series.key} dataKey={series.key} name={series.label} stackId="minutes" fill={series.color} radius={0} isAnimationActive={false}>
          {data.map(month => <Cell key={month.month} fillOpacity={month.future ? 0.35 : 1} />)}
        </Bar>) : <Bar dataKey={metric} name={METRICS[metric].label} fill="#ec3013" radius={0} isAnimationActive={false}>
          {data.map(month => <Cell key={month.month} fillOpacity={month.future ? 0.35 : 1} />)}
        </Bar>}
      </BarChart> : <LineChart accessibilityLayer data={data} margin={{ top: 20, right: 10, bottom: 0, left: 0 }}>
        {axis}
        {metric === 'bpm' ? <><Line type="linear" dataKey="max_bpm" name="최대 심박" stroke="#ec3013" strokeWidth={2.5} dot={{ r: 3, fill: '#ec3013', strokeWidth: 0 }} connectNulls={false} isAnimationActive={false} />
          <Line type="linear" dataKey="avg_bpm" name="평균 심박" stroke="#444141" strokeWidth={2.5} strokeDasharray="6 4" dot={false} connectNulls={false} isAnimationActive={false} /></> :
          <Line type="linear" dataKey="accuracy" name="정확도" stroke="#ec3013" strokeWidth={2.5} dot={{ r: 2.5 }} connectNulls={false} isAnimationActive={false} />}
      </LineChart>}
    </ResponsiveContainer>}
  </div>
}

export function ExerciseSparkline({ values }: { values: (number | null)[] }) {
  const data = MONTH_ORDER.map(index => ({ value: values[index] ?? null }))
  if (!data.some(point => numeric(point.value))) return <span className="text-[#201e1d]/35">—</span>
  return <div aria-label="3월부터 다음 해 2월까지 추이" className="h-[18px] w-16">
    <LineChart width={64} height={18} data={data} margin={{ top: 2, bottom: 2, left: 2, right: 2 }}>
      <Line type="linear" dataKey="value" stroke="#ec3013" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
    </LineChart>
  </div>
}

export function ExerciseComposition({ rows, studentCount }: { rows: ExerciseRow[]; studentCount: number }) {
  const totals = SERIES.map(series => ({ ...series, value: sum(rows.flatMap(row => row[series.key] ?? [])) }))
  const total = sum(totals.map(item => item.value))
  const participants = rows.filter(row => hasRecord(row)).length
  const participation = studentCount ? participants / studentCount * 100 : null
  const calories = sum(rows.flatMap(row => row.calories ?? []))
  const recordedCells = rows.reduce((count, row) => count + row.minutes.filter(numeric).length, 0)
  return <section className="flex min-w-0 flex-col gap-[14px] border border-border bg-white p-5" aria-labelledby="exercise-composition-title">
    <h2 id="exercise-composition-title" className="text-[15px] leading-[1.2] font-extrabold">종목별 비중 &amp; 참여</h2>
    <div className="space-y-[14px]">{totals.map(item => {
      const share = numeric(item.value) && numeric(total) && total > 0 ? item.value / total * 100 : null
      const average = recordedCells && numeric(item.value) ? item.value / recordedCells : null
      return <div key={item.key}>
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-[13px]"><span className="font-semibold">{item.label}</span><span className="tabular-nums text-foreground/60" title="기록이 있는 학생·월 기준 평균 운동시간">{formatValue(average)}분 · {formatValue(share, 0)}%</span></div>
        <div className="h-3 bg-[#eae9e9]" role="img" aria-label={`${item.label} ${formatValue(share, 0)}%`}><div className="h-full" style={{ width: `${share ?? 0}%`, backgroundColor: item.color }} /></div>
      </div>
    })}</div>
    <hr className="my-1 border-t-2 border-border" />
    <dl className="grid grid-cols-2 gap-[2px] bg-foreground/25">
      <div className="min-w-0 bg-white px-4 py-[14px]"><dt className="text-[11px] text-foreground/50">참여율</dt><dd className="mt-0.5 break-words text-[26px] font-extrabold tabular-nums">{formatValue(participation, 0)}<span className="ml-1 text-[13px] font-semibold text-foreground/50">%</span></dd></div>
      <div className="min-w-0 bg-white px-4 py-[14px]"><dt className="text-[11px] text-foreground/50">누적 칼로리</dt><dd className="mt-0.5 break-words text-[26px] font-extrabold tabular-nums">{formatValue(calories, 0)}<span className="ml-1 text-[13px] font-semibold text-foreground/50">kcal</span></dd></div>
    </dl>
  </section>
}
