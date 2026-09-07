import { randomUUID } from 'node:crypto'
import {
  CONTENTS, PAPS_REFERENCE_NOTICE, PREVIEW_CREDENTIALS, PREVIEW_SCHOOL, PREVIEW_YEARS,
  makeFixtures, type FixtureState,
} from './fixtures'
import { PAPS_GRADE_REFERENCES } from './paps-reference'
import { handleSchoolDataRequest, schoolDataRouteFor } from './school-data'
import { PreviewError, bodyOf, fail, keys } from './validation'
import { savePreviewStudentSlot } from './student-save-slot'

export const PREVIEW_COOKIE_NAME = 'atvcms_school_preview_session_v1'
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000
export const MAX_SESSIONS = 128
type Session = { origin: string; authenticated: boolean; touchedAt: number; state: FixtureState }
// A single Node worker owns preview state; this symbol also survives Next dev module reloads.
const storeKey = Symbol.for('atvcms.school-preview.sessions.v1')
const globals = globalThis as typeof globalThis & { [storeKey]?: Map<string, Session> }
const sessions = globals[storeKey] ??= new Map<string, Session>()

type Route = { methods: string[]; kind: string }
function routeFor(path: string): Route | null {
  const routes: Record<string, Route> = {
    '/api/preview/status': { methods: ['GET'], kind: 'status' },
    '/api/preview/reset': { methods: ['POST'], kind: 'reset' },
    '/api/auth/me': { methods: ['GET'], kind: 'me' },
    '/api/auth/signin': { methods: ['POST'], kind: 'signin' },
    '/api/auth/signout': { methods: ['POST'], kind: 'signout' },
    '/api/school/students/save-slot': { methods: ['POST'], kind: 'save-slot' },
  }
  return Object.hasOwn(routes, path) ? routes[path] : schoolDataRouteFor(path)
}

function guard(request: Request, url: URL) {
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) fail(403, 'School preview is restricted to loopback hosts.')
  // Next 15 can reconstruct request.url with localhost even when the browser used 127.0.0.1.
  // Trust only a literal loopback Host on the same port, never a forwarded/external hostname.
  const host = request.headers.get('host')
  const original = new URL(url)
  if (host !== null) {
    if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(host)) fail(403, 'Preview Host must be a literal loopback host.')
    const port = /:(\d+)$/.exec(host)?.[1]
    if (port !== undefined && (Number(port) < 1 || Number(port) > 65535)) fail(403, 'Invalid preview Host port.')
    const candidate = new URL(`${url.protocol}//${host}`)
    if (candidate.port !== url.port) fail(403, 'Preview Host port does not match request URL.')
    original.host = candidate.host
  }
  const forwardedPort = request.headers.get('x-forwarded-port')
  if (forwardedPort !== null && forwardedPort !== (original.port || (original.protocol === 'https:' ? '443' : '80'))) fail(403, 'Forwarded preview port does not match Host.')
  for (const header of ['x-forwarded-host', 'x-forwarded-proto', 'forwarded']) {
    const value = request.headers.get(header)
    if (value === null) continue
    if (header === 'forwarded' || (header === 'x-forwarded-host' && value.toLowerCase() !== original.host) || (header === 'x-forwarded-proto' && value !== url.protocol.slice(0, -1))) fail(403, 'Forwarded preview requests are not supported.')
  }
  const site = request.headers.get('sec-fetch-site')
  if (site && site !== 'same-origin' && site !== 'none') fail(403, 'Cross-origin preview requests are not allowed.')
  if (['POST', 'PATCH', 'DELETE', 'PUT'].includes(request.method) && request.headers.get('origin') !== original.origin) fail(403, 'Same-origin Origin header required for preview writes.')
  return original
}

function sessionFor(request: Request, url: URL, kind: string) {
  const now = Date.now()
  for (const [id, session] of sessions) if (now - session.touchedAt >= SESSION_TTL_MS) sessions.delete(id)
  const cookie = (request.headers.get('cookie') ?? '').split(';').map(value => value.trim()).find(value => value.startsWith(`${PREVIEW_COOKIE_NAME}=`))
  const suppliedId = cookie?.slice(PREVIEW_COOKIE_NAME.length + 1)
  const existing = suppliedId ? sessions.get(suppliedId) : undefined
  if (existing && existing.origin === url.origin) {
    existing.touchedAt = now
    return { id: suppliedId!, session: existing, created: false }
  }
  if (sessions.size >= MAX_SESSIONS) fail(503, 'Preview session capacity reached. Retry after idle sessions expire.')
  const id = randomUUID()
  const session: Session = {
    origin: url.origin, touchedAt: now,
    // Signout keeps this cookie. A stale/unknown cookie must not silently restore authentication.
    authenticated: !cookie && kind !== 'signin' && kind !== 'signout', state: makeFixtures(),
  }
  sessions.set(id, session)
  return { id, session, created: true }
}

