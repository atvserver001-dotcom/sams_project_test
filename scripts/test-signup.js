// Local signup test using supabase-js
/* eslint-disable @typescript-eslint/no-require-imports */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !anon) {
    console.error('환경 변수 누락: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY')
    process.exit(1)
  }

  const supabase = createClient(url, anon)
  const argv = process.argv.slice(2)
  const args = Object.fromEntries(argv.map(kv => {
    const [k, ...rest] = kv.replace(/^--/, '').split('=')
    return [k, rest.join('=')]
  }))
  const email = args.email || process.env.EMAIL || `testuser${Date.now()}@gmail.com`
  const password = args.password || process.env.PASSWORD || 'Passw0rd!'

  // 1) 옵션 포함 회원가입
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: '테스트 유저', birth_date: '2005-01-02' }
    }
  })

  console.log(JSON.stringify({ step: 'with_options', email, data, error }, null, 2))

  // 2) 실패 시 최소 옵션으로 재시도
  if (error) {
    const { data: data2, error: error2 } = await supabase.auth.signUp({ email, password })
    console.log(JSON.stringify({ step: 'minimal', email, data: data2, error: error2 }, null, 2))
  }
}

main().catch((e) => { console.error(e); process.exit(1) })


