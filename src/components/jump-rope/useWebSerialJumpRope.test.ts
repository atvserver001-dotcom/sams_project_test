import { afterEach, describe, expect, it, vi } from 'vitest'

import { WebSerialJumpRopeClient } from './useWebSerialJumpRope'

interface GatewayOptions {
  product?: string
  deviceReadyDelayMs?: number
  disconnectPendingOnce?: boolean
  helloDisconnectPendingCount?: number
  dropFirstRunStartAck?: boolean
  skipFirstPinnedDeviceReady?: boolean
  pingResponseDelayMs?: number
  sessionStartUptimes?: number[]
  failControlOnce?: 'time_sync' | 'mode_set' | 'session_start' | 'session_stop'
  controlAckDelayMs?: Partial<Record<'time_sync' | 'mode_set' | 'session_start' | 'session_stop', number>>
  sessionStopAckWithDisconnectSameChunk?: boolean
}

class MemoryStorage {
  private readonly values = new Map<string, string>()
  private removals = 0

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }

  removeItem(key: string) {
    this.removals += 1
    this.values.delete(key)
  }

  removalCount() {
    return this.removals
  }
}

function createGateway(options: GatewayOptions = {}) {
  const commands: Array<Record<string, unknown>> = []
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  let controller!: ReadableStreamDefaultController<Uint8Array>
  let generation = 0
  let activeRunId = ''
  let profile: Record<string, unknown> = {}
  let openCount = 0
  let closeCount = 0
  let disconnectPendingSent = false
  let helloDisconnectPendingRemaining = options.helloDisconnectPendingCount ?? 0
  let runStartAckDropped = false
  let pinnedDeviceReadySkipped = false
  let controlFailureSent = false
  let sessionStopDisconnectChunkSent = false
  let uptimeMs = 1_000
  let sessionStartIndex = 0
  let latestSessionStartUptime = 0
  let nextSnapshotSequence = 10

  const readable = new ReadableStream<Uint8Array>({
    start(nextController) {
      controller = nextController
    },
  })
  const enqueue = (message: Record<string, unknown>, delayMs = 0) => {
    const send = () => controller.enqueue(encoder.encode(`${JSON.stringify(message)}\n`))
    if (delayMs > 0) setTimeout(send, delayMs)
    else send()
  }
  const enqueueChunk = (messages: Record<string, unknown>[]) => {
    controller.enqueue(encoder.encode(`${messages.map((message) => JSON.stringify(message)).join('\n')}\n`))
  }
  const envelope = (message: Record<string, unknown>) => ({
    v: 1,
    boot_id: 'boot-1',
    uptime_ms: uptimeMs,
    ...message,
  })
  const ack = (
    request: Record<string, unknown>,
    command: string,
    fields: Record<string, unknown> = {},
    delayMs = 0,
  ) => {
    const responseUptime = typeof fields.uptime_ms === 'number' ? fields.uptime_ms : uptimeMs
    enqueue(envelope({
      kind: 'ack',
      request_id: request.request_id,
      command,
      run_id: request.run_id,
      generation,
      ...fields,
      uptime_ms: responseUptime,
    }), delayMs)
    uptimeMs = (responseUptime + 10) >>> 0
    return responseUptime
  }

  const emitSnapshot = (fields: Partial<{
    seq: number
    observed_ms: number
    count: number
    mode: number
    count_up_minute: number
    count_up_second: number
    count_down_minute: number
    count_down_second: number
    battery_percent: number | null
    rssi_dbm: number | null
  }> = {}, delayMs = 0) => {
    const seq = fields.seq ?? nextSnapshotSequence
    nextSnapshotSequence = Math.max(nextSnapshotSequence, seq + 1)
    enqueue(envelope({
      kind: 'jump_rope_snapshot',
      run_id: activeRunId,
      generation,
      seq,
      observed_ms: fields.observed_ms ?? ((latestSessionStartUptime + 1) >>> 0),
      fresh: true,
      slot: 1,
      count: fields.count ?? 12,
      mode: fields.mode ?? 0,
      count_up_minute: fields.count_up_minute ?? 0,
      count_up_second: fields.count_up_second ?? 12,
      count_down_minute: fields.count_down_minute ?? 0,
      count_down_second: fields.count_down_second ?? 48,
      battery_percent: fields.battery_percent ?? 84,
      rssi_dbm: fields.rssi_dbm ?? -51,
    }), delayMs)
  }

  const emitDeviceState = (
    state: 'connecting' | 'disconnected',
    fields: Record<string, unknown> = {},
  ) => enqueue(envelope({
    kind: 'device_state',
    run_id: activeRunId,
    generation,
    slot: 1,
    profile_handle: 'jump-rope-slot-01',
    state,
    ...fields,
  }))

  const emitDeviceReady = (fields: Record<string, unknown> = {}) => enqueue(envelope({
    kind: 'device_ready',
    run_id: activeRunId,
    generation,
    slot: 1,
    profile_handle: 'jump-rope-slot-01',
    address: 'ec:67:0e:8b:da:97',
    address_type: 0,
    name: 'JR260-0923081',
    identity_verified: true,
    ...fields,
  }))

  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      const request = JSON.parse(decoder.decode(chunk).trim()) as Record<string, unknown>
      commands.push(request)

      if (request.kind === 'hello') {
        if (helloDisconnectPendingRemaining > 0) {
          helloDisconnectPendingRemaining -= 1
          enqueue(envelope({
            kind: 'error',
            request_id: request.request_id,
            code: 'disconnect_pending',
            message: 'BLE teardown is still pending',
            retryable: true,
            retry_after_ms: 250,
            state: 'stopping',
          }))
          return
        }
        enqueue(envelope({
          kind: 'caps',
          request_id: request.request_id,
          product: options.product ?? 'ATV_CHILEAF_GATT_WEB_SERIAL_PROBE',
          protocol: 1,
          state: activeRunId ? 'running' : 'ready',
          baud: 115200,
          rx_line_max: 767,
          lease_min_ms: 1000,
          lease_default_ms: 5000,
          lease_max_ms: 30000,
          gateway_id: 'gateway-1',
          max_active_devices: 1,
          capabilities: [
            'chileaf_jr203_gatt_v1',
            'jump_rope_count',
            'mode_control',
            'run_gate',
            'heartbeat_lease',
            'fresh_event_sequence',
          ],
        }))
        return
      }
      if (request.kind === 'profile_set') {
        profile = request
        ack(request, 'profile_set')
        return
      }
      if (request.kind === 'run_start') {
        const requestedRunId = String(request.run_id)
        if (activeRunId !== requestedRunId) {
          generation += 1
          activeRunId = requestedRunId
        }
        if (options.dropFirstRunStartAck && !runStartAckDropped) {
          runStartAckDropped = true
          return
        }
        ack(request, 'run_start', { state: 'running', lease_remaining_ms: 5000 })
        if (
          options.skipFirstPinnedDeviceReady &&
          typeof profile.address === 'string' &&
          !pinnedDeviceReadySkipped
        ) {
          pinnedDeviceReadySkipped = true
          return
        }
        enqueue(envelope({
          kind: 'device_ready',
          run_id: activeRunId,
          generation,
          slot: 1,
          profile_handle: 'jump-rope-slot-01',
          address: 'ec:67:0e:8b:da:97',
          address_type: 0,
          name: 'JR260-0923081',
          identity_verified: typeof profile.address === 'string',
        }), options.deviceReadyDelayMs)
        return
      }
      if (request.kind === 'run_stop') {
        if (options.disconnectPendingOnce && !disconnectPendingSent) {
          disconnectPendingSent = true
          enqueue(envelope({
            kind: 'error',
            request_id: request.request_id,
            code: 'disconnect_pending',
            message: 'BLE teardown is still pending',
            retryable: true,
            retry_after_ms: 250,
            state: 'stopping',
            run_id: request.run_id,
            generation,
          }))
          return
        }
        ack(request, 'run_stop', {
          state: 'ready',
          running: false,
          connected: false,
          lease_remaining_ms: 0,
        })
        activeRunId = ''
        profile = {}
        return
      }
      if (request.kind === 'control') {
        if (request.op === options.failControlOnce && !controlFailureSent) {
          controlFailureSent = true
          enqueue(envelope({
            kind: 'error',
            request_id: request.request_id,
            code: 'control_failed',
            message: `${String(request.op)} failed`,
            retryable: false,
            run_id: activeRunId,
            generation,
          }))
          return
        }
        if (
          request.op === 'session_stop' &&
          options.sessionStopAckWithDisconnectSameChunk &&
          !sessionStopDisconnectChunkSent
        ) {
          sessionStopDisconnectChunkSent = true
          const responseUptime = uptimeMs
          enqueueChunk([
            envelope({
              kind: 'ack',
              request_id: request.request_id,
              command: 'session_stop',
              run_id: activeRunId,
              generation,
              uptime_ms: responseUptime,
            }),
            envelope({
              kind: 'device_state',
              run_id: activeRunId,
              generation,
              slot: 1,
              profile_handle: 'jump-rope-slot-01',
              state: 'disconnected',
            }),
          ])
          uptimeMs = (responseUptime + 10) >>> 0
          return
        }
        const controlDelayMs = options.controlAckDelayMs?.[
          request.op as 'time_sync' | 'mode_set' | 'session_start' | 'session_stop'
        ] ?? 0
        if (request.op === 'session_start') {
          const configuredUptime = options.sessionStartUptimes?.[sessionStartIndex]
          sessionStartIndex += 1
          latestSessionStartUptime = ack(
            request,
            String(request.op),
            configuredUptime === undefined ? {} : { uptime_ms: configuredUptime },
            controlDelayMs,
          )
        } else {
          ack(request, String(request.op), {}, controlDelayMs)
        }
        return
      }
      if (request.kind === 'ping') {
        enqueue(envelope({
          kind: 'pong',
          request_id: request.request_id,
          run_id: activeRunId,
          generation,
        }), options.pingResponseDelayMs)
        return
      }
      throw new Error(`Unexpected command: ${String(request.kind)}`)
    },
  })

  const port = {
    readable,
    writable,
    async open() { openCount += 1 },
    async close() { closeCount += 1 },
    getInfo() { return { usbVendorId: 0x10c4, usbProductId: 0xea60 } },
  }

  return {
    commands,
    port,
    enqueue,
    emitSnapshot,
    emitDeviceState,
    emitDeviceReady,
    closeReadable: () => controller.close(),
    openCount: () => openCount,
    closeCount: () => closeCount,
    generation: () => generation,
    activeRunId: () => activeRunId,
    latestSessionStartUptime: () => latestSessionStartUptime,
  }
}

