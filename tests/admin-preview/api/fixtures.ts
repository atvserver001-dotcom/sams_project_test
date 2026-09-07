import { randomUUID } from 'node:crypto'
import { makeSchoolData } from '../../school-preview/api/school-data'
import type { FixtureState } from '../../school-preview/api/fixtures'

// All identities, passwords and hardware keys below belong only to this memory preview.
export const PREVIEW_CREDENTIALS = { username: 'preview_admin', password: 'preview-only' } as const
export const PREVIEW_ADMIN_ID = 'admin-preview-account-1'
export const PREVIEW_YEARS = [2025, 2026] as const
export type Account = { id: string; username: string; password: string; role: 'admin' | 'school'; school_id: string | null; is_active: boolean }
export type Device = { id: string; device_name: string; linkable: boolean; sort_order: number; icon_path: null; icon_url: null }
export type Content = { id: string; name: string; description: string | null; color_hex: string; device_ids: string[]; created_at: string }
export type Assignment = { id: string; content_id: string; start_date: string | null; end_date: string | null; is_unlimited: boolean }
export type AssignedDevice = FixtureState['devices'][number] & { school_content_id: string }
export type AdminSchool = {
  id: string; group_no: string; name: string; school_type: number; recognition_key: string; created_at: string
  assignments: Assignment[]; data: FixtureState
}
export type AdminFixtureState = { accounts: Account[]; schools: AdminSchool[]; contents: Content[]; devices: Device[] }
export function assignedDevices(school: AdminSchool): AssignedDevice[] { return school.data.devices as AssignedDevice[] }
export function newId(kind: string) { return `admin-preview-${kind}-${randomUUID()}` }
export function makeAssignedDevice(assignment: Assignment, device: Device, id = newId('instance')): AssignedDevice {
  return {
    id, school_content_id: assignment.id, device_id: device.id, device_name: device.device_name,
    auth_key: `synthetic-${id}`, device_icon_url: null, memo: '', status: 'active',
    created_at: new Date().toISOString(), content_name: '', content_color_hex: '', link_group_id: null, is_primary: false,
  }
}
export function makeAdminFixtures(): AdminFixtureState {
  const devices: Device[] = ['스마트미러', '하트 케어', '체력측정기'].map((device_name, i) => ({
    id: `admin-preview-device-${i + 1}`, device_name, linkable: i < 2, sort_order: i, icon_path: null, icon_url: null,
  }))
  const contents: Content[] = ['운동기록관리', 'PAPS기록관리', '심박기록관리', '체력측정관리'].map((name, i) => ({
    id: `admin-preview-content-${i + 1}`, name, description: '합성 미리보기 콘텐츠',
    color_hex: ['#DBEAFE', '#DCFCE7', '#FCE7F3', '#FEF3C7'][i],
    device_ids: [devices[i === 2 ? 1 : i === 3 ? 2 : 0].id], created_at: `2025-03-0${i + 1}T00:00:00.000Z`,
  }))
  const schools: AdminSchool[] = ['샘플초등학교', '샘플중학교', '샘플고등학교'].map((name, i) => {
    const id = `admin-preview-school-${i + 1}`
    const assignments: Assignment[] = contents.slice(0, i === 2 ? 2 : 4).map((content, j) => ({
      id: `${id}-assignment-${j + 1}`, content_id: content.id,
      start_date: i === 1 && j === 0 ? '2024-03-01' : null,
      end_date: i === 1 && j === 0 ? '2025-02-28' : null, is_unlimited: !(i === 1 && j === 0),
    }))
    const data = makeSchoolData(id)
    const entryAge = [6, 12, 15][i]
    for (const student of data.students) student.birth_date = `${student.year - student.grade - entryAge}-04-03`
    data.mappings = data.mappings.map(mapping => ({ ...mapping, device_id: `${id}:${mapping.device_id}` }))
    data.devices = assignments.flatMap((assignment, j) => Array.from({ length: j === 0 ? 2 : 1 }, (_, k) => ({
      ...makeAssignedDevice(assignment, devices.find(device => device.id === contents[j].device_ids[0])!, `${id}-instance-${j + 1}-${k + 1}`),
      content_name: contents[j].name, content_color_hex: contents[j].color_hex,
      memo: k === 0 ? '샘플 체육관' : '샘플 교실', created_at: `2025-03-0${j + 1}T00:00:0${k}.000Z`,
    })))
    return { id, name, group_no: `100${i + 1}`, school_type: i + 1, recognition_key: `synthetic-school-key-${i + 1}`, created_at: `2025-03-0${i + 1}T00:00:00.000Z`, assignments, data }
  })
  const accounts: Account[] = [
    { id: PREVIEW_ADMIN_ID, ...PREVIEW_CREDENTIALS, role: 'admin', school_id: null, is_active: true },
    ...schools.map((school, i): Account => ({ id: `admin-preview-teacher-${i + 1}`, username: `preview_school_${school.group_no}`, password: 'preview-only', role: 'school', school_id: school.id, is_active: true })),
    { id: 'admin-preview-teacher-inactive', username: 'preview_school_inactive', password: 'preview-only', role: 'school', school_id: schools[1].id, is_active: false },
  ]
  return { accounts, schools, contents, devices }
}
