'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import {
  GatewayCapsMessage,
  GatewayHeartRateEvent,
  GatewayMessage,
  HeartRateTransportQuality,
  HEART_RATE_GATEWAY_HANDSHAKE_TIMEOUT_MS,
  HEART_RATE_GATEWAY_LEASE_MS,
  HEART_RATE_SERIAL_BAUD_RATE,
  NdjsonMessageDecoder,
  isExpectedGatewayIdentity,
  isExpectedGatewayStatus,
  isExpectedRunStartAck,
  isHeartRateEventForRun,
  parseHeartRateEvent,
} from '../../lib/heartRateSerial'
import { OperationGeneration } from '../../lib/operationGeneration'
import { disposeOwnedResource } from '../../lib/ownedResource'

export type WebSerialSessionState = 'idle' | 'connecting' | 'handshaking' | 'running' | 'stopping' | 'error'

export interface WebSerialRunMetadata {
  bootId: string
  gatewayId: string
  runId: string
  generation: number
  /** run_start ACK를 검증한 브라우저 시각. 안정화 공통 시계의 기준이다. */
  startedAt: number
}

export interface WebSerialRunPreparation {
  bootId: string
  gatewayId: string
  runId: string
}

export interface WebSerialStartOptions {
  /** 장치 준비와 이전 lease 정리 후, BLE 스캔을 시작하기 직전에 한 번 호출한다. */
  beforeRunStart?: (preparation: WebSerialRunPreparation) => void | Promise<void>
}

interface SerialPortInfo {
  usbVendorId?: number
  usbProductId?: number
}

interface SerialPortLike {
  readable: ReadableStream<Uint8Array> | null
  writable: WritableStream<Uint8Array> | null
  open(options: { baudRate: number }): Promise<void>
  close(): Promise<void>
  getInfo(): SerialPortInfo
}

interface SerialConnectionEventLike extends Event {
  port?: SerialPortLike
}

interface SerialApiLike {
  getPorts(): Promise<SerialPortLike[]>
  requestPort(options?: { filters?: SerialPortInfo[] }): Promise<SerialPortLike>
  addEventListener?(type: 'connect' | 'disconnect', listener: (event: Event) => void): void
  removeEventListener?(type: 'connect' | 'disconnect', listener: (event: Event) => void): void
}

interface PendingRequest {
  matches(message: GatewayMessage): boolean
  resolve(message: GatewayMessage): void
  reject(error: Error): void
  timeoutId: ReturnType<typeof setTimeout>
}

interface SessionStatus {
  state: WebSerialSessionState
  statusText: string
  error: string | null
  run: WebSerialRunMetadata | null
}

type ConnectionFailureKind = 'cancelled' | 'permission' | 'busy' | 'wrong-device' | 'disconnected' | 'transient'

class ConnectionFailure extends Error {
  constructor(
    readonly kind: ConnectionFailureKind,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'ConnectionFailure'
  }
}

class GatewayCommandFailure extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'GatewayCommandFailure'
  }
}

class GatewayRequestTimeout extends Error {
  constructor(readonly command: string) {
    super(`${command} 응답 시간이 초과되었습니다.`)
    this.name = 'GatewayRequestTimeout'
  }
}

const CP210X_FILTER: SerialPortInfo = { usbVendorId: 0x10c4, usbProductId: 0xea60 }
const HANDSHAKE_REQUEST_TIMEOUT_MS = 1_000
const HANDSHAKE_RETRY_DELAY_MS = 120

interface WebSerialClientTiming {
  handshakeTimeoutMs: number
  requestTimeoutMs: number
  retryDelayMs: number
  openRetryDelayMs: number
}

const DEFAULT_CLIENT_TIMING: WebSerialClientTiming = {
  handshakeTimeoutMs: HEART_RATE_GATEWAY_HANDSHAKE_TIMEOUT_MS,
  requestTimeoutMs: HANDSHAKE_REQUEST_TIMEOUT_MS,
  retryDelayMs: HANDSHAKE_RETRY_DELAY_MS,
  openRetryDelayMs: 120,
}

const isCp210xPort = (port: SerialPortLike) => {
  const info = port.getInfo()
  return info.usbVendorId === CP210X_FILTER.usbVendorId &&
    info.usbProductId === CP210X_FILTER.usbProductId
}

