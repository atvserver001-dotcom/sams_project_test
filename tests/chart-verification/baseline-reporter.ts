import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { FullConfig, FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter'

const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex')

function filesUnder(directory: string): string[] {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') return []
    const file = path.join(directory, entry.name)
    return entry.isDirectory() ? filesUnder(file) : [file]
  })
}

export default class CandidateReporter implements Reporter {
  private root = ''
  private config!: FullConfig
  private startedAt = new Date().toISOString()
  private before: Record<string, string> = {}
  private results: object[] = []

  private sources() {
    const files = [
      'package-lock.json', 'playwright.charts.config.ts',
      'src/components/exercises/exercise-charts.tsx',
      'src/components/exercises/exercise-data.ts',
      'src/components/heart-rate/HeartRateChart.tsx',
      'src/components/heart-rate/heart-care.module.css',
      'src/lib/heart-rate/chart.ts', 'src/lib/heart-rate/session.ts',
      'src/lib/heart-rate/zones.ts', 'src/app/globals.css',
    ].map(file => path.join(this.root, file))
    files.push(...filesUnder(path.join(this.root, 'tests/chart-lab')))
    files.push(...filesUnder(path.join(this.root, 'tests/chart-verification')).filter(file => /\.(ts|mjs)$/.test(file)))
    files.push(...filesUnder(path.join(this.root, 'tests/chart-verification/fonts')))
    return Object.fromEntries(files.filter(existsSync).sort().map(file => [path.relative(this.root, file).replaceAll('\\', '/'), sha256(file)]))
  }

  onBegin(config: FullConfig) {
    this.config = config
    this.root = path.dirname(config.configFile!)
    this.before = this.sources()
  }

  onTestEnd(test: TestCase, result: TestResult) {
    this.results.push({
      title: test.titlePath(), status: result.status, durationMs: result.duration,
      errors: result.errors.map(error => error.message),
      measurements: result.attachments.filter(item => item.name === 'replay-metrics' || item.name === 'replay-incomplete')
        .map(item => ({ name: item.name, data: item.body ? JSON.parse(item.body.toString('utf8')) : null })),
      environment: result.attachments.filter(item => item.name === 'chart-environment')
        .map(item => item.body ? JSON.parse(item.body.toString('utf8')) : null),
    })
  }

  onEnd(result: FullResult) {
    const after = this.sources()
    const candidateRoot = path.join(this.root, 'tests/chart-verification/baseline-candidates')
    const candidateFiles = filesUnder(candidateRoot).filter(file => file.endsWith('.png'))
    const report = {
      status: 'CANDIDATE', userApproved: false,
      warning: 'Pixel agreement is not user approval or a hardware/sensor performance guarantee.',
      startedAt: this.startedAt, endedAt: new Date().toISOString(), result: result.status,
      gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: this.root, encoding: 'utf8' }).trim(),
      sourceChangedDuringRun: JSON.stringify(this.before) !== JSON.stringify(after),
      sourceSha256Before: this.before, sourceSha256After: after,
      playwrightVersion: this.config.version,
      platform: process.platform, arch: process.arch, node: process.version,
      clock: '2026-09-05T03:00:00.000Z (Date fixed; real timers)', academicYear: 2025,
      projects: this.config.projects.map(project => ({ name: project.name, use: project.use })),
      candidates: candidateFiles.map(file => ({ file: path.relative(this.root, file).replaceAll('\\', '/'), sha256: sha256(file) })),
      tests: this.results,
    }
    const output = path.resolve(this.root, process.env.CHART_OUTPUT_DIR ?? 'output/chart-verification')
    mkdirSync(output, { recursive: true })
    writeFileSync(path.join(output, 'run-metadata.json'), JSON.stringify(report, null, 2) + '\n', 'utf8')
    if (process.env.CHART_CREATE_CANDIDATES === '1') {
      const directory = path.join(candidateRoot, 'runs')
      mkdirSync(directory, { recursive: true })
      writeFileSync(path.join(directory, `${this.startedAt.replaceAll(':', '-')}.json`), JSON.stringify(report, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' })
    }
  }
}
