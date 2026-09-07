/**
 * Prepare (GENERATE ONLY) SQL to make PROD table schema match TEST.
 *
 * - No SQL is executed against PROD by this script.
 * - Focuses on public schema, tables only (no data).
 * - Generates "safe-by-default" DDL (additive). Potentially destructive changes are reported but not generated.
 *
 * Env: loads `.env.supabase.schema-sync` (gitignored by .env* rule)
 *   TEST_DB_URL=postgresql://...
 *   PROD_DB_URL=postgresql://...
 * Optional:
 *   PG_SCHEMA=public
 *   OUTPUT_DIR=scripts/sql/generated
 *
 * Run:
 *   node scripts/supabase-prepare-prod-schema-from-test.js
 */

/* eslint-disable no-console */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs')
const path = require('node:path')
const process = require('node:process')
const dns = require('node:dns').promises

require('dotenv').config({ path: '.env.supabase.schema-sync' })

const { Client } = require('pg')

function requireEnv(name) {
  const v = process.env[name]
  if (!v) throw new Error(`환경 변수 누락: ${name}`)
  return v
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function writeFile(outDir, filename, content) {
  const full = path.join(outDir, filename)
  fs.writeFileSync(full, content, 'utf8')
  return full
}

function maskConnString(cs) {
  try {
    const u = new URL(cs)
    const safeUser = u.username ? `${u.username}` : ''
    return `postgresql://${safeUser}:***@${u.host}${u.pathname || ''}`
  } catch {
    return '(invalid connection string)'
  }
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
          `[prep] ⚠️ ${label} host "${host}" 는 IPv4(A 레코드)가 없고 IPv6(AAAA)만 있을 수 있습니다. ` +
          `Windows/회사망에서 접속 실패하면 Supabase Connect의 "Session pooler" DB URL을 사용하세요.`
        )
      } catch {
        // ignore
      }
    }
  }
}

async function connectOrDie({ client, label, connectionString }) {
  try {
    await client.connect()
  } catch (e) {
    const msg = e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e)
    console.error(`[prep] ${label} connect failed: ${msg}`)
    console.error(`[prep] ${label} conn: ${maskConnString(connectionString)}`)
    throw e
  }
}

async function fetchTables(client, schema) {
  const { rows } = await client.query(
    `
    select table_name
    from information_schema.tables
    where table_schema = $1
      and table_type = 'BASE TABLE'
    order by table_name
    `,
    [schema]
  )
  return rows.map((r) => r.table_name)
}

async function fetchColumns(client, schema, table) {
  const { rows } = await client.query(
    `
    select
      column_name,
      ordinal_position,
      is_nullable,
      data_type,
      udt_schema,
      udt_name,
      character_maximum_length,
      numeric_precision,
      numeric_scale,
      datetime_precision,
      column_default,
      is_identity,
      identity_generation
    from information_schema.columns
    where table_schema = $1
      and table_name = $2
    order by ordinal_position
    `,
    [schema, table]
  )
  return rows
}

async function fetchConstraints(client, schema) {
  // Includes PK/UNIQUE/FK/CHECK. We will only auto-generate missing PK/UNIQUE/FK (safe-ish).
  const { rows } = await client.query(
    `
    select
      tc.constraint_name,
      tc.table_name,
      tc.constraint_type
    from information_schema.table_constraints tc
    where tc.constraint_schema = $1
      and tc.table_schema = $1
      and tc.constraint_type in ('PRIMARY KEY', 'UNIQUE', 'FOREIGN KEY', 'CHECK')
    order by tc.table_name, tc.constraint_name
    `,
    [schema]
  )

  const byName = new Map()
  for (const r of rows) byName.set(r.constraint_name, r)

  // PK/UNIQUE columns
  const { rows: kcu } = await client.query(
    `
    select
      constraint_name,
      table_name,
      column_name,
      ordinal_position
    from information_schema.key_column_usage
    where constraint_schema = $1
    order by table_name, constraint_name, ordinal_position
    `,
    [schema]
  )

  const columnsByConstraint = new Map()
  for (const r of kcu) {
    if (!columnsByConstraint.has(r.constraint_name)) columnsByConstraint.set(r.constraint_name, [])
    columnsByConstraint.get(r.constraint_name).push(r.column_name)
  }

  // FK references
  const { rows: rc } = await client.query(
    `
    select
      rc.constraint_name,
      ccu.table_schema as referenced_table_schema,
      ccu.table_name as referenced_table_name,
      ccu.column_name as referenced_column_name
    from information_schema.referential_constraints rc
    join information_schema.constraint_column_usage ccu
      on ccu.constraint_name = rc.unique_constraint_name
     and ccu.constraint_schema = rc.unique_constraint_schema
    where rc.constraint_schema = $1
    `,
    [schema]
  )

  const fkRefByConstraint = new Map()
  for (const r of rc) fkRefByConstraint.set(r.constraint_name, r)

  return { base: rows, columnsByConstraint, fkRefByConstraint }
}

