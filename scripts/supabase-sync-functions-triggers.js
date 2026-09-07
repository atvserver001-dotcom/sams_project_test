/**
 * Sync Postgres functions/procedures + triggers from PROD -> TEST (schema-only; no table changes).
 *
 * Requirements:
 * - Node.js
 * - `npm i` (installs `pg`)
 * - Two DB URLs with credentials:
 *   - PROD_DB_URL
 *   - TEST_DB_URL
 *
 * Usage:
 *   # Git Bash
 *   export PROD_DB_URL="postgresql://..."
 *   export TEST_DB_URL="postgresql://..."
 *   node scripts/supabase-sync-functions-triggers.js
 *
 * Optional:
 *   export PG_SCHEMA=public
 *   export DRY_RUN=1              # generate SQL files only; do not apply to TEST
 *   export OUTPUT_DIR=scripts/sql/generated
 */

/* eslint-disable no-console */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs')
const dns = require('node:dns').promises
const path = require('node:path')
const process = require('node:process')

require('dotenv').config({ path: '.env.supabase.sync' })

const { Client } = require('pg')

function requireEnv(name) {
  const v = process.env[name]
  if (!v) throw new Error(`환경 변수 누락: ${name}`)
  return v
}

function maskConnString(cs) {
  try {
    const u = new URL(cs)
    const safeUser = u.username ? `${u.username}` : ''
    // redact password
    const host = u.host
    const db = u.pathname || ''
    return `postgresql://${safeUser}:***@${host}${db}`
  } catch {
    return '(invalid connection string)'
  }
}

function toBool(v) {
  return v === '1' || v === 'true' || v === 'TRUE' || v === 'yes' || v === 'YES'
}

