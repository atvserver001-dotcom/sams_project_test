'use client'
import { PageHeader } from '@/components/console/page-header'
import { NativeSelect } from '@/components/ui/native-select'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

import React, { useEffect, useRef, useState, useMemo } from 'react'

type ConnectionState =
  | 'connecting'
  | 'open'
  | 'closed'
  | 'error'
  | 'idle'
  | 'app_launched'

const BRIDGE_URL = 'ws://localhost:8888'

// 학급 데이터 타입
interface StudentMapping {
  no: number
  name: string
  device_id: string
}

interface ClassData {
  grade: number
  class_no: number
  students: StudentMapping[]
}

function fmtTime(iso?: string | null) {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function fmtSensorId7(id?: string | null) {
  if (!id) return '-'
  const s = String(id).trim()
  if (!/^\d+$/.test(s)) return s
  if (s.length >= 7) return s
  return s.padStart(7, '0')
}

export default function HeartRateTestPage() {
  const [state, setState] = useState<ConnectionState>('idle')
  const [sessionActive, setSessionActive] = useState(false)
  const [statusText, setStatusText] = useState<string>('대기 중')

  // 학급 선택
  const [selectedGrade, setSelectedGrade] = useState<number>(1)
  const [selectedClass, setSelectedClass] = useState<number>(1)

  const [currentBpm, setCurrentBpm] = useState<number | null>(null)
  const [lastTs, setLastTs] = useState<string | null>(null)

  const [samples, setSamples] = useState<
    Array<{
      ts: string
      bpm: number | null
      tech?: string
      sensor_id?: string
      battery_percent?: number | null
      rssi?: number | null
      raw: string
    }>
  >([])

  const [filterTech, setFilterTech] = useState<'all' | 'ANT' | 'BLE'>('all')
  const [filterSensor, setFilterSensor] = useState<string>('')
  const [sensorOrder, setSensorOrder] = useState<string[]>([])

  const wsRef = useRef<WebSocket | null>(null)
  const retryTimerRef = useRef<NodeJS.Timeout | null>(null)

  // 마운트 시 소켓 정리만 수행 (자동 연결 제거)
  useEffect(() => {
    return () => disconnect()
  }, [])

  // 학급 데이터 조회 및 전송
  const sendClassDataToApp = async () => {
    try {
      // 1. 학생 정보 조회
      const currentYear = new Date().getFullYear()
      const studentsRes = await fetch(
        `/api/school/students?year=${currentYear}&grade=${selectedGrade}&class_no=${selectedClass}`,
      )
      if (!studentsRes.ok) {
        throw new Error('학생 정보 조회 실패')
      }
      const studentsData = await studentsRes.json()
      const students = studentsData.students || []

      // 2. 심박계 매핑 조회
      const mappingsRes = await fetch('/api/school/heart-rate-mappings')
      if (!mappingsRes.ok) {
        throw new Error('심박계 매핑 조회 실패')
      }
      const mappingsData = await mappingsRes.json()
      const mappings = mappingsData.mappings || []

      // 3. 학생 데이터 구성 (1~30번)
      const studentMappings: StudentMapping[] = []
      for (let i = 1; i <= 30; i++) {
        const student = students.find(
          (s: { student_no: number; name?: string }) => s.student_no === i,
        )
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mapping = mappings.find((m: any) => m.student_no === i)

        if (student && mapping) {
          studentMappings.push({
            no: i,
            name: student.name || `학생 ${i}`,
            device_id: mapping.device_id,
          })
        }
      }

      // 4. WebSocket으로 학급 데이터 전송
      const classData: ClassData = {
        grade: selectedGrade,
        class_no: selectedClass,
        students: studentMappings,
      }

      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            command: 'set_class_data',
            data: classData,
          }),
        )
        setStatusText(
          `${selectedGrade}학년 ${selectedClass}반 정보 전송 완료 (${studentMappings.length}명)`,
        )
      } else {
        setStatusText('앱이 연결되지 않았습니다')
      }
    } catch (error) {
      console.error('학급 데이터 전송 오류:', error)
      setStatusText('학급 데이터 전송 실패')
    }
  }

  const launchApp = () => {
    window.location.assign('fitness-bridge://start')
    setState('connecting')
    setStatusText('앱을 호출했습니다. 확인 중...')

    let isResolved = false
    // const probeStartTime = Date.now()

    // 공통 앱 감지 함수
    const probe = () => {
      if (isResolved) return

      const checkWs = new WebSocket(BRIDGE_URL)
      checkWs.onopen = () => {
        if (!isResolved) {
          isResolved = true
          checkWs.close()
          setState('app_launched')
          setStatusText('앱 실행됨 (측정 시작을 눌러주세요)')
          cleanup()
        }
      }
      checkWs.onerror = () => {
        checkWs.close()
      }
    }

    // 1. 주기적 폴링 (Chrome '항상 허용' 옵션 대응)
    const intervalId = setInterval(probe, 1000)

    // 2. 포커스 복귀 감지 (취소 또는 수동 열기 대응)
    const onFocus = () => {
      // 사용자가 브라우저로 돌아오면 즉시 한번 더 확인
      setTimeout(probe, 500)
    }
    window.addEventListener('focus', onFocus)

    // 3. 최종 안전 타임아웃 (8초 동안 실패 시 복구)
    const safetyTimeoutId = setTimeout(() => {
      if (!isResolved) {
        isResolved = true
        setState('idle')
        setStatusText('앱이 실행되지 않았습니다. 다시 시도해 주세요.')
        cleanup()
      }
    }, 8000)

    const cleanup = () => {
      clearInterval(intervalId)
      clearTimeout(safetyTimeoutId)
      window.removeEventListener('focus', onFocus)
    }
  }

  const connect = () => {
    disconnect()
    setState('connecting')
    setStatusText('Fitness Bridge와 연결 중입니다...')

    const ws = new WebSocket(BRIDGE_URL)
    wsRef.current = ws

    // 타임아웃 처리 (5초 내 연결 실패 시 에러)
    retryTimerRef.current = setTimeout(() => {
      if (wsRef.current?.readyState !== WebSocket.OPEN) {
        setState('error')
        setStatusText('앱이 켜져 있는지 확인해 주세요.')
      }
    }, 5000)

    ws.onopen = () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)

      setState('open')
      setStatusText('Fitness Bridge 연결됨')

      // 연결되자마자 세션 시작
      setTimeout(() => startSession(), 200)
    }

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data)
        handleFitnessBridgeMessage(msg)
      } catch (err) {
        console.error('메시지 파싱 오류:', err)
      }
    }

    ws.onerror = (e) => {
      console.error('WebSocket 오류:', e)
    }

    ws.onclose = () => {
      // 중요: 연결 시도 중(connecting)이거나 앱 실행 시퀀스 중에는
      // 개별 소켓의 닫힘 이벤트를 무시합니다. (성급한 '연결 종료' 안내 방지)
      // 최종 결과는 12초 타임아웃 타이머(retryTimerRef)에서 결정됩니다.
      if (wsRef.current === ws) {
        // 이미 연결된 이후에 끊긴 경우에만 Closed 처리
        if (state === 'open') {
          setState('closed')
          setStatusText('연결 종료')
          setSessionActive(false)
          wsRef.current = null
        }
      }
    }
  }

  // handleStart는 더 이상 필요 없으므로 제거 (개별 버튼 onClick 사용)

  const disconnect = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ command: 'quit_app' }))
    }

    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
    setState('idle')
    setStatusText('중지됨')
    setSessionActive(false)
  }

  const startSession = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ command: 'start_session' }))
      setStatusText('세션 시작 요청 전송')
    }
  }

  const stopSession = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ command: 'stop_session' }))
    }
  }

  // Effect to use stopSession on unmount via cleanup is already handled by disconnect() which closes socket
  // preventing unused variable warning by effectively logging or ignoring if not intended for direct UI usage
  useEffect(() => {
    // Just to acknowledge stopSession exists for potential future use
    void stopSession
  }, [])

  interface FitnessBridgeMessage {
    type?: string
    sessionActive?: boolean
    message?: string
    dataType?: string
    data?: {
      heartRate?: number
      timestamp?: string
      deviceId?: string | number
      battery?: number
      [key: string]: unknown
    }
  }

  const handleFitnessBridgeMessage = (msg: FitnessBridgeMessage) => {
    const ts = new Date().toISOString()

    // 상태 메시지
    if (msg.type === 'status') {
      if (msg.sessionActive !== undefined) {
        setSessionActive(msg.sessionActive)
      }
      if (msg.message) {
        setStatusText(msg.message)
      }
      return
    }

    // 데이터 메시지
    if (msg.type === 'data' && msg.data) {
      const data = msg.data
      const dataType = msg.dataType

      // ANT+ 심박수
      if (dataType === 'ant_heartrate' && data.heartRate) {
        const sample = {
          ts: data.timestamp || ts,
          bpm: data.heartRate,
          tech: 'ANT',
          sensor_id: 'ANT+',
          raw: `ANT+ HR=${data.heartRate}`,
        }

        setSamples((prev) => [sample, ...prev].slice(0, 200))
        setCurrentBpm(data.heartRate)
        setLastTs(sample.ts)
      }

      // BLE 심박수
      else if (dataType === 'ble_heartrate' && data.heartRate) {
        const sample = {
          ts: data.timestamp || ts,
          bpm: data.heartRate,
          tech: 'BLE',
          sensor_id: data.deviceId ? String(data.deviceId) : 'BLE',
          battery_percent: data.battery,
          raw: `BLE HR=${data.heartRate}${data.battery ? ` Bat=${data.battery}%` : ''}`,
        }

        setSamples((prev) => [sample, ...prev].slice(0, 200))
        setCurrentBpm(data.heartRate)
        setLastTs(sample.ts)
      }

      // 허브 상태 (heartbeat)
      else if (dataType === 'heartbeat') {
        // 배터리 정보 등만 로그
        console.log('허브 상태:', data)
      }
    }
  }

  // 센서별 그룹화
  const groupedSensorsMap = useMemo(() => {
    const map = new Map<string, (typeof samples)[number]>()
    for (const s of samples) {
      const q = filterSensor.trim().toLowerCase()
      if (filterTech !== 'all' && (s.tech || '').toUpperCase() !== filterTech)
        continue
      if (q) {
        const hay = `${s.sensor_id || ''}`.toLowerCase()
        if (!hay.includes(q)) continue
      }

      const key = `${(s.tech || '-').toUpperCase()}|${s.sensor_id}`
      if (!map.has(key)) map.set(key, s)
    }
    return map
  }, [samples, filterTech, filterSensor])

  const groupedSensorsSortedKeys = useMemo(() => {
    const keys = Array.from(groupedSensorsMap.keys())
    return keys.sort((a, b) => {
      const [, aId] = a.split('|')
      const [, bId] = b.split('|')
      const an = Number(aId)
      const bn = Number(bId)
      if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn)
        return an - bn
      return a.localeCompare(b)
    })
  }, [groupedSensorsMap])

  useEffect(() => {
    setSensorOrder((prev) => {
      if (prev.length === 0) return groupedSensorsSortedKeys
      const set = new Set(prev)
      const next = [...prev]
      for (const k of groupedSensorsSortedKeys) {
        if (!set.has(k)) {
          set.add(k)
          next.push(k)
        }
      }
      return next.filter((k) => groupedSensorsMap.has(k))
    })
  }, [groupedSensorsSortedKeys, groupedSensorsMap])

  // 컴포넌트 언마운트 시 연결 정리
  useEffect(() => {
    return () => {
      disconnect()
    }
  }, [])

  return (
    <div className="space-y-6 text-foreground">
      <div className="flex items-start justify-between gap-4">
        <PageHeader
          title="심박계 테스트 - Fitness Bridge"
          eyebrow="운영 관리"
          actions={
            <>
              <p className="mt-1 text-sm text-muted-foreground">
                &quot;시작&quot; 버튼을 클릭하면 로컬 Fitness Bridge 서버에
                연결되어 실시간 심박수 데이터를 수신합니다.
              </p>
            </>
          }
        />
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex items-center px-3 py-1.5 text-xs font-semibold ${
              state === 'open'
                ? 'bg-accent text-foreground'
                : state === 'connecting'
                  ? 'bg-accent text-foreground'
                  : state === 'error'
                    ? 'bg-accent text-destructive'
                    : 'bg-muted text-foreground'
            }`}
          >
            {state === 'open'
              ? '✅ 연결됨'
              : state === 'connecting'
                ? '🔄 연결 중...'
                : state === 'error'
                  ? '❌ 오류'
                  : '⚪ 대기'}
          </span>
          <span
            className={`inline-flex items-center px-3 py-1.5 text-xs font-semibold ${
              sessionActive
                ? 'bg-accent text-foreground'
                : 'bg-muted text-foreground'
            }`}
          >
            세션: {sessionActive ? '🟢 활성' : '⚪ 대기'}
          </span>
        </div>
      </div>

      {/* 상태 및 제어 */}
      <div className="bg-white p-6 space-y-4 console-panel">
        {/* 학급 선택 */}
        <div className="bg-primary border border-border p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">
            📚 학급 선택
          </h3>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-foreground">
                학년:
              </label>
              <NativeSelect
                value={selectedGrade}
                onChange={(e) => setSelectedGrade(Number(e.target.value))}
                className="border border-border px-3 py-1.5 text-sm"
              >
                {[1, 2, 3, 4, 5, 6].map((g) => (
                  <option key={g} value={g}>
                    {g}학년
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-foreground">반:</label>
              <NativeSelect
                value={selectedClass}
                onChange={(e) => setSelectedClass(Number(e.target.value))}
                className="border border-border px-3 py-1.5 text-sm"
              >
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((c) => (
                  <option key={c} value={c}>
                    {c}반
                  </option>
                ))}
              </NativeSelect>
            </div>
            <Button
              onClick={sendClassDataToApp}
              disabled={state !== 'open'}
              className={`px-4 py-2 text-sm font-semibold ${
                state === 'open'
                  ? 'bg-primary text-white hover:bg-primary'
                  : 'bg-muted text-muted-foreground cursor-not-allowed'
              }`}
            >
              학급 정보 전송
            </Button>
          </div>
        </div>

        {/* 연결 전 안내 메시지 */}
        {state === 'idle' && (
          <div className="bg-accent border-l-4 border-border p-4 mb-4">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg
                  className="h-5 w-5 text-foreground"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-foreground">
                  시작하기 전에
                </h3>
                <div className="mt-2 text-sm text-foreground">
                  <p>1. Fitness Bridge 서버가 실행 중인지 확인하세요</p>
                  <p className="mt-1 ml-4 font-mono text-xs bg-accent px-2 py-1 inline-block">
                    node index.js 또는 fitness-bridge.exe 실행
                  </p>
                  <p className="mt-2">
                    2. 허브가 Fitness Bridge에 연결되어 있는지 확인하세요
                  </p>
                  <p className="mt-2">
                    3. 아래 &quot;시작&quot; 버튼을 클릭하세요
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 연결 실패 안내 메시지 */}
        {state === 'error' && (
          <div className="bg-accent border-l-4 border-border p-4 mb-4">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg
                  className="h-5 w-5 text-destructive"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-destructive">
                  연결 실패
                </h3>
                <div className="mt-2 text-sm text-destructive">
                  <p>{statusText}</p>
                  <div className="mt-3 p-3 bg-accent/50 border border-border">
                    <p className="font-semibold text-destructive mb-1">
                      앱을 처음 사용하시나요?
                    </p>
                    <p className="text-xs text-destructive mb-2">
                      윈도우 전용 Fitness Bridge 앱을 설치해야 실시간 연동이
                      가능합니다.
                    </p>
                    <a
                      href="/downloads/FitnessBridge-Portable.exe"
                      className="inline-flex items-center px-3 py-1.5 bg-primary text-foreground text-xs font-bold hover:bg-primary transition-colors"
                    >
                      <span>📥 Fitness Bridge 다운로드</span>
                    </a>
                  </div>
                  <p className="mt-3 font-semibold">이미 앱을 설치했다면:</p>
                  <ul className="list-disc list-inside mt-1 space-y-1">
                    <li>
                      브라우저 팝업에서 &quot;열기&quot;를 허용했는지 확인
                    </li>
                    <li>사용 중인 백신/방화벽이 앱을 차단하는지 확인</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="text-center p-4 bg-primary">
            <div className="text-sm font-semibold text-foreground mb-1">
              현재 심박수
            </div>
            <div className="text-4xl font-bold text-foreground">
              {currentBpm ? `${currentBpm}` : '-'}
              {currentBpm && <span className="text-lg ml-1">BPM</span>}
            </div>
          </div>
          <div className="text-center p-4 bg-primary">
            <div className="text-sm font-semibold text-foreground mb-1">
              수신 데이터
            </div>
            <div className="text-4xl font-bold text-foreground">
              {samples.length}
            </div>
          </div>
          <div className="text-center p-4 bg-primary">
            <div className="text-sm font-semibold text-foreground mb-1">
              마지막 업데이트
            </div>
            <div className="text-lg font-medium text-foreground">
              {fmtTime(lastTs)}
            </div>
          </div>
        </div>

        <div className="flex justify-between items-center pt-2 border-t border-border">
          <div className="text-sm text-muted-foreground">{statusText}</div>
          <div className="flex gap-2">
            {state === 'idle' && (
              <Button
                onClick={launchApp}
                variant="outline"
                className="px-8 py-2.5 text-sm font-bold active:scale-95 transition-all"
              >
                시작
              </Button>
            )}

            {(state === 'app_launched' ||
              state === 'error' ||
              state === 'closed') && (
              <Button
                onClick={() => connect()}
                variant="default"
                className="px-8 py-2.5 text-sm font-bold active:scale-95 transition-all"
              >
                측정 시작
              </Button>
            )}

            {state === 'connecting' && (
              <Button
                disabled
                variant="outline"
                className="px-8 py-2.5 text-sm font-bold cursor-not-allowed animate-pulse"
              >
                연결 중...
              </Button>
            )}

            {state === 'open' && (
              <div className="flex items-center gap-3">
                <span className="flex h-3 w-3 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full bg-primary opacity-75"></span>
                  <span className="relative inline-flex h-3 w-3 bg-primary"></span>
                </span>
                <span className="text-sm font-semibold text-destructive mr-2">
                  측정 중
                </span>
                <Button
                  onClick={disconnect}
                  variant="outline"
                  className="px-6 py-2 text-sm font-bold transition-colors"
                >
                  중지
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 센서 데이터 테이블 */}
      <div className="bg-white p-6 console-panel">
        <h2 className="text-base font-semibold text-foreground mb-4">
          수신 데이터
        </h2>

        <div className="mb-4 flex gap-4 text-sm">
          <label className="flex items-center gap-2">
            <span className="font-semibold text-foreground">필터:</span>
            <NativeSelect
              value={filterTech}
              onChange={(e) =>
                setFilterTech(e.target.value as 'all' | 'ANT' | 'BLE')
              }
              className="border-border h-8 text-xs"
            >
              <option value="all">전체</option>
              <option value="ANT">ANT+</option>
              <option value="BLE">BLE</option>
            </NativeSelect>
          </label>
          <Input
            value={filterSensor}
            onChange={(e) => setFilterSensor(e.target.value)}
            placeholder="센서 ID 검색..."
            className="border-border h-8 px-2 text-xs flex-1 max-w-xs"
          />
          <div className="ml-auto">
            <Button
              onClick={() => setSamples([])}
              variant="outline"
              className="px-3 py-1 text-xs"
            >
              초기화
            </Button>
          </div>
        </div>

        <div
          className="overflow-auto border border-border"
          style={{ maxHeight: '500px' }}
        >
          <table className="w-full text-sm text-left console-data-table">
            <thead className="bg-muted sticky top-0">
              <tr>
                <th className="px-3 py-2">기술</th>
                <th className="px-3 py-2">센서 ID</th>
                <th className="px-3 py-2">심박수 (BPM)</th>
                <th className="px-3 py-2">배터리(%)</th>
                <th className="px-3 py-2">마지막 업데이트</th>
              </tr>
            </thead>
            <tbody>
              {sensorOrder.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="p-4 text-center text-muted-foreground"
                  >
                    데이터가 없습니다
                  </td>
                </tr>
              ) : (
                sensorOrder.map((k) => {
                  const s = groupedSensorsMap.get(k)
                  if (!s) return null
                  return (
                    <tr
                      key={k}
                      className="border-b border-border hover:bg-muted"
                    >
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 text-xs font-semibold ${
                            s.tech === 'ANT'
                              ? 'bg-accent text-foreground'
                              : 'bg-accent text-foreground'
                          }`}
                        >
                          {s.tech}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono">
                        {fmtSensorId7(s.sensor_id)}
                      </td>
                      <td className="px-3 py-2">
                        <span className="font-bold text-lg text-foreground">
                          {s.bpm ?? '-'}
                        </span>
                      </td>
                      <td className="px-3 py-2">{s.battery_percent ?? '-'}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {fmtTime(s.ts)}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-4 text-xs text-muted-foreground">
          💡 Fitness Bridge 서버가 실행 중이어야 하며, 허브가 서버에 연결되어
          있어야 합니다.
        </div>
      </div>
    </div>
  )
}