const isSerialPortLike = (value: unknown): value is SerialPortLike => (
  typeof value === 'object' && value !== null &&
  'getInfo' in value && typeof value.getInfo === 'function'
)

const delay = (durationMs: number) => new Promise<void>((resolve) => {
  setTimeout(resolve, durationMs)
})

const classifyConnectionFailure = (error: unknown): ConnectionFailure => {
  if (error instanceof ConnectionFailure) return error
  if (error instanceof DOMException) {
    if (error.name === 'NotFoundError') {
      return new ConnectionFailure('cancelled', 'USB 포트 선택이 취소되었습니다.', { cause: error })
    }
    if (error.name === 'SecurityError') {
      return new ConnectionFailure('permission', 'USB 포트 사용 권한을 확인해 주세요.', { cause: error })
    }
    if (error.name === 'InvalidStateError') {
      return new ConnectionFailure('busy', 'USB 포트를 다른 창이나 프로그램에서 사용 중입니다.', { cause: error })
    }
    if (error.name === 'NetworkError') {
      return new ConnectionFailure('busy', 'USB 포트를 열 수 없습니다. 다른 프로그램의 연결을 종료해 주세요.', { cause: error })
    }
  }

  if (error instanceof Error) {
    const normalized = error.message.toLowerCase()
    if (normalized.includes('disconnected') || normalized.includes('device has been lost')) {
      return new ConnectionFailure('disconnected', 'USB 수신기 연결이 끊어졌습니다.', { cause: error })
    }
    return new ConnectionFailure('transient', error.message, { cause: error })
  }
  return new ConnectionFailure('transient', String(error))
}

/** Exported for deterministic protocol tests; application code should use the hook below. */
export class WebSerialHeartRateClient {
  private readonly lifecycle = new OperationGeneration()
  private readonly decoder = new NdjsonMessageDecoder()
  private readonly textDecoder = new TextDecoder()
  private readonly textEncoder = new TextEncoder()
  private readonly pendingRequests = new Map<string, PendingRequest>()
  private port: SerialPortLike | null = null
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null
  private readerLoop: Promise<void> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private requestSequence = 0
  private bootId = ''
  private gatewayId = ''
  private runId = ''
  private runGeneration = 0
  private lastSequence = 0
  private transportDiagnostics: HeartRateTransportQuality = {
    receivedEventCount: 0,
    sequenceGapCount: 0,
    rejectedSequenceCount: 0,
    lastEventAt: null,
  }
  private bufferedRunEvents: GatewayHeartRateEvent[] = []
  private missedPongs = 0
  private pingBusy = false
  private closing = false
  private forcePickerNext = false
  private authorizedPorts: SerialPortLike[] = []
  private serialWithListeners: SerialApiLike | null = null
  private state: WebSerialSessionState = 'idle'
  private run: WebSerialRunMetadata | null = null
  private startPromise: Promise<WebSerialRunMetadata | null> | null = null
  private stopPromise: Promise<void> | null = null
  private disposePromise: Promise<void> | null = null
  private closePromise: Promise<void> | null = null
  private readonly timing: WebSerialClientTiming

  private readonly onSerialConnect = (event: Event) => {
    const connectionEvent = event as SerialConnectionEventLike
    const port = connectionEvent.port ?? (isSerialPortLike(event.target) ? event.target : null)
    if (!port || !isCp210xPort(port) || this.authorizedPorts.includes(port)) return
    this.authorizedPorts = [...this.authorizedPorts, port]
  }

  private readonly onSerialDisconnect = (event: Event) => {
    const connectionEvent = event as SerialConnectionEventLike
    const port = connectionEvent.port ?? (isSerialPortLike(event.target) ? event.target : null)
    if (!port) return
    this.authorizedPorts = this.authorizedPorts.filter((candidate) => candidate !== port)
    if (this.port === port) {
      this.forcePickerNext = true
      void this.failSession('USB 수신기 연결이 끊어졌습니다.')
    }
  }

  constructor(
    private readonly onHeartRate: (event: GatewayHeartRateEvent, receivedAt: number) => void,
    private readonly onStatus: (status: SessionStatus) => void,
    timing: Partial<WebSerialClientTiming> = {},
  ) {
    this.timing = { ...DEFAULT_CLIENT_TIMING, ...timing }
  }

