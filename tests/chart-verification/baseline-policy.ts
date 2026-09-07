import type { FullConfig } from '@playwright/test'

export default function baselinePolicy(config: FullConfig) {
  const allowed = process.env.CHART_CREATE_CANDIDATES === '1' ? 'missing' : 'none'
  if (config.updateSnapshots !== allowed) {
    throw new Error(`Chart snapshots are CANDIDATE references, not approved baselines. Expected updateSnapshots=${allowed}; overwriting existing candidates is forbidden. Review drift explicitly; do not use --update-snapshots.`)
  }
  if (process.env.CHART_SOAK_MINUTES !== undefined) {
    const minutes = Number(process.env.CHART_SOAK_MINUTES)
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 120) {
      throw new Error('CHART_SOAK_MINUTES must be an explicit integer from 1 to 120; unset it to skip the wall-clock soak.')
    }
  }
}
