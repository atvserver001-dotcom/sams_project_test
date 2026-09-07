'use client'

import { useMemo } from 'react'
import { createColumnHelper, tableFeatures, useTable } from '@tanstack/react-table'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { ALL_FIELDS, ExerciseField, ExerciseMetric, ExerciseRow, FIELD_LABELS, METRICS, MONTH_ORDER, formatValue, mean, monthLabel, numeric, summarizeField } from './exercise-data'
import { ExerciseSparkline } from './exercise-charts'

const features = tableFeatures({})
const helper = createColumnHelper<typeof features, ExerciseRow>()

function NumberCell({ value, strong = false }: { value: number | null | undefined; strong?: boolean }) {
  return <span className={cn(strong ? 'font-bold' : 'font-normal', !numeric(value) && 'text-foreground/35')}>{formatValue(value)}</span>
}

export function ExerciseTable({ rows, year, metric, allMetrics }: { rows: ExerciseRow[]; year: number; metric: ExerciseMetric; allMetrics: boolean }) {
  const fields = allMetrics ? ALL_FIELDS : METRICS[metric].fields
  const primary: ExerciseField = METRICS[metric].fields[0]
  const columns = useMemo(() => helper.columns([
    helper.accessor('student_no', { id: 'number', header: '번호', cell: info => info.getValue() }),
    helper.accessor('name', { id: 'name', header: '이름', cell: info => <span title={info.getValue()} className="block truncate font-bold">{info.getValue()}</span> }),
    ...(fields.length > 1 ? [helper.display({ id: 'metric', header: '지표', cell: () => <div>{fields.map(field => <div key={field} className="flex h-8 items-center whitespace-nowrap text-xs text-[#605d5d]">{FIELD_LABELS[field]}</div>)}</div> })] : []),
    ...MONTH_ORDER.map(index => helper.display({ id: `month-${index}`, header: () => <span title={monthLabel(year, index)}>{index + 1}월</span>, cell: info => <div>{fields.map(field => <div key={field} className="flex h-8 items-center justify-end"><NumberCell value={info.row.original[field]?.[index]} /></div>)}</div> })),
    helper.display({ id: 'summary', header: fields.length === 1 ? primary === 'minutes' || primary === 'calories' ? '합계' : '평균' : '합계 / 평균 / 최대', cell: info => <div>{fields.map(field => <div key={field} className="flex h-8 items-center justify-end" title={field === 'max_bpm' ? '월별 최대값의 최댓값' : field === 'minutes' || field === 'calories' ? '학년도 합계' : '기록이 있는 월의 평균'}><NumberCell value={summarizeField(info.row.original, field)} strong /></div>)}</div> }),
    helper.display({ id: 'accuracy', header: '정확도', cell: info => <><NumberCell value={mean(info.row.original.accuracy ?? [])} />{numeric(mean(info.row.original.accuracy ?? [])) && '%'}</> }),
    helper.display({ id: 'trend', header: '추이', cell: info => <ExerciseSparkline values={info.row.original[primary] ?? []} /> }),
  ]), [fields, primary, year])
  const table = useTable({ features, columns, data: rows, getRowId: row => row.student_id })
  const cellClass = (id: string, header = false) => {
    const common = `${header ? 'sticky top-0 z-20 bg-white border-b-2 border-[#201e1d]/40 h-9 text-[11px] font-semibold text-foreground/55' : 'border-b border-[#201e1d]/18 bg-white font-normal'} px-2 py-1 tabular-nums`
    if (id === 'number') return `${common} sticky left-0 ${header ? 'z-40' : 'z-10'} w-[60px] min-w-[60px] max-w-[60px] text-left`
    if (id === 'name') return `${common} sticky left-[60px] ${header ? 'z-40' : 'z-10'} w-[110px] min-w-[110px] max-w-[110px] border-r border-r-[#201e1d]/18 text-left`
    if (id === 'metric') return `${common} w-[124px] min-w-[124px] text-left`
    if (id === 'trend') return `${common} xl:sticky xl:right-0 ${header ? 'xl:z-30' : 'xl:z-10'} w-[80px] min-w-[80px] text-left`
    if (id === 'accuracy') return `${common} xl:sticky xl:right-[80px] ${header ? 'xl:z-30' : 'xl:z-10'} w-[100px] min-w-[100px] text-right`
    if (id === 'summary') return `${common} xl:sticky xl:right-[180px] ${header ? 'xl:z-30' : 'xl:z-10'} ${fields.length > 1 ? 'w-[130px] min-w-[130px]' : 'w-[100px] min-w-[100px]'} text-right`
    return `${common} min-w-[96px] text-right`
  }
  return <div className="isolate max-h-[520px] w-full overflow-auto overscroll-contain bg-white focus-visible:outline-2 focus-visible:outline-[#ec3013]" tabIndex={0} role="region" aria-label="학생별 월간 기록, 가로 및 세로 스크롤">
    <table className={cn('w-full table-fixed border-separate border-spacing-0 text-[13px] leading-[1.45]', fields.length > 1 ? 'min-w-[1756px]' : 'min-w-[1602px]')}>
      <caption className="sr-only">{year}학년도 학생별 운동 기록, 3월부터 다음 해 2월까지. 결측은 대시, 실제 0은 0.0으로 표시합니다.</caption>
      <TableHeader>{table.getHeaderGroups().map(group => <TableRow key={group.id}>{group.headers.map(header => <TableHead key={header.id} scope="col" className={cellClass(header.column.id, true)}><table.FlexRender header={header} /></TableHead>)}</TableRow>)}</TableHeader>
      <TableBody>{table.getRowModel().rows.map(row => <TableRow key={row.id} className="group hover:bg-[#201e1d]/4">{row.getAllCells().map(cell => <TableCell key={cell.id} className={`${cellClass(cell.column.id)} group-hover:bg-[#f6f6f6]`}><table.FlexRender cell={cell} /></TableCell>)}</TableRow>)}</TableBody>
    </table>
  </div>
}