  async preloadAuthorizedPorts() {
    const operation = this.lifecycle.capture()
    try {
      const serial = this.getSerialApi()
      this.installSerialListeners(serial)
      const ports = await serial.getPorts()
      if (!this.lifecycle.isCurrent(operation)) return
      this.authorizedPorts = ports.filter(isCp210xPort)
    } catch {
      if (!this.lifecycle.isCurrent(operation)) return
      this.authorizedPorts = []
    }
  }

  start(options: WebSerialStartOptions = {}) {
    if (this.lifecycle.isDisposed()) return Promise.resolve(null)
    if (this.startPromise) return this.startPromise
    if (this.state === 'running') return Promise.resolve(this.run)
    if (this.state === 'stopping') return Promise.resolve(null)

    const operation = this.lifecycle.begin()
    this.notify('connecting', 'USB 심박 수신기를 찾는 중입니다.', null, null)
    this.lastSequence = 0
    this.bootId = ''
    this.gatewayId = ''
    this.runId = ''
    this.runGeneration = 0
    this.run = null
    this.missedPongs = 0
    this.transportDiagnostics = {
      receivedEventCount: 0,
      sequenceGapCount: 0,
      rejectedSequenceCount: 0,
      lastEventAt: null,
    }
    this.bufferedRunEvents = []

    const promise = this.performStart(operation, options).finally(() => {
      if (this.startPromise === promise) this.startPromise = null
    })
    this.startPromise = promise
    return promise
  }

  private async performStart(operation: number, options: WebSerialStartOptions) {
    try {
      const serial = this.getSerialApi()
      this.installSerialListeners(serial)
      let ports: SerialPortLike[]

      if (this.forcePickerNext) {
        const selected = await serial.requestPort({ filters: [CP210X_FILTER] })
        this.assertCurrent(operation)
        ports = [selected]
        this.addAuthorizedPort(selected)
        this.forcePickerNext = false
      } else {
        // requestPort 앞에 다른 비동기 작업을 두지 않아 클릭의 사용자 활성 권한을 보존한다.
        ports = this.authorizedPorts
        if (ports.length === 0) {
          const selected = await serial.requestPort({ filters: [CP210X_FILTER] })
          this.assertCurrent(operation)
          ports = [selected]
          this.addAuthorizedPort(selected)
        }
      }

      let lastFailure: ConnectionFailure | null = null
      for (const port of ports) {
        this.assertCurrent(operation)
        try {
          return await this.connectPort(port, operation, options, true)
        } catch (error) {
          const failure = classifyConnectionFailure(error)
          lastFailure = failure
          if (failure.kind === 'disconnected') this.removeAuthorizedPort(port)
          await this.closeTransport()
          if (!this.lifecycle.isCurrent(operation)) return null
        }
      }

      const failure = lastFailure ?? new ConnectionFailure(
        'transient',
        '사용 가능한 USB 심박 수신기를 찾지 못했습니다.',
      )
      this.forcePickerNext = failure.kind === 'wrong-device' || failure.kind === 'disconnected'
      throw failure
    } catch (error) {
      const failure = classifyConnectionFailure(error)
      await this.closeTransport()
      if (!this.lifecycle.isCurrent(operation)) return null
      const suffix = this.forcePickerNext
        ? ' 다시 시작하면 USB 포트를 다시 선택할 수 있습니다.'
        : ''
      this.notify('error', 'USB 연결 실패', `${failure.message}${suffix}`, null)
      return null
    }
  }

  stop() {
    if (this.lifecycle.isDisposed()) return this.disposePromise ?? Promise.resolve()
    if (this.stopPromise) return this.stopPromise
    if (this.state === 'idle') return Promise.resolve()

    const operation = this.lifecycle.begin()
    this.notify('stopping', '측정을 안전하게 종료하는 중입니다.', null, this.run)
    this.clearPingTimer()

    const promise = this.performStop(operation).finally(() => {
      if (this.stopPromise === promise) this.stopPromise = null
    })
    this.stopPromise = promise
    return promise
  }

