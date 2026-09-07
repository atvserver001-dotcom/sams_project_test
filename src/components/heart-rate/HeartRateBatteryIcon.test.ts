import { describe, expect, it } from 'vitest'

import { getHeartRateBatteryLevel } from './heartRateVisualization'

describe('getHeartRateBatteryLevel', () => {
  it.each([
    [0, 1],
    [25, 1],
    [26, 2],
    [50, 2],
    [51, 3],
    [75, 3],
    [76, 4],
    [100, 4],
  ] as const)('%s%%를 %s단계로 표시한다', (percent, expected) => {
    expect(getHeartRateBatteryLevel(percent)).toBe(expected)
  })

  it.each([null, undefined, -1, 101, Number.NaN])(
    '%s는 배터리 정보 없음으로 처리한다',
    (percent) => {
      expect(getHeartRateBatteryLevel(percent)).toBeNull()
    },
  )
})
