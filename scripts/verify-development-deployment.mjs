import assert from 'node:assert/strict'

const expectedProject = 'prj_wVas64KKQgBSyEHKzf3MEE58NIOA'
const expectedDatabase = 'rbypxqvjmwutzhzbavzm.supabase.co'
assert.equal(process.env.VERCEL, '1', 'This release is for the confirmed Vercel development project.')
assert.equal(process.env.VERCEL_PROJECT_ID, expectedProject, 'Unexpected Vercel project.')
assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname, expectedDatabase, 'Unexpected database. Deployment stopped before Next build.')
assert.equal(process.env.DEVICE_API_ENABLED?.trim().toLowerCase(), 'false', 'Development device API must remain disabled.')
assert.ok(process.env.PREVIEW_ALLOWED_OPERATOR_USERNAMES?.trim(), 'Development operator allowlist must be configured.')
for (const key of ['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'JWT_SECRET']) {
  assert.ok(process.env[key]?.trim(), `Missing required configuration: ${key}`)
}
console.log('Development deployment preflight passed: confirmed project, development database, device guard and operator allowlist.')
