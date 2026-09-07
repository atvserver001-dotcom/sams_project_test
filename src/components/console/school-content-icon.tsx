import { ClipboardCheck, Dumbbell, Gauge, HeartPulse, Package } from 'lucide-react'

// School-list display identities only; content-editor colors remain unchanged.
const contentIcons = {
  exercise: { icon: Dumbbell, color: '#2563eb' },
  paps: { icon: ClipboardCheck, color: '#0f766e' },
  heart: { icon: HeartPulse, color: '#e11d48' },
  fitness: { icon: Gauge, color: '#7c3aed' },
  custom: { icon: Package, color: '#605d5d' },
} as const

export function resolveSchoolContentKind(name: string): keyof typeof contentIcons {
  const normalized = name.replace(/\s/g, '').toLowerCase()
  if (
    normalized.includes('운동기록') ||
    normalized.includes('헬스케어') ||
    normalized.includes('healthcare')
  ) {
    return 'exercise'
  }
  if (normalized.includes('paps')) return 'paps'
  if (
    normalized.includes('심박') ||
    normalized.includes('하트케어') ||
    normalized.includes('heartcare')
  ) {
    return 'heart'
  }
  if (normalized.includes('체력측정')) return 'fitness'
  return 'custom'
}

export function SchoolContentIcon({ name }: { name: string }) {
  const kind = resolveSchoolContentKind(name)
  const { icon: Icon, color } = contentIcons[kind]
  return (
    <Icon
      aria-hidden="true"
      className="school-content-icon h-4 w-4 shrink-0"
      data-content-kind={kind}
      size={16}
      strokeWidth={2}
      style={{ color }}
    />
  )
}
