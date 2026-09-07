interface QueryPage<T> {
  data: T[] | null
  count: number | null
  error: { message: string } | null
}

// A counted first page prevents a configured PostgREST row cap from silently
// truncating a school-wide result. Advance by returned rows, not requested size.
export async function readAllRows<T>(
  readPage: (from: number, to: number, includeCount: boolean) => PromiseLike<QueryPage<T>>,
  signal: AbortSignal,
): Promise<T[]> {
  const rows: T[] = []
  let total: number | null = null
  do {
    signal.throwIfAborted()
    const page = await readPage(rows.length, rows.length + 499, total === null)
    signal.throwIfAborted()
    if (page.error) throw new Error(page.error.message)
    if (total === null) {
      if (page.count === null) throw new Error('전체 조회 건수를 확인하지 못했습니다.')
      total = page.count
    }
    const data = page.data ?? []
    if (data.length === 0 && rows.length < total) throw new Error('조회 중 데이터가 변경되었습니다. 다시 조회해 주세요.')
    rows.push(...data)
  } while (rows.length < total)
  return rows
}
