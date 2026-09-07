export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import jwt from 'jsonwebtoken'
import { supabaseAdmin } from '@/lib/supabase'
import { isOperatorUsernameAllowed, parseSigninCredentials } from '@/lib/signinAccess'
import type { Database } from '@/types/database.types'

function invalidCredentialsResponse() {
  return NextResponse.json(
    { error: '아이디 또는 비밀번호가 올바르지 않습니다.' },
    {
      status: 401,
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  )
}

export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json().catch(() => null)
    const credentials = parseSigninCredentials(body)

    if (
      !credentials ||
      !isOperatorUsernameAllowed(credentials.username, process.env.PREVIEW_ALLOWED_OPERATOR_USERNAMES)
    ) {
      return invalidCredentialsResponse()
    }

    const { username, password } = credentials

    // 운영 계정 조회 (평문 비밀번호 비교)
    const { data: account, error } = await supabaseAdmin
      .from('operator_accounts')
      .select('id, username, role, school_id, is_active')
      .eq('username', username)
      .eq('password', password)
      .single<Database['public']['Tables']['operator_accounts']['Row']>()

    if (error || !account) {
      return invalidCredentialsResponse()
    }

    if (!account.is_active) {
      return NextResponse.json(
        { error: '비활성화된 계정입니다. 관리자에게 문의하세요.' },
        { status: 403 }
      )
    }

    const jwtSecret = process.env.JWT_SECRET
    if (!jwtSecret) {
      return NextResponse.json({ error: '서버 설정 오류 (JWT_SECRET 누락)' }, { status: 500 })
    }

    const tokenPayload = {
      sub: account.id,
      username: account.username,
      role: account.role,
      schoolId: account.school_id || null
    }

    const accessToken = jwt.sign(tokenPayload, jwtSecret, { expiresIn: '7d' })

    const response = NextResponse.json(
      {
        message: '로그인 성공',
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

    response.cookies.set('op-access-token', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7일
      path: '/'
    })

    return response

  } catch (error) {
    console.error('Signin error:', error)
    return NextResponse.json(
      { error: '서버 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}
