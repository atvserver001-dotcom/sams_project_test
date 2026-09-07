import { PREVIEW_YEAR, PREVIEW_YEARS, type Student } from './fixtures'

export class PreviewError extends Error {
  constructor(public status: number, message: string) { super(message) }
}
export function fail(status: number, message: string): never { throw new PreviewError(status, message) }
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'JSON object required.')
  return value as Record<string, unknown>
}
export async function bodyOf(request: Request) {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') fail(415, 'Content-Type application/json required.')
  let value: unknown
  try { value = await request.json() } catch { fail(400, 'Invalid JSON body.') }
  return object(value)
}

export function keys(body: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(body).some(key => !allowed.includes(key))) fail(400, 'Unsupported field.')
}
export function integer(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) fail(400, `${label}: invalid integer.`)
  return value
}
export function string(value: unknown, label: string, max: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim())) fail(400, `${label}: invalid string.`)
  return value
}
export function previewYear(value: unknown): number {
  const year = integer(value, 'year', 1900, 9999)
  if (!(PREVIEW_YEARS as readonly number[]).includes(year)) fail(400, 'Preview writes support academic years 2025 and 2026 only.')
  return year
}
export type Classroom = { year: number; grade: number; class_no: number }
export function classroom(body: Record<string, unknown>): Classroom {
  return { year: previewYear(body.year), grade: integer(body.grade, 'grade', 1, 6), class_no: integer(body.class_no, 'class_no', 1, 99) }
}
export function sameClass(student: Student, scope: Classroom, allYears = false): boolean {
  return (allYears || student.year === scope.year) && student.grade === scope.grade && student.class_no === scope.class_no
}
export function queryClass(params: URLSearchParams, defaultYear = false): Classroom {
  const read = (key: string, min: number, max: number) => {
    const raw = params.get(key)
    if (raw === null && key === 'year' && defaultYear) return PREVIEW_YEAR
    if (raw === null || !/^\d+$/.test(raw) || params.getAll(key).length !== 1) fail(400, `${key}: required integer query parameter.`)
    return integer(Number(raw), key, min, max)
  }
  return { year: read('year', 1900, 9999), grade: read('grade', 1, 6), class_no: read('class_no', 1, 99) }
}

const STUDENT_FIELDS = ['year', 'grade', 'class_no', 'student_no', 'name', 'gender', 'birth_date', 'email', 'height_cm', 'weight_kg', 'notes']
export function studentInput(body: Record<string, unknown>, id: string, schoolId: string, previous?: Student): Student {
  keys(body, STUDENT_FIELDS)
  if (!Object.keys(body).length) fail(400, 'Student changes required.')
  const value = { year: PREVIEW_YEAR, gender: null, birth_date: null, email: null, height_cm: null, weight_kg: null, notes: null, ...previous, ...body }
  const nullableText = (key: string, limit: number) => value[key as keyof typeof value] === null ? null : string(value[key as keyof typeof value], key, limit, true)
  const birth_date = nullableText('birth_date', 10)
  if (birth_date !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(birth_date) || !Number.isFinite(Date.parse(birth_date)) || new Date(birth_date).toISOString().slice(0, 10) !== birth_date)) fail(400, 'birth_date: valid YYYY-MM-DD required.')
  const email = nullableText('email', 254)
  if (email !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'email: invalid address.')
  const gender = value.gender
  if (gender !== null && gender !== 'M' && gender !== 'F') fail(400, 'gender: M, F or null required.')
  const size = (value: unknown, label: string) => {
    if (value === null) return null
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) fail(400, `${label}: nonnegative number or null required.`)
    return value
  }
  return {
    id, school_id: schoolId, ...classroom(value),
    // PATCH supports both the legacy zero buffer and the current editor's vacant 1..50 buffer.
    student_no: integer(value.student_no, 'student_no', previous ? 0 : 1, previous ? 50 : 30),
    name: string(value.name, 'name', 100).trim(), gender, birth_date, email,
    height_cm: size(value.height_cm, 'height_cm'), weight_kg: size(value.weight_kg, 'weight_kg'), notes: nullableText('notes', 4000),
  }
}
export function uniqueStudent(students: Student[], candidate: Student) {
  if (students.some(student => student.id !== candidate.id && sameClass(student, candidate) && student.student_no === candidate.student_no)) fail(409, '해당 번호에 존재하는 학생데이터가 있습니다.')
}
