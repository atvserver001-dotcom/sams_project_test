import { advanceSession, createSession, ingestSample, sessionResults, type LiveStudent, type Sample, type Session, type SessionContext, type SessionResult } from './session'

export const BRIDGE_URL = 'ws://localhost:8888'
export const HEART_FIT_DOWNLOAD = 'https://sxvtdnnzmvyksqqkidoi.supabase.co/storage/v1/object/public/apps/Heart%20Fit%20Setup.exe'
export type ConnectionState = 'idle' | 'connecting' | 'open' | 'error'
export type SaveState = 'idle' | 'waiting' | 'missing' | 'posting' | 'saved' | 'uncertain' | 'empty'
type SaveBody = { results: SessionResult[]; grade: number; class_no: number; year: number }
type StoredLive = Omit<LiveStudent, 'buf'> & { buf: ([number, number | null, number | null, number | null] | Sample | null)[] }
type Checkpoint = { version: 1; session: Omit<Session, 'students'> & { students: StoredLive[] }; saveState: SaveState; pending: SaveBody | null }
type BridgeMessage = { type?: string; message?: string; sessionActive?: boolean; dataType?: string; data?: unknown }

function resultRows(value: unknown): SessionResult[] | null {
  if (!Array.isArray(value)) return null
  if (!value.every(row => row && typeof row === 'object' && typeof row.student_id === 'string'
    && Number.isInteger(row.student_no) && row.student_no >= 1 && row.student_no <= 30
    && Number.isInteger(row.year) && Number.isInteger(row.month) && row.month >= 1 && row.month <= 12
    && [row.avg_bpm, row.min_bpm, row.max_bpm].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 30 && n <= 240)
    && row.min_bpm <= row.avg_bpm && row.avg_bpm <= row.max_bpm
    && Number.isInteger(row.record_count) && row.record_count > 0)) return null
  const keys = value.map(row => `${row.student_no}:${row.year}:${row.month}`)
  return new Set(keys).size === keys.length ? value : null
}

export class HeartRateBridge {
  session: Session | null = null
  state: ConnectionState = 'idle'
  saveState: SaveState = 'idle'
  statusText = '대기 중'
  sessionActive = false
  installNeeded = false
  persistenceError: string | null = null
  now = Date.now()
  private ws: WebSocket | null = null
  private listeners = new Set<() => void>()
  private revision = 0
  private dirty = false
  private frame: number | null = null
  private tick: ReturnType<typeof setInterval> | null = null
  private deadline: ReturnType<typeof setTimeout> | null = null
  private retry: ReturnType<typeof setTimeout> | null = null
  private release: ReturnType<typeof setTimeout> | null = null
  private pending: SaveBody | null = null
  private lastEmit = 0
  private lastPersist = 0
  private connecting: Promise<boolean> | null = null
  private cancelConnection: (() => void) | null = null

  getRevision = () => this.revision
  subscribe = (listener: () => void) => {
    if (this.release) clearTimeout(this.release)
    this.listeners.add(listener)
    if (this.tick === null) {
      this.tick = setInterval(() => {
        this.now = Date.now()
        if (this.session) advanceSession(this.session, this.now)
        this.dirty = true
        if (this.now - this.lastPersist >= 5000) this.persist()
      }, 1000)
      const render = (time: number) => {
        if (this.dirty && time - this.lastEmit >= 250) {
          this.lastEmit = time
          this.dirty = false
          this.revision++
          this.listeners.forEach(notify => notify())
        }
        this.frame = requestAnimationFrame(render)
      }
      this.frame = requestAnimationFrame(render)
      window.addEventListener('pagehide', this.pageHide)
      window.addEventListener('beforeunload', this.beforeUnload)
    }
    return () => {
      this.listeners.delete(listener)
      // App Router replaces the page subscriber while the session owner stays alive.
      if (this.release) clearTimeout(this.release)
      this.release = setTimeout(() => { if (!this.listeners.size) this.dispose() }, 1000)
    }
  }
  private changed() { this.dirty = true }
  private beforeUnload = (event: BeforeUnloadEvent) => {
    if (this.session && this.saveState !== 'saved' && this.saveState !== 'empty') { event.preventDefault(); event.returnValue = '' }
  }
  private pageHide = () => this.persist()
  private key(schoolId: string) { return `sams-heart-care-v1:${schoolId}` }

