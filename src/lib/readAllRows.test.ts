import { describe, expect, it, vi } from 'vitest'
import { readAllRows } from './readAllRows'

describe('counted school-wide pagination', () => {
  it('reads beyond 1000 rows even when the server caps each page below the requested 500', async () => {
    const data = Array.from({ length: 1203 }, (_, id) => ({ id }))
    const query = vi.fn(async (from: number, to: number, count: boolean) => ({ data: data.slice(from, Math.min(to + 1, from + 73)), count: count ? data.length : null, error: null }))
    expect(await readAllRows(query, new AbortController().signal)).toEqual(data)
    expect(query.mock.calls.filter(call => call[2])).toHaveLength(1)
    expect(query.mock.calls.at(-1)?.[0]).toBe(1168)
  })
  it('does not issue an extra request on an exact page boundary or an empty result', async () => {
    const query = vi.fn(async (from: number) => ({ data: Array.from({ length: 500 }, (_, id) => from + id), count: 1000, error: null }))
    expect(await readAllRows(query, new AbortController().signal)).toHaveLength(1000)
    expect(query).toHaveBeenCalledTimes(2)
    const empty = vi.fn(async () => ({ data: [], count: 0, error: null }))
    expect(await readAllRows(empty, new AbortController().signal)).toEqual([])
    expect(empty).toHaveBeenCalledTimes(1)
  })
  it('does not silently accept missing counts, database failures or a truncated stream', async () => {
    const signal = new AbortController().signal
    await expect(readAllRows(async () => ({ data: [1], count: null, error: null }), signal)).rejects.toThrow('건수')
    await expect(readAllRows(async () => ({ data: null, count: null, error: { message: 'database failure' } }), signal)).rejects.toThrow('database failure')
    await expect(readAllRows(async () => ({ data: [], count: 8, error: null }), signal)).rejects.toThrow('변경')
  })
  it('cancels further page reads after a stale request is aborted', async () => {
    const controller = new AbortController()
    const query = vi.fn(async () => { controller.abort(); return { data: [1], count: 50, error: null } })
    await expect(readAllRows(query, controller.signal)).rejects.toThrow()
    expect(query).toHaveBeenCalledTimes(1)
  })
})
