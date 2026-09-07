import { describe, expect, it, vi } from 'vitest'
import { loadCohortInParallel } from './load-cohort'

describe('independent heart-rate reads', () => {
  it('starts records before the roster finishes', async () => {
    let release!: (students: string[]) => void
    const roster = new Promise<string[]>(resolve => { release = resolve })
    const records = vi.fn(async () => [80])
    const pending = loadCohortInParallel(() => roster, records, new AbortController().signal)
    expect(records).toHaveBeenCalledTimes(1)
    release(['student'])
    expect(await pending).toEqual({ students: ['student'], rows: [80], recordsError: null })
  })
  it('retains the roster on record failure, but fails when the roster is unavailable', async () => {
    const error = new Error('record failure')
    expect(await loadCohortInParallel(async () => ['student'], async () => { throw error }, new AbortController().signal)).toEqual({ students: ['student'], rows: [], recordsError: error })
    await expect(loadCohortInParallel(async () => { throw new Error('roster failure') }, async () => [80], new AbortController().signal)).rejects.toThrow('roster failure')
    expect(await loadCohortInParallel(async () => [], async () => { throw error }, new AbortController().signal)).toEqual({ students: [], rows: [], recordsError: null })
  })
  it('rejects results from a canceled class selection', async () => {
    const controller = new AbortController()
    const pending = loadCohortInParallel(async () => ['old-class'], async () => { controller.abort(); return [80] }, controller.signal)
    await expect(pending).rejects.toThrow()
  })
})
