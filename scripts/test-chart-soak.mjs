import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const minutes = Number(process.env.CHART_SOAK_MINUTES)
if (!Number.isInteger(minutes) || minutes < 1 || minutes > 120) {
  console.error('Soak is OFF by default. Explicitly set CHART_SOAK_MINUTES=60 to run one real hour, or 1 for a short trial.')
  process.exitCode = 1
} else {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  console.log(`Starting ${minutes} WALL-CLOCK minutes at speed 1. No preload, accelerated clock, or sensor/hardware guarantee.`)
  const child = spawn(process.execPath, [path.join(root, 'node_modules/@playwright/test/cli.js'), 'test',
    '--config=playwright.charts.config.ts', '--project=chrome-1920', 'soak.spec.ts'], { cwd: root, stdio: 'inherit', windowsHide: true })
  child.on('error', error => { console.error(error.message); process.exitCode = 1 })
  child.on('exit', code => { process.exitCode = code ?? 1 })
}
