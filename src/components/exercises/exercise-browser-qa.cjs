// Isolated browser fixtures for Playwright CLI only; never imported by the app.
// eslint-disable-next-line @typescript-eslint/no-unused-expressions
async (page) => {
  const students = Array.from({ length: 35 }, (_, index) => ({ id: `qa-${index + 1}`, student_no: index + 1, name: `검증학생${String(index + 1).padStart(2, '0')}`, grade: 1, class_no: 1 }))
  const months = value => [null, null, value, value + 4, value + 2, 0, null, value + 8, value + 10, null, null, null]
  const rows = students.map((student, index) => ({ ...student, student_id: student.id, minutes: months(30 + index), minutes_c1: months(10 + index), minutes_c2: months(12), minutes_c3: months(8), avg_bpm: months(122 + index / 2), max_bpm: months(154 + index / 2), accuracy: months(80 + index / 3), calories: months(100 + index * 3) }))
  page.__samsQA = { writes: [], reads: [], errors: [], mode: 'data' }
  page.on('pageerror', error => page.__samsQA.errors.push(error.message))
  await page.unroute('**/api/**')
  await page.route('**/api/**', async route => {
    const request = route.request()
    const url = await page.evaluate(value => {
      const parsed = new URL(value)
      return { pathname: parsed.pathname, search: parsed.search, grade: parsed.searchParams.get('grade'), classNo: parsed.searchParams.get('class_no') }
    }, request.url())
    const path = url.pathname
    if (request.method() !== 'GET') page.__samsQA.writes.push(path)
    page.__samsQA.reads.push(url.pathname + url.search)
    const school = { id: 'qa-school', name: '검증학교', school_type: 1 }
    let payload = { items: [] }
    if (path === '/api/auth/me') payload = { user: { id: 'qa-account', username: 'qa_only', role: 'school', schoolId: school.id, isActive: true } }
    if (path === '/api/school/info') payload = { school }
    if (path === '/api/school/contents') payload = { items: [{ school_content_id: 'qa-content', name: '운동기록관리', start_date: '2026-03-01', end_date: null, is_unlimited: true }] }
    const populated = url.grade === '1' && url.classNo === '1'
    if (path === '/api/school/students') payload = { students: populated && page.__samsQA.mode !== 'empty' ? students : [] }
    if (path === '/api/school/exercises') {
      if (page.__samsQA.mode === 'error') return route.fulfill({ status: 500, json: { error: 'QA 조회 오류' } })
      payload = { rows: populated && page.__samsQA.mode !== 'empty' ? rows : [] }
    }
    await route.fulfill({ status: 200, json: payload })
  })
  await page.goto('http://127.0.0.1:18472/school/exercises')
  await page.getByRole('region', { name: '학생별 월간 기록, 가로 및 세로 스크롤' }).waitFor()
  console.log({ headings: await page.locator('h1,h2').allTextContents(), errors: page.__samsQA.errors })
}
