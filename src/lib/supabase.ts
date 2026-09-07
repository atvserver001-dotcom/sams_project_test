import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

// 환경 변수 검증
if (!supabaseUrl || !supabaseAnonKey) {
  console.error('⚠️ Supabase 환경 변수가 설정되지 않았습니다!')
  console.error('NEXT_PUBLIC_SUPABASE_URL:', supabaseUrl ? '✓' : '✗')
  console.error('NEXT_PUBLIC_SUPABASE_ANON_KEY:', supabaseAnonKey ? '✓' : '✗')
}

// 타입 안전한 Supabase 클라이언트
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey)

// 서버 사이드용 Service Role 클라이언트 (관리자 작업용)
export const supabaseAdmin = createClient<Database>(
  supabaseUrl,
  process.env.SUPABASE_SERVICE_ROLE_KEY || supabaseAnonKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
)

// 인증 관련 타입 정의
export interface User {
  id: string
  email: string
  created_at: string
}

export interface AuthError {
  message: string
}
