import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { Page } from '@playwright/test'

type Asset = { url: string; file: string; sha256: string; mime: string }
const directory = path.join(__dirname, 'fonts')

export async function usePinnedFonts(page: Page) {
  const manifest = JSON.parse(readFileSync(path.join(directory, 'manifest.json'), 'utf8')) as { assets: Asset[] }
  for (const asset of manifest.assets) {
    const bytes = readFileSync(path.join(directory, asset.file))
    if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256) {
      throw new Error(`Pinned font hash mismatch: ${asset.file}. Review the asset; do not update snapshots.`)
    }
    await page.route(asset.url, route => route.fulfill({
      status: 200, contentType: asset.mime,
      headers: { 'access-control-allow-origin': '*' }, body: bytes,
    }))
  }
}
