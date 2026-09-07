import { afterEach, describe, expect, it, vi } from 'vitest'

import { config, middleware } from './middleware'

describe('device API middleware', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('matches every device API path', () => {
    expect(config.matcher).toBe('/api/device/:path*')
  })

  it('returns a non-cacheable not-found response when the device API is disabled', async () => {
    vi.stubEnv('DEVICE_API_ENABLED', 'false')

    const response = middleware()

    expect(response.status).toBe(404)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual({ error: 'Not Found' })
  })

  it('continues the request when the device API is enabled', () => {
    vi.stubEnv('DEVICE_API_ENABLED', 'true')

    const response = middleware()

    expect(response.headers.get('x-middleware-next')).toBe('1')
  })
})
