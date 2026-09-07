export const JUMP_ROPE_GATEWAY_PRODUCT = 'ATV_CHILEAF_GATT_WEB_SERIAL_PROBE'
export const JUMP_ROPE_SERIAL_BAUD_RATE = 115_200
export const JUMP_ROPE_GATEWAY_RX_LINE_MAX = 767
export const JUMP_ROPE_GATEWAY_LEASE_MS = 5_000
export const JUMP_ROPE_GATEWAY_HANDSHAKE_TIMEOUT_MS = 12_000
export const JUMP_ROPE_DEVICE_READY_TIMEOUT_MS = 20_000
export const JUMP_ROPE_NDJSON_MAX_LINE_LENGTH = 2_048
export const JUMP_ROPE_FRESH_MS = 2_000
export const JUMP_ROPE_OFFLINE_MS = 5_000

export const JUMP_ROPE_PROFILE = {
  slot: 1,
  handle: 'jump-rope-slot-01',
  namePrefix: 'JR',
  driver: 'chileaf_jr203_gatt_v1',
  wireDialect: 'JR203_WX_1_1_2',
  writeMode: 'without_response',
} as const

export const REQUIRED_JUMP_ROPE_CAPABILITIES = [
  'chileaf_jr203_gatt_v1',
  'jump_rope_count',
  'mode_control',
  'run_gate',
  'heartbeat_lease',
  'fresh_event_sequence',
] as const

export type JumpRopeMode = 0 | 1 | 2 | 3
export type JumpRopeSignalState = 'waiting' | 'fresh' | 'stale' | 'offline'

export interface JumpRopeModeOption {
  value: JumpRopeMode
  label: string
  inputLabel: string | null
  defaultTarget: number
  minTarget: number
  maxTarget: number
  stepTarget: number
  unit: string | null
}

export const JUMP_ROPE_MODE_OPTIONS: readonly JumpRopeModeOption[] = [
  {
    value: 0,
    label: '자유 줄넘기',
    inputLabel: null,
    defaultTarget: 0,
    minTarget: 0,
    maxTarget: 0,
    stepTarget: 1,
    unit: null,
  },
  {
    value: 1,
    label: '목표 횟수',
    inputLabel: '목표 횟수',
    defaultTarget: 100,
    minTarget: 1,
    maxTarget: 1_000,
    stepTarget: 1,
    unit: '회',
  },
  {
    value: 2,
    label: '타임어택',
    inputLabel: '측정 시간',
    defaultTarget: 60,
    minTarget: 60,
    maxTarget: 3_600,
    stepTarget: 60,
    unit: '초',
  },
  {
    value: 3,
    label: '시험 모드',
    inputLabel: null,
    defaultTarget: 60,
    minTarget: 60,
    maxTarget: 60,
    stepTarget: 60,
    unit: '초',
  },
] as const

export interface JumpRopeGatewayMessage {
  v: number
  kind: string
  request_id?: string
  boot_id?: string
  run_id?: string
  product?: string
  command?: string
  state?: string
  code?: string
  message?: string
  reason?: string
  generation?: number
  seq?: number
  uptime_ms?: number
  [key: string]: unknown
}

export interface JumpRopeGatewayCaps extends JumpRopeGatewayMessage {
  kind: 'caps'
  boot_id: string
  gateway_id: string
  state: 'ready' | 'running' | 'stopping'
  capabilities: string[]
  max_active_devices: 1
}

export interface JumpRopeGatewayStatus extends JumpRopeGatewayMessage {
  kind: 'status'
  boot_id: string
  state: 'ready' | 'running'
  generation: number
  lease_remaining_ms: number
  run_id?: string
}

export interface JumpRopeDeviceIdentity {
  address: string
  address_type: number
  name: string
}

export interface JumpRopeDeviceReadyEvent extends JumpRopeGatewayMessage, JumpRopeDeviceIdentity {
  kind: 'device_ready'
  boot_id: string
  run_id: string
  generation: number
  slot: 1
  profile_handle: typeof JUMP_ROPE_PROFILE.handle
  identity_verified: boolean
}

export interface JumpRopeDeviceStateEvent extends JumpRopeGatewayMessage {
  kind: 'device_state'
  boot_id: string
  run_id: string
  generation: number
  slot: 1
  profile_handle: typeof JUMP_ROPE_PROFILE.handle
  state: 'connecting' | 'disconnected'
}