  private async performStop(operation: number) {
    try {
      if (this.writer && this.runId) {
        const runId = this.runId
        await this.sendRequest(
          'run_stop',
          { run_id: runId },
          (message) => message.kind === 'ack' && message.command === 'run_stop' && message.run_id === runId,
          1_500,
        )
        if (!this.lifecycle.isCurrent(operation)) return
      }
    } catch {
      // 장치가 분리된 경우에도 브라우저 쪽 포트와 리더는 반드시 정리한다.
    } finally {
      await this.closeTransport()
      if (this.lifecycle.isCurrent(operation)) {
        this.notify('idle', '측정이 종료되었습니다.', null, null)
      }
    }
  }

  dispose() {
    if (this.disposePromise) return this.disposePromise
    const activeStart = this.startPromise
    const activeStop = this.stopPromise
    this.lifecycle.dispose()
    this.removeSerialListeners()

    const promise = this.performDispose(activeStart, activeStop)
    this.disposePromise = promise
    return promise
  }

  private async performDispose(
    activeStart: Promise<WebSerialRunMetadata | null> | null,
    activeStop: Promise<void> | null,
  ) {
    this.clearPingTimer()
    if (activeStop) {
      try { await activeStop } catch { }
    } else if (this.writer && this.runId) {
      const runId = this.runId
      try {
        await this.sendRequest(
          'run_stop',
          { run_id: runId },
          (message) => message.kind === 'ack' && message.command === 'run_stop' && message.run_id === runId,
          500,
        )
      } catch {
        // 화면 종료 중에는 장치의 lease 만료가 최종 안전장치가 된다.
      }
    }
    await this.closeTransport()
    if (activeStart) {
      try { await activeStart } catch { }
      await this.closeTransport()
    }
  }

  private getSerialApi() {
    if (!window.isSecureContext) {
      throw new ConnectionFailure('permission', 'USB 연결은 HTTPS 또는 localhost에서만 사용할 수 있습니다.')
    }

    const serial = (navigator as Navigator & { serial?: SerialApiLike }).serial
    if (!serial) {
      throw new ConnectionFailure(
        'permission',
        '이 브라우저는 Web Serial을 지원하지 않습니다. Windows용 Chrome 또는 Edge를 사용해 주세요.',
      )
    }
    return serial
  }

  private installSerialListeners(serial: SerialApiLike) {
    if (this.serialWithListeners === serial) return
    this.removeSerialListeners()
    serial.addEventListener?.('connect', this.onSerialConnect)
    serial.addEventListener?.('disconnect', this.onSerialDisconnect)
    this.serialWithListeners = serial
  }

  private removeSerialListeners() {
    this.serialWithListeners?.removeEventListener?.('connect', this.onSerialConnect)
    this.serialWithListeners?.removeEventListener?.('disconnect', this.onSerialDisconnect)
    this.serialWithListeners = null
  }

  private addAuthorizedPort(port: SerialPortLike) {
    if (isCp210xPort(port) && !this.authorizedPorts.includes(port)) {
      this.authorizedPorts = [...this.authorizedPorts, port]
    }
  }

  private removeAuthorizedPort(port: SerialPortLike) {
    this.authorizedPorts = this.authorizedPorts.filter((candidate) => candidate !== port)
  }

  private async connectPort(
    port: SerialPortLike,
    operation: number,
    options: WebSerialStartOptions,
    retryPortOpen: boolean,
  ): Promise<WebSerialRunMetadata> {
    this.port = port
    this.closing = false
    this.decoder.reset()

    try {
      await this.openPort(port, operation, retryPortOpen)
      this.assertCurrent(operation)
      if (!port.readable || !port.writable) {
        throw new ConnectionFailure('disconnected', 'USB 포트의 읽기/쓰기 스트림을 열 수 없습니다.')
      }

      this.reader = port.readable.getReader()
      this.writer = port.writable.getWriter()
      this.readerLoop = this.readMessages()
      this.notify('handshaking', 'ATV 심박 수신기와 연결을 확인하는 중입니다.', null, null)

      let deadline = Date.now() + this.timing.handshakeTimeoutMs
      const initialCaps = await this.waitForGatewayCaps(deadline, operation)
      const readyCaps = await this.releasePreviousRun(initialCaps, deadline, operation)
      this.bootId = readyCaps.boot_id
      this.gatewayId = readyCaps.gateway_id
      this.runId = this.createToken('run')

      if (options.beforeRunStart) {
        const remainingHandshakeMs = Math.max(1, deadline - Date.now())
        await options.beforeRunStart({
          bootId: this.bootId,
          gatewayId: this.gatewayId,
          runId: this.runId,
        })
        this.assertCurrent(operation)
        // DB 준비 시간은 장치의 8초 복구 예산에 포함하지 않는다.
        deadline = Date.now() + remainingHandshakeMs
      }

      const ack = await this.startRunWithRetry(deadline, operation)
      const metadata: WebSerialRunMetadata = {
        bootId: this.bootId,
        gatewayId: this.gatewayId,
        runId: this.runId,
        generation: ack.generation as number,
        startedAt: Date.now(),
      }
      this.runGeneration = metadata.generation
      this.run = metadata
      this.alignSequenceAfterRunStart()
      this.notify('running', 'USB 수신기 연결됨 · 심박 신호를 안정화하는 중', null, metadata)
      this.startPingTimer()
      return metadata
    } catch (error) {
      if (!this.lifecycle.isCurrent(operation)) {
        await this.closeTransport()
        try { await port.close() } catch { }
      }
      throw error
    }
  }

