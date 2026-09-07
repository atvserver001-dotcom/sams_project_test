'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CircleStop, LoaderCircle, Play, Plug, Scale, Unplug } from 'lucide-react'
import { PageHeader } from '@/components/console/page-header'
import { FilterBar } from '@/components/console/filter-bar'
import { ClassFilterFields } from '@/components/console/class-filter-fields'
import { SelectField } from '@/components/SchoolAnalyticsUI'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import JumpRopeTestBoard, {
  JumpRopeSnapshotView,
} from '@/components/jump-rope/JumpRopeTestBoard'
import {
  isJumpRopeConnectionActionBusy,
  isJumpRopeConnectionContextLocked,
  isJumpRopeMeasurementConfigLocked,
  shouldApplyJumpRopeMeasurementCompletion,
  shouldClearJumpRopeMeasurementUi,
} from '@/components/jump-rope/jumpRopeUiState'
import { useWebSerialJumpRope } from '@/components/jump-rope/useWebSerialJumpRope'
import {
  JUMP_ROPE_MODE_OPTIONS,
  JumpRopeMode,
  getJumpRopeModeOption,
  normalizeJumpRopeTarget,
} from '@/lib/jumpRopeSerial'

type DeviceTestMode = 'jump-rope' | 'body-composition'

interface StudentRow {
  id: string
  student_no: number
  name: string
}

interface CohortSelection {
  year: number
  grade: number
  classNo: number
}

interface ConnectionCohortSnapshot extends CohortSelection {
  students: StudentRow[]
}

interface MeasurementConfigSnapshot {
  mode: JumpRopeMode
  target: number
}

const computeDefaultYear = () => {
  const now = new Date()
  const month = now.getMonth() + 1
  return month === 1 || month === 2 ? now.getFullYear() - 1 : now.getFullYear()
}

const selectionKeyOf = ({ year, grade, classNo }: CohortSelection) => `${year}:${grade}:${classNo}`