export interface JumpRopeSnapshotEvent extends JumpRopeGatewayMessage {
  v: 1
  kind: 'jump_rope_snapshot'
  boot_id: string
  run_id: string
  generation: number
  seq: number
  observed_ms: number
  fresh: true
  slot: number
  count: number
  mode: JumpRopeMode
  count_up_minute: number
  count_up_second: number
  count_down_minute: number
  count_down_second: number
  battery_percent: number | null
  rssi_dbm: number | null
}

export interface JumpRopeCachedIdentity extends JumpRopeDeviceIdentity {
  gateway_id: string
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const isFiniteInteger = (value: unknown): value is number => (
  typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value)
)

export const isJumpRopeUint32 = (value: unknown): value is number => (
  isFiniteInteger(value) && value >= 0 && value <= 0xFFFF_FFFF
)

export const isJumpRopeUint32After = (value: number, fence: number) => {
  if (!isJumpRopeUint32(value) || !isJumpRopeUint32(fence)) return false
  const distance = (value - fence) >>> 0
  return distance > 0 && distance < 0x8000_0000
}

const isNonEmptyString = (value: unknown): value is string => (
  typeof value === 'string' && value.trim().length > 0
)

const isJumpRopeMode = (value: unknown): value is JumpRopeMode => (
  isFiniteInteger(value) && value >= 0 && value <= 3
)

export class JumpRopeNdjsonMessageDecoder {
  private buffer = ''
  private discardingOversizeLine = false

  push(chunk: string): JumpRopeGatewayMessage[] {
    const messages: JumpRopeGatewayMessage[] = []
    let remaining = this.buffer + chunk
    this.buffer = ''

    while (remaining.length > 0) {
      const newlineIndex = remaining.indexOf('\n')
      if (newlineIndex === -1) {
        if (this.discardingOversizeLine || remaining.length > JUMP_ROPE_NDJSON_MAX_LINE_LENGTH) {
          this.discardingOversizeLine = true
        } else {
          this.buffer = remaining
        }
        break
      }

      const rawLine = remaining.slice(0, newlineIndex)
      remaining = remaining.slice(newlineIndex + 1)
      if (this.discardingOversizeLine) {
        this.discardingOversizeLine = false
        continue
      }
      if (rawLine.length > JUMP_ROPE_NDJSON_MAX_LINE_LENGTH) continue

      const line = rawLine.trim()
      if (!line) continue
      try {
        const message = parseJumpRopeGatewayMessage(JSON.parse(line))
        if (message) messages.push(message)
      } catch {
        // 부팅 로그나 손상된 한 줄은 다음 NDJSON 메시지와 섞지 않고 버린다.
      }
    }
    return messages
  }

  reset() {
    this.buffer = ''
    this.discardingOversizeLine = false
  }
}

export function parseJumpRopeGatewayMessage(value: unknown): JumpRopeGatewayMessage | null {
  if (!isRecord(value) || !isFiniteInteger(value.v) || typeof value.kind !== 'string') return null
  return value as JumpRopeGatewayMessage
}

export function isExpectedJumpRopeGatewayIdentity(
  message: JumpRopeGatewayMessage,
): message is JumpRopeGatewayCaps {
  const capabilities = message.capabilities
  if (
    message.v !== 1 ||
    message.kind !== 'caps' ||
    message.product !== JUMP_ROPE_GATEWAY_PRODUCT ||
    message.protocol !== 1 ||
    (message.state !== 'ready' && message.state !== 'running' && message.state !== 'stopping') ||
    message.baud !== JUMP_ROPE_SERIAL_BAUD_RATE ||
    message.rx_line_max !== JUMP_ROPE_GATEWAY_RX_LINE_MAX ||
    message.lease_default_ms !== JUMP_ROPE_GATEWAY_LEASE_MS ||
    !isFiniteInteger(message.lease_min_ms) ||
    !isFiniteInteger(message.lease_max_ms) ||
    message.lease_min_ms > JUMP_ROPE_GATEWAY_LEASE_MS ||
    message.lease_max_ms < JUMP_ROPE_GATEWAY_LEASE_MS ||
    message.max_active_devices !== 1 ||
    !isNonEmptyString(message.gateway_id) ||
    !isNonEmptyString(message.boot_id) ||
    !Array.isArray(capabilities) ||
    !capabilities.every((capability) => typeof capability === 'string')
  ) {
    return false
  }

  return REQUIRED_JUMP_ROPE_CAPABILITIES.every((capability) => capabilities.includes(capability))
}

