import { describe, expect, it, vi } from 'vitest'

import { disposeOwnedResource, OwnedResourceRef } from './ownedResource'

interface TestClient {
  id: number
  dispose(): void
}

describe('disposeOwnedResource', () => {
  it('creates a fresh client after the StrictMode setup-cleanup-setup cycle', () => {
    const ref: OwnedResourceRef<TestClient> = { current: null }
    let sequence = 0
    const getClient = () => {
      if (!ref.current) {
        ref.current = { id: ++sequence, dispose: vi.fn() }
      }
      return ref.current
    }

    const firstClient = getClient()
    disposeOwnedResource(ref, firstClient)
    const secondClient = getClient()

    expect(firstClient.dispose).toHaveBeenCalledOnce()
    expect(secondClient).not.toBe(firstClient)
    expect(secondClient.id).toBe(2)
  })

  it('does not detach a replacement client when an older cleanup runs', () => {
    const firstClient: TestClient = { id: 1, dispose: vi.fn() }
    const secondClient: TestClient = { id: 2, dispose: vi.fn() }
    const ref: OwnedResourceRef<TestClient> = { current: secondClient }

    disposeOwnedResource(ref, firstClient)

    expect(ref.current).toBe(secondClient)
    expect(firstClient.dispose).toHaveBeenCalledOnce()
    expect(secondClient.dispose).not.toHaveBeenCalled()
  })
})
