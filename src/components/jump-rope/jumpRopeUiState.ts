import type { WebSerialJumpRopeState } from './useWebSerialJumpRope'

export function isJumpRopeConnectionContextLocked(
  state: WebSerialJumpRopeState,
  hasConnection: boolean,
) {
  return hasConnection ||
    state === 'connecting' ||
    state === 'handshaking' ||
    state === 'configuring' ||
    state === 'disconnecting'
}

export function isJumpRopeConnectionActionBusy(state: WebSerialJumpRopeState) {
  return state === 'connecting' ||
    state === 'handshaking' ||
    state === 'configuring' ||
    state === 'starting' ||
    state === 'running' ||
    state === 'finishing' ||
    state === 'disconnecting'
}

export function isJumpRopeMeasurementConfigLocked(
  state: WebSerialJumpRopeState,
  hasConnection: boolean,
) {
  return state === 'starting' ||
    state === 'running' ||
    state === 'finishing' ||
    state === 'reconnecting' ||
    (state === 'error' && hasConnection)
}

export function getJumpRopeSlotLifecycleLabel(state: WebSerialJumpRopeState) {
  if (state === 'connected') return '시작 신호 대기'
  if (state === 'starting') return '시작 신호 확인 중'
  if (state === 'finishing') return '끝 신호 확인 중'
  if (state === 'reconnecting') return 'JR203 재연결 중'
  if (state === 'disconnecting') return '연결 해제 중'
  return null
}

export function shouldClearJumpRopeMeasurementUi(
  state: WebSerialJumpRopeState,
  hasConnection: boolean,
) {
  return state === 'reconnecting' || (state === 'error' && !hasConnection)
}

export function shouldApplyJumpRopeMeasurementCompletion(
  requestGeneration: number,
  currentGeneration: number,
) {
  return requestGeneration === currentGeneration
}