async function preflightHost({ label, connectionString }) {
  let host
  try {
    host = new URL(connectionString).hostname
  } catch {
    return
  }

  try {
    await dns.resolve4(host)
  } catch (e) {
    if (e && e.code === 'ENODATA') {
      try {
        await dns.resolve6(host)
        console.log(
          `[sync] ⚠️ ${label} host "${host}" 는 IPv4(A 레코드)가 없고 IPv6(AAAA)만 있을 수 있습니다. ` +
          `현재 PC/네트워크가 IPv6 DB 접속을 지원하지 않으면 Node/pg에서 ENOTFOUND로 실패할 수 있어요. ` +
          `Supabase 대시보드 Connect에서 "Session pooler" 연결 문자열(aws-0-...pooler.supabase.com)을 사용하세요.`
        )
      } catch {
        // ignore
      }
    }
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function writeFile(outDir, filename, content) {
  const full = path.join(outDir, filename)
  fs.writeFileSync(full, content, 'utf8')
  return full
}

function normalizeCreateOrReplace(sql) {
  // pg_get_functiondef typically returns "CREATE FUNCTION/PROCEDURE ...".
  // Make it idempotent where possible.
  return sql
    .replace(/^\s*CREATE\s+FUNCTION\s+/i, 'CREATE OR REPLACE FUNCTION ')
    .replace(/^\s*CREATE\s+PROCEDURE\s+/i, 'CREATE OR REPLACE PROCEDURE ')
}

async function fetchFunctions(client, schema) {
  const { rows } = await client.query(
    `
    select
      n.nspname as schema,
      p.proname as name,
      p.prokind as kind,
      pg_get_function_identity_arguments(p.oid) as identity_args,
      pg_get_functiondef(p.oid) as ddl
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = $1
      and p.prokind in ('f','p') -- function, procedure
    order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)
    `,
    [schema]
  )

  return rows.map((r) => ({
    schema: r.schema,
    name: r.name,
    kind: r.kind,
    identityArgs: r.identity_args ?? '',
    ddl: normalizeCreateOrReplace(String(r.ddl || '')).trimEnd(),
  }))
}

async function fetchTriggers(client, schema) {
  const { rows } = await client.query(
    `
    select
      ns.nspname as table_schema,
      c.relname as table_name,
      t.tgname as trigger_name,
      pg_get_triggerdef(t.oid, true) as ddl
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = $1
      and not t.tgisinternal
    order by ns.nspname, c.relname, t.tgname
    `,
    [schema]
  )

  return rows.map((r) => ({
    tableSchema: r.table_schema,
    tableName: r.table_name,
    triggerName: r.trigger_name,
    ddl: String(r.ddl || '').trimEnd(),
  }))
}

function buildSql({ schema, functions, triggers }) {
  const header = [
    '-- AUTO-GENERATED FILE. DO NOT EDIT MANUALLY.',
    `-- schema: ${schema}`,
    `-- generated_at: ${new Date().toISOString()}`,
    '',
  ].join('\n')

  const functionsSql = [
    header,
    'BEGIN;',
    ...functions.flatMap((fn) => [
      `-- ${fn.kind === 'p' ? 'procedure' : 'function'}: ${fn.schema}.${fn.name}(${fn.identityArgs})`,
      `${fn.ddl};`,
      '',
    ]),
    'COMMIT;',
    '',
  ].join('\n')

  const triggersSql = [
    header,
    'BEGIN;',
    `-- Drop triggers first to make re-apply idempotent`,
    ...triggers.map(
      (t) =>
        `DROP TRIGGER IF EXISTS "${t.triggerName}" ON "${t.tableSchema}"."${t.tableName}";`
    ),
    '',
    `-- Recreate triggers`,
    ...triggers.flatMap((t) => [`-- trigger: ${t.tableSchema}.${t.tableName} :: ${t.triggerName}`, `${t.ddl};`, '']),
    'COMMIT;',
    '',
  ].join('\n')

  const combinedSql = [functionsSql, '', triggersSql].join('\n')

  return { functionsSql, triggersSql, combinedSql }
}

async function execSql(client, sql, label) {
  // One round-trip; server parses multi-statements including $$ blocks.
  try {
    await client.query(sql)
  } catch (e) {
    const msg = e && typeof e === 'object' && 'message' in e ? e.message : String(e)
    throw new Error(`${label} 실행 실패: ${msg}`)
  }
}

async function connectWithHints({ client, label, connectionString }) {
  try {
    await client.connect()
  } catch (e) {
    const msg = e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e)
    console.error(`[sync] ${label} connect failed: ${msg}`)
    console.error(`[sync] ${label} conn: ${maskConnString(connectionString)}`)

    if (/password authentication failed/i.test(msg)) {
      console.error(
        `[sync] 힌트: DB 비밀번호가 프로젝트마다 다릅니다(계정이 달라서 더더욱). ` +
        `각 프로젝트 대시보드 > Connect에서 문자열을 복사한 뒤, 그 프로젝트의 DB 비밀번호로 정확히 교체했는지 확인하세요.`
      )
      console.error(
        `[sync] 힌트: 비밀번호에 '@', ':', '/', '?', '#', '&' 같은 문자가 있으면 URL 인코딩이 필요합니다. ` +
        `예) '@' -> '%40', ':' -> '%3A'`
      )
    }

    throw e
  }
}

async function main() {
  const schema = process.env.PG_SCHEMA || 'public'
  const outDir = process.env.OUTPUT_DIR || path.join('scripts', 'sql', 'generated')
  const dryRun = toBool(process.env.DRY_RUN || '')
  const useSsl = !toBool(process.env.PG_SSL_DISABLE || '')

  const prodUrl = requireEnv('PROD_DB_URL')
  const testUrl = requireEnv('TEST_DB_URL')

  ensureDir(outDir)

  await preflightHost({ label: 'PROD', connectionString: prodUrl })
  await preflightHost({ label: 'TEST', connectionString: testUrl })

  const ssl = useSsl ? { rejectUnauthorized: false } : undefined
  const prod = new Client({ connectionString: prodUrl, ssl })
  const test = new Client({ connectionString: testUrl, ssl })

  console.log(`[sync] schema=${schema} dryRun=${dryRun} outputDir=${outDir}`)
  console.log(`[sync] PROD -> ${maskConnString(prodUrl)}`)
  console.log(`[sync] TEST -> ${maskConnString(testUrl)}`)

  await connectWithHints({ client: prod, label: 'PROD', connectionString: prodUrl })
  try {
    const functions = await fetchFunctions(prod, schema)
    const triggers = await fetchTriggers(prod, schema)

    console.log(`[sync] fetched functions=${functions.length}, triggers=${triggers.length} from PROD`)

    const { functionsSql, triggersSql, combinedSql } = buildSql({ schema, functions, triggers })

    const f1 = writeFile(outDir, `prod_${schema}_functions.sql`, functionsSql)
    const f2 = writeFile(outDir, `prod_${schema}_triggers.sql`, triggersSql)
    const f3 = writeFile(outDir, `prod_${schema}_functions_and_triggers.sql`, combinedSql)

    console.log(`[sync] wrote:`)
    console.log(`  - ${f1}`)
    console.log(`  - ${f2}`)
    console.log(`  - ${f3}`)

    if (dryRun) {
      console.log('[sync] DRY_RUN=1 이라 TEST 적용은 건너뜁니다.')
      return
    }

    await connectWithHints({ client: test, label: 'TEST', connectionString: testUrl })
    try {
      console.log('[sync] applying to TEST (functions first, triggers next)...')
      await execSql(test, functionsSql, 'TEST functions')
      await execSql(test, triggersSql, 'TEST triggers')
      console.log('[sync] ✅ done')
    } finally {
      await test.end().catch(() => { })
    }
  } finally {
    await prod.end().catch(() => { })
  }
}

main().catch((e) => {
  console.error(String(e && e.message ? e.message : e))
  process.exit(1)
})


