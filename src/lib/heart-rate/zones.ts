import { deriveHeartRateZone, derivePredictedMaxBpm } from '../heartRateSession'

export const HR_ZONES = [
  { key: 'low', label: '낮음', max: .64, color: '#605d5d', band: '#dcd8d8' },
  { key: 'moderate', label: '중강도', max: .77, color: '#201e1d', band: '#8b8787' },
  { key: 'high', label: '고강도', max: .96, color: '#ec3013', band: '#ec3013' },
  { key: 'near_max', label: '최대 부근', max: Infinity, color: '#ae1800', band: '#ae1800' },
] as const

export const hrMax = derivePredictedMaxBpm
export const zoneBounds = (age: number) => HR_ZONES.map(zone => Math.ceil(hrMax(age) * zone.max))
export function zoneIndexOf(bpm: number, age: number) {
  const key = deriveHeartRateZone(bpm, hrMax(age))
  const index = HR_ZONES.findIndex(zone => zone.key === key)
  return index < 0 ? HR_ZONES.length - 1 : index
}
export const zoneOf = (bpm: number, age: number) => HR_ZONES[zoneIndexOf(bpm, age)]

export function studentAge(birthDate: string | null, grade: number, schoolType: number, now = new Date()) {
  if (birthDate) {
    const birth = new Date(`${birthDate.slice(0, 10)}T00:00:00`)
    if (Number.isFinite(birth.getTime()) && birth <= now) {
      const beforeBirthday = now.getMonth() < birth.getMonth()
        || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())
      return now.getFullYear() - birth.getFullYear() - Number(beforeBirthday)
    }
  }
  return grade + (schoolType === 3 ? 15 : schoolType === 2 ? 12 : 6)
}

export const academicYear = (date = new Date()) => date.getFullYear() - Number(date.getMonth() < 2)
export const monthOrderIdx = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 0, 1] as const
export function formatDuration(seconds: number) {
  const value = Math.max(0, Math.floor(seconds))
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
}
