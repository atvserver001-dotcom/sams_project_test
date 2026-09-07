'use client'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { PageHeader } from '@/components/console/page-header'
import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/native-select'
import { Input } from '@/components/ui/input'
import { useFeedback } from '@/components/console/feedback-provider'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'

type OperatorRole = 'admin' | 'school'

interface OperatorAccountItem {
  id: string
  username: string
  password: string
  role: OperatorRole
  school_id?: string | null
  is_active: boolean
}

interface SchoolBriefMap {
  [schoolId: string]: {
    group_no: string
    name: string
    min_end_date?: string | null
  }
}

export default function AccountsPage() {
  const { notify, confirmAction } = useFeedback()
  const { isAdmin } = useAuth()
  const [items, setItems] = useState<OperatorAccountItem[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const pageSize = 10
  const [error, setError] = useState<string>('')
  const [schoolMap, setSchoolMap] = useState<SchoolBriefMap>({})

  // form state
  const [isOpen, setIsOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<Partial<OperatorAccountItem>>({
    username: '',
    password: '',
    role: 'school',
    school_id: '',
    is_active: true,
  })

  // filters
  const [roleFilter, setRoleFilter] = useState<'all' | 'admin' | 'school'>(
    'all',
  )
  const [activeFilter, setActiveFilter] = useState<
    'all' | 'active' | 'inactive'
  >('all')
  const [groupNoQuery, setGroupNoQuery] = useState('')
  const [schoolNameQuery, setSchoolNameQuery] = useState('')

  const fetchList = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      })
      const res = await fetch(`/api/admin/accounts?${params.toString()}`, {
        credentials: 'include',
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '목록 조회 실패')
      setItems(data.items)
    } catch (e: unknown) {
      const err = e as Error
      setError(err.message || '목록 조회 실패')
    } finally {
      setLoading(false)
    }
  }, [page, pageSize])

  const fetchSchools = async () => {
    try {
      const res = await fetch('/api/admin/schools', { credentials: 'include' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '학교 목록 조회 실패')
      const map: SchoolBriefMap = {}
      for (const item of data.items || []) {
        if (item && item.id) {
          map[item.id] = {
            group_no: item.group_no,
            name: item.name,
            min_end_date:
              (item as { min_end_date?: string }).min_end_date ?? null,
          }
        }
      }
      setSchoolMap(map)
    } catch {
      // 학교 정보가 없어도 계정 목록은 보여야 하므로 오류는 조용히 무시
    }
  }

  useEffect(() => {
    if (isAdmin) fetchList()
  }, [isAdmin, fetchList])

  useEffect(() => {
    if (isAdmin) fetchSchools()
  }, [isAdmin])

  const handleOpenCreate = () => {
    setEditingId(null)
    setForm({
      username: '',
      password: '',
      role: 'school',
      school_id: '',
      is_active: true,
    })
    setIsOpen(true)
  }

  const handleOpenEdit = (row: OperatorAccountItem) => {
    setEditingId(row.id)
    setForm({
      username: row.username,
      password: row.password,
      role: row.role,
      school_id: row.school_id ?? '',
      is_active: row.is_active,
    })
    setIsOpen(true)
  }

  const handleDelete = async (id: string) => {
    if (!(await confirmAction('정말 삭제하시겠습니까?'))) return
    try {
      const res = await fetch(`/api/admin/accounts/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '삭제 실패')
      await fetchList()
    } catch (e: unknown) {
      const err = e as Error
      notify(err.message || '삭제 실패')
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      // 학교 계정은 학교 선택 필수
      if (form.role === 'school' && !form.school_id) {
        notify('학교 계정은 학교 선택이 필수입니다.')
        return
      }
      const payload = {
        username: form.username,
        password: form.password,
        role: form.role,
        school_id: form.role === 'school' ? form.school_id || null : null,
        is_active: !!form.is_active,
      }
      const res = await fetch(
        editingId ? `/api/admin/accounts/${editingId}` : '/api/admin/accounts',
        {
          method: editingId ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(payload),
        },
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '저장 실패')
      setIsOpen(false)
      await fetchList()
    } catch (e: unknown) {
      const err = e as Error
      notify(err.message || '저장 실패')
    }
  }

  const rows = useMemo(
    () => items.map((item, index) => ({ index: index + 1, ...item })),
    [items],
  )
  const filteredRows = useMemo(() => {
    const gq = groupNoQuery.trim().toLowerCase()
    const sq = schoolNameQuery.trim().toLowerCase()
    return rows.filter((row) => {
      if (roleFilter !== 'all' && row.role !== roleFilter) return false
      if (activeFilter !== 'all') {
        if (activeFilter === 'active' && !row.is_active) return false
        if (activeFilter === 'inactive' && row.is_active) return false
      }
      const school = row.school_id ? schoolMap[row.school_id] : undefined
      const groupNo = (school?.group_no || '').toLowerCase()
      const schoolName = (school?.name || '').toLowerCase()
      if (gq && !groupNo.includes(gq)) return false
      if (sq && !schoolName.includes(sq)) return false
      return true
    })
  }, [rows, roleFilter, activeFilter, groupNoQuery, schoolNameQuery, schoolMap])
  const pagedRows = useMemo(() => {
    const start = (page - 1) * pageSize
    return filteredRows.slice(start, start + pageSize)
  }, [filteredRows, page, pageSize])
  useEffect(() => {
    setPage(1)
  }, [roleFilter, activeFilter, groupNoQuery, schoolNameQuery])
  const schoolOptions = useMemo(() => {
    return Object.entries(schoolMap)
      .map(([id, v]) => ({ id, name: v.name, group_no: v.group_no }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [schoolMap])

  return (
    <div className="console-page space-y-6">
      <PageHeader
        title="계정관리"
        eyebrow="운영 관리"
        actions={
          <>
            <Button
              onClick={handleOpenCreate}
              variant="default"
              className="px-4 py-2 text-sm font-medium"
            >
              생성
            </Button>
          </>
        }
      />

      {error && (
        <div className="bg-destructive/5 border-l-4 border-destructive p-4">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white p-4 console-panel">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs font-semibold text-foreground mb-1">
              권한
            </label>
            <NativeSelect
              className="block w-40 h-10 px-3 border border-border bg-white text-sm text-foreground"
              value={roleFilter}
              onChange={(e) =>
                setRoleFilter(e.target.value as 'all' | 'admin' | 'school')
              }
            >
              <option value="all">전체</option>
              <option value="admin">관리자</option>
              <option value="school">학교 계정</option>
            </NativeSelect>
          </div>
          <div>
            <label className="block text-xs font-semibold text-foreground mb-1">
              활성화
            </label>
            <NativeSelect
              className="block w-40 h-10 px-3 border border-border bg-white text-sm text-foreground"
              value={activeFilter}
              onChange={(e) =>
                setActiveFilter(e.target.value as 'all' | 'active' | 'inactive')
              }
            >
              <option value="all">전체</option>
              <option value="active">활성</option>
              <option value="inactive">비활성</option>
            </NativeSelect>
          </div>
          <div>
            <label className="block text-xs font-semibold text-foreground mb-1">
              그룹번호
            </label>
            <Input
              className="block w-48 h-10 px-3 border border-border bg-white text-sm text-foreground"
              placeholder="그룹번호"
              value={groupNoQuery}
              onChange={(e) => setGroupNoQuery(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-foreground mb-1">
              소속학교
            </label>
            <Input
              className="block w-64 h-10 px-3 border border-border bg-white text-sm text-foreground"
              placeholder="학교명 검색"
              value={schoolNameQuery}
              onChange={(e) => setSchoolNameQuery(e.target.value)}
            />
          </div>
          <div className="ml-auto">
            <Button
              onClick={() => {
                setRoleFilter('all')
                setActiveFilter('all')
                setGroupNoQuery('')
                setSchoolNameQuery('')
              }}
              variant="outline"
              className="h-10 px-3 text-sm"
            >
              초기화
            </Button>
          </div>
        </div>
      </div>

      <div className="bg-white overflow-auto console-panel">
        <table className="min-w-full divide-y divide-border/45 console-data-table">
          <thead className="bg-muted">
            <tr>
              <th className="px-4 py-3 text-left text-[13px] font-bold text-foreground uppercase">
                번호
              </th>
              <th className="px-4 py-3 text-left text-[13px] font-bold text-foreground uppercase">
                ID
              </th>
              <th className="px-4 py-3 text-left text-[13px] font-bold text-foreground uppercase">
                비밀번호
              </th>
              <th className="px-4 py-3 text-left text-[13px] font-bold text-foreground uppercase">
                권한
              </th>
              <th className="px-4 py-3 text-left text-[13px] font-bold text-foreground uppercase">
                그룹번호
              </th>
              <th className="px-4 py-3 text-left text-[13px] font-bold text-foreground uppercase">
                소속학교
              </th>
              <th className="px-4 py-3 text-left text-[13px] font-bold text-foreground uppercase">
                활성화
              </th>
              <th className="px-4 py-3 text-left text-[13px] font-bold text-foreground uppercase">
                특이사항
              </th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-border/45">
            {loading ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-6 text-center text-muted-foreground"
                >
                  불러오는 중...
                </td>
              </tr>
            ) : filteredRows.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-6 text-center text-muted-foreground"
                >
                  데이터가 없습니다.
                </td>
              </tr>
            ) : (
              pagedRows.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-4 whitespace-nowrap text-[13px] text-foreground">
                    {row.index}
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap text-[13px] text-foreground">
                    {row.username}
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap text-[13px] text-foreground">
                    {row.password}
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap text-[13px] text-foreground">
                    {row.role === 'admin' ? '관리자' : '학교 계정'}
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap text-[13px] text-foreground">
                    {row.school_id
                      ? schoolMap[row.school_id]?.group_no || '-'
                      : '-'}
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap text-[13px] text-foreground">
                    {row.school_id
                      ? schoolMap[row.school_id]?.name || '-'
                      : '-'}
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap text-[13px]">
                    <span
                      className={`inline-flex items-center px-2 py-1 text-xs font-medium ${row.is_active ? 'bg-accent text-foreground' : 'bg-muted text-foreground'}`}
                    >
                      {row.is_active ? '활성' : '비활성'}
                    </span>
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap text-[13px] text-foreground">
                    {(() => {
                      const s = row.school_id
                        ? schoolMap[row.school_id]
                        : undefined
                      const end = s?.min_end_date || null
                      if (!end) return '-'
                      const today = new Date()
                      const endDate = new Date(end + 'T00:00:00')
                      const diffMs =
                        endDate.getTime() -
                        new Date(
                          today.getFullYear(),
                          today.getMonth(),
                          today.getDate(),
                        ).getTime()
                      const diffDays = Math.floor(
                        diffMs / (1000 * 60 * 60 * 24),
                      )
                      if (diffDays < 0) {
                        return (
                          <span className="text-destructive">
                            기간종료({diffDays}일)
                          </span>
                        )
                      }
                      return (
                        <span className="text-foreground">
                          {diffDays}일 남음
                        </span>
                      )
                    })()}
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap text-right text-[13px]">
                    <div className="inline-flex items-center gap-2">
                      <Button
                        onClick={() => handleOpenEdit(row)}
                        variant="outline"
                        className="px-3 py-1"
                      >
                        수정
                      </Button>
                      <Button
                        onClick={() => handleDelete(row.id)}
                        variant="outline"
                        className="px-3 py-1 text-destructive hover:text-destructive"
                      >
                        삭제
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
          총 {filteredRows.length}건 • 페이지 {page} /{' '}
          {Math.max(1, Math.ceil((filteredRows.length || 1) / pageSize))}
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
            disabled={page >= Math.ceil((filteredRows.length || 1) / pageSize)}
            onClick={() => setPage((p) => p + 1)}
            variant="outline"
            className="px-3 py-1 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            다음
          </Button>
        </div>
      </div>

      {isOpen && (
        <Dialog
          open
          onOpenChange={(open) => {
            setIsOpen(open)
          }}
        >
          <DialogContent
            showCloseButton={false}
            aria-describedby={undefined}
            className="bg-white w-full sm:max-w-lg p-6 max-h-[90dvh] overflow-y-auto"
          >
            <DialogTitle className="sr-only">계정 관리</DialogTitle>
            <h2 className="text-lg font-semibold text-foreground mb-4">
              {editingId ? '계정 수정' : '계정 생성'}
            </h2>
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div>
                <label
                  htmlFor="account-username"
                  className="block text-sm font-medium text-foreground mb-1"
                >
                  ID
                </label>
                <Input
                  id="account-username"
                  className="w-full border border-border px-3 py-2 text-foreground"
                  value={form.username || ''}
                  onChange={(e) =>
                    setForm((s) => ({ ...s, username: e.target.value }))
                  }
                  required
                />
              </div>
              <div>
                <label
                  htmlFor="account-password"
                  className="block text-sm font-medium text-foreground mb-1"
                >
                  비밀번호
                </label>
                <Input
                  id="account-password"
                  className="w-full border border-border px-3 py-2 text-foreground"
                  value={form.password || ''}
                  onChange={(e) =>
                    setForm((s) => ({ ...s, password: e.target.value }))
                  }
                  required
                />
              </div>
              <div>
                <label
                  htmlFor="account-role"
                  className="block text-sm font-medium text-foreground mb-1"
                >
                  권한
                </label>
                <NativeSelect
                  id="account-role"
                  className="w-full border border-border px-3 py-2 text-foreground"
                  value={form.role}
                  onChange={(e) => {
                    const v = e.target.value as OperatorRole
                    setForm((s) => ({
                      ...s,
                      role: v,
                      school_id: v === 'admin' ? '' : s.school_id,
                    }))
                  }}
                >
                  <option value="admin">관리자</option>
                  <option value="school">학교 계정</option>
                </NativeSelect>
              </div>
              {form.role === 'school' && (
                <div>
                  <label
                    htmlFor="account-school"
                    className="block text-sm font-medium text-foreground mb-1"
                  >
                    학교 선택
                  </label>
                  <NativeSelect
                    id="account-school"
                    className="w-full border border-border px-3 py-2 text-foreground"
                    value={form.school_id || ''}
                    onChange={(e) =>
                      setForm((s) => ({ ...s, school_id: e.target.value }))
                    }
                    required={form.role === 'school'}
                  >
                    <option value="">-- 학교 선택 --</option>
                    {schoolOptions.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.name}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              )}
              <div className="flex items-center gap-2">
                <Checkbox
                  id="is_active"
                  checked={!!form.is_active}
                  onCheckedChange={(checked) =>
                    setForm((s) => ({ ...s, is_active: checked === true }))
                  }
                />
                <label htmlFor="is_active" className="text-sm text-foreground">
                  활성화
                </label>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  variant="outline"
                  className="px-4 py-2"
                >
                  취소
                </Button>
                <Button type="submit" variant="default" className="px-4 py-2">
                  저장
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
