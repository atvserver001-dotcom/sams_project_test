// Node health check for Supabase
/* eslint-disable @typescript-eslint/no-require-imports */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key) {
    console.error('환경 변수 누락: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY')
    process.exit(1)
  }

  const supabase = createClient(url, key)
  const { error, count } = await supabase
    .from('user_profiles')
    .select('*', { count: 'exact', head: true })

  if (error) {
    console.log(JSON.stringify({ success: false, message: 'Supabase 연결 실패', error: {
      message: error.message, code: error.code, details: error.details, hint: error.hint
    }, url }, null, 2))
    process.exit(2)
  }

  console.log(JSON.stringify({ success: true, message: 'Supabase 연결 성공', url, table: 'user_profiles', count }, null, 2))
}

main().catch((e) => { console.error(e); process.exit(1) })