async function fetchIndexes(client, schema) {
  const { rows } = await client.query(
    `
    select schemaname, tablename, indexname, indexdef
    from pg_indexes
    where schemaname = $1
    order by tablename, indexname
    `,
    [schema]
  )
  return rows
}

function formatType(col) {
  // Use udt_name for most types; data_type for arrays/domains can be tricky.
  // We'll produce a reasonable representation and flag unknown/custom types.
  const udt = col.udt_name
  const udtSchema = col.udt_schema

  // character varying
  if (col.data_type === 'character varying' && col.character_maximum_length) {
    return `varchar(${col.character_maximum_length})`
  }
  if (col.data_type === 'character' && col.character_maximum_length) {
    return `char(${col.character_maximum_length})`
  }
  if (col.data_type === 'numeric' && col.numeric_precision) {
    if (col.numeric_scale != null) return `numeric(${col.numeric_precision},${col.numeric_scale})`
    return `numeric(${col.numeric_precision})`
  }

  // timestamp/timestamptz precision
  if ((col.data_type === 'timestamp without time zone' || col.data_type === 'timestamp with time zone') && col.datetime_precision != null) {
    const base = col.data_type === 'timestamp with time zone' ? 'timestamptz' : 'timestamp'
    return `${base}(${col.datetime_precision})`
  }

  // User-defined types (enums/domains)
  if (udtSchema && udtSchema !== 'pg_catalog' && udtSchema !== 'information_schema') {
    return `"${udtSchema}"."${udt}"`
  }

  // Arrays: udt_name starts with '_' (e.g. _text)
  if (typeof udt === 'string' && udt.startsWith('_')) {
    const base = udt.slice(1)
    return `${base}[]`
  }

  // common types: use udt_name
  return udt
}

function buildAddColumnSql({ schema, table, col }) {
  const typeSql = formatType(col)
  const nullable = col.is_nullable === 'NO' ? 'NOT NULL' : ''
  const def = col.column_default ? `DEFAULT ${col.column_default}` : ''

  // Identity columns: do not auto-generate ALTER in safe mode; report only.
  if (col.is_identity === 'YES') {
    return {
      sql: null,
      warning:
        `- ${schema}.${table}.${col.column_name}: TEST는 IDENTITY(${col.identity_generation})인데 PROD에 안전 자동 적용을 생략했습니다(수동 확인 필요).`,
    }
  }

  const parts = [`ALTER TABLE "${schema}"."${table}" ADD COLUMN "${col.column_name}" ${typeSql}`]
  if (def) parts.push(def)
  if (nullable) parts.push(nullable)
  return { sql: `${parts.join(' ')};`, warning: null }
}

function headerLines(schema) {
  return [
    '-- AUTO-GENERATED PREP FILE. DO NOT RUN BLINDLY.',
    `-- schema: ${schema}`,
    `-- generated_at: ${new Date().toISOString()}`,
    '-- 목적: TEST 스키마를 기준으로 PROD에 적용할 DDL을 "준비" (실행은 별도)',
    '',
  ].join('\n')
}

