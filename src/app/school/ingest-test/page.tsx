'use client'

import React, { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { RecordSelect } from '@/components/school-records/record-select'
import { Label } from '@/components/ui/label'
import { PageHeader } from '@/components/console/page-header'

type ExerciseType = 'endurance' | 'flexibility' | 'strength'

interface SchoolInfoResponse {
  school?: {
    id: string
    name: string
    group_no: string
    school_type: number
    recognition_key?: string
  }
  error?: string
}

export default function IngestTestPage() {
  const computeDefaultYear = () => {
    const now = new Date()
    const m = now.getMonth() + 1
    return (m === 1 || m === 2) ? now.getFullYear() - 1 : now.getFullYear()
  }

  const [recognitionKey, setRecognitionKey] = useState('')
  const [year, setYear] = useState<number>(computeDefaultYear)
  const [grade, setGrade] = useState<number>(1)
  const [classNo, setClassNo] = useState<number>(1)
  const [studentNo, setStudentNo] = useState<number>(1)
  const [exerciseType, setExerciseType] = useState<ExerciseType>('endurance')
  const [month, setMonth] = useState<number>(new Date().getMonth() + 1)
  const [avgDuration, setAvgDuration] = useState<number>(600)
  const [avgAccuracy, setAvgAccuracy] = useState<number>(95)
  const [avgBpm, setAvgBpm] = useState<number>(130)
  const [avgMaxBpm, setAvgMaxBpm] = useState<number>(170)
  const [avgCalories, setAvgCalories] = useState<number>(120)

  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/school/info', { credentials: 'include' })
        const data: SchoolInfoResponse = await res.json().catch(() => ({}))
        if (res.ok && data.school) {
          if (data.school.recognition_key) {
            setRecognitionKey(data.school.recognition_key)
          }
        }
      } catch {
        // ignore
      }
    }
    load()
  }, [])

  const handleSend = async () => {
    setMessage(null)

    if (!recognitionKey) {
      setMessage('recognition_key가 없습니다. 수동으로 입력 후 다시 시도하세요.')
      return
    }

    setLoading(true)
    try {
      const payload = {
        idempotency_key: `test-${Date.now()}`,
        recognition_key: recognitionKey,
        year,
        grade,
        class_no: classNo,
        student_no: studentNo,
        exercise_type: exerciseType,
        month,
        avg_duration_seconds: avgDuration,
        avg_accuracy: avgAccuracy,
        avg_bpm: avgBpm,
        avg_max_bpm: avgMaxBpm,
        avg_calories: avgCalories,
      }

      const res = await fetch('/api/device/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        setMessage(`오류: ${data.error || res.statusText}`)
      } else {
        setMessage(`성공: ${JSON.stringify(data)}`)
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : '요청 실패'
      setMessage(`오류: ${message}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="console-page space-y-5">
      <PageHeader title="디바이스 업설트 테스트" eyebrow="디바이스" />

      <div className="bg-card py-5 space-y-5">
        <div className="border-b-2 border-border pb-4 text-sm font-bold">측정 요청</div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="ingest-recognition-key" className="block text-xs font-semibold text-foreground mb-1">recognition_key</Label>
            <Input id="ingest-recognition-key"
              type="text"
              value={recognitionKey}
              onChange={(e) => setRecognitionKey(e.target.value)}
              className="w-full h-10 px-3 border-border text-[13px]"
              placeholder="학교 recognition_key"
            />
          </div>
          <div>
            <Label htmlFor="ingest-year" className="block text-xs font-semibold text-foreground mb-1">학년도 (year)</Label>
            <Input id="ingest-year"
              type="number"
              value={year}
              onChange={(e) => setYear(Number(e.target.value) || computeDefaultYear())}
              className="w-full h-10 px-3 border-border text-[13px]"
            />
          </div>
          <div>
            <Label htmlFor="ingest-grade" className="block text-xs font-semibold text-foreground mb-1">학년 (grade)</Label>
            <Input id="ingest-grade"
              type="number"
              min={1}
              max={12}
              value={grade}
              onChange={(e) => setGrade(Number(e.target.value) || 1)}
              className="w-full h-10 px-3 border-border text-[13px]"
            />
          </div>
          <div>
            <Label htmlFor="ingest-class-no" className="block text-xs font-semibold text-foreground mb-1">반 (class_no)</Label>
            <Input id="ingest-class-no"
              type="number"
              min={1}
              max={20}
              value={classNo}
              onChange={(e) => setClassNo(Number(e.target.value) || 1)}
              className="w-full h-10 px-3 border-border text-[13px]"
            />
          </div>
          <div>
            <Label htmlFor="ingest-student-no" className="block text-xs font-semibold text-foreground mb-1">번호 (student_no)</Label>
            <Input id="ingest-student-no"
              type="number"
              min={1}
              max={50}
              value={studentNo}
              onChange={(e) => setStudentNo(Number(e.target.value) || 1)}
              className="w-full h-10 px-3 border-border text-[13px]"
            />
          </div>
          <div>
            <Label htmlFor="ingest-exercise-type" className="block text-xs font-semibold text-foreground mb-1">운동 종류 (exercise_type)</Label>
            <RecordSelect id="ingest-exercise-type" aria-label="운동 종류 (exercise_type)"
              value={exerciseType}
              onValueChange={(value) => setExerciseType(value as ExerciseType)}
              className="h-9 min-w-28"
            >
              <option value="endurance">endurance (지구력)</option>
              <option value="flexibility">flexibility (유연성)</option>
              <option value="strength">strength (근력)</option>
            </RecordSelect>
          </div>
          <div>
            <Label htmlFor="ingest-month" className="block text-xs font-semibold text-foreground mb-1">월 (month, 1-12)</Label>
            <Input id="ingest-month"
              type="number"
              min={1}
              max={12}
              value={month}
              onChange={(e) => {
                const v = Number(e.target.value)
                if (!Number.isFinite(v)) return
                setMonth(Math.min(12, Math.max(1, v)))
              }}
              className="w-full h-10 px-3 border-border text-[13px]"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Label htmlFor="ingest-avg-duration" className="block text-xs font-semibold text-foreground mb-1">평균 운동시간(초)</Label>
            <Input id="ingest-avg-duration"
              type="number"
              value={avgDuration}
              onChange={(e) => setAvgDuration(Number(e.target.value) || 0)}
              className="w-full h-10 px-3 border-border text-[13px]"
            />
          </div>
          <div>
            <Label htmlFor="ingest-avg-accuracy" className="block text-xs font-semibold text-foreground mb-1">평균 정확도(%)</Label>
            <Input id="ingest-avg-accuracy"
              type="number"
              value={avgAccuracy}
              onChange={(e) => setAvgAccuracy(Number(e.target.value) || 0)}
              className="w-full h-10 px-3 border-border text-[13px]"
            />
          </div>
          <div>
            <Label htmlFor="ingest-avg-bpm" className="block text-xs font-semibold text-foreground mb-1">평균 심박수(bpm)</Label>
            <Input id="ingest-avg-bpm"
              type="number"
              value={avgBpm}
              onChange={(e) => setAvgBpm(Number(e.target.value) || 0)}
              className="w-full h-10 px-3 border-border text-[13px]"
            />
          </div>
          <div>
            <Label htmlFor="ingest-avg-max-bpm" className="block text-xs font-semibold text-foreground mb-1">최대 심박 평균(bpm)</Label>
            <Input id="ingest-avg-max-bpm"
              type="number"
              value={avgMaxBpm}
              onChange={(e) => setAvgMaxBpm(Number(e.target.value) || 0)}
              className="w-full h-10 px-3 border-border text-[13px]"
            />
          </div>
          <div>
            <Label htmlFor="ingest-avg-calories" className="block text-xs font-semibold text-foreground mb-1">평균 칼로리(kcal)</Label>
            <Input id="ingest-avg-calories"
              type="number"
              value={avgCalories}
              onChange={(e) => setAvgCalories(Number(e.target.value) || 0)}
              className="w-full h-10 px-3 border-border text-[13px]"
            />
          </div>
        </div>

        {message && (
          <div role="status" className="border-l-2 border-border bg-muted p-4 text-[13px] whitespace-pre-wrap break-words">
            {message}
          </div>
        )}

        <div className="mt-4 flex justify-end">
          <Button variant="outline"
            type="button"
            onClick={handleSend}
            disabled={loading}
            className="px-4 py-2 bg-primary text-primary-foreground text-[13px] font-medium hover:bg-primary disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? '전송 중...' : '업설트 요청 전송'}
          </Button>
        </div>
      </div>
    </div>
  )
}






