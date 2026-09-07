const { test } = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const fixture = {
  VERCEL: '1',
  VERCEL_PROJECT_ID: 'prj_wVas64KKQgBSyEHKzf3MEE58NIOA',
  NEXT_PUBLIC_SUPABASE_URL: 'https://rbypxqvjmwutzhzbavzm.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-required-value',
  SUPABASE_SERVICE_ROLE_KEY: 'synthetic-required-value',
  JWT_SECRET: 'synthetic-required-value',
  DEVICE_API_ENABLED: 'false',
  PREVIEW_ALLOWED_OPERATOR_USERNAMES: 'synthetic-operator',
}
function check(overrides) {
  return spawnSync(process.execPath, ['scripts/verify-development-deployment.mjs'], {
    cwd: root, env: { ...fixture, ...overrides }, encoding: 'utf8',
  })
}
test('confirmed development project and database passes without external requests', () => {
  const result = check({})
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /preflight passed/)
  assert.ok(!result.stdout.includes('synthetic-required-value'))
})
for (const [name, overrides] of [
  ['production database', { NEXT_PUBLIC_SUPABASE_URL: 'https://sxvtdnnzmvyksqqkidoi.supabase.co' }],
  ['different project', { VERCEL_PROJECT_ID: 'different' }],
  ['enabled device API', { DEVICE_API_ENABLED: 'true' }],
  ['empty operator allowlist', { PREVIEW_ALLOWED_OPERATOR_USERNAMES: '' }],
  ['missing JWT configuration', { JWT_SECRET: '' }],
]) {
  test(`deployment stops before build: ${name}`, () => {
    assert.notEqual(check(overrides).status, 0)
  })
}
