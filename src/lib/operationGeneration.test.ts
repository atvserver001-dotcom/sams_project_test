import { describe, expect, it } from 'vitest'

import { OperationGeneration } from './operationGeneration'

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

describe('OperationGeneration', () => {
  it('invalidates a pending open operation before it resumes', async () => {
    const operations = new OperationGeneration()
    const opened = deferred<void>()
    const operation = operations.begin()
    let continuedAfterOpen = false

    const connect = async () => {
      await opened.promise
      if (!operations.isCurrent(operation)) return
      continuedAfterOpen = true
    }

    const pendingConnect = connect()
    operations.invalidate()
    opened.resolve()
    await pendingConnect

    expect(continuedAfterOpen).toBe(false)
  })

  it('permanently rejects captured operations after disposal', () => {
    const operations = new OperationGeneration()
    const operation = operations.begin()

    operations.dispose()

    expect(operations.isDisposed()).toBe(true)
    expect(operations.isCurrent(operation)).toBe(false)
    expect(operations.isCurrent(operations.begin())).toBe(false)
  })
})