const user = { id: 'preview-teacher-1', username: PREVIEW_CREDENTIALS.username, role: 'school', schoolId: PREVIEW_SCHOOL.id, isActive: true }
function status(session: Session) {
  return {
    preview: true, synthetic: true, schoolId: PREVIEW_SCHOOL.id, schoolName: PREVIEW_SCHOOL.name,
    authenticated: session.authenticated, years: PREVIEW_YEARS,
    counts: { students: session.state.students.length, heartMonths: [...session.state.records.values()].reduce((n, value) => n + value.heart.size, 0), mappings: session.state.mappings.length, devices: session.state.devices.length },
    persistence: 'Per-browser cookie; in-memory, single worker; lost on server restart or 12 hours of inactivity.',
    papsReference: { source: 'temp/insert_paps_grade.sql', count: PAPS_GRADE_REFERENCES.length, notice: PAPS_REFERENCE_NOTICE },
    unsupported: ['device-pages', 'device-page-blocks', 'device-assets', 'device-ingest'],
  }
}

export async function handlePreviewRequest(request: Request): Promise<Response> {
  const headers = new Headers({ 'Cache-Control': 'no-store, no-cache, max-age=0, must-revalidate', Pragma: 'no-cache', Expires: '0', Vary: 'Cookie, Origin', 'X-Content-Type-Options': 'nosniff', 'X-School-Preview': 'synthetic' })
  const respond = (body: unknown, status = 200) => {
    if (request.method === 'HEAD' || status === 204) return new Response(null, { status, headers })
    headers.set('Content-Type', 'application/json; charset=utf-8')
    return new Response(JSON.stringify(body), { status, headers })
  }
  try {
    const url = guard(request, new URL(request.url))
    const route = routeFor(url.pathname)
    if (!route) fail(404, 'Unknown preview API route.')
    if (!route.methods.includes(request.method)) {
      headers.set('Allow', route.methods.join(', '))
      return respond({ error: 'Method not allowed in preview.' }, 405)
    }
    const { session, id, created } = sessionFor(request, url, route.kind)
    if (created) headers.set('Set-Cookie', `${PREVIEW_COOKIE_NAME}=${id}; Path=/; HttpOnly; SameSite=Strict${url.protocol === 'https:' ? '; Secure' : ''}`)
    if (route.kind === 'status') return respond(status(session))
    if (route.kind === 'signin') {
      const body = await bodyOf(request)
      keys(body, ['username', 'password'])
      if (body.username !== PREVIEW_CREDENTIALS.username || body.password !== PREVIEW_CREDENTIALS.password) fail(401, 'Use the documented preview credentials only: preview_teacher / preview-only.')
      session.authenticated = true
      return respond({ user })
    }
    if (route.kind === 'signout') { session.authenticated = false; return respond({ success: true }) }
    if (!session.authenticated) fail(401, 'Preview teacher is signed out.')
    const state = session.state
    switch (route.kind) {
      case 'reset': session.state = makeFixtures(); return respond({ success: true, ...status(session) })
      case 'me': return respond({ user })
      case 'save-slot': return respond({ student: savePreviewStudentSlot(state, await bodyOf(request), PREVIEW_SCHOOL.id) })
      default: {
        const response = await handleSchoolDataRequest(request, state, {
          school: PREVIEW_SCHOOL,
          contents: CONTENTS,
          devices: state.devices.map(device => ({ device_id: device.device_id, device_name: device.device_name, start_date: '2025-03-01', end_date: null, limited_period: false })),
        })
        headers.forEach((value, key) => response.headers.set(key, value))
        return response
      }
    }
  } catch (error) {
    if (error instanceof PreviewError) return respond({ error: error.message }, error.status)
    return respond({ error: 'Isolated preview request failed.' }, 500)
  }
}