  private async openPort(
    port: SerialPortLike,
    operation: number,
    retryPortOpen: boolean,
  ) {
    const maximumAttempts = retryPortOpen ? 2 : 1
    let lastFailure: ConnectionFailure | null = null

    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
      this.assertCurrent(operation)
      try {
        await port.open({ baudRate: HEART_RATE_SERIAL_BAUD_RATE })
        this.assertCurrent(operation)
        return
      } catch (error) {
        const failure = classifyConnectionFailure(error)
        lastFailure = failure
        const retryable = failure.kind === 'busy' || failure.kind === 'transient'
        if (!retryable || attempt === maximumAttempts) break

        try { await port.close() } catch { }
        this.assertCurrent(operation)
        await delay(this.timing.openRetryDelayMs)
      }
    }

    if (lastFailure?.kind === 'busy' && maximumAttempts === 2) {
      throw new ConnectionFailure(
        'busy',
        '승인된 USB 포트를 두 차례 열지 못했습니다. 다른 창이나 프로그램의 연결을 종료해 주세요.',
        { cause: lastFailure },
      )
    }
    throw lastFailure ?? new ConnectionFailure('transient', 'USB 포트를 열지 못했습니다.')
  }

  private async waitForGatewayCaps(deadline: number, operation: number): Promise<GatewayCapsMessage> {
    while (Date.now() < deadline) {
      this.assertCurrent(operation)
      const remainingMs = deadline - Date.now()
      try {
        const caps = await this.sendRequest(
          'hello',
          {},
          (message) => message.kind === 'caps',
          Math.max(1, Math.min(this.timing.requestTimeoutMs, remainingMs)),
        )
        this.assertCurrent(operation)
        if (!isExpectedGatewayIdentity(caps)) {
          throw new ConnectionFailure('wrong-device', '선택한 포트가 ATV 심박 수신기가 아닙니다.')
        }
        return caps
      } catch (error) {
        if (error instanceof ConnectionFailure || error instanceof GatewayCommandFailure) throw error
        if (!(error instanceof GatewayRequestTimeout)) throw error
        const retryDelay = Math.min(this.timing.retryDelayMs, Math.max(0, deadline - Date.now()))
        if (retryDelay > 0) await delay(retryDelay)
      }
    }
    throw new ConnectionFailure('transient', 'ATV 심박 수신기 준비 시간이 초과되었습니다.')
  }

  private async releasePreviousRun(
    initialCaps: GatewayCapsMessage,
    deadline: number,
    operation: number,
  ): Promise<GatewayCapsMessage> {
    let caps = initialCaps
    while (caps.state === 'running') {
      this.notify('handshaking', '이전 측정 세션을 안전하게 정리하는 중입니다.', null, null)
      this.assertDeadline(deadline)
      try {
        const status = await this.sendRequest(
          'status',
          {},
          (message) => message.kind === 'status',
          this.requestTimeoutWithin(deadline),
        )
        this.assertCurrent(operation)
        if (!isExpectedGatewayStatus(status, { bootId: caps.boot_id })) {
          throw new ConnectionFailure('wrong-device', 'USB 수신기 상태 응답이 올바르지 않습니다.')
        }
        if (status.state === 'running' && status.run_id) {
          await this.sendRequest(
            'run_stop',
            { run_id: status.run_id },
            (message) => message.kind === 'ack' &&
              message.command === 'run_stop' &&
              message.run_id === status.run_id,
            this.requestTimeoutWithin(deadline),
          )
          this.assertCurrent(operation)
        }
      } catch (error) {
        if (!(error instanceof GatewayCommandFailure) || error.code !== 'handshake_required') {
          if (!(error instanceof GatewayRequestTimeout)) throw error
        }
        // lease가 status/run_stop과 경합해 만료되면 hello부터 다시 동기화한다.
      }
      caps = await this.waitForGatewayCaps(deadline, operation)
    }
    return caps
  }

  private async startRunWithRetry(deadline: number, operation: number): Promise<GatewayMessage> {
    while (Date.now() < deadline) {
      this.assertCurrent(operation)
      try {
        const ack = await this.sendRequest(
          'run_start',
          { run_id: this.runId, lease_ms: HEART_RATE_GATEWAY_LEASE_MS },
          (message) => message.kind === 'ack' &&
            message.command === 'run_start' &&
            message.run_id === this.runId,
          this.requestTimeoutWithin(deadline),
        )
        this.assertCurrent(operation)
        if (!isExpectedRunStartAck(ack, { bootId: this.bootId, runId: this.runId })) {
          throw new ConnectionFailure('transient', '심박 측정 세션 응답이 올바르지 않습니다.')
        }
        return ack
      } catch (error) {
        if (error instanceof GatewayCommandFailure) {
          if (error.code === 'handshake_required' || error.code === 'run_in_progress') {
            const caps = await this.waitForGatewayCaps(deadline, operation)
            if (caps.boot_id !== this.bootId || caps.gateway_id !== this.gatewayId) {
              throw new ConnectionFailure('disconnected', 'USB 수신기가 연결 중 재시작되었습니다.')
            }
            if (caps.state === 'running') {
              const status = await this.sendRequest(
                'status',
                {},
                (message) => message.kind === 'status',
                this.requestTimeoutWithin(deadline),
              )
              if (!isExpectedGatewayStatus(status, { bootId: this.bootId })) {
                throw new ConnectionFailure('transient', 'USB 수신기 상태 응답이 올바르지 않습니다.')
              }
              if (status.state === 'running' && status.run_id !== this.runId) {
                throw new ConnectionFailure('busy', 'USB 수신기에 다른 측정 세션이 실행 중입니다.')
              }
            }
            continue
          }
          throw new ConnectionFailure('transient', error.message, { cause: error })
        }
        if (!(error instanceof GatewayRequestTimeout)) throw error
        // ACK 유실 가능성이 있으므로 동일한 run_id로만 재시도한다.
      }
    }
    throw new ConnectionFailure('transient', '심박 측정 세션 시작 시간이 초과되었습니다.')
  }

  private requestTimeoutWithin(deadline: number) {
    this.assertDeadline(deadline)
    return Math.max(1, Math.min(this.timing.requestTimeoutMs, deadline - Date.now()))
  }

  private assertDeadline(deadline: number) {
    if (Date.now() >= deadline) {
      throw new ConnectionFailure('transient', 'ATV 심박 수신기 준비 시간이 초과되었습니다.')
    }
  }

  private async readMessages() {
    const reader = this.reader
    if (!reader) return

    try {
      while (!this.closing) {
        const { value, done } = await reader.read()
        if (done) break
        if (!value) continue

        const text = this.textDecoder.decode(value, { stream: true })
        for (const message of this.decoder.push(text)) this.handleMessage(message)
      }

      if (!this.closing) {
        this.forcePickerNext = true
        if (this.port) this.removeAuthorizedPort(this.port)
        void this.failSession('USB 수신기 연결이 종료되었습니다.')
      }
    } catch (error) {
      if (!this.closing) {
        this.forcePickerNext = true
        if (this.port) this.removeAuthorizedPort(this.port)
        const failure = classifyConnectionFailure(error)
        void this.failSession(`USB 데이터 수신 오류: ${failure.message}`)
      }
    } finally {
      if (this.reader === reader) this.reader = null
      reader.releaseLock()
    }
  }

  private handleMessage(message: GatewayMessage) {
    if (message.request_id) {
      const pending = this.pendingRequests.get(message.request_id)
      if (pending) {
        if (message.kind === 'error') {
          clearTimeout(pending.timeoutId)
          this.pendingRequests.delete(message.request_id)
          pending.reject(new GatewayCommandFailure(
            message.code || 'device_error',
            message.message || message.code || '장치 명령 처리 오류',
          ))
        } else if (pending.matches(message)) {
          clearTimeout(pending.timeoutId)
          this.pendingRequests.delete(message.request_id)
          pending.resolve(message)
        }
      }
    }

    if (this.lifecycle.isDisposed()) return

    if (message.kind === 'status' && message.reason === 'lease_expired') {
      // 이전 lease가 handshake 중 만료되는 것은 정상 복구 경로다.
      if (this.state === 'running') {
        void this.failSession('USB 수신기와의 연결 유지 신호가 끊겼습니다.')
      }
      return
    }

    const event = parseHeartRateEvent(message)
    if (!event) return
    if (
      this.state === 'handshaking' &&
      this.runId &&
      event.boot_id === this.bootId &&
      event.run_id === this.runId
    ) {
      this.bufferedRunEvents.push(event)
      return
    }
    if (this.state !== 'running') return
    this.acceptRunEvent(event, Date.now())
  }

  private alignSequenceAfterRunStart() {
    const bufferedEvents = this.bufferedRunEvents
    this.bufferedRunEvents = []
    for (const event of bufferedEvents) {
      if (
        event.boot_id === this.bootId &&
        event.run_id === this.runId &&
        event.generation === this.runGeneration
      ) {
        this.lastSequence = Math.max(this.lastSequence, event.seq)
      }
    }
  }

  private acceptRunEvent(event: GatewayHeartRateEvent, receivedAt: number) {
    if (
      event.boot_id !== this.bootId ||
      event.run_id !== this.runId ||
      event.generation !== this.runGeneration
    ) return
    if (!isHeartRateEventForRun(event, {
      bootId: this.bootId,
      runId: this.runId,
      lastSequence: this.lastSequence,
      generation: this.runGeneration,
    })) {
      this.transportDiagnostics.rejectedSequenceCount += 1
      return
    }

    const transportSequenceGap = Math.max(0, event.seq - this.lastSequence - 1)
    this.lastSequence = event.seq
    this.transportDiagnostics.receivedEventCount += 1
    this.transportDiagnostics.sequenceGapCount += transportSequenceGap
    this.transportDiagnostics.lastEventAt = receivedAt
    this.onHeartRate(
      {
        ...event,
        transport_sequence_gap: transportSequenceGap,
        transport_received_event_count: this.transportDiagnostics.receivedEventCount,
        transport_sequence_gap_total: this.transportDiagnostics.sequenceGapCount,
        transport_rejected_sequence_count: this.transportDiagnostics.rejectedSequenceCount,
      },
      receivedAt,
    )
  }

  private sendRequest(
    kind: string,
    fields: Record<string, unknown>,
    matches: (message: GatewayMessage) => boolean,
    timeoutMs: number,
  ) {
    const requestId = this.createToken('req')
    const writer = this.writer
    if (!writer) return Promise.reject(new ConnectionFailure('disconnected', 'USB 쓰기 스트림이 열려 있지 않습니다.'))

    return new Promise<GatewayMessage>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId)
        reject(new GatewayRequestTimeout(kind))
      }, timeoutMs)

      this.pendingRequests.set(requestId, { matches, resolve, reject, timeoutId })
      const payload = `${JSON.stringify({ v: 1, kind, request_id: requestId, ...fields })}\n`
      writer.write(this.textEncoder.encode(payload)).catch((error) => {
        clearTimeout(timeoutId)
        this.pendingRequests.delete(requestId)
        reject(error instanceof Error ? error : new Error(String(error)))
      })
    })
  }

  private startPingTimer() {
    this.clearPingTimer()
    this.pingTimer = setInterval(() => { void this.exchangePing() }, 1_000)
  }

  private async exchangePing() {
    if (this.lifecycle.isDisposed() || this.state !== 'running' || this.pingBusy || !this.runId) return
    this.pingBusy = true
    const runId = this.runId

    try {
      await this.sendRequest(
        'ping',
        { run_id: runId },
        (message) => message.kind === 'pong' && message.run_id === runId && message.boot_id === this.bootId,
        800,
      )
      if (this.state !== 'running' || this.runId !== runId) return
      this.missedPongs = 0
    } catch {
      if (this.state !== 'running' || this.runId !== runId) return
      this.missedPongs += 1
      if (this.missedPongs >= 3) {
        await this.failSession('USB 수신기가 연결 유지 신호에 응답하지 않습니다.')
      }
    } finally {
      this.pingBusy = false
    }
  }

  private async failSession(message: string) {
    if (
      this.lifecycle.isDisposed() ||
      this.closing ||
      this.state === 'error' ||
      this.state === 'stopping' ||
      this.state === 'idle'
    ) return
    this.clearPingTimer()
    await this.closeTransport()
    this.notify('error', 'USB 연결 오류', message, null)
  }

  private closeTransport() {
    if (this.closePromise) return this.closePromise
    const promise = this.performCloseTransport().finally(() => {
      if (this.closePromise === promise) this.closePromise = null
    })
    this.closePromise = promise
    return promise
  }

  private async performCloseTransport() {
    this.closing = true
    this.clearPingTimer()

    for (const [requestId, pending] of this.pendingRequests) {
      clearTimeout(pending.timeoutId)
      pending.reject(new ConnectionFailure('disconnected', 'USB 연결이 종료되었습니다.'))
      this.pendingRequests.delete(requestId)
    }

    const reader = this.reader
    if (reader) {
      try { await reader.cancel() } catch { }
    }
    if (this.readerLoop) {
      try { await this.readerLoop } catch { }
    }
    this.readerLoop = null

    if (this.writer) {
      try { this.writer.releaseLock() } catch { }
      this.writer = null
    }
    if (this.port) {
      try { await this.port.close() } catch { }
      this.port = null
    }

    this.reader = null
    this.decoder.reset()
    this.textDecoder.decode()
    this.bootId = ''
    this.gatewayId = ''
    this.runId = ''
    this.runGeneration = 0
    this.run = null
    this.lastSequence = 0
    this.bufferedRunEvents = []
    this.closing = false
  }

  private clearPingTimer() {
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.pingTimer = null
    this.pingBusy = false
  }

  transportQuality(): HeartRateTransportQuality {
    return { ...this.transportDiagnostics }
  }

  private createToken(prefix: string) {
    this.requestSequence += 1
    return `${prefix}_${Date.now().toString(36)}_${this.requestSequence.toString(36)}`
  }

  private assertCurrent(operation: number) {
    if (!this.lifecycle.isCurrent(operation)) {
      throw new ConnectionFailure('transient', 'USB 연결 작업이 취소되었습니다.')
    }
  }

  private notify(
    state: WebSerialSessionState,
    statusText: string,
    error: string | null,
    run: WebSerialRunMetadata | null,
  ) {
    if (this.lifecycle.isDisposed()) return
    this.state = state
    this.onStatus({ state, statusText, error, run })
  }
}

