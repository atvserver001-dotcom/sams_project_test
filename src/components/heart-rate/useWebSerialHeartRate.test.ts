import { afterEach, describe, expect, it, vi } from 'vitest'

import { WebSerialHeartRateClient } from './useWebSerialHeartRate'

const gatewayCaps = (requestId: string, state: 'ready' | 'running') => ({
  v: 1,
  kind: 'caps',
  request_id: requestId,
  product: 'ATV_CL830_WEB_SERIAL_GATEWAY',
  protocol: 1,
  state,
  baud: 115200,
  rx_line_max: 255,
  lease_min_ms: 1000,
  lease_default_ms: 5000,
  lease_max_ms: 15000,
  gateway_id: 'gateway-1',
  boot_id: 'boot-1',
  capabilities: ['cl830_a1_a2', 'run_gate', 'heartbeat_lease', 'fresh_event_sequence'],
})

interface ReadyGatewayOptions {
  open?: () => void | Promise<void>
  close?: () => void | Promise<void>
  runStartAckDelayMs?: number
  emitPreAckEvent?: boolean
}

function createReadyGateway(options: ReadyGatewayOptions = {}) {
  const commands: Array<{ kind: string; run_id?: string }> = []
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  let controller!: ReadableStreamDefaultController<Uint8Array>
  let generation = 0

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
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      const request = JSON.parse(decoder.decode(chunk).trim()) as {
        kind: string
        request_id: string
        run_id?: string
      }
      commands.push({ kind: request.kind, run_id: request.run_id })

      if (request.kind === 'hello') {
        enqueue(gatewayCaps(request.request_id, 'ready'))
        return
      }
      if (request.kind === 'run_start') {
        generation += 1
        if (options.emitPreAckEvent) {
          enqueue({
            v: 1,
            kind: 'heart_rate',
            boot_id: 'boot-1',
            run_id: request.run_id,
            generation,
            source_key: 'cl830:000b738e',
            aliases: {
              be_decimal: '750478',
              be_decimal_min7: '0750478',
              le_decimal: '2389904128',
            },
            bpm: 90,
            battery_percent: 80,
            seq: 7,
            fresh: true,
          })
        }
        enqueue({
          v: 1,
          kind: 'ack',
          request_id: request.request_id,
          boot_id: 'boot-1',
          command: 'run_start',
          run_id: request.run_id,
          state: 'running',
          generation,
          lease_remaining_ms: 4999,
        }, options.runStartAckDelayMs)
        return
      }
      if (request.kind === 'run_stop') {
        enqueue({
          v: 1,
          kind: 'ack',
          request_id: request.request_id,
          boot_id: 'boot-1',
          command: 'run_stop',
          run_id: request.run_id,
          state: 'ready',
          generation,
          lease_remaining_ms: 0,
        })
        return
      }
      throw new Error(`Unexpected command: ${request.kind}`)
    },
  })

  const port = {
    readable,
    writable,
    async open() { await options.open?.() },
    async close() { await options.close?.() },
    getInfo() { return { usbVendorId: 0x10c4, usbProductId: 0xea60 } },
  }
  return { commands, port }
}

function installSerialWithCachedPort(port: ReturnType<typeof createReadyGateway>['port']) {
  const serial = {
    async getPorts() { return [port] },
    async requestPort() { throw new Error('The cached authorized port should be reused.') },
    addEventListener() { },
    removeEventListener() { },
  }
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { isSecureContext: true },
  })
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { serial },
  })
}

function installSerialWithSelectedPort(port: ReturnType<typeof createReadyGateway>['port']) {
  let requestCount = 0
  const serial = {
    async getPorts() { return [] },
    async requestPort() {
      requestCount += 1
      return port
    },
    addEventListener() { },
    removeEventListener() { },
  }
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { isSecureContext: true },
  })
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { serial },
  })
  return () => requestCount
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

