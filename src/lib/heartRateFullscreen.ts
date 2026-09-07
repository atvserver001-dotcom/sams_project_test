export interface FullscreenControlPresentation {
  label: '전체화면' | '전체화면 종료'
  action: 'enter' | 'exit'
}

export function getFullscreenControlPresentation(isFullscreen: boolean): FullscreenControlPresentation {
  return isFullscreen
    ? { label: '전체화면 종료', action: 'exit' }
    : { label: '전체화면', action: 'enter' }
}

export function fullscreenFailureMessage(action: 'enter' | 'exit', error: unknown) {
  const fallback = action === 'enter'
    ? '전체화면을 시작하지 못했습니다.'
    : '전체화면을 종료하지 못했습니다.'

  if (error instanceof Error && error.message.trim() !== '') {
    return `${fallback} ${error.message}`
  }
  return fallback
}
