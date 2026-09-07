import type {
  HeartRateCheckpointResponse,
  HeartRateDiscardResponse,
  HeartRateMinutePoint,
  HeartRateSessionPayload,
  HeartRateTransportQuality,
  StartHeartRateSessionRequest,
} from './heartRateSession'

const SESSION_ENDPOINT = '/api/school/heart-rate/sessions'

export class HeartRateSessionApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'HeartRateSessionApiError'
  }
}

async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })

  const payload = await response.json().catch(() => null) as { error?: unknown } | null
  if (!response.ok) {
    const message = typeof payload?.error === 'string'
      ? payload.error
      : '심박 측정 세션 요청을 처리하지 못했습니다.'
    throw new HeartRateSessionApiError(message, response.status)
  }
  return payload as T
}

export function startHeartRateSession(request: StartHeartRateSessionRequest): Promise<HeartRateSessionPayload> {
  return requestJson<HeartRateSessionPayload>(SESSION_ENDPOINT, {
    method: 'POST',
    body: JSON.stringify(request),
  })
}

export function getHeartRateSession(sessionId: string): Promise<HeartRateSessionPayload> {
  return requestJson<HeartRateSessionPayload>(`${SESSION_ENDPOINT}/${encodeURIComponent(sessionId)}`)
}

export function stabilizeHeartRateSession(
  sessionId: string,
  gatewayRunId: string,
  runStartedAt: string,
): Promise<HeartRateSessionPayload> {
  return requestJson<HeartRateSessionPayload>(`${SESSION_ENDPOINT}/${encodeURIComponent(sessionId)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      action: 'stabilize',
      gateway_run_id: gatewayRunId,
      run_started_at: runStartedAt,
    }),
  })
}

export function checkpointHeartRateSession(
  sessionId: string,
  points: HeartRateMinutePoint[],
  transportQuality: HeartRateTransportQuality,
): Promise<HeartRateCheckpointResponse> {
  return requestJson<HeartRateCheckpointResponse>(`${SESSION_ENDPOINT}/${encodeURIComponent(sessionId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ action: 'checkpoint', points, transport_quality: transportQuality }),
  })
}

export function stopHeartRateSession(
  sessionId: string,
  points: HeartRateMinutePoint[],
  transportQuality: HeartRateTransportQuality,
): Promise<HeartRateSessionPayload> {
  return requestJson<HeartRateSessionPayload>(`${SESSION_ENDPOINT}/${encodeURIComponent(sessionId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ action: 'stop', points, transport_quality: transportQuality }),
  })
}

export function finalizeHeartRateSession(sessionId: string): Promise<HeartRateSessionPayload> {
  return requestJson<HeartRateSessionPayload>(`${SESSION_ENDPOINT}/${encodeURIComponent(sessionId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ action: 'finalize' }),
  })
}

export function discardHeartRateSession(sessionId: string): Promise<HeartRateDiscardResponse> {
  return requestJson<HeartRateDiscardResponse>(`${SESSION_ENDPOINT}/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
  })
}
