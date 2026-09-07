'use client'

import { useSyncExternalStore } from 'react'
import { heartRateBridge } from '@/lib/heart-rate/bridge'

export function useHeartRateBridge() {
  useSyncExternalStore(heartRateBridge.subscribe, heartRateBridge.getRevision, () => 0)
  return heartRateBridge
}
