import { randomUUID } from 'node:crypto'
import { handleSchoolDataRequest, schoolDataRouteFor } from '../../school-preview/api/school-data'
import { makeAdminFixtures, PREVIEW_ADMIN_ID, PREVIEW_CREDENTIALS, PREVIEW_YEARS, type Account, type AdminFixtureState } from './fixtures'
import { contentView, find, findSchool, removeContent, removeDevice, removeSchool, reorderDevices, saveAccount, saveContent, saveDevice, saveSchool, schoolDetails, schoolScope, schoolView } from './model'
import { PreviewError, bodyOf, fail, groupNumber, keys, paginate, string } from './validation'

export const PREVIEW_COOKIE_NAME = 'atvcms_admin_preview_session_v1'
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000
export const MAX_SESSIONS = 128
type Session = { origin: string; accountId: string | null; actingSchoolId: string | null; touchedAt: number; state: AdminFixtureState; tail: Promise<void> }
const storeKey = Symbol.for('atvcms.admin-preview.sessions.v1')
const globals = globalThis as typeof globalThis & { [storeKey]?: Map<string, Session> }
const sessions = globals[storeKey] ??= new Map<string, Session>()
type Route = { kind: string; methods: string[]; id?: string }
function routeFor(path: string): Route | null {
  const routes: Record<string, Route> = {
    '/api/preview/status': { kind: 'status', methods: ['GET'] },
    '/api/preview/reset': { kind: 'reset', methods: ['POST'] },
    '/api/auth/me': { kind: 'me', methods: ['GET'] },
    '/api/auth/signin': { kind: 'signin', methods: ['POST'] },
    '/api/auth/signout': { kind: 'signout', methods: ['POST'] },
    '/api/admin/accounts': { kind: 'accounts', methods: ['GET', 'POST'] },
    '/api/admin/schools': { kind: 'schools', methods: ['GET', 'POST'] },
    '/api/admin/school-details': { kind: 'details', methods: ['GET'] },
    '/api/admin/act-as': { kind: 'acting', methods: ['GET', 'POST', 'DELETE'] },
    '/api/admin/contents': { kind: 'contents', methods: ['GET', 'POST'] },
    '/api/admin/devices': { kind: 'devices', methods: ['GET', 'POST', 'PUT'] },
    '/api/admin/school-linking': { kind: 'unsupported', methods: ['GET', 'POST', 'DELETE'] },
    '/api/admin/heart-rate-test/stream': { kind: 'unsupported', methods: ['GET'] },
    '/api/device/ingest': { kind: 'unsupported', methods: ['POST'] },
  }
  if (Object.hasOwn(routes, path)) return routes[path]
  const item = /^\/api\/admin\/(accounts|schools|contents|devices|school-devices)\/([^/]+)$/.exec(path)
  if (item) return { kind: item[1] + '-item', id: item[2], methods: item[1] === 'school-devices' ? ['PATCH'] : item[1] === 'accounts' || item[1] === 'devices' ? ['PUT', 'DELETE'] : ['GET', 'PUT', 'DELETE'] }
  if (/^\/api\/admin\/devices\/[^/]+\/icon$/.test(path)) return { kind: 'unsupported', methods: ['POST', 'DELETE'] }
  const schoolRoute = path.startsWith('/api/school/') ? schoolDataRouteFor(path) : null
  if (schoolRoute) return { ...schoolRoute, kind: 'school-data' }
  return null
}
function guard(request: Request, url: URL) {
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) fail(403, 'Admin preview is restricted to loopback hosts.')
  const original = new URL(url)
  const host = request.headers.get('host')
  if (host !== null) {
    if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(host)) fail(403, 'Preview Host must be a literal loopback host.')
    const port = /:(\d+)$/.exec(host)?.[1]
    if (port !== undefined && (Number(port) < 1 || Number(port) > 65535)) fail(403, 'Invalid preview Host port.')
    const candidate = new URL(`${url.protocol}//${host}`)
    if (candidate.port !== url.port) fail(403, 'Preview Host port does not match request URL.')
    original.host = candidate.host
  }
  const forwardedPort = request.headers.get('x-forwarded-port')
  if (forwardedPort !== null && forwardedPort !== (original.port || (original.protocol === 'https:' ? '443' : '80'))) fail(403, 'Forwarded port does not match Host.')
  for (const header of ['x-forwarded-host', 'x-forwarded-proto', 'forwarded']) {
    const value = request.headers.get(header)
    if (value !== null && (header === 'forwarded' || (header === 'x-forwarded-host' && value.toLowerCase() !== original.host) || (header === 'x-forwarded-proto' && value !== url.protocol.slice(0, -1)))) fail(403, 'Forwarded preview request rejected.')
  }
  const site = request.headers.get('sec-fetch-site')
  if (site && site !== 'same-origin' && site !== 'none') fail(403, 'Cross-origin preview request rejected.')
  const origin = request.headers.get('origin')
  if ((origin !== null && origin !== original.origin) || (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) && origin !== original.origin)) fail(403, 'Same-origin Origin header required for preview writes.')
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
    origin: url.origin, touchedAt: now, actingSchoolId: null, state: makeAdminFixtures(), tail: Promise.resolve(),
    // Bootstrap once before parallel UI requests. A stale cookie never silently signs back in.
    accountId: !cookie && kind !== 'signin' && kind !== 'signout' ? PREVIEW_ADMIN_ID : null,
  }
  sessions.set(id, session)
  return { id, session, created: true }
}
function currentAccount(session: Session): Account {
  if (!session.accountId) fail(401, 'Preview account is signed out.')
  const account = session.state.accounts.find(account => account.id === session.accountId)
  if (!account) fail(404, 'Preview account no longer exists.')
  if (!account.is_active) fail(403, 'Preview account is inactive.')
  return account
}
function userView(session: Session, account: Account) {
  return { id: account.id, username: account.username, role: account.role, schoolId: account.role === 'admin' ? session.actingSchoolId : account.school_id, isActive: account.is_active }
}
function status(session: Session) {
  const account = session.state.accounts.find(item => item.id === session.accountId && item.is_active)
  return {
    preview: true, synthetic: true, mode: 'admin', authenticated: !!account, user: account ? userView(session, account) : null,
    years: PREVIEW_YEARS, actingSchoolId: session.actingSchoolId,
    counts: { schools: session.state.schools.length, accounts: session.state.accounts.length, contents: session.state.contents.length, devices: session.state.devices.length },
    credentials: PREVIEW_CREDENTIALS,
    bootstrap: 'Await GET /api/preview/status before issuing parallel requests. Reset requires an active admin account.',
    persistence: 'Per-browser cookie; in-memory, single worker; lost on server restart or 12 hours of inactivity.',
    unsupported: ['school-linking', 'device-icon-upload/delete', 'advanced-diagnostics', 'device-pages', 'device-page-blocks', 'device-assets', 'device-ingest'],
  }
}
export async function handleAdminPreviewRequest(request: Request): Promise<Response> {
  const headers = new Headers({ 'Cache-Control': 'no-store, no-cache, max-age=0, must-revalidate', Pragma: 'no-cache', Expires: '0', Vary: 'Cookie, Origin', 'X-Content-Type-Options': 'nosniff', 'X-Admin-Preview': 'synthetic' })
  const respond = (body: unknown, status = 200) => {
    if (request.method === 'HEAD' || status === 204) return new Response(null, { status, headers })
    headers.set('Content-Type', 'application/json; charset=utf-8')
    return new Response(JSON.stringify(body), { status, headers })
  }
  let release: (() => void) | undefined
  try {
    const url = guard(request, new URL(request.url))
    const route = routeFor(url.pathname)
    if (!route) fail(404, 'Unknown admin preview API route.')
    if (!route.methods.includes(request.method)) {
      headers.set('Allow', route.methods.join(', '))
      return respond({ error: 'Method not allowed in preview.' }, 405)
    }
    const { session, id, created } = sessionFor(request, url, route.kind)
    if (created) headers.set('Set-Cookie', `${PREVIEW_COOKIE_NAME}=${id}; Path=/; HttpOnly; SameSite=Strict${url.protocol === 'https:' ? '; Secure' : ''}`)
    // Serialize a session's complete operations, including asynchronous school body parsing.
    const previous = session.tail
    session.tail = new Promise<void>(resolve => { release = resolve })
    await previous
    if (route.kind === 'status') return respond(status(session))
    if (route.kind === 'signout') { session.accountId = null; session.actingSchoolId = null; return respond({ success: true }) }
    if (route.kind === 'signin') {
      const body = await bodyOf(request)
      keys(body, ['username', 'password'])
      const username = string(body.username, 'username'), password = string(body.password, 'password')
      const account = session.state.accounts.find(item => item.username === username && item.password === password)
      if (!account) fail(401, 'Use preview_admin / preview-only, or a synthetic account created in this preview session.')
      if (!account.is_active) fail(403, 'Preview account is inactive.')
      session.accountId = account.id
      session.actingSchoolId = null
      return respond({ user: userView(session, account) })
    }
    const account = currentAccount(session)
    if (route.kind === 'me') return respond({ user: userView(session, account) })
    if (route.kind === 'school-data') {
      const schoolId = account.role === 'admin' ? session.actingSchoolId : account.school_id
      if (!schoolId && url.pathname === '/api/school/info') return respond({ school: null })
      if (!schoolId) fail(403, 'Select an acting school before accessing school data.')
      const school = find(session.state.schools, schoolId)
      const result = await handleSchoolDataRequest(request, school.data, schoolScope(session.state, school))
      const merged = new Headers(result.headers)
      headers.forEach((value, name) => merged.set(name, value))
      return new Response(result.body, { status: result.status, headers: merged })
    }
    if (account.role !== 'admin') fail(403, 'Administrator preview account required.')
    if (route.kind === 'unsupported') fail(501, 'This optional linking/icon/asset/diagnostic operation is not implemented in the isolated admin preview. No data was saved.')
    if (route.kind === 'reset') {
      session.state = makeAdminFixtures(); session.accountId = PREVIEW_ADMIN_ID; session.actingSchoolId = null
      return respond({ success: true, ...status(session) })
    }
    if (route.kind === 'acting') {
      if (request.method === 'DELETE') { session.actingSchoolId = null; return respond({ success: true }) }
      if (request.method === 'POST') {
        if (!session.actingSchoolId) fail(400, 'No acting context to refresh.')
        find(session.state.schools, session.actingSchoolId)
        return respond({ success: true })
      }
      const school = findSchool(session.state, groupNumber(url.searchParams.get('group_no')))
      session.actingSchoolId = school.id
      return respond({ success: true, school: { id: school.id, group_no: school.group_no, name: school.name } })
    }
    if (request.method === 'GET') {
      const state = session.state
      switch (route.kind) {
        case 'accounts': return respond(paginate(state.accounts, url.searchParams))
        case 'schools': return respond({ items: state.schools.map(school => schoolView(state, school)), total: state.schools.length })
        case 'schools-item': return respond(schoolView(state, findSchool(state, route.id!)))
        case 'details': return respond(schoolDetails(state, url.searchParams))
        case 'contents': return respond({ items: [...state.contents].sort((a, b) => b.created_at.localeCompare(a.created_at)).map(content => contentView(state, content)) })
        case 'contents-item': return respond({ item: contentView(state, find(state.contents, route.id!)) })
        case 'devices': return respond({ items: [...state.devices].sort((a, b) => a.sort_order - b.sort_order || a.device_name.localeCompare(b.device_name)) })
      }
    }
    const body = request.method === 'DELETE' ? {} : await bodyOf(request)
    // A failing relationship/date/removal validation cannot commit even the earlier basic edits.
    const state = structuredClone(session.state)
    let result: unknown = { success: true }
    let code = 200
    switch (route.kind) {
      case 'accounts': result = { item: saveAccount(state, body) }; code = 201; break
      case 'accounts-item':
        if (request.method === 'DELETE') { find(state.accounts, route.id!); state.accounts = state.accounts.filter(item => item.id !== route.id) }
        else result = { item: saveAccount(state, body, route.id) }
        break
      case 'schools': result = { success: true, item: saveSchool(state, body) }; code = 201; break
      case 'schools-item':
        if (request.method === 'DELETE') removeSchool(state, route.id!)
        else saveSchool(state, body, route.id)
        break
      case 'contents': result = { item: contentView(state, saveContent(state, body)) }; code = 201; break
      case 'contents-item':
        if (request.method === 'DELETE') removeContent(state, route.id!)
        else saveContent(state, body, route.id)
        break
      case 'devices':
        if (request.method === 'PUT') reorderDevices(state, body)
        else { result = { item: saveDevice(state, body) }; code = 201 }
        break
      case 'devices-item':
        if (request.method === 'DELETE') removeDevice(state, route.id!)
        else result = { item: saveDevice(state, body, route.id) }
        break
      case 'school-devices-item': {
        keys(body, ['memo'])
        const device = find(state.schools.flatMap(school => school.data.devices), route.id!)
        device.memo = string(body.memo, 'memo', 4000, true)
        result = { item: { id: device.id, memo: device.memo } }
        break
      }
      default: fail(404, 'Unknown admin preview API route.')
    }
    session.state = state
    if (session.actingSchoolId && !state.schools.some(school => school.id === session.actingSchoolId)) session.actingSchoolId = null
    return respond(result, code)
  } catch (error) {
    if (error instanceof PreviewError) return respond({ error: error.message }, error.status)
    return respond({ error: 'Isolated admin preview request failed.' }, 500)
  } finally { release?.() }
}