export function isExpectedJumpRopeStatus(
  message: JumpRopeGatewayMessage,
  session: { bootId: string },
): message is JumpRopeGatewayStatus {
  if (
    message.v !== 1 ||
    message.kind !== 'status' ||
    message.boot_id !== session.bootId ||
    (message.state !== 'ready' && message.state !== 'running') ||
    !isFiniteInteger(message.generation) ||
    message.generation < 0 ||
    !isFiniteInteger(message.lease_remaining_ms) ||
    message.lease_remaining_ms < 0 ||
    message.lease_remaining_ms > 30_000
  ) {
    return false
  }

  return message.state === 'ready'
    ? message.run_id === undefined && message.lease_remaining_ms === 0
    : isNonEmptyString(message.run_id) && message.lease_remaining_ms > 0
}

export function isExpectedJumpRopeAck(
  message: JumpRopeGatewayMessage,
  command: string,
  expected: { bootId?: string; runId?: string; generation?: number } = {},
) {
  if (
    message.v !== 1 ||
    message.kind !== 'ack' ||
    message.command !== command ||
    (expected.bootId !== undefined && message.boot_id !== expected.bootId) ||
    (expected.runId !== undefined && message.run_id !== expected.runId) ||
    (expected.generation !== undefined && message.generation !== expected.generation)
  ) {
    return false
  }
  return true
}

export function parseJumpRopeAckUptime(message: JumpRopeGatewayMessage) {
  return isJumpRopeUint32(message.uptime_ms) ? message.uptime_ms : null
}

export function parseJumpRopeDeviceReady(
  message: JumpRopeGatewayMessage,
): JumpRopeDeviceReadyEvent | null {
  if (
    message.v !== 1 ||
    message.kind !== 'device_ready' ||
    !isNonEmptyString(message.boot_id) ||
    !isNonEmptyString(message.run_id) ||
    !isFiniteInteger(message.generation) ||
    message.generation <= 0 ||
    message.slot !== 1 ||
    message.profile_handle !== JUMP_ROPE_PROFILE.handle ||
    typeof message.identity_verified !== 'boolean' ||
    !isNonEmptyString(message.address) ||
    !isFiniteInteger(message.address_type) ||
    message.address_type < 0 ||
    message.address_type > 3 ||
    typeof message.name !== 'string'
  ) {
    return null
  }
  return message as unknown as JumpRopeDeviceReadyEvent
}

export function parseJumpRopeDeviceState(
  message: JumpRopeGatewayMessage,
): JumpRopeDeviceStateEvent | null {
  if (
    message.v !== 1 ||
    message.kind !== 'device_state' ||
    !isNonEmptyString(message.boot_id) ||
    !isNonEmptyString(message.run_id) ||
    !isFiniteInteger(message.generation) ||
    message.generation <= 0 ||
    message.slot !== JUMP_ROPE_PROFILE.slot ||
    message.profile_handle !== JUMP_ROPE_PROFILE.handle ||
    (message.state !== 'connecting' && message.state !== 'disconnected')
  ) {
    return null
  }
  return message as unknown as JumpRopeDeviceStateEvent
}

export function parseJumpRopeSnapshot(
  message: JumpRopeGatewayMessage,
): JumpRopeSnapshotEvent | null {
  if (
    message.v !== 1 ||
    message.kind !== 'jump_rope_snapshot' ||
    !isNonEmptyString(message.boot_id) ||
    !isNonEmptyString(message.run_id) ||
    !isFiniteInteger(message.generation) ||
    message.generation <= 0 ||
    !isFiniteInteger(message.seq) ||
    message.seq <= 0 ||
    !isJumpRopeUint32(message.observed_ms) ||
    message.fresh !== true ||
    !isFiniteInteger(message.slot) ||
    message.slot < 1 ||
    message.slot > 30 ||
    !isFiniteInteger(message.count) ||
    message.count < 0 ||
    !isJumpRopeMode(message.mode) ||
    !isFiniteInteger(message.count_up_minute) ||
    message.count_up_minute < 0 ||
    !isFiniteInteger(message.count_up_second) ||
    message.count_up_second < 0 ||
    message.count_up_second > 59 ||
    !isFiniteInteger(message.count_down_minute) ||
    message.count_down_minute < 0 ||
    !isFiniteInteger(message.count_down_second) ||
    message.count_down_second < 0 ||
    message.count_down_second > 59 ||
    !(message.battery_percent === null || (
      isFiniteInteger(message.battery_percent) &&
      message.battery_percent >= 0 &&
      message.battery_percent <= 100
    )) ||
    !(message.rssi_dbm === null || (isFiniteInteger(message.rssi_dbm) && message.rssi_dbm <= 0))
  ) {
    return null
  }
  return message as unknown as JumpRopeSnapshotEvent
}