function installSerial(
  port: ReturnType<typeof createGateway>['port'],
  storage = new MemoryStorage(),
) {
  let pickerCount = 0
  const serial = {
    async getPorts() { return [] },
    async requestPort() {
      pickerCount += 1
      return port
    },
    addEventListener() { },
    removeEventListener() { },
  }
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { isSecureContext: true, localStorage: storage },
  })
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { serial },
  })
  return { pickerCount: () => pickerCount, storage }
}

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')

afterEach(() => {
  vi.useRealTimers()
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
  else Reflect.deleteProperty(globalThis, 'window')
  if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator)
  else Reflect.deleteProperty(globalThis, 'navigator')
})

const clientTiming = {
  handshakeTimeoutMs: 200,
  deviceReadyTimeoutMs: 200,
  requestTimeoutMs: 50,
  runStartTimeoutMs: 50,
  retryDelayMs: 1,
  openRetryDelayMs: 1,
  pingIntervalMs: 60_000,
  pingTimeoutMs: 50,
}

describe('WebSerialJumpRopeClient', () => {
  const cachedIdentity = (storage = new MemoryStorage()) => {
    storage.setItem('atv.jump-rope.jr203.identity.v1', JSON.stringify({
      gateway_id: 'gateway-1',
      address: 'ec:67:0e:8b:da:97',
      address_type: 0,
      name: 'JR260-0923081',
    }))
    return storage
  }

  const flushMessages = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

  it('connects and pins a discovered identity without sending a measurement start', async () => {
    const gateway = createGateway()
    const installed = installSerial(gateway.port)
    const statuses: string[] = []
    const client = new WebSerialJumpRopeClient(
      () => undefined,
      (status) => statuses.push(status.state),
      clientTiming,
    )

    const connection = await client.connect()
    expect(connection).toMatchObject({
      bootId: 'boot-1',
      gatewayId: 'gateway-1',
      generation: 2,
      device: { identity_verified: true },
    })
    expect(installed.pickerCount()).toBe(1)
    expect(statuses.at(-1)).toBe('connected')
    expect(gateway.commands.filter((command) => command.kind === 'control')).toHaveLength(0)
    expect(gateway.commands.some((command) => command.op === 'session_start')).toBe(false)

    const profiles = gateway.commands.filter((command) => command.kind === 'profile_set')
    expect(profiles[0]).not.toHaveProperty('address')
    expect(profiles[1]).toMatchObject({
      slot: 1,
      handle: 'jump-rope-slot-01',
      driver: 'chileaf_jr203_gatt_v1',
      name_prefix: 'JR',
      address: 'ec:67:0e:8b:da:97',
      address_type: 0,
      wire_dialect: 'JR203_WX_1_1_2',
      write_mode: 'without_response',
    })

    await client.disconnect()
    expect(gateway.commands.at(-1)).toMatchObject({ kind: 'run_stop' })
    expect(gateway.closeCount()).toBe(1)
  })

  it('changes modes across repeated start and end signals on one GATT run', async () => {
    const gateway = createGateway()
    installSerial(gateway.port, cachedIdentity())
    const statuses: string[] = []
    const client = new WebSerialJumpRopeClient(
      () => undefined,
      (status) => statuses.push(status.state),
      clientTiming,
    )

    const connection = await client.connect()
    const first = await client.startMeasurement({ mode: 1, target: 120 })
    await client.finishMeasurement()
    const second = await client.startMeasurement({ mode: 2, target: 125 })
    await client.finishMeasurement()

    expect(first).toMatchObject({ mode: 1, target: 120 })
    expect(second).toMatchObject({ mode: 2, target: 120 })
    expect(gateway.activeRunId()).toBe(connection?.runId)
    expect(gateway.commands.filter((command) => command.kind === 'run_start')).toHaveLength(1)
    expect(gateway.commands.filter((command) => command.kind === 'run_stop')).toHaveLength(0)
    expect(gateway.closeCount()).toBe(0)
    const controls = gateway.commands.filter((command) => command.kind === 'control')
    expect(controls.map((command) => command.op)).toEqual([
      'time_sync',
      'mode_set',
      'session_start',
      'session_stop',
      'time_sync',
      'mode_set',
      'session_start',
      'session_stop',
    ])
    expect(controls[1]).toMatchObject({ mode: 1, target: 120, minutes: 0, seconds: 0 })
    expect(controls[5]).toMatchObject({ mode: 2, target: 0, minutes: 2, seconds: 0 })
    expect(controls[6]).toMatchObject({ mode: 2, target: 120 })
    expect(statuses.at(-1)).toBe('connected')

    await client.disconnect()
  })

  it('keeps the port, run, and lease alive after END', async () => {
    const gateway = createGateway()
    installSerial(gateway.port, cachedIdentity())
    const client = new WebSerialJumpRopeClient(
      () => undefined,
      () => undefined,
      { ...clientTiming, pingIntervalMs: 10 },
    )

    await client.connect()
    await client.startMeasurement({ mode: 0, target: 0 })
    await client.finishMeasurement()
    const pingsAtEnd = gateway.commands.filter((command) => command.kind === 'ping').length
    await new Promise((resolve) => setTimeout(resolve, 30))

    expect(gateway.commands.filter((command) => command.kind === 'run_stop')).toHaveLength(0)
    expect(gateway.closeCount()).toBe(0)
    expect(gateway.commands.filter((command) => command.kind === 'ping').length).toBeGreaterThan(pingsAtEnd)
    await client.disconnect()
  })

  it('sends session_stop before run_stop when disconnecting during measurement', async () => {
    const gateway = createGateway()
    installSerial(gateway.port, cachedIdentity())
    const client = new WebSerialJumpRopeClient(() => undefined, () => undefined, clientTiming)

    await client.connect()
    await client.startMeasurement({ mode: 1, target: 100 })
    await client.disconnect()

    expect(gateway.commands.slice(-2).map((command) => [command.kind, command.op])).toEqual([
      ['control', 'session_stop'],
      ['run_stop', undefined],
    ])
    expect(gateway.commands.at(-2)).toMatchObject({ mode: 1, target: 100 })
    expect(gateway.closeCount()).toBe(1)
  })

  it('uses a cached identity and fixes exam mode at 60 seconds without mode_set', async () => {
    const gateway = createGateway()
    installSerial(gateway.port, cachedIdentity())
    const client = new WebSerialJumpRopeClient(() => undefined, () => undefined, clientTiming)

    const connection = await client.connect()
    const measurement = await client.startMeasurement({ mode: 3, target: 999 })
    expect(connection).toMatchObject({ generation: 1 })
    expect(measurement).toMatchObject({ mode: 3, target: 60 })
    expect(gateway.commands.filter((command) => command.kind === 'profile_set')).toHaveLength(1)
    const controls = gateway.commands.filter((command) => command.kind === 'control')
    expect(controls.map((command) => command.op)).toEqual(['time_sync', 'session_start'])
    expect(controls[1]).toMatchObject({ mode: 3, target: 60 })
    await client.finishMeasurement()
    await client.disconnect()
  })

  it('rejects the wrong gateway product before profile_set', async () => {
    const gateway = createGateway({ product: 'ATV_CL830_WEB_SERIAL_GATEWAY' })
    installSerial(gateway.port)
    const statuses: Array<{ state: string; error: string | null }> = []
    const client = new WebSerialJumpRopeClient(
      () => undefined,
      (status) => statuses.push({ state: status.state, error: status.error }),
      clientTiming,
    )

    await expect(client.connect()).resolves.toBeNull()
    expect(gateway.commands.map((command) => command.kind)).toEqual(['hello'])
    expect(statuses.at(-1)).toMatchObject({ state: 'error' })
    expect(statuses.at(-1)?.error).toContain('ATV JR203')
  })

  it('fences pre-START and post-END snapshots while advancing the run-wide sequence', async () => {
    const gateway = createGateway({ sessionStartUptimes: [100, 200] })
    installSerial(gateway.port, cachedIdentity())
    const received: number[] = []
    const client = new WebSerialJumpRopeClient(
      (event) => received.push(event.count),
      () => undefined,
      clientTiming,
    )

    await client.connect()
    gateway.emitSnapshot({ seq: 1, observed_ms: 90, count: 1, mode: 0 })
    await flushMessages()

    await client.startMeasurement({ mode: 0, target: 0 })
    gateway.emitSnapshot({ seq: 2, observed_ms: 99, count: 2, mode: 0 })
    gateway.emitSnapshot({ seq: 3, observed_ms: 100, count: 3, mode: 0 })
    gateway.emitSnapshot({ seq: 4, observed_ms: 101, count: 4, mode: 0 })
    await flushMessages()

    const finishPromise = client.finishMeasurement()
    gateway.emitSnapshot({ seq: 5, observed_ms: 102, count: 5, mode: 0 })
    await finishPromise
    await flushMessages()

    await client.startMeasurement({ mode: 0, target: 0 })
    gateway.emitSnapshot({ seq: 6, observed_ms: 201, count: 6, mode: 0 })
    await flushMessages()

    expect(received).toEqual([4, 6])
    await client.finishMeasurement()
    await client.disconnect()
  })

  it('ignores duplicate and out-of-order absolute count snapshots', async () => {
    const gateway = createGateway()
    installSerial(gateway.port, cachedIdentity())
    const received: number[] = []
    const client = new WebSerialJumpRopeClient((event) => received.push(event.count), () => undefined, clientTiming)
    const connection = await client.connect()
    const measurement = await client.startMeasurement({ mode: 0, target: 0 })

    expect(connection).not.toBeNull()
    expect(measurement).not.toBeNull()
    const observedMs = ((measurement?.startUptimeMs ?? 0) + 1) >>> 0
    gateway.emitSnapshot({ seq: 20, observed_ms: observedMs, count: 3, mode: 0 })
    gateway.emitSnapshot({ seq: 20, observed_ms: observedMs, count: 999, mode: 0 })
    gateway.emitSnapshot({ seq: 19, observed_ms: observedMs, count: 998, mode: 0 })
    gateway.emitSnapshot({ seq: 21, observed_ms: observedMs, count: 4, mode: 0 })
    await flushMessages()

    expect(received).toEqual([3, 4])
    await client.finishMeasurement()
    await client.disconnect()
  })

  it('starts ping immediately after run_start so the five-second lease survives GATT discovery', async () => {
    const gateway = createGateway({ deviceReadyDelayMs: 35 })
    installSerial(gateway.port, cachedIdentity())
    const client = new WebSerialJumpRopeClient(
      () => undefined,
      () => undefined,
      { ...clientTiming, pingIntervalMs: 10 },
    )

    await expect(client.connect()).resolves.not.toBeNull()
    const kinds = gateway.commands.map((command) => command.kind === 'control' ? command.op : command.kind)
    expect(kinds).toContain('ping')
    expect(kinds).not.toContain('time_sync')
    await client.disconnect()
  })

  it('keeps one configuring ping pending through a GATT stall longer than five seconds', async () => {
    vi.useFakeTimers()
    const gateway = createGateway({ deviceReadyDelayMs: 7_000, pingResponseDelayMs: 6_000 })
    installSerial(gateway.port, cachedIdentity())
    const statuses: string[] = []
    const client = new WebSerialJumpRopeClient(
      () => undefined,
      (status) => statuses.push(status.state),
      {
        ...clientTiming,
        deviceReadyTimeoutMs: 10_000,
        pingIntervalMs: 1_000,
        pingTimeoutMs: 50,
      },
    )

    const connectPromise = client.connect()
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await Promise.resolve()
      if (gateway.commands.some((command) => command.kind === 'run_start')) break
    }
    expect(gateway.commands.some((command) => command.kind === 'run_start')).toBe(true)

    await vi.advanceTimersByTimeAsync(7_000)
    await expect(connectPromise).resolves.not.toBeNull()
    expect(statuses).not.toContain('error')
    expect(gateway.commands.filter((command) => command.kind === 'ping')).toHaveLength(1)
    await client.disconnect()
  })

  it('escalates a later transport failure after a measurement command error', async () => {
    const gateway = createGateway({ failControlOnce: 'mode_set' })
    installSerial(gateway.port, cachedIdentity())
    const statuses: Array<{ state: string; connection: unknown }> = []
    const client = new WebSerialJumpRopeClient(
      () => undefined,
      (status) => statuses.push({ state: status.state, connection: status.connection }),
      clientTiming,
    )

    await client.connect()
    await expect(client.startMeasurement({ mode: 1, target: 100 })).resolves.toBeNull()
    expect(statuses.at(-1)).toMatchObject({ state: 'error' })
    expect(statuses.at(-1)?.connection).not.toBeNull()

    gateway.closeReadable()
    await flushMessages()
    await flushMessages()

    expect(statuses.at(-1)).toMatchObject({ state: 'error', connection: null })
    expect(gateway.closeCount()).toBe(1)
  })

  it('accepts only a current lease_expired status, including firmware messages without run_id', async () => {
    const gateway = createGateway()
    installSerial(gateway.port, cachedIdentity())
    const statuses: Array<{ state: string; connection: unknown }> = []
    const client = new WebSerialJumpRopeClient(
      () => undefined,
      (status) => statuses.push({ state: status.state, connection: status.connection }),
      clientTiming,
    )
    const connection = await client.connect()

    gateway.enqueue({
      v: 1,
      kind: 'status',
      boot_id: 'boot-1',
      generation: (connection?.generation ?? 0) + 1,
      state: 'ready',
      reason: 'lease_expired',
    })
    await flushMessages()
    expect(statuses.at(-1)).toMatchObject({ state: 'connected' })
    expect(gateway.closeCount()).toBe(0)

    gateway.enqueue({
      v: 1,
      kind: 'status',
      boot_id: 'boot-1',
      run_id: 'stale-run',
      generation: connection?.generation,
      state: 'ready',
      reason: 'lease_expired',
    })
    await flushMessages()
    expect(statuses.at(-1)).toMatchObject({ state: 'connected' })
    expect(gateway.closeCount()).toBe(0)

    gateway.enqueue({
      v: 1,
      kind: 'status',
      boot_id: 'boot-1',
      generation: connection?.generation,
      state: 'ready',
      reason: 'lease_expired',
    })
    await flushMessages()

    expect(statuses.at(-1)).toMatchObject({ state: 'error', connection: null })
    expect(gateway.closeCount()).toBe(1)
  })

  it('fails closed on a current-device BLE reconnect and resumes only after verified device_ready', async () => {
    const gateway = createGateway()
    installSerial(gateway.port, cachedIdentity())
    const received: number[] = []
    const statuses: Array<{
      state: string
      statusText: string
      error: string | null
      connection: unknown
      measurement: unknown
    }> = []
    const client = new WebSerialJumpRopeClient(
      (event) => received.push(event.count),
      (status) => statuses.push(status),
      { ...clientTiming, pingIntervalMs: 10 },
    )

    const connection = await client.connect()
    const measurement = await client.startMeasurement({ mode: 1, target: 100 })
    gateway.emitSnapshot({
      seq: 10,
      observed_ms: ((measurement?.startUptimeMs ?? 0) + 1) >>> 0,
      count: 10,
      mode: 1,
    })
    await flushMessages()
    expect(received).toEqual([10])

    gateway.emitDeviceState('disconnected', { generation: (connection?.generation ?? 0) + 1 })
    await flushMessages()
    expect(statuses.at(-1)?.state).toBe('running')

    gateway.emitDeviceState('disconnected')
    await flushMessages()
    expect(statuses.at(-1)).toMatchObject({
      state: 'reconnecting',
      measurement: null,
    })
    expect(statuses.at(-1)?.connection).not.toBeNull()
    expect(statuses.at(-1)?.error).toContain('측정이 중단')
    const pingsBeforeReconnectWait = gateway.commands.filter((command) => command.kind === 'ping').length
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(gateway.commands.filter((command) => command.kind === 'ping').length).toBeGreaterThan(pingsBeforeReconnectWait)

    gateway.emitSnapshot({ seq: 11, observed_ms: 2_000, count: 99, mode: 1 })
    gateway.emitDeviceState('connecting')
    gateway.emitDeviceReady({ address: 'ec:67:0e:8b:da:00' })
    await flushMessages()
    expect(statuses.at(-1)?.state).toBe('reconnecting')
    expect(received).toEqual([10])

    gateway.emitDeviceReady()
    await flushMessages()
    await flushMessages()
    expect(statuses.at(-1)).toMatchObject({ state: 'connected', measurement: null, error: null })
    expect(statuses.at(-1)?.statusText).toContain('이전 측정 중단')
    expect(gateway.commands.filter((command) => command.op === 'session_start')).toHaveLength(1)
    expect(gateway.commands.filter((command) => command.op === 'session_stop')).toHaveLength(1)
    expect(gateway.commands.filter((command) => command.kind === 'run_stop')).toHaveLength(0)
    expect(gateway.closeCount()).toBe(0)

    await client.startMeasurement({ mode: 2, target: 120 })
    expect(gateway.commands.filter((command) => command.op === 'session_start')).toHaveLength(2)
    await client.finishMeasurement()
    await client.disconnect()
  })

  it('does not publish connected from a stale recovery when the stop ACK and disconnect share a chunk', async () => {
    const gateway = createGateway({ sessionStopAckWithDisconnectSameChunk: true })
    installSerial(gateway.port, cachedIdentity())
    const statuses: string[] = []
    const client = new WebSerialJumpRopeClient(
      () => undefined,
      (status) => statuses.push(status.state),
      clientTiming,
    )

    await client.connect()
    await client.startMeasurement({ mode: 1, target: 100 })
    gateway.emitDeviceState('disconnected')
    await flushMessages()
    expect(statuses.at(-1)).toBe('reconnecting')

    const connectedCountBeforeRecovery = statuses.filter((state) => state === 'connected').length
    gateway.emitDeviceReady()
    await flushMessages()
    await flushMessages()

    expect(statuses.at(-1)).toBe('reconnecting')
    expect(statuses.filter((state) => state === 'connected')).toHaveLength(connectedCountBeforeRecovery)
    expect(gateway.commands.filter((command) => command.op === 'session_stop')).toHaveLength(1)

    gateway.emitDeviceReady()
    await flushMessages()
    await flushMessages()

    expect(statuses.at(-1)).toBe('connected')
    expect(gateway.commands.filter((command) => command.op === 'session_stop')).toHaveLength(2)
    await client.disconnect()
  })

  it('settles an invalidated START owner before reconnect exposes connected', async () => {
    const gateway = createGateway({ controlAckDelayMs: { time_sync: 40 } })
    installSerial(gateway.port, cachedIdentity())
    const statuses: string[] = []
    const client = new WebSerialJumpRopeClient(
      () => undefined,
      (status) => statuses.push(status.state),
      clientTiming,
    )

    await client.connect()
    const staleStart = client.startMeasurement({ mode: 1, target: 100 })
    gateway.emitDeviceState('disconnected')
    await flushMessages()
    gateway.emitDeviceReady()
    await flushMessages()

    expect(statuses.at(-1)).toBe('reconnecting')
    expect(gateway.commands.filter((command) => command.op === 'time_sync')).toHaveLength(1)
    await expect(staleStart).resolves.toBeNull()
    await flushMessages()
    expect(statuses.at(-1)).toBe('connected')

    const currentStart = client.startMeasurement({ mode: 2, target: 120 })
    expect(currentStart).not.toBe(staleStart)
    await expect(currentStart).resolves.toMatchObject({ mode: 2, target: 120 })
    expect(gateway.commands.filter((command) => command.op === 'time_sync')).toHaveLength(2)
    expect(gateway.commands.filter((command) => command.op === 'session_start')).toHaveLength(1)
    await client.finishMeasurement()
    await client.disconnect()
  })

  it('settles an invalidated END owner before reconnect accepts a new measurement', async () => {
    const gateway = createGateway({ controlAckDelayMs: { session_stop: 40 } })
    installSerial(gateway.port, cachedIdentity())
    const statuses: string[] = []
    const client = new WebSerialJumpRopeClient(
      () => undefined,
      (status) => statuses.push(status.state),
      clientTiming,
    )

    await client.connect()
    await client.startMeasurement({ mode: 1, target: 100 })
    const staleFinish = client.finishMeasurement()
    gateway.emitDeviceState('disconnected')
    await flushMessages()
    gateway.emitDeviceReady()
    await flushMessages()

    expect(statuses.at(-1)).toBe('reconnecting')
    await staleFinish
    await new Promise((resolve) => setTimeout(resolve, 50))
    await flushMessages()
    expect(statuses.at(-1)).toBe('connected')

    await client.startMeasurement({ mode: 2, target: 120 })
    const currentFinish = client.finishMeasurement()
    expect(currentFinish).not.toBe(staleFinish)
    await currentFinish
    expect(statuses.at(-1)).toBe('connected')
    expect(gateway.commands.filter((command) => command.op === 'session_start')).toHaveLength(2)
    expect(gateway.commands.filter((command) => command.op === 'session_stop')).toHaveLength(3)
    await client.disconnect()
  })

  it('does not return stale connection metadata from connect while disconnecting', async () => {
    const gateway = createGateway()
    installSerial(gateway.port, cachedIdentity())
    const client = new WebSerialJumpRopeClient(() => undefined, () => undefined, clientTiming)

    await client.connect()
    const disconnectPromise = client.disconnect()
    await expect(client.connect()).resolves.toBeNull()
    await disconnectPromise
    expect(gateway.closeCount()).toBe(1)
  })

  it('clears a stale cached identity and performs one unpinned discovery fallback', async () => {
    const gateway = createGateway({ skipFirstPinnedDeviceReady: true })
    const storage = new MemoryStorage()
    storage.setItem('atv.jump-rope.jr203.identity.v1', JSON.stringify({
      gateway_id: 'gateway-1',
      address: 'ec:67:0e:8b:da:00',
      address_type: 0,
      name: 'JR-OLD',
    }))
    installSerial(gateway.port, storage)
    const client = new WebSerialJumpRopeClient(
      () => undefined,
      () => undefined,
      { ...clientTiming, deviceReadyTimeoutMs: 30 },
    )

    const connection = await client.connect()
    const profiles = gateway.commands.filter((command) => command.kind === 'profile_set')
    expect(connection).toMatchObject({ generation: 3, device: { identity_verified: true } })
    expect(profiles).toHaveLength(3)
    expect(profiles.map((profile) => typeof profile.address === 'string')).toEqual([true, false, true])
    expect(storage.removalCount()).toBe(1)
    expect(JSON.parse(storage.getItem('atv.jump-rope.jr203.identity.v1') ?? '{}')).toMatchObject({
      gateway_id: 'gateway-1',
      address: 'ec:67:0e:8b:da:97',
    })
    await client.disconnect()
  })

  it('retries disconnect_pending run_stop once with the same run ID', async () => {
    const gateway = createGateway({ disconnectPendingOnce: true })
    installSerial(gateway.port, cachedIdentity())
    const client = new WebSerialJumpRopeClient(() => undefined, () => undefined, clientTiming)
    await client.connect()
    await client.disconnect()

    const runStops = gateway.commands.filter((command) => command.kind === 'run_stop')
    expect(runStops).toHaveLength(2)
    expect(runStops[0].run_id).toBe(runStops[1].run_id)
    expect(runStops[0].generation).toBe(runStops[1].generation)
  })

  it('retries a lost run_start ACK with one stable run ID', async () => {
    const gateway = createGateway({ dropFirstRunStartAck: true })
    installSerial(gateway.port, cachedIdentity())
    const client = new WebSerialJumpRopeClient(() => undefined, () => undefined, clientTiming)

    const connection = await client.connect()
    const starts = gateway.commands.filter((command) => command.kind === 'run_start')
    expect(connection?.generation).toBe(1)
    expect(starts).toHaveLength(2)
    expect(starts[0].run_id).toBe(starts[1].run_id)
    await client.disconnect()
  })

  it('waits through a retryable disconnect_pending hello response', async () => {
    const gateway = createGateway({ helloDisconnectPendingCount: 1 })
    installSerial(gateway.port, cachedIdentity())
    const client = new WebSerialJumpRopeClient(() => undefined, () => undefined, {
      ...clientTiming,
      handshakeTimeoutMs: 1_000,
    })

    await expect(client.connect()).resolves.not.toBeNull()
    expect(gateway.commands.filter((command) => command.kind === 'hello')).toHaveLength(2)
    await client.disconnect()
  })
})
