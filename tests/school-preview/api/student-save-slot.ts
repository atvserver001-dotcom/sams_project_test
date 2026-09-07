import { randomUUID } from 'node:crypto'
import { emptyRecords, type FixtureState } from './fixtures'
import { classroom, fail, integer, sameClass, studentInput, uniqueStudent } from './validation'

// In-memory counterpart of immutable 5e55cdd save_student_slot. Existing preview
// field/year validation still applies; no production API or database is imported.
export function savePreviewStudentSlot(state: FixtureState, body: Record<string, unknown>, schoolId: string) {
  const { id, source_student_no, ...fields } = body
  const scope = classroom(fields)
  const number = integer(fields.student_no, 'student_no', 1, 30)
  const source = source_student_no == null ? null : integer(source_student_no, 'source_student_no', 1, 30)
  const studentId = typeof id === 'string' && id.trim() ? id : null
  const current = studentId ? state.students.find(student => student.id === studentId && student.school_id === schoolId) : undefined
  if (studentId && !current) fail(400, 'student not found')
  const target = state.students.find(student => student.school_id === schoolId && sameClass(student, scope) && student.student_no === number && student.id !== studentId)
  const moveTarget = !!target && (!!current || (source !== null && source !== number))

  if (current && target && !Array.from({ length: 20 }, (_, i) => i + 31).some(buffer =>
    !state.students.some(student => student.school_id === schoolId && sameClass(student, scope) && student.student_no === buffer))) {
    fail(409, '번호 이동을 위한 임시 번호가 없습니다.')
  }
  if (!current && moveTarget && state.students.some(student => student.school_id === schoolId && sameClass(student, scope) && student.student_no === source && student.id !== target?.id)) {
    fail(409, '원래 번호에 이미 학생데이터가 있어 번호를 이동할 수 없습니다.')
  }

  const savedId = current?.id ?? (!moveTarget ? target?.id : undefined) ?? `preview-created-${randomUUID()}`
  const saved = studentInput(fields, savedId, schoolId)
  const staged = state.students.map(student => {
    if (student.id === saved.id) return saved
    if (moveTarget && student.id === target?.id) return { ...student, ...scope, student_no: current?.student_no ?? source! }
    return student
  })
  if (!staged.some(student => student.id === saved.id)) staged.push(saved)
  for (const student of staged) uniqueStudent(staged, student)

  // No await between validation and commit; readers never observe half a swap.
  state.students = staged
  if (!state.records.has(saved.id)) state.records.set(saved.id, emptyRecords(saved.year))
  return saved
}
