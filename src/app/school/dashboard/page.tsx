'use client'

import React, { useEffect, useMemo, useState } from 'react'
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Tooltip,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import { PageHeader } from '@/components/console/page-header'
import { FilterBar } from '@/components/console/filter-bar'

import {
  ACADEMIC_MONTHS,
  EmptyState,
  MetricCard,
  SelectField,
  getDefaultAcademicYear,
} from '@/components/SchoolAnalyticsUI'

ChartJS.register(ArcElement, BarElement, CategoryScale, LinearScale, Tooltip, Legend)

type DashboardSummary = {
  exercise_count: number
  paps_count: number
  avg_paps_grade: number | null
  avg_paps_grade_delta: number | null
  avg_efficiency_score: number | null
  grade_avg_paps: Array<{ grade: number; avg: number }>
  exercise_type_ratio: { strength: number; cardio: number; flexibility: number }
  grade_distribution: Array<{ grade: number; measured: number; g1: number; g2: number; g3: number; g4: number; g5: number }>
  bmi_distribution: Array<{ grade: number; normal: number; overweight: number; mild_obesity: number; obesity: number }>
  grade_efficiency: Array<{ grade: number; avg: number }>
}

function years() {
  const base = getDefaultAcademicYear()
  return Array.from({ length: 7 }, (_, index) => base + 1 - index)
}

function chartTextColor() {
  return '#374151'
}

