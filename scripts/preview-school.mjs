import { copyFile, mkdir } from 'node:fs/promises'
import { createServer } from 'node:net'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const directory = path.join(root, 'tests', 'school-preview')
const port = Number(process.argv[2] || 18475)
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid preview port')
await new Promise((resolve, reject) => {
  const probe = createServer()
  probe.once('error', reject)
  probe.listen(port, '127.0.0.1', () => probe.close(resolve))
})
// Refresh only the exact approved assets, not application data or server files.
await mkdir(path.join(directory, 'public', 'image'), { recursive: true })
await copyFile(path.join(root, 'public', 'image', 'logo_atvcms.svg'), path.join(directory, 'public', 'image', 'logo_atvcms.svg'))
const child = spawn(process.execPath, [path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next'), 'dev', directory, '--hostname', '127.0.0.1', '--port', String(port)], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
})
child.on('exit', code => { process.exitCode = code ?? 1 })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