export default function DeviceTestPage() {
  const [deviceTestMode, setDeviceTestMode] = useState<DeviceTestMode>('jump-rope')
  const [year, setYear] = useState(computeDefaultYear)
  const [grade, setGrade] = useState(1)
  const [classNo, setClassNo] = useState(1)
  const [schoolType, setSchoolType] = useState<1 | 2 | 3>(1)
  const [students, setStudents] = useState<StudentRow[]>([])
  const [studentsLoading, setStudentsLoading] = useState(true)
  const [loadedSelectionKey, setLoadedSelectionKey] = useState<string | null>(null)
  const [pageError, setPageError] = useState<string | null>(null)
  const [ropeMode, setRopeMode] = useState<JumpRopeMode>(0)
  const [target, setTarget] = useState(0)
  const [connectionCohortSnapshot, setConnectionCohortSnapshot] = useState<ConnectionCohortSnapshot | null>(null)
  const [measurementConfigSnapshot, setMeasurementConfigSnapshot] = useState<MeasurementConfigSnapshot | null>(null)
  const [snapshotsBySlot, setSnapshotsBySlot] = useState<Record<number, JumpRopeSnapshotView>>({})
  const fetchGenerationRef = useRef(0)
  const measurementRequestGenerationRef = useRef(0)

  const selectedCohort = useMemo<CohortSelection>(() => ({ year, grade, classNo }), [year, grade, classNo])
  const selectedCohortKey = useMemo(() => selectionKeyOf(selectedCohort), [selectedCohort])
  const selectedModeOption = getJumpRopeModeOption(ropeMode)

  const handleSnapshot = useCallback((event: JumpRopeSnapshotView['event'], receivedAt: number) => {
    setSnapshotsBySlot((previous) => ({
      ...previous,
      [event.slot]: { event, receivedAt },
    }))
  }, [])
  const serialSession = useWebSerialJumpRope(handleSnapshot)

  const isConnecting = serialSession.state === 'connecting' ||
    serialSession.state === 'handshaking' ||
    serialSession.state === 'configuring'
  const isDisconnecting = serialSession.state === 'disconnecting'
  const hasConnection = serialSession.connection !== null
  const isMeasuring = serialSession.state === 'running'
  const connectionActionBusy = isJumpRopeConnectionActionBusy(serialSession.state)
  const lockConnectionContext = isJumpRopeConnectionContextLocked(serialSession.state, hasConnection)
  const lockMeasurementConfig = isJumpRopeMeasurementConfigLocked(serialSession.state, hasConnection)

  useEffect(() => {
    let cancelled = false
    const loadSchool = async () => {
      try {
        const response = await fetch('/api/school/info', { credentials: 'include' })
        const data = await response.json()
        if (!response.ok || cancelled) return
        const type = Number(data?.school?.school_type)
        if (type !== 1 && type !== 2 && type !== 3) return
        setSchoolType(type)
        setGrade((current) => Math.min(Math.max(1, current), type === 1 ? 6 : 3))
        setClassNo((current) => Math.min(Math.max(1, current), 10))
      } catch {
        // 학교 유형을 불러오지 못하면 기본값(초등 6개 학년)으로 테스트를 계속한다.
      }
    }
    void loadSchool()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const generation = fetchGenerationRef.current + 1
    fetchGenerationRef.current = generation
    const controller = new AbortController()
    const selection = selectedCohort
    const selectionKey = selectedCohortKey
    setStudentsLoading(true)
    setLoadedSelectionKey(null)
    setStudents([])
    setPageError(null)

    const loadStudents = async () => {
      try {
        const response = await fetch(
          `/api/school/students?year=${selection.year}&grade=${selection.grade}&class_no=${selection.classNo}`,
          { credentials: 'include', signal: controller.signal },
        )
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || '학생 정보 조회에 실패했습니다.')
        if (controller.signal.aborted || fetchGenerationRef.current !== generation) return
        const nextStudents = Array.isArray(data.students)
          ? (data.students as StudentRow[])
            .filter((student) => Number.isInteger(student.student_no) && student.student_no >= 1 && student.student_no <= 30)
            .sort((left, right) => left.student_no - right.student_no)
          : []
        setStudents(nextStudents)
        setLoadedSelectionKey(selectionKey)
      } catch (error) {
        if (controller.signal.aborted || fetchGenerationRef.current !== generation) return
        setStudents([])
        setLoadedSelectionKey(null)
        setPageError(error instanceof Error ? error.message : String(error))
      } finally {
        if (!controller.signal.aborted && fetchGenerationRef.current === generation) setStudentsLoading(false)
      }
    }

    void loadStudents()
    return () => controller.abort()
  }, [selectedCohort, selectedCohortKey])

  useEffect(() => {
    const hasActiveConnection = serialSession.connection !== null
    if (shouldClearJumpRopeMeasurementUi(serialSession.state, hasActiveConnection)) {
      measurementRequestGenerationRef.current += 1
      if (serialSession.state === 'error' && !hasActiveConnection) {
        setConnectionCohortSnapshot(null)
      }
      setMeasurementConfigSnapshot(null)
      setSnapshotsBySlot({})
    }
  }, [serialSession.connection, serialSession.state])

  const clearFinishedMeasurement = () => {
    if (lockMeasurementConfig) return
    setMeasurementConfigSnapshot(null)
    setSnapshotsBySlot({})
  }

  const changeYear = (nextYear: number) => {
    clearFinishedMeasurement()
    setYear(nextYear)
  }

  const changeGrade = (nextGrade: number) => {
    clearFinishedMeasurement()
    setGrade(nextGrade)
  }

  const changeClassNo = (nextClassNo: number) => {
    clearFinishedMeasurement()
    setClassNo(nextClassNo)
  }

  const changeRopeMode = (mode: JumpRopeMode) => {
    clearFinishedMeasurement()
    const option = getJumpRopeModeOption(mode)
    setRopeMode(mode)
    setTarget(option.defaultTarget)
  }

  const changeTarget = (nextTarget: number) => {
    clearFinishedMeasurement()
    setTarget(nextTarget)
  }

  const handleConnect = () => {
    if (lockConnectionContext) return
    setPageError(null)
    measurementRequestGenerationRef.current += 1
    if (studentsLoading || loadedSelectionKey !== selectedCohortKey) {
      setPageError('선택한 학급의 학생 정보를 불러오는 중입니다. 잠시 후 다시 시도해 주세요.')
      return
    }

    const snapshot: ConnectionCohortSnapshot = {
      ...selectedCohort,
      students: students.map((student) => ({ ...student })),
    }
    setConnectionCohortSnapshot(snapshot)
    setMeasurementConfigSnapshot(null)
    setSnapshotsBySlot({})

    // Web Serial 포트 선택의 클릭 권한을 보존하기 위해 현재 클릭 핸들러에서 즉시 연결한다.
    const connectPromise = serialSession.connect()
    void connectPromise.then((connection) => {
      if (!connection) setConnectionCohortSnapshot(null)
    })
  }

  const handleDisconnect = () => {
    measurementRequestGenerationRef.current += 1
    void serialSession.disconnect().then(() => {
      setConnectionCohortSnapshot(null)
      setMeasurementConfigSnapshot(null)
      setSnapshotsBySlot({})
    })
  }

  const handleStartMeasurement = () => {
    if (serialSession.state !== 'connected') return
    const normalizedTarget = normalizeJumpRopeTarget(ropeMode, target)
    const config = { mode: ropeMode, target: normalizedTarget }
    const requestGeneration = measurementRequestGenerationRef.current + 1
    measurementRequestGenerationRef.current = requestGeneration
    setTarget(normalizedTarget)
    setMeasurementConfigSnapshot(config)
    setSnapshotsBySlot({})
    void serialSession.startMeasurement(config).then((measurement) => {
      if (!shouldApplyJumpRopeMeasurementCompletion(
        requestGeneration,
        measurementRequestGenerationRef.current,
      )) return
      if (!measurement) setMeasurementConfigSnapshot(null)
    })
  }

  const handleFinishMeasurement = () => {
    measurementRequestGenerationRef.current += 1
    void serialSession.finishMeasurement()
  }

  const displayStudents = connectionCohortSnapshot?.students ?? students
  const displayMode = measurementConfigSnapshot?.mode ?? ropeMode
  const displayTarget = measurementConfigSnapshot?.target ?? normalizeJumpRopeTarget(ropeMode, target)

  return (
    <div className="console-page font-sans text-[13px] text-foreground">
      <PageHeader title="줄넘기 / 체성분 테스트" eyebrow="개발중" actions={
        <div className="inline-flex border border-border bg-card" role="tablist" aria-label="테스트 기기 선택">
          <Button
            type="button"
            role="tab"
            aria-selected={deviceTestMode === 'jump-rope'}
            onClick={() => setDeviceTestMode('jump-rope')}
            disabled={lockConnectionContext}
            variant={deviceTestMode === 'jump-rope' ? 'default' : 'ghost'}
            className="min-w-20 rounded-none text-[13px]"
          >
            줄넘기
          </Button>
          <Button
            type="button"
            role="tab"
            aria-selected={deviceTestMode === 'body-composition'}
            onClick={() => setDeviceTestMode('body-composition')}
            disabled={lockConnectionContext}
            variant={deviceTestMode === 'body-composition' ? 'default' : 'ghost'}
            className="min-w-20 rounded-none text-[13px]"
          >
            체성분
          </Button>
        </div>
      } />

      {deviceTestMode === 'jump-rope' && (
        <FilterBar>
          <ClassFilterFields
            year={year}
            grade={grade}
            classNo={classNo}
            years={Array.from({ length: 7 }, (_, index) => {
              const value = computeDefaultYear() + 1 - index
              return { value, label: `${value}년` }
            })}
            gradeCount={schoolType === 1 ? 6 : 3}
            classCount={10}
            labels={{ year: '년도' }}
            onYearChange={changeYear}
            onGradeChange={changeGrade}
            onClassChange={changeClassNo}
            disabled={lockConnectionContext}
          />
          <SelectField
            label="줄넘기 모드"
            value={ropeMode}
            onChange={(value) => changeRopeMode(Number(value) as JumpRopeMode)}
            disabled={lockMeasurementConfig}
            className="w-44"
          >
            {JUMP_ROPE_MODE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </SelectField>

          {selectedModeOption.inputLabel ? (
            <div className="flex flex-col items-start gap-1.5">
              <Label htmlFor="jump-rope-target" className="text-[11px] font-bold leading-[1.3] text-muted-foreground">{selectedModeOption.inputLabel}</Label>
              <div className="relative w-40">
                <Input
                  id="jump-rope-target"
                  type="number"
                  min={selectedModeOption.minTarget}
                  max={selectedModeOption.maxTarget}
                  step={selectedModeOption.stepTarget}
                  value={target}
                  onChange={(event) => changeTarget(Number(event.target.value))}
                  onBlur={() => changeTarget(normalizeJumpRopeTarget(ropeMode, target))}
                  disabled={lockMeasurementConfig}
                  aria-describedby="jump-rope-target-range"
                  className="h-9 rounded-none bg-background pr-11 text-[13px]"
                />
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
                  {selectedModeOption.unit}
                </span>
              </div>
              <p id="jump-rope-target-range" className="text-[10px] text-muted-foreground">
                {ropeMode === 1 ? '1~1,000회' : '1~60분 · 60초 단위'}
              </p>
            </div>
          ) : ropeMode === 3 ? (
            <div className="flex flex-col items-start gap-1.5">
              <span className="text-[11px] font-bold leading-[1.3] text-muted-foreground">시험 시간</span>
              <div className="flex h-9 w-40 items-center justify-center border border-border bg-muted text-[13px] text-muted-foreground">
                60초 고정
              </div>
            </div>
          ) : null}

          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              onClick={hasConnection ? handleDisconnect : handleConnect}
              disabled={connectionActionBusy || (!hasConnection && (
                studentsLoading || loadedSelectionKey !== selectedCohortKey
              ))}
              variant={hasConnection ? 'outline' : 'default'}
              className="rounded-none text-[13px]"
            >
              {isConnecting || isDisconnecting ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : hasConnection ? <Unplug aria-hidden="true" /> : <Plug aria-hidden="true" />}
              {isConnecting
                ? '연결 중...'
                : isDisconnecting
                  ? '해제 중...'
                  : hasConnection
                    ? '연결 해제'
                    : '기기 연결'}
            </Button>
            <Button
              type="button"
              onClick={handleStartMeasurement}
              disabled={serialSession.state !== 'connected'}
              variant="outline"
              className="rounded-none text-[13px]"
            >
              {serialSession.state === 'starting' ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Play aria-hidden="true" />}
              시작 신호
            </Button>
            <Button
              type="button"
              onClick={handleFinishMeasurement}
              disabled={!isMeasuring}
              variant="destructive"
              className="rounded-none text-[13px]"
            >
              {serialSession.state === 'finishing' ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <CircleStop aria-hidden="true" />}
              끝 신호
            </Button>
          </div>
        </FilterBar>
      )}

      {deviceTestMode === 'body-composition' ? (
        <section className="border-t border-border bg-card px-4 py-10 text-center">
          <Scale className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <h2 className="mt-3 text-base font-bold text-card-foreground">체성분 연동은 준비 중입니다</h2>
          <p className="mt-2 text-[13px] text-muted-foreground">JR203 줄넘기 실증을 완료한 뒤 BFS100 측정 흐름을 연결합니다.</p>
        </section>
      ) : (
        <div className="space-y-5">
          <div className="border-l-2 border-primary bg-accent px-4 py-3 text-[13px] font-semibold text-accent-foreground" role="note">
            최초 자동 식별 시에는 주변의 다른 JR203을 끄고, 테스트할 줄넘기 1대만 켜 주세요.
          </div>
          {pageError && (
            <div className="border-l-2 border-destructive bg-destructive/5 px-4 py-3 text-[13px] break-words text-destructive" role="alert">
              {pageError}
            </div>
          )}
          <JumpRopeTestBoard
            students={displayStudents}
            mode={displayMode}
            target={displayTarget}
            snapshotsBySlot={snapshotsBySlot}
            connectionState={serialSession.state}
            statusText={serialSession.statusText}
            connectionError={serialSession.error}
          />
        </div>
      )}
    </div>
  )
}
