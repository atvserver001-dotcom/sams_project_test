import { deviceKey, type SessionResult } from '../../src/lib/heart-rate/session'

const ENDPOINT = 'ws://localhost:8888/'
const STORAGE_KEY = 'sams-school-preview:heart-fit-transport:v1'
const INSTALLATION = Symbol.for('sams-school-preview.heart-fit-transport')

type Participant = { id: string; no: number; name: string; device_id: string }
type ClassData = { grade: number; class_no: number; students: Participant[] }
type Stats = { n: number; sum: number; min: number | null; max: number | null }
type Snapshot = {
  version: 1
  scope: string
  active: boolean
  startedAt: number
  academicYear?: number
  step: number
  stats: Stats[]
}
type PreviewSession = Snapshot & { students: Participant[] }
type Installation = { retain: () => () => void }
type InstalledSocket = typeof WebSocket & { [INSTALLATION]?: Installation }

function classData(value: unknown): ClassData | null {
  if (!value || typeof value !== 'object') return null
  const data = value as ClassData
  if (!Number.isInteger(data.grade) || !Number.isInteger(data.class_no)
    || !Array.isArray(data.students) || data.students.length > 30
    || !data.students.every(student => student && Number.isInteger(student.no) && student.no >= 1 && student.no <= 30
      && typeof student.id === 'string' && typeof student.name === 'string' && typeof student.device_id === 'string')
    || new Set(data.students.map(student => student.no)).size !== data.students.length) return null
  return { grade: data.grade, class_no: data.class_no,
    students: data.students.map(({ id, no, name, device_id }) => ({ id, no, name, device_id })).sort((a, b) => a.no - b.no) }
}

function restore(scope: string, count: number): Snapshot | null {
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? 'null') as Snapshot | null
    if (!saved || saved.version !== 1 || saved.scope !== scope || typeof saved.active !== 'boolean'
      || (saved.academicYear !== undefined && saved.academicYear !== 2025 && saved.academicYear !== 2026)
      || !Number.isFinite(saved.startedAt) || !Number.isSafeInteger(saved.step) || saved.step < 0
      || !Array.isArray(saved.stats) || saved.stats.length !== count
      || !saved.stats.every(stat => stat && Number.isSafeInteger(stat.n) && stat.n >= 0 && Number.isFinite(stat.sum)
        && (stat.n === 0 ? stat.sum === 0 && stat.min === null && stat.max === null
          : Number.isInteger(stat.min) && Number.isInteger(stat.max) && stat.min! >= 30 && stat.max! <= 240
            && stat.min! <= stat.max! && stat.sum >= stat.min! * stat.n && stat.sum <= stat.max! * stat.n))) return null
    return saved
  } catch {
    // Storage is optional in private/restricted preview browsers.
    return null
  }
}

function emptyStats(count: number): Stats[] {
  return Array.from({ length: count }, () => ({ n: 0, sum: 0, min: null, max: null }))
}