export function isJumpRopeEventForRun(
  event: Pick<JumpRopeSnapshotEvent, 'boot_id' | 'run_id' | 'generation' | 'seq'>,
  run: { bootId: string; runId: string; generation: number; lastSequence: number },
) {
  return event.boot_id === run.bootId &&
    event.run_id === run.runId &&
    event.generation === run.generation &&
    event.seq > run.lastSequence
}

export function getJumpRopeModeOption(mode: JumpRopeMode) {
  return JUMP_ROPE_MODE_OPTIONS.find((option) => option.value === mode) as JumpRopeModeOption
}

export function getJumpRopeModePresentation(
  requestedMode: JumpRopeMode,
  reportedMode?: JumpRopeMode,
) {
  const requestedLabel = getJumpRopeModeOption(requestedMode).label
  if (reportedMode === undefined) {
    return {
      state: 'pending' as const,
      label: `${requestedLabel} 요청`,
      warning: null,
    }
  }

  const reportedLabel = getJumpRopeModeOption(reportedMode).label
  if (reportedMode === requestedMode) {
    return {
      state: 'confirmed' as const,
      label: `${reportedLabel} · 센서 확인`,
      warning: null,
    }
  }

  return {
    state: 'mismatch' as const,
    label: `센서 ${reportedLabel} · 요청 ${requestedLabel}`,
    warning: '센서 모드 불일치',
  }
}

export function normalizeJumpRopeTarget(mode: JumpRopeMode, value: number) {
  const option = getJumpRopeModeOption(mode)
  if (mode === 0) return 0
  if (!Number.isFinite(value)) return option.defaultTarget
  const clamped = Math.min(option.maxTarget, Math.max(option.minTarget, Math.trunc(value)))
  if (option.stepTarget <= 1) return clamped
  const stepped = option.minTarget + Math.round((clamped - option.minTarget) / option.stepTarget) * option.stepTarget
  return Math.min(option.maxTarget, Math.max(option.minTarget, stepped))
}

export function jumpRopeModeSetFields(mode: Exclude<JumpRopeMode, 3>, target: number) {
  const normalizedTarget = normalizeJumpRopeTarget(mode, target)
  if (mode === 0) return { mode, target: 0, minutes: 0, seconds: 0 }
  if (mode === 1) return { mode, target: normalizedTarget, minutes: 0, seconds: 0 }
  return {
    mode,
    target: 0,
    minutes: Math.floor(normalizedTarget / 60),
    seconds: normalizedTarget % 60,
  }
}

export function formatJumpRopeDuration(totalSeconds: number) {
  const normalized = Math.max(0, Math.trunc(totalSeconds))
  const minutes = Math.floor(normalized / 60)
  const seconds = normalized % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function getJumpRopeRule(mode: JumpRopeMode, target: number) {
  if (mode === 0) return '제한 없음'
  if (mode === 1) return `목표 ${normalizeJumpRopeTarget(mode, target).toLocaleString('ko-KR')}회`
  return `${formatJumpRopeDuration(normalizeJumpRopeTarget(mode, target))} 측정`
}

export function getJumpRopeCardRule(
  requestedMode: JumpRopeMode,
  target: number,
  event?: Pick<
    JumpRopeSnapshotEvent,
    'mode' | 'count' | 'count_up_minute' | 'count_up_second' | 'count_down_minute' | 'count_down_second'
  >,
) {
  if (!event) return getJumpRopeRule(requestedMode, target)
  if (event.mode !== requestedMode) return null
  if (requestedMode === 0) {
    return `경과 ${formatJumpRopeDuration(event.count_up_minute * 60 + event.count_up_second)}`
  }
  if (requestedMode === 1) {
    return `남은 횟수 ${Math.max(0, target - event.count).toLocaleString('ko-KR')}회`
  }
  return `남은 시간 ${formatJumpRopeDuration(event.count_down_minute * 60 + event.count_down_second)}`
}

export function getJumpRopeSignalState(
  receivedAt: number | null | undefined,
  now: number,
): JumpRopeSignalState {
  if (typeof receivedAt !== 'number') return 'waiting'
  const age = Math.max(0, now - receivedAt)
  if (age <= JUMP_ROPE_FRESH_MS) return 'fresh'
  if (age <= JUMP_ROPE_OFFLINE_MS) return 'stale'
  return 'offline'
}