  restore(schoolId: string) {
    if (this.session?.context.schoolId === schoolId) return
    if (this.session) {
      this.persist()
      this.closeSocket()
      this.cancelConnection?.()
      if (this.deadline) clearTimeout(this.deadline)
      if (this.retry) clearTimeout(this.retry)
      this.deadline = null
      this.retry = null
      this.session = null
      this.pending = null
      this.saveState = 'idle'
      this.state = 'idle'
      this.sessionActive = false
      this.statusText = '대기 중'
      this.changed()
    }
    try {
      const raw = localStorage.getItem(this.key(schoolId))
      if (!raw) return
      const saved = JSON.parse(raw) as Checkpoint
      if (saved.version !== 1 || saved.session.context.schoolId !== schoolId || saved.session.students.length !== 30
        || saved.session.students.some(student => student.buf.length !== 3000)) throw new Error('invalid checkpoint')
      this.session = { ...saved.session, students: saved.session.students.map(student => ({ ...student,
        buf: student.buf.map(point => point === null ? null : Array.isArray(point) ? ({ sec: point[0], bpm: point[1], min: point[2], max: point[3] }) : point),
      })) }
      this.pending = saved.pending
      this.saveState = saved.saveState === 'posting' ? 'uncertain' : saved.saveState === 'waiting' ? 'missing' : saved.saveState
      this.statusText = this.saveState === 'uncertain' ? '저장 결과 확인 필요' : this.saveState === 'saved' ? '측정 데이터가 서버에 저장되었습니다.' : '이전 세션 복구됨 · 연결 대기'
      this.session.students.forEach(student => { student.cur = null; student.maximumSince = null })
      this.changed()
    } catch {
      this.persistenceError = '이전 세션을 복구하지 못했습니다. 저장된 기록을 확인해 주세요.'
      this.changed()
    }
  }

  private persist() {
    if (!this.session) return
    try {
      const value: Checkpoint = { version: 1, session: { ...this.session, students: this.session.students.map(student => ({ ...student,
        buf: student.buf.map(point => point === null ? null : [point.sec, point.bpm, point.min, point.max]),
      })) }, saveState: this.saveState, pending: this.pending }
      localStorage.setItem(this.key(this.session.context.schoolId), JSON.stringify(value))
      this.lastPersist = Date.now()
      this.persistenceError = null
    } catch {
      this.persistenceError = '이 브라우저에 세션을 보관할 수 없습니다. 저장 전에는 새로고침하지 마세요.'
    }
  }

  begin(context: SessionContext) {
    if (this.session && !['saved', 'empty'].includes(this.saveState)) return
    this.session = createSession(context)
    this.saveState = 'idle'
    this.pending = null
    this.installNeeded = false
    this.persist()
    this.changed()
  }

  connect(launch = false): Promise<boolean> {
    if (!this.session || this.session.stoppedAt !== null) return Promise.resolve(false)
    if (this.ws?.readyState === WebSocket.OPEN) return Promise.resolve(true)
    if (this.connecting) return this.connecting
    this.state = 'connecting'
    this.installNeeded = false
    this.statusText = 'Heart Fit와 연결 중...'
    this.changed()
    let appLaunched = false
    const isResume = this.session.students.some(student => student.agg.n > 0)
    this.connecting = new Promise<boolean>(resolve => {
      const finish = (success: boolean) => {
        if (this.deadline) clearTimeout(this.deadline)
        if (this.retry) clearTimeout(this.retry)
        this.deadline = null
        this.retry = null
        this.connecting = null
        this.cancelConnection = null
        resolve(success)
      }
      this.cancelConnection = () => finish(false)
      this.deadline = setTimeout(() => {
        this.closeSocket()
        this.state = 'error'
        this.statusText = '앱이 실행되지 않았습니다.'
        this.installNeeded = true
        this.changed()
        finish(false)
      }, 8000)
      const attempt = () => {
        const ws = new WebSocket(BRIDGE_URL)
        this.ws = ws
        ws.onopen = () => {
          if (this.ws !== ws || !this.session) return
          this.state = 'open'
          this.statusText = isResume ? '연결됨 · 세션 상태 확인 중' : '세션 시작 요청 전송'
          const { grade, class_no, students } = this.session.context
          ws.send(JSON.stringify({ command: 'set_class_data', data: {
            grade, class_no, students: students.map(({ id, no, name, device_id }) => ({ id, no, name, device_id })),
          } }))
          if (!isResume) {
            this.session.startedAt = Date.now()
            this.session.lastSec = -1
            this.session.students.forEach(student => { student.head = 0; student.size = 0; student.buf.fill(null) })
            ws.send(JSON.stringify({ command: 'start_session' }))
          }
          this.persist()
          this.changed()
          finish(true)
        }
        ws.onmessage = event => {
          if (this.ws !== ws) return
          try { this.receive(JSON.parse(String(event.data))) } catch { this.statusText = '수신 메시지 형식 오류'; this.changed() }
        }
        ws.onerror = () => { if (this.ws === ws && this.state === 'open') { this.statusText = '연결 오류'; this.changed() } }
        ws.onclose = () => {
          if (this.ws !== ws) return
          this.ws = null
          if (this.state === 'connecting') {
            if (launch && !appLaunched) {
              appLaunched = true
              window.location.assign('fitness-bridge://start')
            }
            this.retry = setTimeout(attempt, 750)
          }
          else {
            this.state = 'error'
            this.sessionActive = false
            this.statusText = '연결 종료 · 수신 기록 보관 중'
            this.session?.students.forEach(student => { student.cur = null; student.maximumSince = null })
            this.persist()
            this.changed()
          }
        }
      }
      attempt()
    })
    return this.connecting
  }

