export class PreviewError extends Error {
  constructor(public status: number, message: string) { super(message) }
}
export function fail(status: number, message: string): never { throw new PreviewError(status, message) }
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'JSON object required.')
  return value as Record<string, unknown>
}
export function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) fail(400, 'Unsupported request field.')
}
export function string(value: unknown, field: string, max = 200, empty = false): string {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) fail(400, `${field}: valid string required.`)
  return value
}
export function integer(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) fail(400, `${field}: integer from ${min} to ${max} required.`)
  return value
}
export function boolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') fail(400, `${field}: boolean required.`)
  return value
}
export function array(value: unknown, field: string, max = 1000): unknown[] {
  if (!Array.isArray(value) || value.length > max) fail(400, `${field}: array with at most ${max} entries required.`)
  return value
}
export function ids(value: unknown, field: string): string[] {
  const result = array(value, field).map(item => string(item, field))
  if (new Set(result).size !== result.length) fail(409, `${field}: duplicate ID.`)
  return result
}
export function date(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null
  const result = string(value, field, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(Date.parse(result)) || new Date(result).toISOString().slice(0, 10) !== result) fail(400, `${field}: valid YYYY-MM-DD date required.`)
  return result
}
export function groupNumber(value: unknown): string {
  const result = string(value, 'group_no', 4)
  if (!/^\d{4}$/.test(result)) fail(400, 'group_no: four digits required.')
  return result
}
export async function bodyOf(request: Request) {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') fail(415, 'Content-Type application/json required.')
  let value: unknown
  try { value = await request.json() } catch { fail(400, 'Invalid JSON body.') }
  return object(value)
}
export function paginate<T>(items: T[], params: URLSearchParams) {
  const page = integer(Number(params.get('page') ?? 1), 'page', 1, 1000000)
  const pageSize = integer(Number(params.get('pageSize') ?? 10), 'pageSize', 1, 1000)
  return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, pageSize }
}
