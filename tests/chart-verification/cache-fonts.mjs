import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import postcss from 'postcss'

const directory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fonts')
const cssURL = 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css'
const licenseURL = 'https://raw.githubusercontent.com/orioncactus/pretendard/v1.3.9/LICENSE'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
await mkdir(directory, { recursive: true })

async function immutableFile(file, bytes) {
  const destination = path.join(directory, file)
  try {
    await writeFile(destination, bytes, { flag: 'wx' })
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    if (hash(await readFile(destination)) !== hash(bytes)) throw new Error(`Existing font asset changed: ${file}. Review explicitly; never overwrite silently.`)
  }
}

async function retrieve(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`${response.status}: ${url}`)
  return Buffer.from(await response.arrayBuffer())
}

const original = await retrieve(cssURL)
const css = postcss.parse(original.toString('utf8'))
const assets = []
const fonts = []
css.walkAtRules('font-face', rule => {
  rule.walkDecls('src', declaration => {
    const source = declaration.value.match(/url\(([^)]+\.woff2)\)/)?.[1]
    if (!source) throw new Error('Pinned CSS no longer contains the expected WOFF2 source.')
    const url = new URL(source, cssURL)
    if (!url.href.startsWith('https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/')) throw new Error('Unexpected font origin/version.')
    const file = path.posix.basename(url.pathname)
    fonts.push({ url: url.href, file })
    // Remove machine-specific local() precedence and fallback network formats.
    declaration.value = `url("${url.href}") format('woff2')`
  })
})
for (const font of fonts) {
  const bytes = await retrieve(font.url)
  if (bytes.subarray(0, 4).toString('ascii') !== 'wOF2') throw new Error(`Not a WOFF2 font: ${font.file}`)
  await immutableFile(font.file, bytes)
  assets.push({ ...font, sha256: hash(bytes), mime: 'font/woff2' })
}
const pinnedCss = Buffer.from(css.toString(), 'utf8')
await immutableFile('pretendard.css', pinnedCss)
assets.push({ url: cssURL, file: 'pretendard.css', sha256: hash(pinnedCss), mime: 'text/css; charset=utf-8' })
await immutableFile('LICENSE.txt', await retrieve(licenseURL))
await immutableFile('manifest.json', Buffer.from(JSON.stringify({
  version: 'Pretendard 1.3.9', originalCssURL: cssURL, originalCssSha256: hash(original),
  licenseURL, policy: 'Test-only local WOFF2 responses; no local() font precedence; never regenerate a different existing asset silently.', assets,
}, null, 2) + '\n', 'utf8'))
console.log(`Pinned ${fonts.length} fonts and stylesheet under tests/chart-verification/fonts. No dependency installed or app edited.`)