export default function SchoolDashboardPage() {
  const [year, setYear] = useState(getDefaultAcademicYear())
  const [month, setMonth] = useState<string>('all')
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({ year: String(year) })
        if (month !== 'all') params.set('month', month)
        const res = await fetch(`/api/school/dashboard/summary?${params.toString()}`, {
          credentials: 'include',
          signal: controller.signal,
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || '통계 데이터를 불러오지 못했습니다.')
        setSummary(data)
      } catch (err) {
        if ((err as Error).name !== 'AbortError') setError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
      }
    }
    load()
    return () => controller.abort()
  }, [year, month])

  const gradeLabels = useMemo(() => (summary?.grade_avg_paps ?? []).map((item) => `${item.grade}학년`), [summary])
  const distributionLabels = useMemo(() => (summary?.grade_distribution ?? []).map((item) => `${item.grade}학년 (${item.measured}명)`), [summary])
  const bmiLabels = useMemo(() => (summary?.bmi_distribution ?? []).map((item) => `${item.grade}학년`), [summary])
  const efficiencyLabels = useMemo(() => (summary?.grade_efficiency ?? []).map((item) => `${item.grade}학년`), [summary])

  const commonBarOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: chartTextColor(), font: { weight: 'bold' as const } } },
    },
    scales: {
      x: { ticks: { color: chartTextColor() }, grid: { color: '#f3f4f6' } },
      y: { ticks: { color: chartTextColor() }, grid: { display: false } },
    },
  }

  return (
    <div className="console-page text-foreground">
      <PageHeader title="학교 전체 통계" actions={loading ? <span className="text-xs text-muted-foreground" role="status">불러오는 중</span> : undefined} />

      <FilterBar>
          <SelectField label="년도" value={year} onChange={(value) => setYear(Number(value))}>
            {years().map((item) => <option key={item} value={item}>{item}년</option>)}
          </SelectField>
          <SelectField label="월" value={month} onChange={setMonth}>
            <option value="all">전체(연간)</option>
            {ACADEMIC_MONTHS.map((item) => <option key={item} value={item}>{item}월</option>)}
          </SelectField>
      </FilterBar>

      <div className="space-y-6">
      {error && <div className="border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive" role="alert">{error}</div>}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="운동 기록 학생 수" value={summary?.exercise_count ?? 0} suffix="명" />
        <MetricCard label="PAPS 측정 학생 수" value={summary?.paps_count ?? 0} suffix="명" />
        <MetricCard label="평균 PAPS 등급" value={summary?.avg_paps_grade ?? null} suffix="등급" />
        <MetricCard label="평균 운동 효율 점수" value={summary?.avg_efficiency_score ?? null} suffix="점" />
      </div>

      {!summary ? (
        <EmptyState message="통계 데이터를 불러오는 중입니다." />
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <section className="min-w-0 border-t border-border py-5">
            <h2 className="mb-4 text-base font-bold">학년별 평균 PAPS 등급</h2>
            {summary.grade_avg_paps.length === 0 ? (
              <EmptyState message="측정 기록 없음" />
            ) : (
              <div className="h-72">
                <Bar
                  options={{ ...commonBarOptions, indexAxis: 'y' as const }}
                  data={{
                    labels: gradeLabels,
                    datasets: [{ label: '평균 등급', data: summary.grade_avg_paps.map((item) => item.avg), backgroundColor: '#ec3013' }],
                  }}
                />
              </div>
            )}
          </section>

          <section className="min-w-0 border-t border-border py-5">
            <h2 className="mb-4 text-base font-bold">운동 유형별 누적 시간 비율</h2>
            {Object.values(summary.exercise_type_ratio).every((value) => value === 0) ? (
              <EmptyState message="측정 기록 없음" />
            ) : (
              <div className="mx-auto h-72 max-w-md">
                <Doughnut
                  data={{
                    labels: ['근력', '심폐', '유연성'],
                    datasets: [{
                      data: [
                        summary.exercise_type_ratio.strength,
                        summary.exercise_type_ratio.cardio,
                        summary.exercise_type_ratio.flexibility,
                      ],
                      backgroundColor: ['#ec3013', '#2596be', '#18a77b'],
                    }],
                  }}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { position: 'bottom', labels: { color: chartTextColor(), font: { weight: 'bold' } } } },
                  }}
                />
              </div>
            )}
          </section>

          <section className="min-w-0 border-t border-border py-5">
            <h2 className="mb-4 text-base font-bold">PAPS 등급 분포</h2>
            {summary.grade_distribution.length === 0 ? (
              <EmptyState message="측정 기록 없음" />
            ) : (
              <div className="h-72">
                <Bar
                  options={{
                    ...commonBarOptions,
                    indexAxis: 'y' as const,
                    scales: {
                      x: { stacked: true, ticks: { color: chartTextColor() }, grid: { color: '#f3f4f6' } },
                      y: { stacked: true, ticks: { color: chartTextColor() }, grid: { display: false } },
                    },
                  }}
                  data={{
                    labels: distributionLabels,
                    datasets: [
                      { label: '1등급', data: summary.grade_distribution.map((item) => item.g1), backgroundColor: '#065F46' },
                      { label: '2등급', data: summary.grade_distribution.map((item) => item.g2), backgroundColor: '#1E40AF' },
                      { label: '3등급', data: summary.grade_distribution.map((item) => item.g3), backgroundColor: '#854D0E' },
                      { label: '4등급', data: summary.grade_distribution.map((item) => item.g4), backgroundColor: '#9A3412' },
                      { label: '5등급', data: summary.grade_distribution.map((item) => item.g5), backgroundColor: '#991B1B' },
                    ],
                  }}
                />
              </div>
            )}
          </section>

          <section className="min-w-0 border-t border-border py-5">
            <h2 className="mb-4 text-base font-bold">체질량지수 분포</h2>
            {summary.bmi_distribution.length === 0 ? (
              <EmptyState message="측정 기록 없음" />
            ) : (
              <div className="h-72">
                <Bar
                  options={{
                    ...commonBarOptions,
                    scales: {
                      x: { stacked: true, ticks: { color: chartTextColor() }, grid: { display: false } },
                      y: { stacked: true, ticks: { color: chartTextColor() }, grid: { color: '#f3f4f6' } },
                    },
                  }}
                  data={{
                    labels: bmiLabels,
                    datasets: [
                      { label: '정상', data: summary.bmi_distribution.map((item) => item.normal), backgroundColor: '#1E40AF' },
                      { label: '과체중', data: summary.bmi_distribution.map((item) => item.overweight), backgroundColor: '#9A3412' },
                      { label: '경도비만', data: summary.bmi_distribution.map((item) => item.mild_obesity), backgroundColor: '#854D0E' },
                      { label: '비만', data: summary.bmi_distribution.map((item) => item.obesity), backgroundColor: '#991B1B' },
                    ],
                  }}
                />
              </div>
            )}
          </section>

          <section className="min-w-0 border-t border-border py-5 xl:col-span-2">
            <h2 className="mb-4 text-base font-bold">학년별 평균 운동 효율 점수</h2>
            {summary.grade_efficiency.length === 0 ? (
              <EmptyState message="측정 기록 없음" />
            ) : (
              <div className="h-80">
                <Bar
                  options={{ ...commonBarOptions, indexAxis: 'y' as const }}
                  data={{
                    labels: efficiencyLabels,
                    datasets: [{ label: '효율 점수', data: summary.grade_efficiency.map((item) => item.avg), backgroundColor: '#2596be' }],
                  }}
                />
              </div>
            )}
          </section>
        </div>
      )}
      </div>
    </div>
  )
}
