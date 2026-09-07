import type { NextRequest } from 'next/server'
import jwt from 'jsonwebtoken'

import { supabaseAdmin } from '@/lib/supabase'

type OperatorAccount = {
  id: string
  role: string
  school_id: string | null
  is_active: boolean
}

type SchoolContext = {
  account: OperatorAccount
  schoolId: string
  schoolType: number
}

export type SchoolAuthResult =
  | SchoolContext
  | { error: string; status: 400 | 401 | 403 | 404 | 500 }

export async function getSchoolContext(request: NextRequest): Promise<SchoolAuthResult> {
  const accessToken = request.cookies.get('op-access-token')?.value
  if (!accessToken) return { error: 'Unauthorized', status: 401 }

  const jwtSecret = process.env.JWT_SECRET
  if (!jwtSecret) return { error: 'Server auth configuration is missing.', status: 500 }

  let accountId = ''
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const decoded = jwt.verify(accessToken, jwtSecret) as any
    accountId = String(decoded.sub || '')
  } catch {
    return { error: 'Invalid session.', status: 401 }
  }

  const { data: account, error: accountError } = await supabaseAdmin
    .from('operator_accounts')
    .select('id, role, school_id, is_active')
    .eq('id', accountId)
    .maybeSingle<OperatorAccount>()

  if (accountError || !account) return { error: 'Account not found.', status: 404 }
  if (!account.is_active) return { error: 'Inactive account.', status: 403 }

  let schoolId = account.school_id
  if (account.role === 'admin') {
    schoolId = request.cookies.get('acting_school_id')?.value || null
    if (!schoolId) return { error: 'Admin acting school context is required.', status: 403 }
  } else if (account.role !== 'school') {
    return { error: 'Forbidden.', status: 403 }
  }

  if (!schoolId) return { error: 'School context is missing.', status: 400 }

  const { data: school, error: schoolError } = await supabaseAdmin
    .from('schools')
    .select('id, school_type')
    .eq('id', schoolId)
    .maybeSingle<{ id: string; school_type: number }>()

  if (schoolError || !school) return { error: 'School not found.', status: 404 }

  return {
    account,
    schoolId: school.id,
    schoolType: Number(school.school_type || 1),
  }
}