export function useWebSerialHeartRate(
  onHeartRate: (event: GatewayHeartRateEvent, receivedAt: number) => void,
) {
  const eventHandlerRef = useRef(onHeartRate)
  const clientRef = useRef<WebSerialHeartRateClient | null>(null)
  const [session, setSession] = useState<SessionStatus>({
    state: 'idle',
    statusText: 'USB 연결 대기',
    error: null,
    run: null,
  })

  useEffect(() => {
    eventHandlerRef.current = onHeartRate
  }, [onHeartRate])

  const getClient = useCallback(() => {
    if (!clientRef.current) {
      clientRef.current = new WebSerialHeartRateClient(
        (event, receivedAt) => eventHandlerRef.current(event, receivedAt),
        setSession,
      )
    }
    return clientRef.current
  }, [])

  const start = useCallback(async (options?: WebSerialStartOptions) => (
    getClient().start(options)
  ), [getClient])

  const stop = useCallback(async () => {
    await getClient().stop()
  }, [getClient])

  const transportQuality = useCallback(() => getClient().transportQuality(), [getClient])

  useEffect(() => {
    const client = getClient()
    void client.preloadAuthorizedPorts()
    return () => { disposeOwnedResource(clientRef, client) }
  }, [getClient])

  return { ...session, start, stop, transportQuality }
}
