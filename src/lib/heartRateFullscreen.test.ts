import { describe, expect, it } from 'vitest'

import {
  fullscreenFailureMessage,
  getFullscreenControlPresentation,
} from './heartRateFullscreen'

describe('heart-rate fullscreen presentation', () => {
  it('changes the accessible action when the board enters fullscreen', () => {
    expect(getFullscreenControlPresentation(false)).toEqual({
      label: '전체화면',
      action: 'enter',
    })
    expect(getFullscreenControlPresentation(true)).toEqual({
      label: '전체화면 종료',
      action: 'exit',
    })
  })

  it('keeps fullscreen failures non-destructive and understandable', () => {
    expect(fullscreenFailureMessage('enter', new Error('권한이 거부되었습니다.')))
      .toBe('전체화면을 시작하지 못했습니다. 권한이 거부되었습니다.')
    expect(fullscreenFailureMessage('exit', null))
      .toBe('전체화면을 종료하지 못했습니다.')
  })
})
