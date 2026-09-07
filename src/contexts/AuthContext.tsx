'use client'

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

type OperatorRole = 'admin' | 'school'

interface OperatorUser {
  id: string
  username: string
  role: OperatorRole
  schoolId?: string | null
  isActive: boolean
}

export interface SchoolInfo {
  id: string
  name: string
  school_type: 1 | 2 | 3
}

interface AuthContextType {
  user: OperatorUser | null
  loading: boolean
  signIn: (username: string, password: string) => Promise<{ error?: string; user?: OperatorUser }>
  signOut: () => Promise<void>
  refreshUser: () => Promise<void>
  isAdmin: boolean
  isSchool: boolean
  schoolName: string | null
  schoolInfo: SchoolInfo | null
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<OperatorUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [schoolInfo, setSchoolInfo] = useState<SchoolInfo | null>(null)
  const currentRequest = useRef<AbortController | null>(null)

  const beginRequest = useCallback(() => {
    currentRequest.current?.abort()
    const request = new AbortController()
    currentRequest.current = request
    setSchoolInfo(null)
    return request
  }, [])
  const isCurrent = useCallback((request: AbortController) => currentRequest.current === request && !request.signal.aborted, [])

  const fetchSchoolInfo = useCallback(async (request: AbortController) => {
    try {
      const res = await fetch('/api/school/info', { credentials: 'include', signal: request.signal })
      const data = res.ok ? await res.json() : null
      if (isCurrent(request)) setSchoolInfo(data?.school ?? null)
    } catch {
      if (isCurrent(request)) setSchoolInfo(null)
    }
  }, [isCurrent])

  const refreshUser = useCallback(async () => {
    const request = beginRequest()
    try {
      const response = await fetch('/api/auth/me', {
        method: 'GET',
        credentials: 'include',
        signal: request.signal,
      })
      const data = response.ok ? await response.json() : null
      if (!isCurrent(request)) return
      setUser(data?.user ?? null)
      if (data?.user?.role === 'school' || data?.user?.role === 'admin') {
        void fetchSchoolInfo(request)
      }
    } catch (error) {
      if (!isCurrent(request)) return
      console.error('사용자 정보 조회 오류:', error)
      setUser(null)
    } finally {
      // School metadata is shared by consumers but does not block authentication.
      if (isCurrent(request)) setLoading(false)
    }
  }, [beginRequest, fetchSchoolInfo, isCurrent])

  useEffect(() => {
    void refreshUser()
    return () => currentRequest.current?.abort()
  }, [refreshUser])

  const signIn = async (username: string, password: string) => {
    const request = beginRequest()
    try {
      const response = await fetch('/api/auth/signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        signal: request.signal,
        body: JSON.stringify({ username, password }),
      })
      const data = await response.json()
      if (!isCurrent(request)) return { error: '로그인 요청이 취소되었습니다.' }
      if (response.ok) {
        setUser(data.user)
        setLoading(false)
        if (data?.user?.role === 'school') void fetchSchoolInfo(request)
        return { user: data.user as OperatorUser }
      }
      return { error: data.error || '로그인에 실패했습니다.' }
    } catch (error) {
      if (!isCurrent(request)) return { error: '로그인 요청이 취소되었습니다.' }
      console.error('로그인 오류:', error)
      return { error: '로그인 중 오류가 발생했습니다.' }
    }
  }

  const signOut = async () => {
    const request = beginRequest()
    try {
      await fetch('/api/auth/signout', {
        method: 'POST',
        credentials: 'include',
        signal: request.signal,
      })
      if (!isCurrent(request)) return
      setUser(null)
      setLoading(false)
    } catch (error) {
      if (isCurrent(request)) console.error('로그아웃 오류:', error)
    }
  }

  const value = {
    user,
    loading,
    signIn,
    signOut,
    refreshUser,
    isAdmin: user?.role === 'admin',
    isSchool: user?.role === 'school',
    schoolName: schoolInfo?.name ?? null,
    schoolInfo,
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