/** Test-only transport. Install before mounting pages that use HeartRateBridge. */
export function installPreviewTransport(options?: { academicYear?: () => number | undefined }): () => void {
  if (typeof window === 'undefined') return () => {}
  const NativeSocket = window.WebSocket as InstalledSocket
  if (NativeSocket[INSTALLATION]) return NativeSocket[INSTALLATION].retain()

  let references = 0
  let disposed = false
  let session: PreviewSession | null = null
  let timer: ReturnType<typeof setInterval> | null = null
  const sockets = new Set<PreviewSocket>()

  function persist() {
    if (!session) return
    const { version, scope, active, startedAt, academicYear, step, stats } = session
    try { window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ version, scope, active, startedAt, academicYear, step, stats })) }
    catch { /* An in-memory preview still works when storage is unavailable. */ }
  }

  function connected(current: PreviewSession) {
    return [...sockets].filter(socket => socket.readyState === 1 && socket.scope === current.scope)
  }

  function updateTimer() {
    const running = !disposed && session?.active && connected(session).length > 0
    if (running && timer === null) timer = setInterval(sample, 1000)
    else if (!running && timer !== null) { clearInterval(timer); timer = null }
  }

  function sample() {
    const current = session
    if (!current?.active) return
    const timestamp = new Date(Date.now()).toISOString()
    const peers = connected(current)
    current.step++
    for (const [index, student] of current.students.entries()) {
      // Do not invent identities or measurements for missing/ambiguous mappings.
      if (!student.id || !student.device_id.trim()
        || current.students.filter(item => item.id === student.id).length !== 1
        || current.students.filter(item => deviceKey(item.device_id) === deviceKey(student.device_id)).length !== 1) continue
      if (disposed || session !== current || !current.active || !peers.some(socket => socket.readyState === 1)) break
      const bpm = Math.round(135 + student.no % 7 * 3 + 28 * Math.sin(current.step / 18 + student.no / 4))
      const stat = current.stats[index]
      stat.n++
      stat.sum += bpm
      stat.min = Math.min(stat.min ?? bpm, bpm)
      stat.max = Math.max(stat.max ?? bpm, bpm)
      for (const socket of peers) {
        if (disposed || session !== current || !current.active) break
        socket.message({ type: 'data', dataType: student.no % 2 ? 'ant_heartrate' : 'ble_heartrate',
          data: { deviceId: student.device_id, heartRate: bpm, timestamp, battery: 75 + student.no % 20 } })
      }
    }
    persist()
  }

  function status(socket: PreviewSocket, active: boolean) {
    socket.enqueueMessage({ type: 'status', sessionActive: active,
      message: active ? 'Preview simulation running' : 'Preview simulation ready' })
  }

  function command(socket: PreviewSocket, input: unknown) {
    if (!input || typeof input !== 'object') return
    const message = input as { command?: string; data?: unknown }
    if (message.command === 'set_class_data') {
      const data = classData(message.data)
      if (!data) return
      const scope = JSON.stringify(data)
      if (session?.scope !== scope) {
        if (session) for (const peer of connected(session)) status(peer, false)
        const saved = restore(scope, data.students.length)
        session = { ...(saved ?? { version: 1, scope, active: false, startedAt: Date.now(), step: 0,
          stats: emptyStats(data.students.length) }), students: data.students }
      }
      socket.scope = scope
      status(socket, session.active)
      updateTimer()
      return
    }
    const current = session
    if (!current || socket.scope !== current.scope) return
    if (message.command === 'start_session') {
      const academicYear = options?.academicYear?.()
      current.active = true
      current.startedAt = Date.now()
      current.academicYear = academicYear === 2025 || academicYear === 2026 ? academicYear : undefined
      current.step = 0
      current.stats = emptyStats(current.students.length)
      // A new start gets a full second before its first sample, including after reconnect.
      if (timer !== null) { clearInterval(timer); timer = null }
      for (const peer of connected(current)) status(peer, true)
    } else if (message.command === 'stop_session' && current.active) {
      current.active = false
      const date = new Date(current.startedAt)
      const month = date.getMonth() + 1
      // Preview-only logical report year; the session clock and sample timestamps stay real.
      const year = current.academicYear === undefined ? date.getFullYear() : current.academicYear + (month <= 2 ? 1 : 0)
      const results: SessionResult[] = current.students.flatMap((student, index) => {
        const stat = current.stats[index]
        return stat.n === 0 ? [] : [{ student_id: student.id, student_no: student.no, name: student.name,
          year, month, avg_bpm: Math.round(stat.sum / stat.n * 10) / 10,
          min_bpm: stat.min!, max_bpm: stat.max!, record_count: stat.n }]
      })
      for (const peer of connected(current)) {
        status(peer, false)
        // Native socket messages are asynchronous; the bridge installs its save deadline after send().
        peer.enqueueMessage({ type: 'session_result', data: results })
      }
    } else return
    persist()
    updateTimer()
  }

  class PreviewSocket extends EventTarget {
    readonly CONNECTING = 0
    readonly OPEN = 1
    readonly CLOSING = 2
    readonly CLOSED = 3
    readonly url = ENDPOINT
    readonly protocol = ''
    readonly extensions = ''
    readonly bufferedAmount = 0
    binaryType: BinaryType = 'blob'
    readyState = 0
    scope: string | null = null
    onopen: ((event: Event) => void) | null = null
    onmessage: ((event: MessageEvent) => void) | null = null
    onerror: ((event: Event) => void) | null = null
    onclose: ((event: CloseEvent) => void) | null = null
    private pending = new Set<ReturnType<typeof setTimeout>>()

    constructor() {
      super()
      if (disposed) { this.readyState = 3; return }
      sockets.add(this)
      this.enqueue(() => {
        if (this.readyState !== 0) return
        this.readyState = 1
        status(this, false)
        const event = new Event('open')
        this.dispatchEvent(event)
        this.onopen?.(event)
      })
    }

    private enqueue(callback: () => void) {
      const timeout = setTimeout(() => { this.pending.delete(timeout); callback() }, 0)
      this.pending.add(timeout)
    }

    message(value: unknown) {
      if (this.readyState !== 1) return
      const event = new MessageEvent('message', { data: JSON.stringify(value), origin: ENDPOINT.slice(0, -1) })
      this.dispatchEvent(event)
      this.onmessage?.(event)
    }

    enqueueMessage(value: unknown) { this.enqueue(() => this.message(value)) }

    send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
      if (this.readyState === 0) throw new DOMException('WebSocket is still connecting', 'InvalidStateError')
      if (this.readyState !== 1 || typeof data !== 'string') return
      let parsed: unknown
      try { parsed = JSON.parse(data) } catch { return }
      command(this, parsed)
    }

    close(code = 1000, reason = '') {
      if (code !== 1000 && (!Number.isInteger(code) || code < 3000 || code > 4999)) throw new DOMException('Invalid close code', 'InvalidAccessError')
      if (new TextEncoder().encode(reason).length > 123) throw new DOMException('Close reason is too long', 'SyntaxError')
      if (this.readyState >= 2) return
      this.cancelPending()
      this.readyState = 2
      persist()
      updateTimer()
      this.enqueue(() => {
        this.readyState = 3
        sockets.delete(this)
        const event = new CloseEvent('close', { code, reason, wasClean: true })
        this.dispatchEvent(event)
        this.onclose?.(event)
      })
    }

    private cancelPending() {
      for (const timeout of this.pending) clearTimeout(timeout)
      this.pending.clear()
    }

    dispose() {
      this.cancelPending()
      this.readyState = 3
      this.onopen = this.onmessage = this.onerror = this.onclose = null
    }
  }

  const installation: Installation = { retain() {
    references++
    let released = false
    return () => {
      if (released) return
      released = true
      if (--references > 0) return
      disposed = true
      persist()
      updateTimer()
      for (const socket of sockets) socket.dispose()
      sockets.clear()
      if (window.WebSocket === InterceptedSocket) window.WebSocket = NativeSocket
    }
  } }

  const InterceptedSocket: typeof WebSocket = new Proxy(NativeSocket, {
    construct(target, args, newTarget): object {
      // Only the bridge's exact endpoint (and its URL-canonical trailing slash) is synthetic.
      const url = String(args[0])
      if (url === ENDPOINT || url === ENDPOINT.slice(0, -1)) return new PreviewSocket()
      return Reflect.construct(target, args, newTarget === InterceptedSocket ? target : newTarget)
    },
    get(target, property, receiver) {
      if (property === INSTALLATION) return installation
      if (property === Symbol.hasInstance) return (value: unknown) => value instanceof PreviewSocket || value instanceof NativeSocket
      return Reflect.get(target, property, receiver)
    },
  })
  window.WebSocket = InterceptedSocket
  return installation.retain()
}
