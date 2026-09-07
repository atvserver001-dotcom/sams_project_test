'use client'

import { useAuth } from '@/contexts/AuthContext'
import Link from 'next/link'

export default function Dashboard() {
  const { user, signOut } = useAuth()

  const handleSignOut = async () => {
    await signOut()
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center gap-4">
              <h1 className="text-xl font-semibold text-gray-900">
                대시보드
              </h1>
              {user?.role === 'admin' && (
                <Link href="/admin" className="text-sm text-indigo-600 hover:text-indigo-700 underline">
                  관리자 메뉴로 이동
                </Link>
              )}
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-gray-700">
                {user?.username}님 환영합니다 ({user?.role})
              </span>
              <button
                onClick={handleSignOut}
                className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-md text-sm font-medium"
              >
                로그아웃
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <div className="border-4 border-dashed border-gray-200 rounded-lg h-96">
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <h2 className="text-2xl font-bold text-gray-900 mb-4">
                  로그인 성공!
                </h2>
                <p className="text-gray-600 mb-8">
                  이곳에 보호된 콘텐츠를 추가할 수 있습니다.
                </p>
                <div className="bg-white p-6 rounded-lg shadow">
                  <h3 className="text-lg font-medium text-gray-900 mb-4">
                    사용자 정보
                  </h3>
                  <div className="space-y-2">
                    <p className="text-gray-600">
                      <strong>아이디:</strong> {user?.username}
                    </p>
                    <p className="text-gray-600">
                      <strong>역할:</strong> {user?.role}
                    </p>
                    <p className="text-gray-600">
                      <strong>사용자 ID:</strong> {user?.id}
                    </p>
                    <p className="text-gray-600">
                      <strong>소속 학교:</strong> {user?.schoolId || 'N/A'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
