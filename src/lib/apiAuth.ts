import type { NextRequest } from 'next/server'
import jwt from 'jsonwebtoken'

export type OperatorRole = 'admin' | 'school'

export type OperatorJwtPayload = jwt.JwtPayload & {
  role?: OperatorRole
  school_id?: string | null
  group_no?: string
}

export type RequireRoleResult =
  | { decoded: OperatorJwtPayload }
  | { error: string; status: 401 | 403 }

function getToken(req: NextRequest) {
  return req.cookies.get('op-access-token')?.value
}

export function requireAdmin(req: NextRequest): RequireRoleResult {
  const token = getToken(req)
  const jwtSecret = process.env.JWT_SECRET
  if (!token || !jwtSecret) return { error: 'Unauthorized', status: 401 }

  try {
    const decoded = jwt.verify(token, jwtSecret) as OperatorJwtPayload
    if (decoded?.role !== 'admin') return { error: 'Forbidden', status: 403 }
    return { decoded }
  } catch {
    return { error: 'Invalid token', status: 401 }
  }
}

export function requireOperator(req: NextRequest): RequireRoleResult {
  const token = getToken(req)
  const jwtSecret = process.env.JWT_SECRET
  if (!token || !jwtSecret) return { error: 'Unauthorized', status: 401 }

  try {
    const decoded = jwt.verify(token, jwtSecret) as OperatorJwtPayload
    if (decoded?.role !== 'admin' && decoded?.role !== 'school') return { error: 'Forbidden', status: 403 }
    return { decoded }
  } catch {
    return { error: 'Invalid token', status: 401 }
  }
}