  receive(message: BridgeMessage) {
    if (!this.session) return
    if (message.type === 'status') {
      if (typeof message.sessionActive === 'boolean') this.sessionActive = message.sessionActive
      if (message.message) this.statusText = message.message
    } else if (message.type === 'data' && this.saveState === 'idle' && this.session.stoppedAt === null) {
      if (message.dataType !== 'ant_heartrate' && message.dataType !== 'ble_heartrate') return
      const data = message.data as { deviceId?: string | number; heartRate?: number; timestamp?: string; battery?: number } | null
      if (!data || data.deviceId === undefined || typeof data.heartRate !== 'number') return
      const timestamp = data.timestamp === undefined ? null : Date.parse(data.timestamp)
      if (timestamp !== null && !Number.isFinite(timestamp)) return
      if (ingestSample(this.session, data.deviceId, data.heartRate, Date.now(), message.dataType === 'ant_heartrate' ? 'ANT' : 'BLE',
        typeof data.battery === 'number' && data.battery >= 0 && data.battery <= 100 ? data.battery : null, timestamp)) this.sessionActive = true
    } else if (message.type === 'session_result' && ['idle', 'waiting', 'missing'].includes(this.saveState)) {
      const results = resultRows(message.data)
      if (!results) { this.statusText = '세션 결과 형식 오류 · 저장하지 않았습니다'; this.changed(); return }
      if (results.some(result => {
        const student = this.session!.context.students.find(item => item.no === result.student_no)
        return !student || (student.id && result.student_id !== student.id)
      })) { this.statusText = '학급 명단과 세션 결과가 일치하지 않습니다'; this.changed(); return }
      this.freeze()
      void this.save(results)
    }
    this.changed()
  }

  private freeze() {
    if (!this.session) return
    advanceSession(this.session, Date.now())
    this.session.stoppedAt ??= Date.now()
    this.sessionActive = false
    if (this.deadline) clearTimeout(this.deadline)
    this.deadline = null
  }
  stop() {
    if (!this.session || this.saveState !== 'idle') return
    this.freeze()
    this.saveState = 'waiting'
    this.statusText = '측정 종료 · 앱 결과 수신 대기'
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ command: 'stop_session' }))
    this.deadline = setTimeout(() => {
      this.saveState = 'missing'
      this.statusText = '앱 결과 미수신 · 수신 집계 보관 중'
      this.persist()
      this.changed()
    }, 8000)
    this.persist()
    this.changed()
  }
  saveLocal() {
    if (!this.session || this.saveState !== 'missing') return
    return this.save(sessionResults(this.session))
  }
  retrySave() {
    if (this.saveState !== 'uncertain' || !this.pending) return
    return this.save(this.pending.results)
  }
  private async save(results: SessionResult[]) {
    if (!this.session) return
    const savingSession = this.session
    if (results.length === 0) {
      this.saveState = 'empty'
      this.statusText = '수신된 기록이 없어 저장하지 않았습니다.'
      this.closeSocket()
      this.state = 'idle'
      this.persist()
      this.changed()
      return
    }
    const { grade, class_no, year } = this.session.context
    this.pending = { results, grade, class_no, year }
    this.saveState = 'posting'
    this.statusText = '데이터 저장 중...'
    // The existing monthly endpoint merges counts; an ambiguous POST must never auto-retry.
    this.persist()
    this.changed()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)
    try {
      const response = await fetch('/api/school/heart-rate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify(this.pending), signal: controller.signal,
      })
      const data = await response.json()
      if (this.session !== savingSession) return
      if (!response.ok || !data.success) throw new Error(data.error || '저장 응답을 확인하지 못했습니다.')
      this.saveState = 'saved'
      this.pending = null
      this.statusText = '측정 데이터가 서버에 저장되었습니다.'
      this.closeSocket()
      this.state = 'idle'
    } catch (error) {
      if (this.session !== savingSession) return
      this.saveState = 'uncertain'
      this.statusText = `저장 결과 확인 필요: ${error instanceof Error ? error.message : '연결 오류'}`
    } finally {
      clearTimeout(timeout)
      this.persist()
      this.changed()
    }
  }
  private closeSocket() {
    const ws = this.ws
    this.ws = null
    if (ws) { ws.onclose = null; ws.onopen = null; ws.onerror = null; ws.onmessage = null; ws.close() }
  }
  dispose() {
    this.persist()
    this.closeSocket()
    this.cancelConnection?.()
    if (this.tick) clearInterval(this.tick)
    if (this.frame !== null) cancelAnimationFrame(this.frame)
    if (this.deadline) clearTimeout(this.deadline)
    if (this.retry) clearTimeout(this.retry)
    if (this.release) clearTimeout(this.release)
    this.tick = null
    this.frame = null
    this.state = 'idle'
    window.removeEventListener('pagehide', this.pageHide)
    window.removeEventListener('beforeunload', this.beforeUnload)
  }
}

export const heartRateBridge = new HeartRateBridge()