describe('WebSerialHeartRateClient gateway recovery', () => {
  it('recovers a lost hello, stops the previous lease, and retries run_start with one run ID', async () => {
    const commands: Array<{ kind: string; run_id?: string }> = []
    const encoder = new TextEncoder()
    const decoder = new TextDecoder()
    let controller!: ReadableStreamDefaultController<Uint8Array>
    let gatewayState: 'ready' | 'running' = 'running'
    let activeRunId = 'old-run'
    let generation = 2
    let helloAttemptCount = 0
    let runStartAttemptCount = 0

    const readable = new ReadableStream<Uint8Array>({
      start(nextController) {
        controller = nextController
      },
    })
    const writable = new WritableStream<Uint8Array>({
      write(chunk) {
        const request = JSON.parse(decoder.decode(chunk).trim()) as {
          kind: string
          request_id: string
          run_id?: string
        }
        commands.push({ kind: request.kind, run_id: request.run_id })

        let response: Record<string, unknown>
        if (request.kind === 'hello') {
          helloAttemptCount += 1
          if (helloAttemptCount === 1) return
          response = gatewayCaps(request.request_id, gatewayState)
        } else if (request.kind === 'status') {
          response = {
            v: 1,
            kind: 'status',
            request_id: request.request_id,
            boot_id: 'boot-1',
            state: gatewayState,
            ...(gatewayState === 'running' ? { run_id: activeRunId } : {}),
            generation,
            lease_remaining_ms: gatewayState === 'running' ? 3000 : 0,
          }
        } else if (request.kind === 'run_stop') {
          gatewayState = 'ready'
          response = {
            v: 1,
            kind: 'ack',
            request_id: request.request_id,
            boot_id: 'boot-1',
            command: 'run_stop',
            run_id: request.run_id,
            state: 'ready',
            generation,
            lease_remaining_ms: 0,
          }
        } else if (request.kind === 'run_start') {
          runStartAttemptCount += 1
          if (gatewayState !== 'running' || activeRunId !== request.run_id) {
            gatewayState = 'running'
            activeRunId = request.run_id ?? ''
            generation += 1
          }
          // 첫 ACK만 유실시켜 동일 run_id 재시도가 중복 실행을 만들지 않는지 확인한다.
          if (runStartAttemptCount === 1) {
            controller.enqueue(encoder.encode(`${JSON.stringify({
              v: 1,
              kind: 'heart_rate',
              boot_id: 'boot-1',
              run_id: request.run_id,
              generation,
              source_key: 'cl830:000b738e',
              aliases: {
                be_decimal: '750478',
                be_decimal_min7: '0750478',
                le_decimal: '2389904128',
              },
              bpm: 91,
              battery_percent: 81,
              seq: 1,
              fresh: true,
            })}\n`))
            return
          }
          response = {
            v: 1,
            kind: 'ack',
            request_id: request.request_id,
            boot_id: 'boot-1',
            command: 'run_start',
            run_id: request.run_id,
            state: 'running',
            generation,
            lease_remaining_ms: 4999,
          }
        } else {
          throw new Error(`Unexpected command: ${request.kind}`)
        }
        controller.enqueue(encoder.encode(`${JSON.stringify(response)}\n`))
      },
    })

    const port = {
      readable,
      writable,
      async open() { },
      async close() { },
      getInfo() { return { usbVendorId: 0x10c4, usbProductId: 0xea60 } },
    }
    const serial = {
      async getPorts() { return [port] },
      async requestPort() { throw new Error('The cached authorized port should be reused.') },
      addEventListener() { },
      removeEventListener() { },
    }
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { isSecureContext: true },
    })
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { serial },
    })

    const statuses: string[] = []
    const preparationRunIds: string[] = []
    const receivedEvents: Array<{ transport_sequence_gap?: number }> = []
    const client = new WebSerialHeartRateClient(
      (receivedEvent) => receivedEvents.push(receivedEvent),
      (status) => statuses.push(status.state),
      { handshakeTimeoutMs: 200, requestTimeoutMs: 10, retryDelayMs: 1 },
    )
    await client.preloadAuthorizedPorts()

    const metadata = await client.start({
      beforeRunStart(preparation) {
        preparationRunIds.push(preparation.runId)
      },
    })

    expect(metadata).toMatchObject({
      bootId: 'boot-1',
      gatewayId: 'gateway-1',
      generation: 3,
    })
    expect(metadata?.startedAt).toEqual(expect.any(Number))
    expect(preparationRunIds).toEqual([metadata?.runId])
    expect(commands.slice(0, 7)).toEqual([
      { kind: 'hello', run_id: undefined },
      { kind: 'hello', run_id: undefined },
      { kind: 'status', run_id: undefined },
      { kind: 'run_stop', run_id: 'old-run' },
      { kind: 'hello', run_id: undefined },
      { kind: 'run_start', run_id: metadata?.runId },
      { kind: 'run_start', run_id: metadata?.runId },
    ])
    expect(statuses).toContain('running')
    expect(receivedEvents).toEqual([])
    expect(client.transportQuality()).toEqual({
      receivedEventCount: 0,
      sequenceGapCount: 0,
      rejectedSequenceCount: 0,
      lastEventAt: null,
    })

    const heartRateEvent = {
      v: 1,
      kind: 'heart_rate',
      boot_id: 'boot-1',
      run_id: metadata?.runId,
      generation: 3,
      source_key: 'cl830:000b738e',
      aliases: {
        be_decimal: '750478',
        be_decimal_min7: '0750478',
        le_decimal: '2389904128',
      },
      bpm: 92,
      battery_percent: 81,
      seq: 2,
      fresh: true,
    }
    controller.enqueue(encoder.encode(`${JSON.stringify(heartRateEvent)}\n`))
    controller.enqueue(encoder.encode(`${JSON.stringify(heartRateEvent)}\n`))
    controller.enqueue(encoder.encode(`${JSON.stringify({ ...heartRateEvent, seq: 4 })}\n`))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(receivedEvents).toHaveLength(2)
    expect(receivedEvents[0].transport_sequence_gap).toBe(0)
    expect(receivedEvents[1].transport_sequence_gap).toBe(1)
    expect(client.transportQuality()).toMatchObject({
      receivedEventCount: 2,
      sequenceGapCount: 1,
      rejectedSequenceCount: 1,
    })

    await client.stop()
    expect(commands.at(-1)).toEqual({ kind: 'run_stop', run_id: metadata?.runId })
    await client.dispose()
  })

  it('reopens one cached CP210x port exactly once after the first busy failure', async () => {
    let openCount = 0
    let closeCount = 0
    const gateway = createReadyGateway({
      open() {
        openCount += 1
        if (openCount === 1) throw new DOMException('busy', 'NetworkError')
      },
      close() {
        closeCount += 1
      },
    })
    installSerialWithCachedPort(gateway.port)

    const client = new WebSerialHeartRateClient(
      () => { },
      () => { },
      { handshakeTimeoutMs: 200, requestTimeoutMs: 20, retryDelayMs: 1, openRetryDelayMs: 1 },
    )
    await client.preloadAuthorizedPorts()
    const metadata = await client.start()

    expect(metadata).not.toBeNull()
    expect(openCount).toBe(2)
    expect(closeCount).toBe(1)
    await client.stop()
    expect(closeCount).toBe(2)
    await client.dispose()
  })

  it('reopens one newly selected CP210x port exactly once after the first busy failure', async () => {
    let openCount = 0
    let closeCount = 0
    const gateway = createReadyGateway({
      open() {
        openCount += 1
        if (openCount === 1) throw new DOMException('busy', 'NetworkError')
      },
      close() {
        closeCount += 1
      },
    })
    const getRequestCount = installSerialWithSelectedPort(gateway.port)

    const client = new WebSerialHeartRateClient(
      () => { },
      () => { },
      { handshakeTimeoutMs: 200, requestTimeoutMs: 20, retryDelayMs: 1, openRetryDelayMs: 1 },
    )
    const metadata = await client.start()

    expect(metadata).not.toBeNull()
    expect(getRequestCount()).toBe(1)
    expect(openCount).toBe(2)
    expect(closeCount).toBe(1)
    await client.stop()
    expect(closeCount).toBe(2)
    await client.dispose()
  })

  it('stops after two cached port open failures and reports an explicit busy error', async () => {
    let openCount = 0
    let closeCount = 0
    const gateway = createReadyGateway({
      open() {
        openCount += 1
        throw new DOMException('busy', 'NetworkError')
      },
      close() {
        closeCount += 1
      },
    })
    installSerialWithCachedPort(gateway.port)
    const statuses: Array<{ state: string; error: string | null }> = []
    const client = new WebSerialHeartRateClient(
      () => { },
      (status) => statuses.push(status),
      { handshakeTimeoutMs: 200, requestTimeoutMs: 20, retryDelayMs: 1, openRetryDelayMs: 1 },
    )
    await client.preloadAuthorizedPorts()

    expect(await client.start()).toBeNull()
    expect(openCount).toBe(2)
    expect(closeCount).toBeGreaterThanOrEqual(2)
    expect(statuses.at(-1)).toMatchObject({
      state: 'error',
      error: expect.stringContaining('두 차례'),
    })
    await client.dispose()
  })

  it('uses pre-ACK events only to align sequence when the ACK arrives six seconds later', async () => {
    vi.useFakeTimers({ now: 1_000_000 })
    const gateway = createReadyGateway({
      runStartAckDelayMs: 6_000,
      emitPreAckEvent: true,
    })
    installSerialWithCachedPort(gateway.port)
    const receivedEvents: unknown[] = []
    const client = new WebSerialHeartRateClient(
      (event) => receivedEvents.push(event),
      () => { },
      { handshakeTimeoutMs: 7_000, requestTimeoutMs: 6_500, retryDelayMs: 1 },
    )
    await client.preloadAuthorizedPorts()

    const startPromise = client.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(gateway.commands.some((command) => command.kind === 'run_start')).toBe(true)
    await vi.advanceTimersByTimeAsync(6_000)
    const metadata = await startPromise
    expect(metadata?.startedAt).toBe(1_006_000)
    expect(receivedEvents).toEqual([])
    expect(client.transportQuality()).toEqual({
      receivedEventCount: 0,
      sequenceGapCount: 0,
      rejectedSequenceCount: 0,
      lastEventAt: null,
    })

    await client.stop()
    const stoppedQuality = client.transportQuality()
    expect(
      stoppedQuality.lastEventAt === null ||
      stoppedQuality.lastEventAt >= (metadata?.startedAt ?? Number.POSITIVE_INFINITY),
    ).toBe(true)
    await client.dispose()
  })
})