async function main() {
  const schema = process.env.PG_SCHEMA || 'public'
  const outDir = process.env.OUTPUT_DIR || path.join('scripts', 'sql', 'generated')
  const useSsl = true

  const testUrl = requireEnv('TEST_DB_URL')
  const prodUrl = requireEnv('PROD_DB_URL')

  ensureDir(outDir)

  await preflightHost({ label: 'TEST', connectionString: testUrl })
  await preflightHost({ label: 'PROD', connectionString: prodUrl })

  const ssl = useSsl ? { rejectUnauthorized: false } : undefined
  const test = new Client({ connectionString: testUrl, ssl })
  const prod = new Client({ connectionString: prodUrl, ssl })

  console.log(`[prep] schema=${schema} outputDir=${outDir}`)
  console.log(`[prep] TEST -> ${maskConnString(testUrl)}`)
  console.log(`[prep] PROD -> ${maskConnString(prodUrl)}`)

  await connectOrDie({ client: test, label: 'TEST', connectionString: testUrl })
  await connectOrDie({ client: prod, label: 'PROD', connectionString: prodUrl })

  try {
    const [testTables, prodTables] = await Promise.all([fetchTables(test, schema), fetchTables(prod, schema)])
    const prodTableSet = new Set(prodTables)

    const warnings = []
    const ddl = []
    const report = []

    report.push(`## 스키마 동기화 준비 리포트`)
    report.push(`- schema: \`${schema}\``)
    report.push(`- generated_at: \`${new Date().toISOString()}\``)
    report.push(`- mode: **준비만(DDL 생성), PROD에 실행하지 않음**`)
    report.push('')

    // Fetch once (constraints/indexes)
    const [testCons, prodCons, testIdx, prodIdx] = await Promise.all([
      fetchConstraints(test, schema),
      fetchConstraints(prod, schema),
      fetchIndexes(test, schema),
      fetchIndexes(prod, schema),
    ])

    const prodConstraintNames = new Set(prodCons.base.map((c) => c.constraint_name))
    const prodIndexNames = new Set(prodIdx.map((i) => i.indexname))

    ddl.push(headerLines(schema))
    ddl.push('BEGIN;')
    ddl.push('')

    // 1) Missing tables: report only (creating full table safely is complex w/o pg_dump)
    const missingTables = testTables.filter((t) => !prodTableSet.has(t))
    if (missingTables.length) {
      report.push(`### PROD에 없는 테이블(생성 필요)`)
      for (const t of missingTables) report.push(`- \`${schema}.${t}\``)
      report.push('')
      warnings.push(
        `- PROD에 없는 테이블 ${missingTables.length}개가 있습니다. 이 스크립트는 안전을 위해 CREATE TABLE을 자동 생성하지 않습니다(수동/pg_dump 기반 추천).`
      )
    }

    // 2) Columns: add missing columns for tables that exist in both
    report.push(`### 컬럼 차이(추가만 자동 생성)`)
    for (const t of testTables) {
      if (!prodTableSet.has(t)) continue

      const [tCols, pCols] = await Promise.all([fetchColumns(test, schema, t), fetchColumns(prod, schema, t)])
      const pColSet = new Set(pCols.map((c) => c.column_name))

      const missingCols = tCols.filter((c) => !pColSet.has(c.column_name))
      if (!missingCols.length) continue

      report.push(`- \`${schema}.${t}\`: +${missingCols.length} columns`)
      for (const col of missingCols) {
        const { sql, warning } = buildAddColumnSql({ schema, table: t, col })
        if (warning) warnings.push(warning)
        if (sql) ddl.push(sql)
      }
      ddl.push('')
    }
    report.push('')

    // 3) Constraints: generate missing PK/UNIQUE/FK by name (safe-ish)
    // NOTE: This relies on matching constraint names; if names differ between envs, it will be reported.
    const testKeyByName = new Map(testCons.base.map((c) => [c.constraint_name, c]))
    const missingConstraints = testCons.base.filter((c) => !prodConstraintNames.has(c.constraint_name))
    if (missingConstraints.length) report.push(`### 제약조건 차이(이름 기준, 일부 자동 생성)`)

    for (const c of missingConstraints) {
      if (!['PRIMARY KEY', 'UNIQUE', 'FOREIGN KEY'].includes(c.constraint_type)) {
        warnings.push(`- 제약조건 ${c.constraint_name} (${c.constraint_type})는 자동 생성 대상에서 제외(수동 확인 필요).`)
        continue
      }

      const cols = testCons.columnsByConstraint.get(c.constraint_name) || []
      if (!cols.length) {
        warnings.push(`- 제약조건 ${c.constraint_name}는 컬럼 정보를 찾지 못해 자동 생성 불가.`)
        continue
      }

      if (c.constraint_type === 'PRIMARY KEY') {
        ddl.push(
          `ALTER TABLE "${schema}"."${c.table_name}" ADD CONSTRAINT "${c.constraint_name}" PRIMARY KEY (${cols
            .map((x) => `"${x}"`)
            .join(', ')});`
        )
      } else if (c.constraint_type === 'UNIQUE') {
        ddl.push(
          `ALTER TABLE "${schema}"."${c.table_name}" ADD CONSTRAINT "${c.constraint_name}" UNIQUE (${cols
            .map((x) => `"${x}"`)
            .join(', ')});`
        )
      } else if (c.constraint_type === 'FOREIGN KEY') {
        const ref = testCons.fkRefByConstraint.get(c.constraint_name)
        if (!ref) {
          warnings.push(`- FK ${c.constraint_name}의 참조 테이블 정보를 찾지 못해 자동 생성 불가.`)
          continue
        }
        // This is a simplification: composite FK references are not fully represented by constraint_column_usage.
        ddl.push(
          `ALTER TABLE "${schema}"."${c.table_name}" ADD CONSTRAINT "${c.constraint_name}" FOREIGN KEY (${cols
            .map((x) => `"${x}"`)
            .join(', ')}) REFERENCES "${ref.referenced_table_schema}"."${ref.referenced_table_name}" ("${ref.referenced_column_name}");`
        )
        warnings.push(`- FK ${c.constraint_name}: 복합 FK면 참조 컬럼 매핑이 다를 수 있어 적용 전 SQL 확인이 필요합니다.`)
      }
    }
    if (missingConstraints.length) ddl.push('')

    // 4) Indexes: generate missing index by index name
    const missingIndexes = testIdx.filter((i) => !prodIndexNames.has(i.indexname))
    if (missingIndexes.length) {
      report.push(`### 인덱스 차이(이름 기준, CREATE INDEX 자동 생성)`)
      report.push(`- missing indexes: ${missingIndexes.length}`)
      report.push('')
      for (const i of missingIndexes) {
        ddl.push(`${i.indexdef};`)
      }
      ddl.push('')
    }

    ddl.push('ROLLBACK;')
    ddl.push('')
    ddl.push('-- ⚠️ 기본은 ROLLBACK으로 생성됩니다. 실제 적용하려면 SQL 검토 후 COMMIT으로 바꾸거나, 별도 실행 절차를 사용하세요.')

    if (warnings.length) {
      report.push(`### 주의/수동 확인 필요`)
      for (const w of warnings) report.push(w)
      report.push('')
    }

    report.push(`### 생성 파일`)
    const sqlPath = writeFile(outDir, `prepare_prod_from_test_${schema}.sql`, ddl.join('\n'))
    const mdPath = writeFile(outDir, `prepare_prod_from_test_${schema}_report.md`, report.join('\n'))
    report.push(`- \`${sqlPath}\``)
    report.push(`- \`${mdPath}\``)

    // rewrite report with file list appended at end
    writeFile(outDir, `prepare_prod_from_test_${schema}_report.md`, report.join('\n'))

    console.log(`[prep] wrote:`)
    console.log(`  - ${sqlPath}`)
    console.log(`  - ${mdPath}`)
    console.log(`[prep] done (no changes applied)`)
  } finally {
    await Promise.all([test.end().catch(() => { }), prod.end().catch(() => { })])
  }
}

main().catch((e) => {
  console.error(String(e && e.message ? e.message : e))
  process.exit(1)
})







