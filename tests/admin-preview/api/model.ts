import { makeSchoolData, type SchoolDataScope } from '../../school-preview/api/school-data'
import { assignedDevices, makeAssignedDevice, newId, type Account, type AdminFixtureState, type AdminSchool, type Assignment, type Content, type Device } from './fixtures'
import { array, boolean, date, fail, groupNumber, ids, integer, keys, object, paginate, string } from './validation'

export function find<T extends { id: string }>(items: T[], id: string): T {
  const item = items.find(item => item.id === id)
  if (!item) fail(404, 'Item not found in this preview session.')
  return item
}
export function findSchool(state: AdminFixtureState, group: string) {
  const school = state.schools.find(school => school.group_no === group)
  if (!school) fail(404, 'School not found in this preview session.')
  return school
}
export function contentView(state: AdminFixtureState, content: Content) {
  const { device_ids, ...row } = content
  const devices = device_ids.map(id => find(state.devices, id))
  return { ...row, devices: devices.map(device => ({ id: device.id, name: device.device_name })), content_devices: devices.map(device => ({ device_id: device.id, device: { device_name: device.device_name } })) }
}
export function syncSchool(state: AdminFixtureState, school: AdminSchool) {
  for (const instance of assignedDevices(school)) {
    const assignment = find(school.assignments, instance.school_content_id)
    const content = find(state.contents, assignment.content_id)
    const device = find(state.devices, instance.device_id)
    instance.device_name = device.device_name
    instance.content_name = content.name
    instance.content_color_hex = content.color_hex
  }
}
export function schoolView(state: AdminFixtureState, school: AdminSchool) {
  syncSchool(state, school)
  const { id, group_no, name, school_type, recognition_key, created_at, assignments } = school
  const contents = assignments.map(assignment => {
    const content = find(state.contents, assignment.content_id)
    return {
      ...assignment, school_content_id: assignment.id, name: content.name, color_hex: content.color_hex,
      period: assignment.is_unlimited ? '제한없음' : `${assignment.start_date || ''} ~ ${assignment.end_date || ''}`,
      devices: assignedDevices(school).filter(device => device.school_content_id === assignment.id).map(device => ({ ...device, linkable: find(state.devices, device.device_id).linkable })),
    }
  })
  const endDates = assignments.filter(item => !item.is_unlimited && item.end_date).map(item => item.end_date!).sort()
  return { id, group_no, name, school_type, recognition_key, created_at, contents, min_end_date: endDates[0] ?? null, has_linkable: new Set(contents.filter(content => content.devices.some(device => device.linkable)).map(content => content.content_id)).size >= 2 }
}
function deviceManagementView(state: AdminFixtureState, school: AdminSchool) {
  const assignmentsByDevice = new Map<string, Set<Assignment>>()
  for (const instance of assignedDevices(school)) {
    const assignments = assignmentsByDevice.get(instance.device_id) ?? new Set<Assignment>()
    assignments.add(find(school.assignments, instance.school_content_id))
    assignmentsByDevice.set(instance.device_id, assignments)
  }
  // Production reads device_management, not issued school_devices. Its synchronization rule is
  // absent from the repository; this preview projects one catalog row with combined date bounds.
  return Array.from(assignmentsByDevice, ([device_id, assignments]) => {
    const periods = [...assignments]
    const unlimited = periods.some(assignment => assignment.is_unlimited)
    const starts = periods.map(assignment => assignment.start_date)
    const ends = periods.map(assignment => assignment.end_date)
    return {
      device_id, device_name: find(state.devices, device_id).device_name,
      start_date: unlimited || starts.includes(null) ? null : starts.sort()[0],
      end_date: unlimited || ends.includes(null) ? null : ends.sort().reverse()[0],
      limited_period: !unlimited,
    }
  })
}
export function schoolScope(state: AdminFixtureState, school: AdminSchool): SchoolDataScope {
  const view = schoolView(state, school)
  return {
    school: view,
    contents: view.contents.map(content => ({ school_content_id: content.id, content_id: content.content_id, name: content.name, color_hex: content.color_hex, start_date: content.start_date, end_date: content.end_date, is_unlimited: content.is_unlimited })),
    devices: deviceManagementView(state, school),
  }
}
export function schoolDetails(state: AdminFixtureState, params: URLSearchParams) {
  const query = (params.get('search') ?? params.get('q') ?? '').trim().toLowerCase()
  const group = (params.get('group_no') ?? '').trim()
  const name = (params.get('name') ?? params.get('school_name') ?? '').trim().toLowerCase()
  const schools = state.schools.filter(school => (!query || `${school.group_no} ${school.name}`.toLowerCase().includes(query)) && school.group_no.includes(group) && school.name.toLowerCase().includes(name))
  const result = paginate(schools, params)
  return { ...result, items: result.items.map((school, i) => ({
    index: (result.page - 1) * result.pageSize + i + 1, name: school.name, group_no: school.group_no,
    teacher_accounts: state.accounts.filter(account => account.role === 'school' && account.school_id === school.id).length,
    device_count: school.data.devices.length,
  })) }
}
export function saveAccount(state: AdminFixtureState, body: Record<string, unknown>, id?: string) {
  keys(body, ['username', 'password', 'role', 'school_id', 'is_active'])
  const previous = id ? find(state.accounts, id) : undefined
  const item = { ...previous, ...body }
  const role = string(item.role, 'role')
  if (role !== 'admin' && role !== 'school') fail(400, 'role: admin or school required.')
  const school_id = item.school_id == null ? null : string(item.school_id, 'school_id')
  if (school_id) find(state.schools, school_id)
  const account: Account = {
    id: previous?.id ?? newId('account'), username: string(item.username, 'username'),
    password: string(item.password, 'password'), role, school_id,
    is_active: item.is_active === undefined ? true : boolean(item.is_active, 'is_active'),
  }
  if (state.accounts.some(other => other.id !== account.id && other.username === account.username)) fail(409, 'Username already exists.')
  if (previous) state.accounts = state.accounts.map(other => other.id === account.id ? account : other)
  else state.accounts.push(account)
  return account
}
export function saveDevice(state: AdminFixtureState, body: Record<string, unknown>, id?: string) {
  keys(body, ['device_name', 'linkable'])
  const previous = id ? find(state.devices, id) : undefined
  const item = { ...previous, ...body }
  const device: Device = {
    id: previous?.id ?? newId('device'), device_name: string(item.device_name, 'device_name').trim(),
    linkable: item.linkable === undefined ? false : boolean(item.linkable, 'linkable'),
    sort_order: previous?.sort_order ?? Math.max(-1, ...state.devices.map(item => item.sort_order)) + 1,
    icon_path: null, icon_url: null,
  }
  if (previous) state.devices = state.devices.map(other => other.id === device.id ? device : other)
  else state.devices.push(device)
  return device
}
export function reorderDevices(state: AdminFixtureState, body: Record<string, unknown>) {
  keys(body, ['order'])
  const order = ids(body.order, 'order')
  for (const id of order) find(state.devices, id)
  order.forEach((id, i) => { find(state.devices, id).sort_order = i })
}
export function saveContent(state: AdminFixtureState, body: Record<string, unknown>, id?: string) {
  keys(body, ['name', 'description', 'color_hex', 'device_ids'])
  const previous = id ? find(state.contents, id) : undefined
  const item = { ...previous, ...body }
  const device_ids = item.device_ids === undefined ? [] : ids(item.device_ids, 'device_ids')
  device_ids.forEach(id => find(state.devices, id))
  const color_hex = item.color_hex === undefined ? '#DBEAFE' : string(item.color_hex, 'color_hex', 7)
  if (!/^#[\da-f]{6}$/i.test(color_hex)) fail(400, 'color_hex: six-digit hex color required.')
  const content: Content = {
    id: previous?.id ?? newId('content'), name: string(item.name, 'name').trim(), device_ids, color_hex,
    description: item.description == null ? null : string(item.description, 'description', 4000, true),
    created_at: previous?.created_at ?? new Date().toISOString(),
  }
  if (previous) state.contents = state.contents.map(other => other.id === content.id ? content : other)
  else state.contents.push(content)
  return content
}
function saveAssignments(state: AdminFixtureState, school: AdminSchool, values: unknown) {
  const seen = new Set<string>()
  const previousDevices = assignedDevices(school)
  const devices: typeof previousDevices = []
  const assignments = array(values, 'content_assignments', 100).map(value => {
    const item = object(value)
    keys(item, ['content_id', 'start_date', 'end_date', 'is_unlimited', 'device_quantities', 'remove_school_device_ids'])
    const content = find(state.contents, string(item.content_id, 'content_id'))
    if (seen.has(content.id)) fail(409, 'Duplicate content assignment.')
    seen.add(content.id)
    const is_unlimited = boolean(item.is_unlimited, 'is_unlimited')
    const start = date(item.start_date, 'start_date'), end = date(item.end_date, 'end_date')
    if (!is_unlimited && start && end && start > end) fail(400, 'end_date must not precede start_date.')
    const previous = school.assignments.find(assignment => assignment.content_id === content.id)
    const assignment: Assignment = { id: previous?.id ?? newId('assignment'), content_id: content.id, is_unlimited, start_date: is_unlimited ? null : start, end_date: is_unlimited ? null : end }
    const remove = ids(item.remove_school_device_ids ?? [], 'remove_school_device_ids')
    for (const id of remove) {
      if (!previousDevices.some(device => device.id === id && device.school_content_id === assignment.id)) fail(400, 'Removal ID does not belong to this school content assignment.')
    }
    const seenDevices = new Set<string>()
    for (const value of array(item.device_quantities ?? [], 'device_quantities', 100)) {
      const quantity = object(value)
      keys(quantity, ['device_id', 'quantity'])
      const device = find(state.devices, string(quantity.device_id, 'device_id'))
      if (seenDevices.has(device.id)) fail(409, 'Duplicate device quantity.')
      seenDevices.add(device.id)
      const count = integer(quantity.quantity, 'quantity', 0, 1000)
      const existing = previousDevices.filter(instance => instance.school_content_id === assignment.id && instance.device_id === device.id)
      // Catalog detachment does not erase already-issued instances; new assignments need a catalog relation.
      if (!content.device_ids.includes(device.id) && count > existing.filter(instance => !remove.includes(instance.id)).length) fail(400, 'Device is not part of this content catalog.')
      const keep = existing.filter(instance => !remove.includes(instance.id)).sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)).slice(0, count)
      devices.push(...keep)
      for (let i = keep.length; i < count; i++) devices.push(makeAssignedDevice(assignment, device))
      if (devices.length > 5000) fail(400, 'Preview school instance capacity exceeded.')
    }
    return assignment
  })
  school.assignments = assignments
  school.data.devices = devices
}
export function saveSchool(state: AdminFixtureState, body: Record<string, unknown>, group?: string) {
  keys(body, ['group_no', 'name', 'school_type', 'content_assignments'])
  const previous = group ? findSchool(state, group) : undefined
  const item = { ...previous, ...body }
  const group_no = groupNumber(item.group_no)
  if (state.schools.some(other => other.id !== previous?.id && other.group_no === group_no)) fail(409, 'Group number already exists.')
  const id = previous?.id ?? newId('school')
  const school: AdminSchool = {
    id, group_no, name: string(item.name, 'name').trim(), school_type: integer(item.school_type, 'school_type', 1, 3),
    recognition_key: previous?.recognition_key ?? `synthetic-${newId('key')}`, created_at: previous?.created_at ?? new Date().toISOString(),
    assignments: previous?.assignments ?? [], data: previous?.data ?? makeSchoolData(id, false),
  }
  if (body.content_assignments !== undefined) saveAssignments(state, school, body.content_assignments)
  if (previous) state.schools = state.schools.map(other => other.id === id ? school : other)
  else state.schools.push(school)
  return schoolView(state, school)
}
export function removeSchool(state: AdminFixtureState, group: string) {
  const school = findSchool(state, group)
  // The repository operator_accounts.school_id FK has no ON DELETE cascade.
  if (state.accounts.some(account => account.school_id === school.id)) fail(409, 'School is referenced by operator accounts. Remove or reassign them first.')
  state.schools = state.schools.filter(item => item.id !== school.id)
}
export function removeDevice(state: AdminFixtureState, id: string) {
  find(state.devices, id)
  if (state.contents.some(content => content.device_ids.includes(id)) || state.schools.some(school => school.data.devices.some(device => device.device_id === id))) fail(409, 'Device is still referenced by content or school assignments.')
  state.devices = state.devices.filter(item => item.id !== id)
}
export function removeContent(state: AdminFixtureState, id: string) {
  const content = find(state.contents, id)
  if (state.schools.some(school => school.assignments.some(item => item.content_id === id))) fail(409, 'Content is still assigned to a school.')
  if (content.device_ids.length) fail(409, 'Content is still referenced by catalog device relations. Detach them first.')
  state.contents = state.contents.filter(item => item.id !== id)
}
