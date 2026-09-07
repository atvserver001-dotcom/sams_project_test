export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import jwt from 'jsonwebtoken'
import { supabaseAdmin } from '@/lib/supabase'
import type { TableRow } from '@/types/supabaseHelpers'

export async function GET(request: NextRequest) {
  try {
    const accessToken = request.cookies.get('op-access-token')?.value

    if (!accessToken) {
      return NextResponse.json(
        { error: '인증 토큰이 없습니다.' },
        { status: 401 }
      )
    }

    const jwtSecret = process.env.JWT_SECRET
    if (!jwtSecret) {
      return NextResponse.json({ error: '서버 설정 오류 (JWT_SECRET 누락)' }, { status: 500 })
    }

    try {
      const decoded = jwt.verify(accessToken, jwtSecret) as jwt.JwtPayload
      const userId = decoded.sub
      if (!userId) return NextResponse.json({ error: '유효하지 않은 세션입니다.' }, { status: 401 })

      // operator_accounts에서 최신 상태 조회
      const { data: account, error } = await supabaseAdmin
        .from('operator_accounts')
        .select('id, username, role, school_id, is_active')
        .eq('id', userId)
        .single<Pick<TableRow<'operator_accounts'>, 'id' | 'username' | 'role' | 'school_id' | 'is_active'>>()

      if (error || !account) {
        return NextResponse.json({ error: '사용자를 찾을 수 없습니다.' }, { status: 404 })
      }

      if (!account.is_active) {
        return NextResponse.json({ error: '비활성화된 계정입니다.' }, { status: 403 })
      }

      return NextResponse.json(
        {
          user: {
            id: account.id,
            username: account.username,
            role: account.role,
            schoolId: account.school_id || null,
            isActive: account.is_active
          }
        },
        { status: 200 }
      )
    } catch {
      return NextResponse.json({ error: '유효하지 않은 세션입니다.' }, { status: 401 })
    }

  } catch (error) {
    console.error('Auth verification error:', error)
    return NextResponse.json(
      { error: '인증 확인 중 오류가 발생했습니다.' },
      { status: 401 }
    )
  }
}
