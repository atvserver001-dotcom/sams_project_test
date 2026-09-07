'use client'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { PageHeader } from '@/components/console/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useFeedback } from '@/components/console/feedback-provider'

import React, { useEffect, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'

interface DeviceRow {
  id: string
  device_name: string
  sort_order?: number | null
  icon_url?: string | null
  icon_path?: string | null
  linkable?: boolean
}
interface ContentRow {
  id: string
  name: string
  description?: string
  color_hex?: string
  devices: { id: string; name: string }[]
}

export default function AdminDevicesPage() {
  const { notify, confirmAction } = useFeedback()
  const { isAdmin } = useAuth()
  const [activeTab, setActiveTab] = useState<'content' | 'device'>('content')

  const [devices, setDevices] = useState<DeviceRow[]>([])
  const [contents, setContents] = useState<ContentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [isDeviceModalOpen, setIsDeviceModalOpen] = useState(false)
  const [isContentModalOpen, setIsContentModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const [deviceName, setDeviceName] = useState('')
  const [deviceIconFile, setDeviceIconFile] = useState<File | null>(null)
  const [deviceIconPreview, setDeviceIconPreview] = useState<string>('')
  const [deviceLinkable, setDeviceLinkable] = useState(false)

  const [contentName, setContentName] = useState('')
  const [contentDesc, setContentDesc] = useState('')
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<string[]>([])
  const [contentColorHex, setContentColorHex] = useState<string>('#DBEAFE')

  const [formError, setFormError] = useState('')

  const fetchAll = async () => {
    setLoading(true)
    setError('')
    try {
      const [devRes, contRes] = await Promise.all([
        fetch('/api/admin/devices', { credentials: 'include' }),
        fetch('/api/admin/contents', { credentials: 'include' }),
      ])
      const devData = await devRes.json()
      const contData = await contRes.json()

      if (!devRes.ok) throw new Error(devData.error || '디바이스 조회 실패')
      if (!contRes.ok) throw new Error(contData.error || '컨텐츠 조회 실패')

      setDevices(devData.items || [])
      setContents(contData.items || [])
    } catch (e: unknown) {
      const err = e as Error
      setError(err.message || '목록 조회 실패')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAdmin) fetchAll()
  }, [isAdmin])

  // --- Device Management ---
  const openDeviceCreate = () => {
    setEditingId(null)
    setDeviceName('')
    setDeviceIconFile(null)
    setDeviceIconPreview('')
    setDeviceLinkable(false)
    setFormError('')
    setIsDeviceModalOpen(true)
  }

  const openDeviceEdit = (row: DeviceRow) => {
    setEditingId(row.id)
    setDeviceName(row.device_name)
    setDeviceIconFile(null)
    setDeviceIconPreview(row.icon_url || '')
    setDeviceLinkable(!!row.linkable)
    setFormError('')
    setIsDeviceModalOpen(true)
  }

  const handleDeviceDelete = async (id: string) => {
    if (
      !(await confirmAction(
        '정말 삭제하시겠습니까? (컨텐츠나 학교에 할당된 경우 실패할 수 있습니다)',
      ))
    )
      return
    try {
      const res = await fetch(`/api/admin/devices/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || '삭제 실패')
      }
      await fetchAll()
    } catch (e: unknown) {
      const err = e as Error
      notify(err.message || '삭제 실패')
    }
  }

  const handleDeviceSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError('')
    try {
      const name = deviceName.trim()
      if (!name) return setFormError('디바이스 이름을 입력해주세요.')

      const res = await fetch(
        editingId ? `/api/admin/devices/${editingId}` : '/api/admin/devices',
        {
          method: editingId ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ device_name: name, linkable: deviceLinkable }),
        },
      )
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || '저장 실패')
      }
      const data = await res.json()
      const deviceId = editingId || data?.item?.id

      // 아이콘 업로드(선택된 경우)
      if (deviceId && deviceIconFile) {
        const form = new FormData()
        form.append('file', deviceIconFile)
        const upRes = await fetch(
          `/api/admin/devices/${encodeURIComponent(deviceId)}/icon`,
          {
            method: 'POST',
            credentials: 'include',
            body: form,
          },
        )
        const upData = await upRes.json().catch(() => ({}))
        if (!upRes.ok) throw new Error(upData.error || '아이콘 업로드 실패')
      }
      setIsDeviceModalOpen(false)
      await fetchAll()
    } catch (e: unknown) {
      const err = e as Error
      setFormError(err.message || '저장 실패')
    }
  }

  // --- Content Management ---
  const openContentCreate = () => {
    setEditingId(null)
    setContentName('')
    setContentDesc('')
    setSelectedDeviceIds([])
    setContentColorHex('#DBEAFE')
    setFormError('')
    setIsContentModalOpen(true)
  }

  const openContentEdit = (row: ContentRow) => {
    setEditingId(row.id)
    setContentName(row.name)
    setContentDesc(row.description || '')
    setSelectedDeviceIds(row.devices.map((d) => d.id))
    setContentColorHex(row.color_hex || '#DBEAFE')
    setFormError('')
    setIsContentModalOpen(true)
  }

  const handleContentDelete = async (id: string) => {
    if (
      !(await confirmAction(
        '정말 삭제하시겠습니까? (학교에 할당된 경우 실패할 수 있습니다)',
      ))
    )
      return
    try {
      const res = await fetch(`/api/admin/contents/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || '삭제 실패')
      }
      await fetchAll()
    } catch (e: unknown) {
      const err = e as Error
      notify(err.message || '삭제 실패')
    }
  }

  const handleContentSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError('')
    try {
      const name = contentName.trim()
      if (!name) return setFormError('컨텐츠 이름을 입력해주세요.')

      const res = await fetch(
        editingId ? `/api/admin/contents/${editingId}` : '/api/admin/contents',
        {
          method: editingId ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            name,
            description: contentDesc,
            device_ids: selectedDeviceIds,
            color_hex: contentColorHex,
          }),
        },
      )
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || '저장 실패')
      }
      setIsContentModalOpen(false)
      await fetchAll()
    } catch (e: unknown) {
      const err = e as Error
      setFormError(err.message || '저장 실패')
    }
  }

  const persistDeviceOrder = async (newItems: DeviceRow[]) => {
    try {
      const order = newItems.map((x) => x.id)
      const res = await fetch('/api/admin/devices', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ order }),
      })
      if (!res.ok) throw new Error('정렬 저장 실패')
    } catch (e) {
      console.error(e)
      fetchAll()
    }
  }

  const moveDeviceUp = (id: string) => {
    const idx = devices.findIndex((x) => x.id === id)
    if (idx <= 0) return
    const next = [...devices]
    const tmp = next[idx - 1]
    next[idx - 1] = next[idx]
    next[idx] = tmp
    setDevices(next)
    persistDeviceOrder(next)
  }

  const moveDeviceDown = (id: string) => {
    const idx = devices.findIndex((x) => x.id === id)
    if (idx === -1 || idx >= devices.length - 1) return
    const next = [...devices]
    const tmp = next[idx + 1]
    next[idx + 1] = next[idx]
    next[idx] = tmp
    setDevices(next)
    persistDeviceOrder(next)
  }

  return (
    <div className="console-page space-y-6">
      <PageHeader
        title="디바이스 관리"
        eyebrow="운영 관리"
        actions={
          <>
            <div className="flex gap-2">
              {activeTab === 'content' ? (
                <Button
                  onClick={openContentCreate}
                  variant="default"
                  className="px-4 py-2 text-sm font-medium"
                >
                  컨텐츠 추가
                </Button>
              ) : (
                <Button
                  onClick={openDeviceCreate}
                  variant="default"
                  className="px-4 py-2 text-sm font-medium"
                >
                  디바이스 추가
                </Button>
              )}
            </div>
          </>
        }
      />

      {/* Tabs */}
      <ToggleGroup
        type="single"
        value={activeTab}
        aria-label="관리 대상"
        onValueChange={(value) => {
          if (value === 'content' || value === 'device') setActiveTab(value)
        }}
      >
        <ToggleGroupItem value="content">컨텐츠 관리</ToggleGroupItem>
        <ToggleGroupItem value="device">디바이스 관리</ToggleGroupItem>
      </ToggleGroup>

      {error && (
        <div className="bg-destructive/5 border-l-4 border-destructive p-4">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      <div className="bg-white overflow-auto console-panel">
        {activeTab === 'content' ? (
          <table className="min-w-full divide-y divide-border/45 console-data-table">
            <thead className="bg-muted">
              <tr>
                <th className="px-4 py-3 text-left text-[13px] font-bold text-foreground uppercase">
                  컨텐츠 이름
                </th>
                <th className="px-4 py-3 text-left text-[13px] font-bold text-foreground uppercase">
                  색상
                </th>
                <th className="px-4 py-3 text-left text-[13px] font-bold text-foreground uppercase">
                  설명
                </th>
                <th className="px-4 py-3 text-left text-[13px] font-bold text-foreground uppercase">
                  소속 디바이스
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
              ) : contents.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-6 text-center text-muted-foreground"
                  >
                    데이터가 없습니다.
                  </td>
                </tr>
              ) : (
                contents.map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-4 whitespace-nowrap text-[13px] font-medium text-foreground">
                      {row.name}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-[13px] text-foreground">
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-block h-5 w-5 border border-border"
                          style={{
                            backgroundColor: row.color_hex || '#DBEAFE',
                          }}
                          title={row.color_hex || '#DBEAFE'}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-4 text-[13px] text-muted-foreground">
                      {row.description || '-'}
                    </td>
                    <td className="px-4 py-4 text-[13px] text-foreground">
                      <div className="flex flex-wrap gap-1">
                        {row.devices.map((d) => (
                          <span
                            key={d.id}
                            className="bg-accent text-foreground px-2 py-0.5 text-xs border border-border"
                          >
                            {d.name}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-right text-[13px] font-medium">
                      <Button
                        onClick={() => openContentEdit(row)}
                        variant="outline"
                        className="mr-3"
                      >
                        수정
                      </Button>
                      <Button
                        onClick={() => handleContentDelete(row.id)}
                        variant="outline"
                        className="text-destructive hover:text-destructive"
                      >
                        삭제
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        ) : (
          <table className="min-w-full divide-y divide-border/45 console-data-table">
            <thead className="bg-muted">
              <tr>
                <th className="px-4 py-3 text-left text-[13px] font-bold text-foreground uppercase">
                  순서
                </th>
                <th className="px-4 py-3 text-left text-[13px] font-bold text-foreground uppercase">
                  디바이스 이름
                </th>
                <th className="px-4 py-3 text-left text-[13px] font-bold text-foreground uppercase">
                  연동
                </th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-border/45">
              {loading ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-6 text-center text-muted-foreground"
                  >
                    불러오는 중...
                  </td>
                </tr>
              ) : devices.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-6 text-center text-muted-foreground"
                  >
                    데이터가 없습니다.
                  </td>
                </tr>
              ) : (
                devices.map((row, idx) => (
                  <tr key={row.id}>
                    <td className="px-4 py-4 whitespace-nowrap text-[13px] text-foreground">
                      {idx + 1}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-[13px] text-foreground">
                      <div className="flex items-center gap-3">
                        {row.icon_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={row.icon_url}
                            alt={`${row.device_name} 아이콘`}
                            className="h-8 w-8 object-cover border border-border"
                          />
                        ) : (
                          <div className="h-8 w-8 bg-muted border border-border" />
                        )}
                        <span>{row.device_name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-[13px] text-foreground">
                      {row.linkable ? (
                        <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium bg-accent text-foreground">
                          가능
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground">
                          -
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-right text-[13px]">
                      <div className="inline-flex items-center gap-2">
                        <Button
                          onClick={() => moveDeviceUp(row.id)}
                          disabled={idx === 0}
                          variant="outline"
                          className="px-2 py-1 disabled:opacity-30"
                        >
                          ▲
                        </Button>
                        <Button
                          onClick={() => moveDeviceDown(row.id)}
                          disabled={idx === devices.length - 1}
                          variant="outline"
                          className="px-2 py-1 disabled:opacity-30"
                        >
                          ▼
                        </Button>
                        <Button
                          onClick={() => openDeviceEdit(row)}
                          variant="outline"
                          className="px-3 py-1"
                        >
                          수정
                        </Button>
                        <Button
                          onClick={() => handleDeviceDelete(row.id)}
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
        )}
      </div>

      {/* Device Modal */}
      {isDeviceModalOpen && (
        <Dialog
          open
          onOpenChange={(open) => {
            setIsDeviceModalOpen(open)
          }}
        >
          <DialogContent
            showCloseButton={false}
            aria-describedby={undefined}
            className="bg-white w-full sm:max-w-md p-8 max-h-[90dvh] overflow-y-auto"
          >
            <DialogTitle className="sr-only">디바이스 관리</DialogTitle>
            <h2 className="text-lg font-semibold text-foreground mb-4">
              {editingId ? '디바이스 수정' : '디바이스 추가'}
            </h2>
            <form className="space-y-4" onSubmit={handleDeviceSubmit}>
              <div>
                <label
                  htmlFor="device-name"
                  className="block text-sm font-medium text-foreground mb-1"
                >
                  디바이스 이름
                </label>
                <Input
                  id="device-name"
                  className="w-full border border-border px-3 py-2 text-foreground"
                  value={deviceName}
                  onChange={(e) => setDeviceName(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  아이콘 이미지
                </label>
                <div className="flex items-center gap-3">
                  {deviceIconPreview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={deviceIconPreview}
                      alt="아이콘 미리보기"
                      className="h-12 w-12 object-cover border border-border"
                    />
                  ) : (
                    <div className="h-12 w-12 bg-muted border border-border" />
                  )}
                  <label className="inline-flex items-center">
                    <Input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0] || null
                        setDeviceIconFile(f)
                        if (f) {
                          const url = URL.createObjectURL(f)
                          setDeviceIconPreview(url)
                        }
                      }}
                    />
                    <span className="px-3 py-2 bg-foreground text-white text-sm font-medium cursor-pointer hover:bg-foreground">
                      아이콘 선택
                    </span>
                  </label>
                  {deviceIconPreview && (
                    <Button
                      type="button"
                      onClick={() => {
                        setDeviceIconFile(null)
                        setDeviceIconPreview('')
                      }}
                      variant="outline"
                      className="px-3 py-2 text-sm"
                    >
                      제거
                    </Button>
                  )}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  권장: 정사각형 PNG/JPG (예: 256×256)
                </p>
              </div>
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-foreground cursor-pointer">
                  <Checkbox
                    className="h-4 w-4 border-border"
                    checked={deviceLinkable}
                    onCheckedChange={(checked) =>
                      setDeviceLinkable(checked === true)
                    }
                  />
                  연동 가능
                </label>
                <p className="mt-1 text-xs text-muted-foreground">
                  이 디바이스를 다른 디바이스와 연동할 수 있게 합니다.
                </p>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  onClick={() => setIsDeviceModalOpen(false)}
                  variant="outline"
                  className="px-4 py-2"
                >
                  취소
                </Button>
                <Button type="submit" variant="default" className="px-4 py-2">
                  저장
                </Button>
              </div>
              {formError && (
                <p className="text-sm text-destructive pt-2">{formError}</p>
              )}
            </form>
          </DialogContent>
        </Dialog>
      )}

      {/* Content Modal */}
      {isContentModalOpen && (
        <Dialog
          open
          onOpenChange={(open) => {
            setIsContentModalOpen(open)
          }}
        >
          <DialogContent
            showCloseButton={false}
            aria-describedby={undefined}
            className="bg-white w-full sm:max-w-lg p-8 max-h-[90dvh] overflow-y-auto"
          >
            <DialogTitle className="sr-only">콘텐츠 관리</DialogTitle>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-foreground">
                {editingId ? '컨텐츠 수정' : '컨텐츠 추가'}
              </h2>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">색상</span>
                <Input
                  type="color"
                  className="h-8 w-10 border border-border"
                  value={contentColorHex}
                  onChange={(e) => setContentColorHex(e.target.value)}
                  title="컨텐츠 색상"
                />
                <Input
                  className="w-24 border border-border px-2 py-1 text-sm text-foreground font-mono"
                  value={contentColorHex}
                  onChange={(e) => setContentColorHex(e.target.value)}
                  placeholder="#RRGGBB"
                  aria-label="컨텐츠 색상 코드"
                />
              </div>
            </div>
            <form className="space-y-4" onSubmit={handleContentSubmit}>
              <div>
                <label
                  htmlFor="content-name"
                  className="block text-sm font-medium text-foreground mb-1"
                >
                  컨텐츠 이름
                </label>
                <Input
                  id="content-name"
                  className="w-full border border-border px-3 py-2 text-foreground"
                  value={contentName}
                  onChange={(e) => setContentName(e.target.value)}
                  placeholder="예: 운동기록관리"
                  required
                />
              </div>
              <div>
                <label
                  htmlFor="content-description"
                  className="block text-sm font-medium text-foreground mb-1"
                >
                  설명
                </label>
                <Textarea
                  id="content-description"
                  className="w-full border border-border px-3 py-2 text-foreground"
                  value={contentDesc}
                  onChange={(e) => setContentDesc(e.target.value)}
                  rows={2}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  디바이스 선택 (복수 선택 가능)
                </label>
                <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto border border-border p-3">
                  {devices.map((d) => (
                    <label
                      key={d.id}
                      className="flex items-center gap-2 text-sm text-foreground cursor-pointer hover:bg-muted p-1"
                    >
                      <Checkbox
                        className="h-4 w-4"
                        checked={selectedDeviceIds.includes(d.id)}
                        onCheckedChange={(checked) => {
                          if (checked === true)
                            setSelectedDeviceIds((prev) => [...prev, d.id])
                          else
                            setSelectedDeviceIds((prev) =>
                              prev.filter((id) => id !== d.id),
                            )
                        }}
                      />
                      {d.device_name}
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  onClick={() => setIsContentModalOpen(false)}
                  variant="outline"
                  className="px-4 py-2"
                >
                  취소
                </Button>
                <Button type="submit" variant="default" className="px-4 py-2">
                  저장
                </Button>
              </div>
              {formError && (
                <p className="text-sm text-destructive pt-2">{formError}</p>
              )}
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
