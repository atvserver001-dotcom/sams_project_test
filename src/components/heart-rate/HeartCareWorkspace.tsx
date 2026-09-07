"use client"

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { usePathname, useRouter } from 'next/navigation'
import { Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { HeartRateMonthlyView } from './HeartRateMonthlyView'
import { SerialHeartCareView } from './SerialHeartCareView'
import { createSerialDisplay, appendAcceptedSample, syncSerialDisplay } from '@/lib/heart-rate/serial-display'
import type { Session } from '@/lib/heart-rate/session'
import { useWebSerialHeartRate } from '@/components/heart-rate/useWebSerialHeartRate'
import {
  HeartRateMeasurementView,
  HeartRateMinutePoint as CollectedHeartRateMinutePoint,
  createHeartRateStatsCollector,
} from '@/lib/heartRateCollector'
import {
  GatewayHeartRateEvent,
  HeartRateDeviceMapping,
  findMappedStudentNumber,
} from '@/lib/heartRateSerial'
import { validateHeartRateMappings } from '@/lib/heartRateMapping'
import {
  HeartRateSessionPayload,
  serializeHeartRateTransportQuality,
} from '@/lib/heartRateSession'
import {
  assertHeartRateParticipantSnapshot,
  buildHeartRateParticipantIndex,
  serializeCollectedHeartRatePoints,
  splitHeartRateCheckpointPoints,
} from '@/lib/heartRateSessionClient'
import {
  checkpointHeartRateSession,
  discardHeartRateSession,
  finalizeHeartRateSession,
  stabilizeHeartRateSession,
  startHeartRateSession,
  stopHeartRateSession,
} from '@/lib/heartRateSessionApi'

const HEART_RATE_STATS_FLUSH_MS = 250
const HEART_RATE_CHECKPOINT_MS = 15_000

type Gender = 'M' | 'F'

interface StudentRow {
  id: string
  grade: number
  class_no: number
  student_no: number
  name: string
  gender: Gender | null
  birth_date: string | null
  email: string | null
  height_cm: number | null
  weight_kg: number | null
  notes: string | null
}

interface HeartRateRow {
  student_id: string
  student_no: number
  name: string
  avg_bpm: (number | null)[]
  max_bpm: (number | null)[]
  min_bpm: (number | null)[]
}

interface CohortSelection {
  year: number
  grade: number
  classNo: number
}

interface MeasurementSnapshot extends CohortSelection {
  students: StudentRow[]
  mappings: HeartRateDeviceMapping[]
}

const selectionKeyOf = ({ year, grade, classNo }: CohortSelection) => `${year}:${grade}:${classNo}`

const emptyHeartRateRows = (students: StudentRow[]): HeartRateRow[] => {
  const empty12 = Array.from({ length: 12 }, () => null as number | null)
  return students
    .slice()
    .sort((a, b) => (a.student_no ?? 0) - (b.student_no ?? 0))
    .map((student) => ({
      student_id: student.id,
      student_no: student.student_no,
      name: student.name,
      avg_bpm: [...empty12],
      max_bpm: [...empty12],
      min_bpm: [...empty12],
    }))
}

export default function HeartCareWorkspace() {
  const pathname = usePathname()
  const router = useRouter()
  const displayRef = useRef<Session | null>(null)
  const [displayNow, setDisplayNow] = useState(Date.now)
  const liveRoute = pathname === '/school/heart-rate/live'
  // 학년도: 3~12월은 해당 연도, 1~2월은 전년도
  const computeDefaultYear = () => {
    const now = new Date()
    const m = now.getMonth() + 1
    return (m === 1 || m === 2) ? now.getFullYear() - 1 : now.getFullYear()
  }

  const [grade, setGrade] = useState<number>(1)
  const [classNo, setClassNo] = useState<number>(1)
  const [schoolType, setSchoolType] = useState<1 | 2 | 3>(1)
  const [year, setYear] = useState<number>(computeDefaultYear())

  const [students, setStudents] = useState<StudentRow[]>([])
  const [studentsLoading, setStudentsLoading] = useState(true)
  const [loadedSelectionKey, setLoadedSelectionKey] = useState<string | null>(null)
  const [rows, setRows] = useState<HeartRateRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [mappings, setMappings] = useState<HeartRateDeviceMapping[]>([])
  const [mappingsLoading, setMappingsLoading] = useState(true)
  const [liveMeasurement, setLiveMeasurement] = useState<HeartRateMeasurementView | null>(null)
  const [completedMinutePoints, setCompletedMinutePoints] = useState<Record<number, CollectedHeartRateMinutePoint[]>>({})
  const [activeSession, setActiveSession] = useState<HeartRateSessionPayload | null>(null)
  const [isLiveView, setIsLiveView] = useState(false)
  const [isStartingMeasurement, setIsStartingMeasurement] = useState(false)
  const [isStoppingMeasurement, setIsStoppingMeasurement] = useState(false)
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [checkpointWarning, setCheckpointWarning] = useState<string | null>(null)
  const [measurementSnapshot, setMeasurementSnapshot] = useState<MeasurementSnapshot | null>(null)
  const mappingsRef = useRef<HeartRateDeviceMapping[]>([])
  const measurementSnapshotRef = useRef<MeasurementSnapshot | null>(null)
  const activeSessionRef = useRef<HeartRateSessionPayload | null>(null)
  const studentFetchGenerationRef = useRef(0)
  const collectorRef = useRef<ReturnType<typeof createHeartRateStatsCollector> | null>(null)
  if (collectorRef.current === null) collectorRef.current = createHeartRateStatsCollector()
  const collector = collectorRef.current
  const finalMeasurementRef = useRef<HeartRateMeasurementView | null>(null)
  const flushedRevisionRef = useRef(0)
  const completedMinuteCountRef = useRef(0)
  const statsFlushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const checkpointTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const checkpointInFlightRef = useRef<Promise<void> | null>(null)
  const checkpointAckRevisionRef = useRef(0)
  const sessionStopSyncedRef = useRef(false)
  const startInProgressRef = useRef(false)
  const stopInProgressRef = useRef(false)
  const mountedRef = useRef(true)
  const measurementButtonRef = useRef<HTMLButtonElement | null>(null)
  const saveDialogRef = useRef<HTMLDivElement | null>(null)
  const discardButtonRef = useRef<HTMLButtonElement | null>(null)
  const selectedCohort = useMemo<CohortSelection>(() => ({ year, grade, classNo }), [year, grade, classNo])
  const selectedCohortKey = useMemo(() => selectionKeyOf(selectedCohort), [selectedCohort])

  const onChangeYear = (v: number) => { setYear(v) }
  const onChangeGrade = (v: number) => { setGrade(v) }
  const onChangeClassNo = (v: number) => { setClassNo(v) }

  useEffect(() => {
    const loadSchool = async () => {
      try {
        const res = await fetch('/api/school/info', { credentials: 'include' })
        const data = await res.json()
        if (res.ok && data?.school?.school_type) {
          const t = Number(data.school.school_type)
          if (t === 1 || t === 2 || t === 3) {
            setSchoolType(t as 1 | 2 | 3)
            setGrade((g) => {
              const maxG = t === 1 ? 6 : 3
              return Math.min(Math.max(1, g), maxG)
            })
            setClassNo((c) => Math.min(Math.max(1, c), 10))
          }
        }
      } catch { }
    }
    loadSchool()
  }, [])

  const requestHeartRateRows = useCallback(async (
    selection: CohortSelection,
    signal?: AbortSignal,
  ): Promise<HeartRateRow[]> => {
    const res = await fetch(
      `/api/school/heart-rate?grade=${selection.grade}&class_no=${selection.classNo}&year=${selection.year}`,
      { signal },
    )
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || '심박수 기록 조회 실패')
    return (data.rows || []) as HeartRateRow[]
  }, [])

  useEffect(() => {
    const generation = studentFetchGenerationRef.current + 1
    studentFetchGenerationRef.current = generation
    const controller = new AbortController()
    const selection = selectedCohort
    const selectionKey = selectedCohortKey

    setStudentsLoading(true)
    setLoadedSelectionKey(null)
    setStudents([])
    setRows([])
    setError(null)

    const loadCohort = async () => {
      try {
        const studentsResponse = await fetch(
          `/api/school/students?year=${selection.year}&grade=${selection.grade}&class_no=${selection.classNo}`,
          { signal: controller.signal },
        )
        const studentsData = await studentsResponse.json()
        if (!studentsResponse.ok) throw new Error(studentsData.error || '학생 조회 실패')

        const nextStudents = Array.isArray(studentsData.students)
          ? studentsData.students as StudentRow[]
          : []
        let nextRows: HeartRateRow[] = []
        let heartRateLoadError: string | null = null

        if (nextStudents.length > 0) {
          try {
            nextRows = await requestHeartRateRows(selection, controller.signal)
          } catch (heartRateError) {
            if (controller.signal.aborted) return
            nextRows = emptyHeartRateRows(nextStudents)
            heartRateLoadError = heartRateError instanceof Error ? heartRateError.message : String(heartRateError)
          }
        }

        if (controller.signal.aborted || studentFetchGenerationRef.current !== generation) return
        setStudents(nextStudents)
        setRows(nextRows)
        setError(heartRateLoadError)
        setLoadedSelectionKey(selectionKey)
      } catch (loadError) {
        if (controller.signal.aborted || studentFetchGenerationRef.current !== generation) return
        setStudents([])
        setRows([])
        setLoadedSelectionKey(null)
        setError(loadError instanceof Error ? loadError.message : String(loadError))
      } finally {
        if (!controller.signal.aborted && studentFetchGenerationRef.current === generation) {
          setStudentsLoading(false)
        }
      }
    }

    void loadCohort()
    return () => controller.abort()
  }, [requestHeartRateRows, selectedCohort, selectedCohortKey])

  useEffect(() => {
    let cancelled = false

    const fetchMappings = async () => {
      setMappingsLoading(true)
      try {
        const response = await fetch('/api/school/heart-rate-mappings', { credentials: 'include' })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || '심박계 매핑 조회 실패')
        if (!cancelled) {
          const nextMappings = Array.isArray(data.mappings)
            ? data.mappings.map((mapping: { student_no: number; device_id: string }) => ({
              student_no: Number(mapping.student_no),
              device_id: String(mapping.device_id ?? ''),
            }))
            : []
          setMappings(nextMappings)
        }
      } catch (mappingError) {
        if (!cancelled) {
          setMappings([])
          setError(mappingError instanceof Error ? mappingError.message : String(mappingError))
        }
      } finally {
        if (!cancelled) setMappingsLoading(false)
      }
    }

    void fetchMappings()
    return () => { cancelled = true }
  }, [grade, classNo, year])

  useEffect(() => {
    mappingsRef.current = mappings
  }, [mappings])

  const clearStatsFlushTimer = useCallback(() => {
    if (statsFlushTimerRef.current) clearInterval(statsFlushTimerRef.current)
    statsFlushTimerRef.current = null
  }, [])

  const clearCheckpointTimer = useCallback(() => {
    if (checkpointTimerRef.current) clearInterval(checkpointTimerRef.current)
    checkpointTimerRef.current = null
  }, [])

  const handleHeartRateEvent = useCallback((event: GatewayHeartRateEvent, receivedAt: number) => {
    const studentNumber = findMappedStudentNumber(event, mappingsRef.current)
    if (studentNumber === null) return

    const accepted = collector.addSample(studentNumber, event, receivedAt)
    if (displayRef.current) appendAcceptedSample(displayRef.current, studentNumber, event, receivedAt, accepted)
  }, [collector])

  const serialSession = useWebSerialHeartRate(handleHeartRateEvent)

  const startStatsFlushTimer = useCallback(() => {
    clearStatsFlushTimer()
    statsFlushTimerRef.current = setInterval(() => {
      collector.updateTransportQuality(serialSession.transportQuality())
      const now = Date.now()
      const view = collector.advance(now)
      if (displayRef.current) syncSerialDisplay(displayRef.current, view, now)
      setDisplayNow(now)
      if (view.revision === flushedRevisionRef.current) return

      flushedRevisionRef.current = view.revision
      setLiveMeasurement(view)
      if (view.completedMinuteCount !== completedMinuteCountRef.current) {
        completedMinuteCountRef.current = view.completedMinuteCount
        setCompletedMinutePoints(Object.fromEntries(
          Object.entries(view.minutePointsByStudentNumber).map(([studentNumber, points]) => [
            Number(studentNumber),
            points.filter((point) => !point.isPartial),
          ]),
        ))
      }
    }, HEART_RATE_STATS_FLUSH_MS)
  }, [clearStatsFlushTimer, collector, serialSession])

  const flushCheckpoint = useCallback((): Promise<void> => {
    if (checkpointInFlightRef.current) return checkpointInFlightRef.current

    const operation = (async () => {
      const sessionPayload = activeSessionRef.current
      if (!sessionPayload) return

      try {
        collector.updateTransportQuality(serialSession.transportQuality())
        const checkpoint = collector.checkpoint(checkpointAckRevisionRef.current, Date.now())
        if (checkpoint.points.length === 0) return

        const participantIds = buildHeartRateParticipantIndex(sessionPayload.participants)
        const points = serializeCollectedHeartRatePoints(
          checkpoint.points.reduce<Record<number, typeof checkpoint.points>>((grouped, point) => {
            grouped[point.studentNumber] ??= []
            grouped[point.studentNumber].push(point)
            return grouped
          }, {}),
          participantIds,
        )
        const transportQuality = serializeHeartRateTransportQuality(checkpoint.transportQuality)

        for (const chunk of splitHeartRateCheckpointPoints(points)) {
          await checkpointHeartRateSession(sessionPayload.session.id, chunk, transportQuality)
        }
        checkpointAckRevisionRef.current = checkpoint.revision
        if (mountedRef.current) setCheckpointWarning(null)
      } catch (checkpointError) {
        if (mountedRef.current) {
          const detail = checkpointError instanceof Error ? checkpointError.message : String(checkpointError)
          setCheckpointWarning(`측정 데이터의 서버 동기화가 지연되고 있습니다. 자동으로 다시 시도합니다. (${detail})`)
        }
        throw checkpointError
      }
    })()

    checkpointInFlightRef.current = operation
    void operation.finally(() => {
      if (checkpointInFlightRef.current === operation) checkpointInFlightRef.current = null
    }).catch(() => undefined)
    return operation
  }, [collector, serialSession])

  const startCheckpointTimer = useCallback(() => {
    clearCheckpointTimer()
    checkpointTimerRef.current = setInterval(() => {
      void flushCheckpoint().catch(() => undefined)
    }, HEART_RATE_CHECKPOINT_MS)
  }, [clearCheckpointTimer, flushCheckpoint])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      clearStatsFlushTimer()
      clearCheckpointTimer()
      collector.reset()
      finalMeasurementRef.current = null
      measurementSnapshotRef.current = null
      activeSessionRef.current = null
      flushedRevisionRef.current = 0
      completedMinuteCountRef.current = 0
      checkpointAckRevisionRef.current = 0
      sessionStopSyncedRef.current = false
      startInProgressRef.current = false
      stopInProgressRef.current = false
    }
  }, [clearCheckpointTimer, clearStatsFlushTimer, collector])

  useEffect(() => {
    if (!showSaveModal) return

    const measurementButton = measurementButtonRef.current
    const focusFrame = requestAnimationFrame(() => discardButtonRef.current?.focus())
    const keepFocusInsideDialog = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const dialog = saveDialogRef.current
      if (!dialog) return

      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ))
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', keepFocusInsideDialog)
    return () => {
      cancelAnimationFrame(focusFrame)
      document.removeEventListener('keydown', keepFocusInsideDialog)
      requestAnimationFrame(() => measurementButton?.focus())
    }
  }, [showSaveModal])

  const resetMeasurementState = useCallback(() => {
    displayRef.current = null
    router.replace('/school/heart-rate')
    clearStatsFlushTimer()
    clearCheckpointTimer()
    collector.reset()
    finalMeasurementRef.current = null
    flushedRevisionRef.current = 0
    completedMinuteCountRef.current = 0
    checkpointAckRevisionRef.current = 0
    checkpointInFlightRef.current = null
    sessionStopSyncedRef.current = false
    startInProgressRef.current = false
    stopInProgressRef.current = false
    activeSessionRef.current = null
    measurementSnapshotRef.current = null
    mappingsRef.current = mappings
    setShowSaveModal(false)
    setIsLiveView(false)
    setIsStartingMeasurement(false)
    setIsStoppingMeasurement(false)
    setIsSaving(false)
    setLiveMeasurement(null)
    setCompletedMinutePoints({})
    setActiveSession(null)
    setMeasurementSnapshot(null)
    setCheckpointWarning(null)
  }, [clearCheckpointTimer, clearStatsFlushTimer, collector, mappings, router])

  const handleStartMeasurement = () => {
    if (startInProgressRef.current) return
    setError(null)

    if (studentsLoading || loadedSelectionKey !== selectedCohortKey) {
      setError('선택한 학급의 학생 정보를 불러오는 중입니다. 잠시 후 다시 시도해 주세요.')
      return
    }
    if (students.length === 0) {
      setError('선택한 학급에 측정할 학생이 없습니다.')
      return
    }
    if (mappingsLoading) {
      setError('심박계 ID를 확인하는 중입니다. 잠시 후 다시 시도해 주세요.')
      return
    }

    const mappingValidation = validateHeartRateMappings(mappings)
    if (!mappingValidation.ok) {
      setError(`디바이스 설정 > Heart Fit 설정을 확인해 주세요. ${mappingValidation.error}`)
      return
    }
    const studentNumbers = new Set(students.map((student) => student.student_no))
    const activeMappings = mappingValidation.mappings.map((mapping) => (
      studentNumbers.has(mapping.student_no) ? { ...mapping } : { ...mapping, device_id: '' }
    ))
    const nonEmptyMappings = activeMappings.filter((mapping) => mapping.device_id !== '')
    if (nonEmptyMappings.length === 0) {
      setError('배정된 심박계가 없습니다. 디바이스 설정 > Heart Fit 설정에서 측정 슬롯에 7자리 심박계 ID를 먼저 배정해 주세요.')
      return
    }

    const snapshot: MeasurementSnapshot = {
      ...selectedCohort,
      students: students.map((student) => ({ ...student })),
      mappings: activeMappings,
    }
    measurementSnapshotRef.current = snapshot
    setMeasurementSnapshot(snapshot)
    mappingsRef.current = snapshot.mappings
    activeSessionRef.current = null
    finalMeasurementRef.current = null
    flushedRevisionRef.current = 0
    completedMinuteCountRef.current = 0
    checkpointAckRevisionRef.current = 0
    sessionStopSyncedRef.current = false
    startInProgressRef.current = true
    setLiveMeasurement(null)
    setCompletedMinutePoints({})
    setActiveSession(null)
    setSaveError(null)
    setCheckpointWarning(null)
    setIsStartingMeasurement(true)
    setIsLiveView(true)

    const createdSessionBox: { current: HeartRateSessionPayload | null } = { current: null }
    let beforeRunError: unknown = null
    const clientRequestId = crypto.randomUUID()

    // Web Serial 포트 선택의 클릭 권한을 보존하기 위해 이 Promise를 클릭 핸들러 안에서 즉시 시작한다.
    const startPromise = serialSession.start({
      beforeRunStart: async () => {
        try {
          const createdSession = await startHeartRateSession({
            client_request_id: clientRequestId,
            academic_year: snapshot.year,
            grade: snapshot.grade,
            class_no: snapshot.classNo,
          })
          createdSessionBox.current = createdSession
          assertHeartRateParticipantSnapshot(snapshot.students, createdSession.participants)

          const participantByStudentNumber = new Map(
            createdSession.participants.map((participant) => [participant.student_no, participant]),
          )
          const authoritativeSnapshot: MeasurementSnapshot = {
            ...snapshot,
            students: snapshot.students.map((student) => ({
              ...student,
              name: participantByStudentNumber.get(student.student_no)?.name ?? student.name,
            })),
          }
          measurementSnapshotRef.current = authoritativeSnapshot
          activeSessionRef.current = createdSession
          if (mountedRef.current) {
            setMeasurementSnapshot(authoritativeSnapshot)
            setActiveSession(createdSession)
          }
        } catch (startSessionError) {
          beforeRunError = startSessionError
          throw startSessionError
        }
      },
    })

    router.push('/school/heart-rate/live')
    void (async () => {
      try {
        const run = await startPromise
        if (!run) {
          throw beforeRunError ?? new Error('USB 연결에 실패했습니다. 장치를 확인한 뒤 다시 시작해 주세요.')
        }
        if (!mountedRef.current) throw new Error('화면 이동으로 측정 시작이 취소되었습니다.')
        const createdSession = createdSessionBox.current
        if (!createdSession) throw new Error('측정 세션이 준비되지 않았습니다.')

        displayRef.current = createSerialDisplay(createdSession, snapshot.mappings, {
          schoolId: '', year: snapshot.year, grade: snapshot.grade, class_no: snapshot.classNo, schoolType,
        }, run.startedAt)
        collector.begin({
          startedAt: run.startedAt,
          studentNumbers: nonEmptyMappings.map((mapping) => mapping.student_no),
        })
        const initialView = collector.measurementSnapshot(run.startedAt)
        flushedRevisionRef.current = initialView.revision
        setLiveMeasurement(initialView)

        const stabilizedSession = await stabilizeHeartRateSession(
          createdSession.session.id,
          run.runId,
          new Date(run.startedAt).toISOString(),
        )
        activeSessionRef.current = stabilizedSession
        setActiveSession(stabilizedSession)
        startStatsFlushTimer()
        startCheckpointTimer()
      } catch (startError) {
        clearStatsFlushTimer()
        clearCheckpointTimer()
        collector.reset()
        try { await serialSession.stop() } catch { }

        let cleanupError: unknown = null
        const sessionToDiscard = createdSessionBox.current
        if (sessionToDiscard) {
          try {
            await discardHeartRateSession(sessionToDiscard.session.id)
          } catch (discardError) {
            cleanupError = discardError
          }
        }

        if (mountedRef.current) {
          resetMeasurementState()
          const detail = startError instanceof Error ? startError.message : String(startError)
          const cleanupDetail = cleanupError instanceof Error ? cleanupError.message : cleanupError ? String(cleanupError) : null
          setError(cleanupDetail
            ? `${detail} 생성된 측정 세션 정리에도 실패했습니다. (${cleanupDetail})`
            : detail)
        }
      } finally {
        startInProgressRef.current = false
        if (mountedRef.current) setIsStartingMeasurement(false)
      }
    })()
  }

  const syncStoppedMeasurement = useCallback(async () => {
    if (sessionStopSyncedRef.current) return
    const sessionPayload = activeSessionRef.current
    if (!sessionPayload || !finalMeasurementRef.current) throw new Error('종료할 측정 세션이 없습니다.')

    // freeze 이후 dirty absolute point를 먼저 모두 ACK하면 수업 길이와 무관하게
    // stop API의 3,600-point snapshot 상한을 사용하지 않고 안전하게 상태를 전환할 수 있다.
    await flushCheckpoint()
    const finalMeasurement = finalMeasurementRef.current
    if (!finalMeasurement) throw new Error('종료할 측정 데이터가 없습니다.')
    const stoppedSession = await stopHeartRateSession(
      sessionPayload.session.id,
      [],
      serializeHeartRateTransportQuality(finalMeasurement.transportQuality),
    )
    activeSessionRef.current = stoppedSession
    sessionStopSyncedRef.current = true
    if (mountedRef.current) {
      setActiveSession(stoppedSession)
      setCheckpointWarning(null)
    }
  }, [flushCheckpoint])

  const handleStopMeasurement = async () => {
    if (stopInProgressRef.current) return
    stopInProgressRef.current = true
    setIsStoppingMeasurement(true)

    clearStatsFlushTimer()
    clearCheckpointTimer()
    collector.updateTransportQuality(serialSession.transportQuality())
    const stoppedAt = Date.now()
    const finalMeasurement = collector.freezeMeasurement(stoppedAt)
    if (displayRef.current) {
      syncSerialDisplay(displayRef.current, finalMeasurement, stoppedAt)
      displayRef.current.stoppedAt = stoppedAt
      setDisplayNow(stoppedAt)
    }
    finalMeasurementRef.current = finalMeasurement
    flushedRevisionRef.current = finalMeasurement.revision
    setLiveMeasurement(finalMeasurement)

    try {
      try { await checkpointInFlightRef.current } catch { }
      await serialSession.stop()
      collector.updateTransportQuality(serialSession.transportQuality())
      const stoppedView = collector.measurementSnapshot()
      finalMeasurementRef.current = stoppedView
      setLiveMeasurement(stoppedView)
      try {
        await syncStoppedMeasurement()
        if (mountedRef.current) setSaveError(null)
      } catch (stopSyncError) {
        if (mountedRef.current) {
          const detail = stopSyncError instanceof Error ? stopSyncError.message : String(stopSyncError)
          setSaveError(`측정은 종료되었지만 서버 동기화가 완료되지 않았습니다. 저장하면 다시 시도합니다. (${detail})`)
        }
      }
    } finally {
      if (document.fullscreenElement && typeof document.exitFullscreen === 'function') {
        try { await document.exitFullscreen() } catch { }
      }
      if (mountedRef.current) {
        setShowSaveModal(true)
        setIsStoppingMeasurement(false)
      }
      stopInProgressRef.current = false
    }
  }

  const saveMeasurement = async () => {
    const finalMeasurement = finalMeasurementRef.current
    const snapshot = measurementSnapshotRef.current
    const sessionPayload = activeSessionRef.current
    if (!snapshot || !finalMeasurement || !sessionPayload) return

    const pointCount = Object.values(finalMeasurement.minutePointsByStudentNumber)
      .reduce((total, points) => total + points.length, 0)
    if (pointCount === 0) {
      setSaveError('저장할 심박 측정 데이터가 없습니다. 저장하지 않고 종료할 수 있습니다.')
      return
    }

    setIsSaving(true)
    setSaveError(null)
    try {
      await syncStoppedMeasurement()
      await finalizeHeartRateSession(sessionPayload.session.id)

      try {
        setRows(await requestHeartRateRows(snapshot))
      } catch (refreshError) {
        setRows(emptyHeartRateRows(snapshot.students))
        setError(refreshError instanceof Error ? refreshError.message : String(refreshError))
      }
      resetMeasurementState()
    } catch (saveRequestError) {
      setSaveError(saveRequestError instanceof Error ? saveRequestError.message : String(saveRequestError))
    } finally {
      setIsSaving(false)
    }
  }

  const discardMeasurement = async () => {
    const sessionPayload = activeSessionRef.current
    if (!sessionPayload) return

    setIsSaving(true)
    setSaveError(null)
    try {
      await discardHeartRateSession(sessionPayload.session.id)
      resetMeasurementState()
    } catch (discardError) {
      setSaveError(discardError instanceof Error ? discardError.message : String(discardError))
    } finally {
      setIsSaving(false)
    }
  }

  useEffect(() => {
    if (liveRoute && !isLiveView) router.replace('/school/heart-rate')
  }, [liveRoute, isLiveView, router])

  const displayStatusText = serialSession.state === 'running' && displayRef.current?.students.some(student => student.cur !== null)
    ? 'USB 수신기 연결됨 · 심박 수신 중'
    : serialSession.statusText

  return <>
    {liveRoute && isLiveView ? <SerialHeartCareView
      session={displayRef.current} now={displayNow} state={serialSession.state}
      statusText={displayStatusText} error={error ?? checkpointWarning ?? serialSession.error}
      busy={isStartingMeasurement || isStoppingMeasurement}
      onStop={() => { void handleStopMeasurement() }} onBack={() => router.push('/school/heart-rate')}
    /> : <HeartRateMonthlyView
      year={year} grade={grade} classNo={classNo} schoolType={schoolType} students={students} rows={rows}
      loading={studentsLoading} starting={isStartingMeasurement} activeSession={isLiveView}
      startDisabled={!isLiveView && (loadedSelectionKey !== selectedCohortKey || mappingsLoading)}
      state={serialSession.state === 'running' ? 'open' : serialSession.state} statusText={displayStatusText}
      error={error ?? checkpointWarning} measurementButtonRef={measurementButtonRef}
      onYearChange={onChangeYear} onGradeChange={onChangeGrade} onClassChange={onChangeClassNo}
      start={() => { if (isLiveView) router.push('/school/heart-rate/live'); else handleStartMeasurement() }}
    />}
      {showSaveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" role="presentation">
          <div
            ref={saveDialogRef}
            className="w-full max-w-md rounded-none bg-white p-6 text-gray-900 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="save-heart-rate-title"
            aria-describedby="save-heart-rate-description"
          >
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-secondary">
              <Clock size={30} className="text-primary" aria-hidden="true" />
            </div>
            <h3 id="save-heart-rate-title" className="text-center text-xl font-bold">측정 결과를 저장하시겠습니까?</h3>
            <p id="save-heart-rate-description" className="mt-2 text-center text-sm text-gray-500">
              이번 수업의 1분 평균 원본과 요약을 저장하고 월별 기록도 함께 갱신합니다.
            </p>

            {saveError && (
              <div className="mt-4 rounded-none border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
                {saveError}
              </div>
            )}

            <div className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Button
                ref={discardButtonRef}
                type="button"
                onClick={() => { void discardMeasurement() }}
                disabled={isSaving}
                variant="outline" className="h-11"
              >
                저장하지 않고 종료
              </Button>
              <Button
                type="button"
                onClick={() => { void saveMeasurement() }}
                disabled={isSaving}
                className="h-11"
              >
                {isSaving ? '저장 중...' : '저장하고 종료'}
              </Button>
            </div>
          </div>
        </div>
      )}

  </>
}
