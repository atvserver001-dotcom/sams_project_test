'use client'

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'

type OperatorRole = 'admin' | 'school'

interface OperatorUser {
  id: string
  username: string
  role: OperatorRole
  schoolId?: string | null
  isActive: boolean
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
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<OperatorUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [schoolName, setSchoolName] = useState<string | null>(null)

  const fetchSchoolInfo = useCallback(async () => {
    try {
      const res = await fetch('/api/school/info', { credentials: 'include' })
      if (!res.ok) return setSchoolName(null)
      const data = await res.json()
      setSchoolName(data?.school?.name || null)
    } catch {
      setSchoolName(null)
    }
  }, [])

  const refreshUser = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/me', {
        method: 'GET',
        credentials: 'include'
      })

      if (response.ok) {
        const data = await response.json()
        setUser(data.user)
        if (data?.user?.role === 'school' || data?.user?.role === 'admin') {
          await fetchSchoolInfo()
        } else {
          setSchoolName(null)
        }
      } else {
        setUser(null)
        setSchoolName(null)
      }
    } catch (error) {
      console.error('사용자 정보 조회 오류:', error)
      setUser(null)
      setSchoolName(null)
    }
  }, [fetchSchoolInfo])

  useEffect(() => {
    const checkAuth = async () => {
      await refreshUser()
      setLoading(false)
    }

    checkAuth()
  }, [refreshUser])

  const signIn = async (username: string, password: string) => {
    try {
      const response = await fetch('/api/auth/signin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ username, password }),
      })

      const data = await response.json()

      if (response.ok) {
        setUser(data.user)
        if (data?.user?.role === 'school') {
          await fetchSchoolInfo()
        } else {
          setSchoolName(null)
        }
        return { user: data.user as OperatorUser }
      } else {
        return { error: data.error || '로그인에 실패했습니다.' }
      }
    } catch (error) {
      console.error('로그인 오류:', error)
      return { error: '로그인 중 오류가 발생했습니다.' }
    }
  }

  const signOut = async () => {
    try {
      await fetch('/api/auth/signout', {
        method: 'POST',
        credentials: 'include',
      })
      setUser(null)
      setSchoolName(null)
    } catch (error) {
      console.error('로그아웃 오류:', error)
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
    schoolName,
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
