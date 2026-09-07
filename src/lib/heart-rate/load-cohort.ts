// The roster is required; a failed monthly-record read still permits an empty
// record display for that roster. Start both independent reads together.
export async function loadCohortInParallel<Student, Row>(
  readStudents: () => Promise<Student[]>,
  readRecords: () => Promise<Row[]>,
  signal: AbortSignal,
) {
  const [studentsResult, recordsResult] = await Promise.allSettled([readStudents(), readRecords()])
  signal.throwIfAborted()
  if (studentsResult.status === 'rejected') throw studentsResult.reason
  const students = studentsResult.value
  return {
    students,
    rows: students.length && recordsResult.status === 'fulfilled' ? recordsResult.value : [],
    recordsError: students.length && recordsResult.status === 'rejected' ? recordsResult.reason as unknown : null,
  }
}
