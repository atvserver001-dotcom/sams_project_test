'use client'
import { PageHeader } from '@/components/console/page-header'
import { Button } from '@/components/ui/button'
import { useFeedback } from '@/components/console/feedback-provider'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'

interface SchoolDetailItem {
  index: number
  name: string
  group_no: string
  teacher_accounts: number
  device_count: number
}

export default function SchoolDetailsPage() {
  const { notify } = useFeedback()
  const { isAdmin } = useAuth()
  const [items, setItems] = useState<SchoolDetailItem[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const pageSize = 10
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string>('')

  const fetchList = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      })
      const res = await fetch(
        `/api/admin/school-details?${params.toString()}`,
        { credentials: 'include' },
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '목록 조회 실패')
      setItems(data.items || [])
      setTotal(data.total || 0)
    } catch (e: unknown) {
      const err = e as Error
      setError(err.message || '목록 조회 실패')
    } finally {
      setLoading(false)
    }
  }, [page, pageSize])

  useEffect(() => {
    if (isAdmin) fetchList()
  }, [isAdmin, fetchList])

  const rows = useMemo(() => items.map((item) => item), [items])

  return (
    <div className="console-page space-y-6">
      <PageHeader title="학교 세부정보" eyebrow="운영 관리" />

      {error && (
        <div className="bg-destructive/5 border-l-4 border-destructive p-4">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      <div className="bg-white overflow-auto console-panel">
        <table className="min-w-full divide-y divide-border/45 console-data-table">
          <thead className="bg-muted">
            <tr>
              <th className="px-4 py-3 text-left text-[13px] font-bold text-foreground uppercase">
                번호
              </th>
              <th className="px-4 py-3 text-left text-[13px] font-bold text-foreground uppercase">
                학교 이름
              </th>
              <th className="px-4 py-3 text-left text-[13px] font-bold text-foreground uppercase">
                그룹번호
              </th>
              <th className="px-4 py-3 text-left text-[13px] font-bold text-foreground uppercase">
                교사 계정
              </th>
              <th className="px-4 py-3 text-left text-[13px] font-bold text-foreground uppercase">
                제품 구성
              </th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-border/45">
            {loading ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-6 text-center text-muted-foreground"
                >
                  불러오는 중...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-6 text-center text-muted-foreground"
                >
                  데이터가 없습니다.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.group_no}>
                  <td className="px-4 py-4 whitespace-nowrap text-[13px] text-foreground">
                    {row.index}
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap text-[13px] text-foreground">
                    {row.name}
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap text-[13px] text-foreground">
                    {row.group_no}
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap text-[13px] text-foreground">
                    {row.teacher_accounts}
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap text-[13px] text-foreground">
                    {row.device_count}
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap text-right text-[13px]">
                    <div className="inline-flex items-center gap-2">
                      <Button
                        onClick={async () => {
                          try {
                            const res = await fetch(
                              `/api/admin/act-as?group_no=${encodeURIComponent(row.group_no)}`,
                              { credentials: 'include' },
                            )
                            const data = await res.json()
                            if (!res.ok)
                              throw new Error(data.error || '전환 실패')
                            window.location.href = '/school'
                          } catch (e: unknown) {
                            const err = e as Error
                            notify(err.message || '전환 실패')
                          }
                        }}
                        variant="outline"
                        className="px-3 py-1"
                      >
                        이동
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          총 {total}건 • 페이지 {page} /{' '}
          {Math.max(1, Math.ceil(total / pageSize))}
        </div>
        <div className="inline-flex gap-2">
          <Button
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            variant="outline"
            className="px-3 py-1 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            이전
          </Button>
          <Button
            disabled={page >= Math.ceil(total / pageSize)}
            onClick={() => setPage((p) => p + 1)}
            variant="outline"
            className="px-3 py-1 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            다음
          </Button>
        </div>
      </div>
    </div>
  )
}
