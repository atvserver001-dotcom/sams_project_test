'use client'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { PageHeader } from '@/components/console/page-header'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { useFeedback } from '@/components/console/feedback-provider'
import { SchoolContentIcon } from '@/components/console/school-content-icon'

import React, { useEffect, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'

interface SchoolDeviceItem {
  id?: string
  device_id?: string
  device_name: string
  auth_key: string
  created_at?: string
  memo?: string
  link_group_id?: string | null
}
interface SchoolContentItem {
  id: string
  name: string
  period: string
  start_date?: string | null
  end_date?: string | null
  is_unlimited?: boolean
  color_hex?: string | null
  devices: SchoolDeviceItem[]
}
interface SchoolListItem {
  id: string
  group_no: string
  name: string
  school_type: 1 | 2 | 3
  recognition_key?: string
  contents: SchoolContentItem[]
  has_linkable?: boolean
}

interface ContentMaster {
  id: string
  name: string
  devices: { id: string; name: string }[]
}

interface ContentAssignment {
  content_id: string
  name: string
  start_date: string | null
  end_date: string | null
  is_unlimited: boolean
  device_quantities: { [device_id: string]: number }
  // 수정 모달에서만 사용: 기존 발급된 school_devices 목록(개별 삭제를 위해 id/device_id 포함)
  existing_devices?: SchoolDeviceItem[]
  // 수정 모달에서 개별 삭제로 선택된 school_device.id들 (저장 시 서버로 전달)
  remove_school_device_ids?: string[]
  // 수정 모달에서 "추가" 버튼으로 증가시킨 신규(아직 DB 반영 전) 인스턴스 수
  pending_additions?: { [device_id: string]: number }
}

export default function SchoolsPage() {
  const { notify, confirmAction } = useFeedback()
  const { isAdmin } = useAuth()
  const [items, setItems] = useState<SchoolListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>('')

  const [isOpen, setIsOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<{
    group_no: string
    name: string
    school_type: 1 | 2 | 3
  }>({
    group_no: '',
    name: '',
    school_type: 1,
  })
  const [contentAssignments, setContentAssignments] = useState<
    ContentAssignment[]
  >([])
  const [formError, setFormError] = useState<string>('')

  const [memoModalOpen, setMemoModalOpen] = useState(false)
  const [memoTarget, setMemoTarget] = useState<{
    schoolDeviceId: string
    label: string
  } | null>(null)
  const [memoText, setMemoText] = useState('')
  const [memoSaving, setMemoSaving] = useState(false)

  const [contentMaster, setContentMaster] = useState<ContentMaster[]>([])
  const [modalLoading, setModalLoading] = useState(false)

  // 연동 모달 state
  const [linkModalOpen, setLinkModalOpen] = useState(false)
  const [linkSchool, setLinkSchool] = useState<SchoolListItem | null>(null)
  const [linkLoading, setLinkLoading] = useState(false)
  const [linkGroups, setLinkGroups] = useState<any[]>([])
  const [linkAvailable, setLinkAvailable] = useState<any[]>([])
  const [linkPrimary, setLinkPrimary] = useState<string>('')
  const [linkSecondaries, setLinkSecondaries] = useState<string[]>([])
  const [linkSaving, setLinkSaving] = useState(false)

  const fetchContents = async () => {
    try {
      const res = await fetch('/api/admin/contents', { credentials: 'include' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '컨텐츠 목록 조회 실패')
      setContentMaster(data.items || [])
    } catch (e: unknown) {
      console.error(e)
    }
  }

  const fetchList = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/admin/schools`, { credentials: 'include' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '목록 조회 실패')
      setItems(data.items)
    } catch (e: unknown) {
      const err = e as Error
      setError(err.message || '목록 조회 실패')
    } finally {
      setLoading(false)
    }
  }
  const openMemoModal = (
    schoolDeviceId: string,
    label: string,
    currentMemo: string | undefined,
  ) => {
    setMemoTarget({ schoolDeviceId, label })
    setMemoText(currentMemo || '')
    setMemoModalOpen(true)
  }

  const saveMemo = async () => {
    if (!memoTarget) return
    setMemoSaving(true)
    try {
      const res = await fetch(
        `/api/admin/school-devices/${memoTarget.schoolDeviceId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ memo: memoText }),
        },
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || '메모 저장 실패')

      // 로컬 상태 반영
      setItems((prev) =>
        prev.map((school) => ({
          ...school,
          contents: school.contents.map((c) => ({
            ...c,
            devices: c.devices.map((d: SchoolDeviceItem) =>
              d.id === memoTarget.schoolDeviceId ? { ...d, memo: memoText } : d,
            ),
          })),
        })),
      )

      setMemoModalOpen(false)
      setMemoTarget(null)
    } catch (e: unknown) {
      const err = e as Error
      notify(err.message || '메모 저장 실패')
    } finally {
      setMemoSaving(false)
    }
  }

  // ===== 연동 모달 함수 =====
  const handleOpenLinkModal = async (school: SchoolListItem) => {
    setLinkSchool(school)
    setLinkModalOpen(true)
    setLinkLoading(true)
    setLinkPrimary('')
    setLinkSecondaries([])
    try {
      const res = await fetch(
        `/api/admin/school-linking?school_id=${school.id}`,
        {
          credentials: 'include',
        },
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '연동 정보 조회 실패')
      setLinkGroups(data.groups || [])
      setLinkAvailable(data.linkable_devices || [])
    } catch (e: unknown) {
      notify((e as Error).message || '연동 정보 조회 실패')
    } finally {
      setLinkLoading(false)
    }
  }

  const handleCreateLinkGroup = async () => {
    if (!linkPrimary) {
      notify('주 디바이스를 선택해주세요.')
      return
    }
    if (linkSecondaries.length === 0) {
      notify('부 디바이스를 1개 이상 선택해주세요.')
      return
    }
    setLinkSaving(true)
    try {
      const res = await fetch('/api/admin/school-linking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          primary_device_id: linkPrimary,
          secondary_device_ids: linkSecondaries,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '연동 그룹 생성 실패')
      // 새로고침
      if (linkSchool) handleOpenLinkModal(linkSchool)
    } catch (e: unknown) {
      notify((e as Error).message || '연동 그룹 생성 실패')
    } finally {
      setLinkSaving(false)
    }
  }

  const handleDeleteLinkGroup = async (groupId: string) => {
    if (!(await confirmAction('이 연동 그룹을 삭제하시겠습니까?'))) return
    try {
      const res = await fetch(`/api/admin/school-linking?group_id=${groupId}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '연동 그룹 삭제 실패')
      // 새로고침
      if (linkSchool) handleOpenLinkModal(linkSchool)
    } catch (e: unknown) {
      notify((e as Error).message || '연동 그룹 삭제 실패')
    }
  }

  const toggleSecondary = (id: string) => {
    setLinkSecondaries((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  useEffect(() => {
    if (isAdmin) {
      fetchList()
      fetchContents()
    }
  }, [isAdmin])

  const handleOpenCreate = () => {
    setEditingId(null)
    setForm({ group_no: '', name: '', school_type: 1 })
    setContentAssignments([])
    setFormError('')
    setIsOpen(true)
  }

  const sortInstances = (arr: SchoolDeviceItem[]) => {
    return [...arr].sort((a, b) => {
      const ad = a.created_at || ''
      const bd = b.created_at || ''
      if (ad !== bd) return ad.localeCompare(bd)
      return String(a.id || '').localeCompare(String(b.id || ''))
    })
  }

  const handleOpenEdit = async (row: SchoolListItem) => {
    setModalLoading(true)
    setEditingId(row.group_no)
    setForm({
      group_no: row.group_no,
      name: row.name,
      school_type: row.school_type,
    })
    setContentAssignments([])
    setFormError('')
    setIsOpen(true)

    try {
      const res = await fetch(`/api/admin/schools/${row.group_no}`, {
        credentials: 'include',
      })
      const data = await res.json()
      if (res.ok) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const assignments: ContentAssignment[] = (data.contents || []).map(
          (c: any) => {
            // 각 디바이스별 수량 계산
            const quantities: { [id: string]: number } = {}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            c.devices.forEach((d: any) => {
              quantities[d.device_id] = (quantities[d.device_id] || 0) + 1
            })

            return {
              content_id: c.content_id,
              name: c.name,
              start_date: c.start_date || null,
              end_date: c.end_date || null,
              is_unlimited: !!c.is_unlimited,
              device_quantities: quantities,
              existing_devices: c.devices,
              remove_school_device_ids: [],
              pending_additions: {},
            }
          },
        )
        setContentAssignments(assignments)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setModalLoading(false)
    }
  }

  const handleDelete = async (groupNo: string) => {
    if (
      !(await confirmAction(
        '학교의 모든 데이터가 삭제됩니다. 정말 삭제 하시겠습니까?',
      ))
    )
      return
    try {
      const res = await fetch(`/api/admin/schools/${groupNo}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || '삭제 실패')
      }
      await fetchList()
    } catch (e: unknown) {
      const err = e as Error
      notify(err.message || '삭제 실패')
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError('')

    try {
      if (!/^\d{4}$/.test(form.group_no))
        return setFormError('그룹번호는 숫자 4자리여야 합니다.')

      const payload = {
        ...form,
        content_assignments: contentAssignments.map((a) => ({
          content_id: a.content_id,
          start_date: a.start_date,
          end_date: a.end_date,
          is_unlimited: a.is_unlimited,
          remove_school_device_ids: (a.remove_school_device_ids || []).filter(
            Boolean,
          ),
          device_quantities: Object.entries(a.device_quantities).map(
            ([device_id, quantity]) => ({
              device_id,
              quantity,
            }),
          ),
        })),
      }

      const res = await fetch(
        editingId ? `/api/admin/schools/${editingId}` : '/api/admin/schools',
        {
          method: editingId ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(payload),
        },
      )

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || '저장 실패')
      }

      setIsOpen(false)
      await fetchList()
    } catch (e: unknown) {
      const err = e as Error
      setFormError(err.message || '저장 실패')
    }
  }

  const toggleContent = (content: ContentMaster, checked: boolean) => {
    if (checked) {
      const initialQuantities: { [id: string]: number } = {}
      content.devices.forEach((d) => (initialQuantities[d.id] = 0))

      setContentAssignments((prev) => [
        ...prev,
        {
          content_id: content.id,
          name: content.name,
          start_date: null,
          end_date: null,
          is_unlimited: true,
          device_quantities: initialQuantities,
          remove_school_device_ids: [],
          pending_additions: {},
        },
      ])
    } else {
      setContentAssignments((prev) =>
        prev.filter((a) => a.content_id !== content.id),
      )
    }
  }

  const startOfToday = () => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  }

  const diffDays = (endDateStr: string) => {
    const end = new Date(endDateStr)
    end.setHours(0, 0, 0, 0)
    const today = startOfToday()
    const ms = end.getTime() - today.getTime()
    return Math.ceil(ms / (1000 * 60 * 60 * 24))
  }

  const renderPeriod = (c: SchoolContentItem) => {
    if (c.is_unlimited) {
      return <div className="text-xs text-muted-foreground">제한없음</div>
    }

    const hasDateRange = !!(c.start_date && c.end_date)
    const dateRangeText = hasDateRange
      ? `${c.start_date} ~ ${c.end_date}`
      : c.period

    if (c.end_date) {
      const days = diffDays(c.end_date)
      return (
        <div className="space-y-0.5">
          <div className="text-xs text-muted-foreground">{dateRangeText}</div>
          {days < 0 ? (
            <div className="text-xs font-semibold text-destructive">
              기간종료({days}일)
            </div>
          ) : (
            <div className="text-xs font-semibold text-foreground">
              {days}일 남음
            </div>
          )}
        </div>
      )
    }

    return <div className="text-xs text-muted-foreground">{dateRangeText}</div>
  }

  const renderDeviceKeys = (devices: SchoolDeviceItem[]) => {
    // 보기 좋게 정렬: 디바이스명 -> created_at -> auth_key
    const sorted = [...devices].sort((a, b) => {
      const nn = (a.device_name || '').localeCompare(b.device_name || '')
      if (nn !== 0) return nn
      const ad = a.created_at || ''
      const bd = b.created_at || ''
      if (ad !== bd) return ad.localeCompare(bd)
      return (a.auth_key || '').localeCompare(b.auth_key || '')
    })

    const counter = new Map<string, number>()
    return sorted.map((d, i) => {
      const n = (counter.get(d.device_name) || 0) + 1
      counter.set(d.device_name, n)
      return (
        <div
          key={`${d.device_name}-${d.auth_key}-${i}`}
          className="text-xs flex gap-2 items-center whitespace-nowrap"
        >
          <span className="text-muted-foreground w-28 truncate">
            {d.device_name} #{n}:
          </span>
          <code className="bg-muted px-1 text-destructive font-mono">
            {d.auth_key}
          </code>
          <div className="w-10 flex-shrink-0 flex items-center justify-center">
            {d.link_group_id && (
              <span className="px-1.5 py-0.5 bg-accent text-foreground text-[10px] font-bold border border-border">
                연동
              </span>
            )}
          </div>
          <Button
            type="button"
            onClick={() =>
              openMemoModal(String(d.id), `${d.device_name} #${n}`, d.memo)
            }
            variant="outline"
            className="ml-2 px-2 py-0.5 text-[11px]"
          >
            메모
          </Button>
          {d.memo && (
            <span
              className="ml-2 text-[11px] text-muted-foreground truncate max-w-[300px]"
              title={d.memo}
            >
              {d.memo}
            </span>
          )}
        </div>
      )
    })
  }

  const renderContentBadge = (c: SchoolContentItem) => {
    return (
      <div className="school-content-badge inline-flex items-center gap-1.5 border border-border/45 bg-muted/40 px-2 py-0.5 text-sm font-bold text-foreground">
        <SchoolContentIcon name={c.name} />
        {c.name}
      </div>
    )
  }

  const renderContentDeviceCard = (c: SchoolContentItem) => {
    return (
      <div
        key={c.id}
        className="school-content-device-card border border-border/45 bg-white p-2"
      >
        <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground mb-1">
          <SchoolContentIcon name={c.name} />
          {c.name}
        </div>
        <div className="border-l-2 border-border pl-2 space-y-1">
          {renderDeviceKeys(c.devices)}
        </div>
      </div>
    )
  }

  return (
    <div className="console-page space-y-6">
      <PageHeader
        title="학교관리"
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

      <div className="bg-white overflow-auto console-panel">
        <table className="min-w-full divide-y divide-border/45 console-data-table">
          <thead className="bg-muted">
            <tr>
              <th className="px-4 py-3 text-left text-[13px] font-bold text-foreground uppercase">
                번호
              </th>
              <th className="px-4 py-3 text-left text-[13px] font-bold text-foreground uppercase">
                학교 정보
              </th>
              <th className="px-4 py-3 text-left text-[13px] font-bold text-foreground uppercase">
                할당된 컨텐츠
              </th>
              <th className="px-4 py-3 text-left text-[13px] font-bold text-foreground uppercase">
                디바이스 및 인증키
              </th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-border/45">
            {loading ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-6 text-center text-muted-foreground"
                >
                  불러오는 중...
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-6 text-center text-muted-foreground"
                >
                  데이터가 없습니다.
                </td>
              </tr>
            ) : (
              items.map((row, rowIdx) => (
                <tr key={row.id}>
                  <td className="px-4 py-4 text-[13px] text-foreground align-top">
                    {rowIdx + 1}
                  </td>
                  <td className="px-4 py-4 text-[13px] text-foreground align-top">
                    <div className="font-bold">{row.name}</div>
                    <div className="text-xs text-muted-foreground">
                      그룹: {row.group_no} |{' '}
                      {row.school_type === 1
                        ? '초등'
                        : row.school_type === 2
                          ? '중등'
                          : '고등'}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      인식키: {row.recognition_key}
                    </div>
                  </td>
                  <td className="px-4 py-4 text-[13px] text-foreground align-top">
                    {row.contents.map((c) => (
                      <div key={c.id} className="mb-2 last:mb-0">
                        {renderContentBadge(c)}
                        {renderPeriod(c)}
                      </div>
                    ))}
                  </td>
                  <td className="px-4 py-4 text-[13px] text-foreground align-top">
                    <div className="space-y-2">
                      {row.contents.map((c) => renderContentDeviceCard(c))}
                    </div>
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap text-right text-[13px] align-top">
                    <div className="flex flex-col gap-2">
                      <Button
                        onClick={() => handleOpenEdit(row)}
                        variant="outline"
                        className="px-3 py-1"
                      >
                        수정
                      </Button>
                      {row.has_linkable && (
                        <Button
                          onClick={() => handleOpenLinkModal(row)}
                          variant="outline"
                          className="px-3 py-1"
                        >
                          연동
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 메모 모달 */}
      {memoModalOpen && memoTarget && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!memoSaving) {
              setMemoModalOpen(open)
              if (!open) setMemoTarget(null)
            }
          }}
        >
          <DialogContent
            showCloseButton={false}
            aria-describedby={undefined}
            className="bg-white w-full sm:max-w-md p-6 max-h-[90dvh] overflow-y-auto"
          >
            <DialogTitle className="sr-only">디바이스 메모</DialogTitle>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold text-foreground">
                메모 - {memoTarget.label}
              </h3>
              <Button
                type="button"
                onClick={() => {
                  if (memoSaving) return
                  setMemoModalOpen(false)
                  setMemoTarget(null)
                }}
                variant="outline"
                className=""
              >
                닫기
              </Button>
            </div>
            <Textarea
              className="w-full border border-border px-3 py-2 text-foreground"
              rows={4}
              value={memoText}
              onChange={(e) => setMemoText(e.target.value)}
              placeholder="메모를 입력하세요"
            />
            <div className="flex justify-end gap-2 mt-4">
              <Button
                type="button"
                onClick={() => {
                  if (memoSaving) return
                  setMemoModalOpen(false)
                  setMemoTarget(null)
                }}
                variant="outline"
                className="px-4 py-2"
              >
                취소
              </Button>
              <Button
                type="button"
                disabled={memoSaving}
                onClick={saveMemo}
                variant="default"
                className="px-4 py-2 disabled:opacity-60"
              >
                완료
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* 연동 모달 */}
      {linkModalOpen &&
        linkSchool &&
        (() => {
          // 컨텐츠별로 그룹핑 헬퍼
          const groupByContent = (devices: any[]) => {
            const map = new Map<
              string,
              {
                content_name: string
                content_color_hex: string | null
                items: any[]
              }
            >()
            devices.forEach((d: any) => {
              const key = d.content_name || '기타'
              if (!map.has(key))
                map.set(key, {
                  content_name: key,
                  content_color_hex: d.content_color_hex,
                  items: [],
                })
              map.get(key)!.items.push(d)
            })
            return Array.from(map.values())
          }
          const availableByContent = groupByContent(linkAvailable)

          return (
            <Dialog
              open
              onOpenChange={(open) => {
                setLinkModalOpen(open)
                if (!open) {
                  setLinkSchool(null)
                  void fetchList()
                }
              }}
            >
              <DialogContent
                showCloseButton={false}
                aria-describedby={undefined}
                className="bg-white w-full sm:max-w-3xl max-h-[90vh] overflow-auto flex flex-col max-h-[90dvh] overflow-y-auto"
              >
                <DialogTitle className="sr-only">
                  디바이스 연동 관리
                </DialogTitle>
                {/* 헤더 */}
                <div className="flex items-center justify-between px-6 py-4 border-b bg-primary">
                  <div>
                    <h2 className="text-lg font-bold text-foreground">
                      디바이스 연동 관리
                    </h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {linkSchool.name}
                    </p>
                  </div>
                  <Button
                    onClick={() => {
                      setLinkModalOpen(false)
                      setLinkSchool(null)
                      fetchList()
                    }}
                    variant="outline"
                    className="w-8 h-8 flex items-center justify-center transition-colors text-lg"
                  >
                    &times;
                  </Button>
                </div>

                <div className="overflow-y-auto flex-1 px-6 py-5">
                  {linkLoading ? (
                    <div className="py-16 text-center text-muted-foreground">
                      불러오는 중...
                    </div>
                  ) : (
                    <div className="space-y-8">
                      {/* ── 섹션 1: 기존 연동 그룹 ── */}
                      <section>
                        <div className="flex items-center gap-2 mb-3">
                          <div className="w-1 h-5 bg-primary"></div>
                          <h3 className="text-sm font-bold text-foreground">
                            기존 연동 그룹
                          </h3>
                          <span className="text-xs text-muted-foreground ml-1">
                            {linkGroups.length}개
                          </span>
                        </div>

                        {linkGroups.length === 0 ? (
                          <div className="border-2 border-dashed border-border p-6 text-center">
                            <p className="text-sm text-muted-foreground">
                              아직 연동 그룹이 없습니다.
                            </p>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {linkGroups.map((g: any) => (
                              <div
                                key={g.group_id}
                                className="border border-border bg-white overflow-auto"
                              >
                                <div className="flex items-center justify-between px-4 py-2 bg-muted border-b border-border">
                                  <span className="text-xs text-muted-foreground font-mono">
                                    그룹 {g.group_id.slice(0, 8)}
                                  </span>
                                  <Button
                                    onClick={() =>
                                      handleDeleteLinkGroup(g.group_id)
                                    }
                                    variant="outline"
                                    className="text-xs px-3 py-1 transition-colors text-destructive hover:text-destructive"
                                  >
                                    삭제
                                  </Button>
                                </div>
                                <div className="p-4 space-y-2">
                                  {/* 주 디바이스 */}
                                  {g.primary && (
                                    <div className="flex items-center gap-3 p-2.5 bg-accent border border-border">
                                      <span className="shrink-0 w-6 h-6 bg-primary text-white text-xs font-bold flex items-center justify-center">
                                        주
                                      </span>
                                      <div className="flex-1 min-w-0">
                                        <div className="text-sm font-semibold text-foreground">
                                          {g.primary.device_name}
                                        </div>
                                        <div className="flex items-center gap-2 mt-0.5">
                                          <span
                                            className="inline-block px-1.5 py-0.5 text-[10px] font-medium text-white"
                                            style={{
                                              backgroundColor:
                                                g.primary.content_color_hex ||
                                                '#6B7280',
                                            }}
                                          >
                                            {g.primary.content_name}
                                          </span>
                                          <span className="text-xs font-mono text-muted-foreground">
                                            {g.primary.auth_key}
                                          </span>
                                        </div>
                                      </div>
                                    </div>
                                  )}
                                  {/* 연결선 */}
                                  {g.secondaries.length > 0 && (
                                    <div className="flex items-center gap-2 pl-6">
                                      <div className="w-px h-3 bg-muted"></div>
                                      <span className="text-[10px] text-muted-foreground">
                                        연동됨
                                      </span>
                                      <div className="flex-1 h-px bg-muted"></div>
                                    </div>
                                  )}
                                  {/* 부 디바이스들 */}
                                  {g.secondaries.map((s: any) => (
                                    <div
                                      key={s.id}
                                      className="flex items-center gap-3 p-2.5 bg-muted border border-border ml-6"
                                    >
                                      <span className="shrink-0 w-6 h-6 bg-muted text-white text-xs font-bold flex items-center justify-center">
                                        부
                                      </span>
                                      <div className="flex-1 min-w-0">
                                        <div className="text-sm font-semibold text-foreground">
                                          {s.device_name}
                                        </div>
                                        <div className="flex items-center gap-2 mt-0.5">
                                          <span
                                            className="inline-block px-1.5 py-0.5 text-[10px] font-medium text-white"
                                            style={{
                                              backgroundColor:
                                                s.content_color_hex ||
                                                '#6B7280',
                                            }}
                                          >
                                            {s.content_name}
                                          </span>
                                          <span className="text-xs font-mono text-muted-foreground">
                                            {s.auth_key}
                                          </span>
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </section>

                      {/* ── 섹션 2: 새 연동 그룹 생성 ── */}
                      {linkAvailable.length >= 2 ? (
                        <section>
                          <div className="flex items-center gap-2 mb-3">
                            <div className="w-1 h-5 bg-primary"></div>
                            <h3 className="text-sm font-bold text-foreground">
                              새 연동 그룹 생성
                            </h3>
                          </div>
                          <p className="text-xs text-muted-foreground mb-4">
                            주 디바이스 1개와 부 디바이스를 선택하여 연동 그룹을
                            만드세요.
                          </p>

                          {/* 컨텐츠별 그룹 */}
                          <div className="space-y-4">
                            {availableByContent.map((group) => (
                              <div
                                key={group.content_name}
                                className="border border-border overflow-auto"
                              >
                                {/* 컨텐츠 헤더 */}
                                <div
                                  className="flex items-center gap-2 px-4 py-2.5 border-b"
                                  style={{
                                    backgroundColor:
                                      (group.content_color_hex || '#E5E7EB') +
                                      '20',
                                  }}
                                >
                                  <span
                                    className="inline-block px-2 py-0.5 text-xs font-bold text-white"
                                    style={{
                                      backgroundColor:
                                        group.content_color_hex || '#6B7280',
                                    }}
                                  >
                                    {group.content_name}
                                  </span>
                                  <span className="text-xs text-muted-foreground">
                                    {group.items.length}개 디바이스
                                  </span>
                                </div>

                                {/* 디바이스 목록 */}
                                <div className="divide-y divide-border/45">
                                  {group.items.map((d: any) => {
                                    const isPrimary = linkPrimary === d.id
                                    const isSecondary =
                                      linkSecondaries.includes(d.id)
                                    const isSelected = isPrimary || isSecondary

                                    return (
                                      <div
                                        key={d.id}
                                        className={`flex items-center gap-3 px-4 py-3 transition-colors ${
                                          isPrimary
                                            ? 'bg-accent'
                                            : isSecondary
                                              ? 'bg-accent'
                                              : 'hover:bg-muted'
                                        }`}
                                      >
                                        {/* 역할 선택 버튼 */}
                                        <div className="flex items-center gap-1.5 shrink-0">
                                          <Button
                                            type="button"
                                            onClick={() => {
                                              if (isPrimary) {
                                                setLinkPrimary('')
                                              } else {
                                                setLinkPrimary(d.id)
                                                setLinkSecondaries((prev) =>
                                                  prev.filter(
                                                    (x) => x !== d.id,
                                                  ),
                                                )
                                              }
                                            }}
                                            className={`w-7 h-7 text-xs font-bold flex items-center justify-center border-2 transition-all ${
                                              isPrimary
                                                ? 'bg-primary text-white border-border shadow-indigo-200'
                                                : 'bg-white text-muted-foreground border-border hover:border-border hover:text-foreground'
                                            }`}
                                            title="주 디바이스로 지정"
                                          >
                                            주
                                          </Button>
                                          <Button
                                            type="button"
                                            onClick={() => {
                                              if (isPrimary) return // 주 선택 시 부 불가
                                              toggleSecondary(d.id)
                                            }}
                                            className={`w-7 h-7 text-xs font-bold flex items-center justify-center border-2 transition-all ${
                                              isSecondary
                                                ? 'bg-primary text-white border-border shadow-purple-200'
                                                : isPrimary
                                                  ? 'bg-muted text-muted-foreground border-border cursor-not-allowed'
                                                  : 'bg-white text-muted-foreground border-border hover:border-border hover:text-foreground'
                                            }`}
                                            title="부 디바이스로 지정"
                                            disabled={isPrimary}
                                          >
                                            부
                                          </Button>
                                        </div>

                                        {/* 디바이스 정보 */}
                                        <div className="flex-1 min-w-0">
                                          <div className="text-sm font-medium text-foreground">
                                            {d.device_name}
                                          </div>
                                          <div className="text-xs font-mono text-muted-foreground mt-0.5">
                                            {d.auth_key}
                                          </div>
                                        </div>

                                        {/* 선택 상태 뱃지 */}
                                        {isSelected && (
                                          <span
                                            className={`shrink-0 text-[10px] font-bold px-2 py-0.5 ${
                                              isPrimary
                                                ? 'bg-accent text-foreground'
                                                : 'bg-accent text-foreground'
                                            }`}
                                          >
                                            {isPrimary
                                              ? '주 디바이스'
                                              : '부 디바이스'}
                                          </span>
                                        )}
                                      </div>
                                    )
                                  })}
                                </div>
                              </div>
                            ))}
                          </div>

                          {/* 선택 요약 & 생성 버튼 */}
                          <div className="mt-5 flex items-center justify-between p-4 bg-primary border border-border">
                            <div className="text-xs text-muted-foreground">
                              {linkPrimary ? (
                                <span>
                                  주:{' '}
                                  <strong className="text-foreground">
                                    {
                                      linkAvailable.find(
                                        (d: any) => d.id === linkPrimary,
                                      )?.device_name
                                    }
                                  </strong>
                                </span>
                              ) : (
                                <span className="text-muted-foreground">
                                  주 디바이스를 선택하세요
                                </span>
                              )}
                              {linkSecondaries.length > 0 && (
                                <span className="ml-3">
                                  부:{' '}
                                  <strong className="text-foreground">
                                    {linkSecondaries.length}개
                                  </strong>{' '}
                                  선택됨
                                </span>
                              )}
                            </div>
                            <Button
                              onClick={handleCreateLinkGroup}
                              disabled={
                                linkSaving ||
                                !linkPrimary ||
                                linkSecondaries.length === 0
                              }
                              variant="outline"
                              className="px-5 py-2 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            >
                              {linkSaving ? '생성 중...' : '연동 그룹 생성'}
                            </Button>
                          </div>
                        </section>
                      ) : linkAvailable.length > 0 ? (
                        <div className="border-2 border-dashed border-border p-6 text-center">
                          <p className="text-sm text-muted-foreground">
                            미연동 디바이스가 2개 이상이어야 새 그룹을 만들 수
                            있습니다.
                          </p>
                        </div>
                      ) : linkGroups.length === 0 ? (
                        <div className="border-2 border-dashed border-border p-6 text-center">
                          <p className="text-sm text-muted-foreground">
                            연동 가능한 디바이스가 없습니다.
                          </p>
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              </DialogContent>
            </Dialog>
          )
        })()}

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
            className="bg-white w-full sm:max-w-2xl p-8 max-h-[90vh] overflow-y-auto max-h-[90dvh] overflow-y-auto"
          >
            <DialogTitle className="sr-only">학교 관리</DialogTitle>
            <h2 className="text-lg font-semibold text-foreground mb-4">
              {editingId ? '학교 수정' : '학교 생성'}
            </h2>
            {modalLoading ? (
              <div className="flex flex-col items-center justify-center py-16 text-foreground">
                <div className="h-8 w-8 border-2 border-border border-t-gray-600 animate-spin mb-3" />
                <div className="text-sm">불러오는 중...</div>
              </div>
            ) : (
              <form className="space-y-6" onSubmit={handleSubmit}>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label
                      htmlFor="school-group"
                      className="block text-sm font-medium text-foreground mb-1"
                    >
                      그룹번호
                    </label>
                    <Input
                      id="school-group"
                      className="w-full border border-border px-3 py-2 text-foreground"
                      value={form.group_no}
                      onChange={(e) =>
                        setForm((s) => ({
                          ...s,
                          group_no: e.target.value
                            .replace(/\D/g, '')
                            .slice(0, 4),
                        }))
                      }
                      required
                      placeholder="4자리 숫자"
                      maxLength={4}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="school-name"
                      className="block text-sm font-medium text-foreground mb-1"
                    >
                      학교 이름
                    </label>
                    <Input
                      id="school-name"
                      className="w-full border border-border px-3 py-2 text-foreground"
                      value={form.name}
                      onChange={(e) =>
                        setForm((s) => ({ ...s, name: e.target.value }))
                      }
                      required
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="school-type"
                    className="block text-sm font-medium text-foreground mb-1"
                  >
                    학교 종류
                  </label>
                  <NativeSelect
                    id="school-type"
                    className="w-full border border-border px-3 py-2 text-foreground"
                    value={form.school_type}
                    onChange={(e) =>
                      setForm((s) => ({
                        ...s,
                        school_type: Number(e.target.value) as 1 | 2 | 3,
                      }))
                    }
                    required
                  >
                    <option value={1}>초등학교</option>
                    <option value={2}>중학교</option>
                    <option value={3}>고등학교</option>
                  </NativeSelect>
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    컨텐츠 선택
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {contentMaster.map((c) => (
                      <label
                        key={c.id}
                        className={`flex items-center gap-2 p-2 border cursor-pointer transition-colors ${contentAssignments.some((a) => a.content_id === c.id) ? 'bg-accent border-border text-foreground' : 'bg-muted border-border text-muted-foreground'}`}
                      >
                        <Checkbox
                          checked={contentAssignments.some(
                            (a) => a.content_id === c.id,
                          )}
                          onCheckedChange={(checked) =>
                            toggleContent(c, checked === true)
                          }
                        />
                        <span className="text-sm font-medium">{c.name}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {contentAssignments.length > 0 && (
                  <div className="space-y-4 border-t pt-4">
                    <label className="block text-sm font-medium text-foreground">
                      컨텐츠별 설정
                    </label>
                    {contentAssignments.map((a, idx) => {
                      const master = contentMaster.find(
                        (m) => m.id === a.content_id,
                      )
                      return (
                        <div
                          key={a.content_id}
                          className="bg-muted p-4 border border-border space-y-3"
                        >
                          <div className="flex items-center justify-between">
                            <h3 className="font-bold text-foreground">
                              {a.name}
                            </h3>
                            <div className="flex items-center gap-2">
                              <label className="inline-flex items-center gap-1 text-xs text-foreground">
                                <Checkbox
                                  checked={a.is_unlimited}
                                  onCheckedChange={(checked) => {
                                    const next = [...contentAssignments]
                                    next[idx].is_unlimited = checked === true
                                    setContentAssignments(next)
                                  }}
                                />
                                무제한
                              </label>
                              {!a.is_unlimited && (
                                <div className="flex gap-1">
                                  <Input
                                    type="date"
                                    aria-label={`${a.name} 시작일`}
                                    className="text-xs border px-1 py-0.5 text-foreground"
                                    value={a.start_date || ''}
                                    onChange={(e) => {
                                      const next = [...contentAssignments]
                                      next[idx].start_date = e.target.value
                                      setContentAssignments(next)
                                    }}
                                  />
                                  <span className="text-muted-foreground">
                                    ~
                                  </span>
                                  <Input
                                    type="date"
                                    aria-label={`${a.name} 종료일`}
                                    className="text-xs border px-1 py-0.5 text-foreground"
                                    value={a.end_date || ''}
                                    onChange={(e) => {
                                      const next = [...contentAssignments]
                                      next[idx].end_date = e.target.value
                                      setContentAssignments(next)
                                    }}
                                  />
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="space-y-2">
                            <label className="text-xs font-medium text-muted-foreground">
                              디바이스 수량 설정
                            </label>
                            {master?.devices.map((d) => (
                              <div
                                key={d.id}
                                className="bg-white p-2 border border-border space-y-2"
                              >
                                <div className="flex items-center justify-between">
                                  <span className="text-sm text-foreground">
                                    {d.name}
                                  </span>
                                  <div className="flex items-center gap-2">
                                    {!editingId && (
                                      <Button
                                        type="button"
                                        onClick={() => {
                                          const next = [...contentAssignments]
                                          const assignment: ContentAssignment =
                                            {
                                              ...next[idx],
                                              device_quantities: {
                                                ...next[idx].device_quantities,
                                              },
                                              existing_devices: next[idx]
                                                .existing_devices
                                                ? [
                                                    ...next[idx]
                                                      .existing_devices!,
                                                  ]
                                                : undefined,
                                              remove_school_device_ids: next[
                                                idx
                                              ].remove_school_device_ids
                                                ? [
                                                    ...next[idx]
                                                      .remove_school_device_ids!,
                                                  ]
                                                : [],
                                              pending_additions: next[idx]
                                                .pending_additions
                                                ? {
                                                    ...next[idx]
                                                      .pending_additions,
                                                  }
                                                : {},
                                            }

                                          const val =
                                            assignment.device_quantities[
                                              d.id
                                            ] || 0
                                          if (val <= 0) return

                                          assignment.device_quantities[d.id] =
                                            Math.max(0, val - 1)
                                          next[idx] = assignment
                                          setContentAssignments(next)
                                        }}
                                        variant="outline"
                                        className="w-6 h-6 flex items-center justify-center"
                                        title="수량 감소"
                                      >
                                        -
                                      </Button>
                                    )}
                                    <span className="text-sm font-mono w-4 text-center text-foreground">
                                      {a.device_quantities[d.id] || 0}
                                    </span>
                                    {!editingId ? (
                                      <Button
                                        type="button"
                                        onClick={() => {
                                          const next = [...contentAssignments]
                                          const assignment = {
                                            ...next[idx],
                                            device_quantities: {
                                              ...next[idx].device_quantities,
                                            },
                                          }
                                          assignment.device_quantities[d.id] =
                                            (assignment.device_quantities[
                                              d.id
                                            ] || 0) + 1
                                          next[idx] = assignment
                                          setContentAssignments(next)
                                        }}
                                        variant="outline"
                                        className="w-6 h-6 flex items-center justify-center"
                                        title="수량 증가"
                                      >
                                        +
                                      </Button>
                                    ) : (
                                      <Button
                                        type="button"
                                        onClick={() => {
                                          const next = [...contentAssignments]
                                          const assignment: ContentAssignment =
                                            {
                                              ...next[idx],
                                              device_quantities: {
                                                ...next[idx].device_quantities,
                                              },
                                              pending_additions: next[idx]
                                                .pending_additions
                                                ? {
                                                    ...next[idx]
                                                      .pending_additions,
                                                  }
                                                : {},
                                            }

                                          assignment.device_quantities[d.id] =
                                            (assignment.device_quantities[
                                              d.id
                                            ] || 0) + 1
                                          assignment.pending_additions =
                                            assignment.pending_additions || {}
                                          assignment.pending_additions[d.id] =
                                            (assignment.pending_additions[
                                              d.id
                                            ] || 0) + 1

                                          next[idx] = assignment
                                          setContentAssignments(next)
                                        }}
                                        variant="default"
                                        className="px-2.5 py-1 text-[11px] font-medium"
                                        title="인스턴스 추가(저장 시 발급)"
                                      >
                                        추가
                                      </Button>
                                    )}
                                  </div>
                                </div>

                                {/* 개별 인스턴스 삭제/취소 UI (수정 모달에서만) */}
                                {editingId &&
                                  ((a.existing_devices || []).some(
                                    (x) => x.device_id === d.id && !!x.id,
                                  ) ||
                                    ((a.pending_additions || {})[d.id] || 0) >
                                      0) && (
                                    <div className="flex flex-wrap items-center gap-1">
                                      <span className="text-[11px] text-muted-foreground mr-1">
                                        개별삭제
                                      </span>

                                      {/* 기존 발급분 */}
                                      {sortInstances(
                                        (a.existing_devices || []).filter(
                                          (x) => x.device_id === d.id && !!x.id,
                                        ),
                                      ).map((inst, instIdx) => (
                                        <Button
                                          key={String(inst.id)}
                                          type="button"
                                          onClick={() => {
                                            const next = [...contentAssignments]
                                            const assignment: ContentAssignment =
                                              {
                                                ...next[idx],
                                                device_quantities: {
                                                  ...next[idx]
                                                    .device_quantities,
                                                },
                                                existing_devices: next[idx]
                                                  .existing_devices
                                                  ? [
                                                      ...next[idx]
                                                        .existing_devices!,
                                                    ]
                                                  : undefined,
                                                remove_school_device_ids: next[
                                                  idx
                                                ].remove_school_device_ids
                                                  ? [
                                                      ...next[idx]
                                                        .remove_school_device_ids!,
                                                    ]
                                                  : [],
                                                pending_additions: next[idx]
                                                  .pending_additions
                                                  ? {
                                                      ...next[idx]
                                                        .pending_additions,
                                                    }
                                                  : {},
                                              }

                                            if (!inst.id) return

                                            assignment.remove_school_device_ids =
                                              Array.from(
                                                new Set([
                                                  ...(assignment.remove_school_device_ids ||
                                                    []),
                                                  String(inst.id),
                                                ]),
                                              )
                                            assignment.existing_devices = (
                                              assignment.existing_devices || []
                                            ).filter(
                                              (x) =>
                                                String(x.id) !==
                                                String(inst.id),
                                            )

                                            // UI 수량도 같이 감소
                                            const cur =
                                              assignment.device_quantities[
                                                d.id
                                              ] || 0
                                            assignment.device_quantities[d.id] =
                                              Math.max(0, cur - 1)

                                            next[idx] = assignment
                                            setContentAssignments(next)
                                          }}
                                          variant="outline"
                                          className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px]"
                                          title={`#${instIdx + 1}, ${inst.auth_key} 삭제`}
                                        >
                                          <span className="font-mono">
                                            #{instIdx + 1},
                                          </span>
                                          <span
                                            className="font-mono text-[10px] text-destructive/80 max-w-[160px] truncate"
                                            title={inst.auth_key}
                                          >
                                            {inst.auth_key}
                                          </span>
                                          <span className="text-destructive">
                                            ✕
                                          </span>
                                        </Button>
                                      ))}

                                      {/* 추가 대기분(저장 시 생성될 인스턴스) */}
                                      {(() => {
                                        const existingCount = sortInstances(
                                          (a.existing_devices || []).filter(
                                            (x) =>
                                              x.device_id === d.id && !!x.id,
                                          ),
                                        ).length
                                        const pending =
                                          (a.pending_additions || {})[d.id] || 0
                                        if (pending <= 0) return null

                                        return Array.from({
                                          length: pending,
                                        }).map((_, pi) => {
                                          const labelNum =
                                            existingCount + pi + 1
                                          return (
                                            <Button
                                              key={`pending-${d.id}-${pi}-${labelNum}`}
                                              type="button"
                                              onClick={() => {
                                                const next = [
                                                  ...contentAssignments,
                                                ]
                                                const assignment: ContentAssignment =
                                                  {
                                                    ...next[idx],
                                                    device_quantities: {
                                                      ...next[idx]
                                                        .device_quantities,
                                                    },
                                                    pending_additions: next[idx]
                                                      .pending_additions
                                                      ? {
                                                          ...next[idx]
                                                            .pending_additions,
                                                        }
                                                      : {},
                                                  }

                                                const curPending =
                                                  (assignment.pending_additions ||
                                                    {})[d.id] || 0
                                                if (curPending <= 0) return

                                                // pending 1개 취소 + 수량 1 감소
                                                assignment.pending_additions =
                                                  assignment.pending_additions ||
                                                  {}
                                                assignment.pending_additions[
                                                  d.id
                                                ] = Math.max(0, curPending - 1)
                                                const curQty =
                                                  assignment.device_quantities[
                                                    d.id
                                                  ] || 0
                                                assignment.device_quantities[
                                                  d.id
                                                ] = Math.max(0, curQty - 1)

                                                next[idx] = assignment
                                                setContentAssignments(next)
                                              }}
                                              variant="outline"
                                              className="inline-flex items-center gap-1 border-dashed px-2 py-0.5 text-[11px]"
                                              title={`#${labelNum} 추가대기(취소)`}
                                            >
                                              <span className="font-mono">
                                                #{labelNum}
                                              </span>
                                              <span className="text-destructive">
                                                ✕
                                              </span>
                                            </Button>
                                          )
                                        })
                                      })()}
                                    </div>
                                  )}
                              </div>
                            ))}
                          </div>

                          {/* 인증키 영역 제거 (인증키는 저장 시 유지/추가/삭제로 관리) */}
                        </div>
                      )
                    })}
                  </div>
                )}

                <div className="flex justify-between items-center pt-4 border-t">
                  {editingId ? (
                    <Button
                      type="button"
                      onClick={async () => {
                        const groupNo = editingId
                        await handleDelete(groupNo)
                        // 삭제 성공 시 목록이 갱신되므로 모달도 닫아 UX 정리
                        setIsOpen(false)
                      }}
                      variant="outline"
                      className="px-4 py-2 font-medium text-destructive hover:text-destructive"
                    >
                      삭제
                    </Button>
                  ) : (
                    <span />
                  )}

                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      onClick={() => setIsOpen(false)}
                      variant="outline"
                      className="px-4 py-2"
                    >
                      취소
                    </Button>
                    <Button
                      type="submit"
                      variant="default"
                      className="px-4 py-2 font-medium"
                    >
                      저장
                    </Button>
                  </div>
                </div>
                {formError && (
                  <p className="text-sm text-destructive pt-2">{formError}</p>
                )}
              </form>
            )}
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
