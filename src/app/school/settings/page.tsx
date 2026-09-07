'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PageHeader } from '@/components/console/page-header'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useFeedback } from '@/components/console/feedback-provider'
import { X, Settings2, StickyNote } from 'lucide-react'

import {
  isCanonicalHeartRateDeviceId,
  validateHeartRateMappings,
} from '@/lib/heartRateMapping'

type SchoolDeviceInstance = {
  id: string
  device_id: string
  device_name: string
  device_icon_url?: string | null
  auth_key: string
  memo: string
  status: string | null
  created_at: string | null
  content_name: string | null
  content_color_hex?: string | null
  link_group_id?: string | null
  is_primary?: boolean
}

type AssetItem = {
  name: string
  original_path: string
  thumb_path: string
  thumb_url: string | null
  full_url: string | null
  created_at?: string | null
  updated_at?: string | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: any
}

type CustomBlockBase = {
  id: string
  type: 'text' | 'image'
  subtitle: string
  body: string
}

type CustomTextBlock = CustomBlockBase & {
  type: 'text'
}

type CustomImageBlock = CustomBlockBase & {
  type: 'image'
  // DB 연동(테스트 DB): Storage 경로/URL
  image_name?: string | null
  image_original_path?: string | null
  image_thumb_path?: string | null
  image_full_url?: string | null
  image_thumb_url?: string | null
}

type CustomBlock = CustomTextBlock | CustomImageBlock

type SettingsPage = {
  id: string
  kind: 'custom' | 'images'
  name: string
  blocks: CustomBlock[]
  // images 페이지 전용
  image_name?: string | null
  image_original_path?: string | null
  image_thumb_path?: string | null
  image_full_url?: string | null
  image_thumb_url?: string | null
}

type DraftImageMeta = {
  _pendingFile?: File | null
  _pendingPreviewUrl?: string | null
  _pendingClear?: boolean
}

type DraftBlock = (CustomTextBlock | (CustomImageBlock & DraftImageMeta)) & {
  _temp?: boolean
}

type DraftSettingsPage = Omit<SettingsPage, 'blocks'> &
  DraftImageMeta & {
    _temp?: boolean
    blocks: DraftBlock[]
  }

export default function SchoolSettingsPage() {
  const { notify, confirmAction } = useFeedback()
  const [devices, setDevices] = useState<SchoolDeviceInstance[]>([])
  const [loadingDevices, setLoadingDevices] = useState(true)


  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)


  const [settingsModalOpen, setSettingsModalOpen] = useState(false)
  const [settingsTarget, setSettingsTarget] = useState<{ id: string; label: string } | null>(null)

  const [pagesByDeviceId, setPagesByDeviceId] = useState<Record<string, DraftSettingsPage[]>>({})
  const [originalPagesByDeviceId, setOriginalPagesByDeviceId] = useState<Record<string, SettingsPage[]>>({})
  const [activePageId, setActivePageId] = useState<string | null>(null)
  const [customImageDragOverBlockId, setCustomImageDragOverBlockId] = useState<string | null>(null)
  const [expandedImageBlocks, setExpandedImageBlocks] = useState<Record<string, boolean>>({})
  const customImageFileInputRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const pageImageFileInputRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const [settingsDirty, setSettingsDirty] = useState(false)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [settingsLoading, setSettingsLoading] = useState(false)

  // 업로드 413 방지(환경별 body limit 대응): 5MB 초과 시 브라우저에서 자동 압축/리사이즈
  const MAX_UPLOAD_BYTES = 5 * 1024 * 1024
  const MAX_DIM = 1920

  const compressImageIfNeeded = async (file: File): Promise<File> => {
    try {
      if (!file || !(file instanceof File)) return file
      if (!file.type?.startsWith('image/')) return file
      if (file.size <= MAX_UPLOAD_BYTES) return file

      const bitmap = await createImageBitmap(file)
      let w = bitmap.width
      let h = bitmap.height

      const maxSide = Math.max(w, h)
      if (maxSide > MAX_DIM) {
        const scale = MAX_DIM / maxSide
        w = Math.max(1, Math.round(w * scale))
        h = Math.max(1, Math.round(h * scale))
      }

      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) return file
      ctx.drawImage(bitmap, 0, 0, w, h)

      // quality를 낮추며 5MB 이하가 되도록 시도
      let quality = 0.86
      let blob: Blob | null = null
      for (let i = 0; i < 8; i++) {
        blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob((b) => resolve(b), 'image/jpeg', quality),
        )
        if (!blob) break
        if (blob.size <= MAX_UPLOAD_BYTES) break
        quality = Math.max(0.5, quality - 0.08)
        if (quality === 0.5 && blob.size > MAX_UPLOAD_BYTES) {
          // 해상도도 추가로 축소
          w = Math.max(1, Math.round(w * 0.85))
          h = Math.max(1, Math.round(h * 0.85))
          canvas.width = w
          canvas.height = h
          ctx.drawImage(bitmap, 0, 0, w, h)
        }
      }

      if (!blob) return file

      const base = (file.name || 'image').replace(/\.[^/.]+$/, '')
      const newName = `${base || 'image'}.jpg`
      return new File([blob], newName, { type: 'image/jpeg' })
    } catch {
      return file
    }
  }

  const [memoModalOpen, setMemoModalOpen] = useState(false)
  const [memoTarget, setMemoTarget] = useState<{ id: string; label: string } | null>(null)
  const [memoText, setMemoText] = useState('')
  const [memoSaving, setMemoSaving] = useState(false)

  // 하트 케어 ID 매핑 모달
  const [heartRateMappingModalOpen, setHeartRateMappingModalOpen] = useState(false)
  const [heartRateMappings, setHeartRateMappings] = useState<Array<{ student_no: number; device_id: string }>>([])
  const [heartRateMappingSaving, setHeartRateMappingSaving] = useState(false)
  const [heartRateMappingLabel, setHeartRateMappingLabel] = useState('')
  const heartRateMappingValidation = useMemo(
    () => validateHeartRateMappings(heartRateMappings),
    [heartRateMappings],
  )
  const duplicateHeartRateDeviceIds = useMemo(() => {
    const counts = new Map<string, number>()
    for (const mapping of heartRateMappings) {
      if (mapping.device_id !== '') {
        counts.set(mapping.device_id, (counts.get(mapping.device_id) ?? 0) + 1)
      }
    }
    return new Set(
      [...counts.entries()]
        .filter(([, count]) => count > 1)
        .map(([deviceId]) => deviceId),
    )
  }, [heartRateMappings])
  const hasInvalidHeartRateMapping = !heartRateMappingValidation.ok

  const loadDevices = async () => {
    setLoadingDevices(true)
    try {
      const res = await fetch('/api/school/school-devices', { credentials: 'include' })
      const data = await res.json()
      setDevices(Array.isArray(data.items) ? data.items : [])
    } catch {
      setDevices([])
    } finally {
      setLoadingDevices(false)
    }
  }







  useEffect(() => {
    loadDevices()
  }, [])

  // DB 연동으로 이미지는 signed URL 기반(브라우저 object URL 미사용)

  const rows = useMemo(() => {
    return devices.filter(d => !d.link_group_id || d.is_primary)
  }, [devices])

  const loadDevicePages = async (schoolDeviceId: string) => {
    const res = await fetch(`/api/school/device-pages?school_device_id=${encodeURIComponent(schoolDeviceId)}`, {
      credentials: 'include',
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || '페이지 불러오기 실패')

    const items = Array.isArray(data.items) ? data.items : []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pages: SettingsPage[] = items.map((p: any) => ({
      id: String(p.id),
      kind: p.kind === 'images' ? 'images' : 'custom',
      name: String(p.name || ''),
      image_name: p.image_name ?? null,
      image_original_path: p.image_original_path ?? null,
      image_thumb_path: p.image_thumb_path ?? null,
      image_full_url: p.image_full_url ?? null,
      image_thumb_url: p.image_thumb_url ?? null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      blocks: (Array.isArray(p.blocks) ? p.blocks : []).map((b: any) => {
        if (String(b.type) === 'image') {
          const bb: CustomImageBlock = {
            id: String(b.id),
            type: 'image',
            subtitle: String(b.subtitle || ''),
            body: String(b.body || ''),
            image_name: b.image_name ?? null,
            image_original_path: b.image_original_path ?? null,
            image_thumb_path: b.image_thumb_path ?? null,
            image_full_url: b.image_full_url ?? null,
            image_thumb_url: b.image_thumb_url ?? null,
          }
          return bb
        }
        const tt: CustomTextBlock = {
          id: String(b.id),
          type: 'text',
          subtitle: String(b.subtitle || ''),
          body: String(b.body || ''),
        }
        return tt
      }),
    }))

    // 원본(저장된 상태) 보관 + 드래프트(편집용) 생성
    setOriginalPagesByDeviceId((prev) => ({ ...prev, [schoolDeviceId]: pages }))
    const draftPages: DraftSettingsPage[] = pages.map((p) => ({
      ...p,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      blocks: (p.blocks || []).map((b) => ({ ...(b as any) })) as DraftBlock[],
    }))
    setPagesByDeviceId((prev) => ({ ...prev, [schoolDeviceId]: draftPages }))
    setActivePageId((cur) => (cur && pages.some((p) => p.id === cur) ? cur : pages[0]?.id || null))
    setSettingsDirty(false)
    setSettingsLoading(false)
  }

  const openSettingsModal = async (id: string, label: string) => {
    // 이전 드래프트가 잠깐 보였다가 사라지는 “깜빡임” 방지:
    // 모달 오픈 직전에 해당 디바이스 드래프트를 즉시 초기화하고 로딩 UI로 전환
    setSettingsDirty(false)
    setSettingsLoading(true)
    setActivePageId(null)
    setExpandedImageBlocks({})
    setCustomImageDragOverBlockId(null)
    setPagesByDeviceId((prev) => ({ ...prev, [id]: [] }))
    setOriginalPagesByDeviceId((prev) => ({ ...prev, [id]: [] }))

    setSettingsTarget({ id, label })
    setSettingsModalOpen(true)
    try {
      await loadDevicePages(id)
    } catch (e: unknown) {
      setSettingsLoading(false)
      const message = e instanceof Error ? e.message : String(e)
      notify(message || '페이지 불러오기 실패')
    }
  }

  const closeSettingsModal = async () => {
    if (settingsSaving) return
    if (settingsDirty && !(await confirmAction('저장되지 않은 변경사항이 있습니다. 닫을까요?'))) return

    // 드래프트에서 생성한 objectURL 정리
    if (settingsTarget) {
      const cur = pagesByDeviceId[settingsTarget.id] || []
      for (const p of cur) {
        if (p._pendingPreviewUrl) revokePreview(p._pendingPreviewUrl)
        for (const b of p.blocks || []) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const bb: any = b
          if (bb?._pendingPreviewUrl) revokePreview(bb._pendingPreviewUrl)
        }
      }
    }

    setSettingsModalOpen(false)
    setSettingsTarget(null)
    setActivePageId(null)
    setCustomImageDragOverBlockId(null)
    setExpandedImageBlocks({})
    setSettingsDirty(false)
  }

  const makeId = () => `${Date.now()}_${Math.random().toString(16).slice(2)}`
  const makeTempId = () => `tmp_${makeId()}`
  const isTempId = (id: string) => String(id || '').startsWith('tmp_')

  const revokePreview = (url: string | null | undefined) => {
    try {
      if (url) URL.revokeObjectURL(url)
    } catch { }
  }

  const ensurePages = (schoolDeviceId: string) => {
    setPagesByDeviceId((prev) => (prev[schoolDeviceId] ? prev : { ...prev, [schoolDeviceId]: [] }))
  }

  const addSettingsPage = (schoolDeviceId: string, kind: SettingsPage['kind']) => {
    setPagesByDeviceId((prev) => {
      const cur = prev[schoolDeviceId] || []
      if (cur.length >= 8) return prev

      const imageCount = cur.filter((p) => p.kind === 'images').length
      const customCount = cur.filter((p) => p.kind === 'custom').length
      const name = kind === 'images' ? `${imageCount + 1}-이미지` : `${customCount + 1}-페이지`

      const next: DraftSettingsPage = {
        id: makeTempId(),
        _temp: true,
        kind,
        name,
        blocks: [],
      }
      const nextPages = [...cur, next]
      setActivePageId(next.id)
      setSettingsDirty(true)
      return { ...prev, [schoolDeviceId]: nextPages }
    })
  }

  const addTextBlock = (schoolDeviceId: string, pageId: string) => {
    setPagesByDeviceId((prev) => {
      const pages = prev[schoolDeviceId] || []
      return {
        ...prev,
        [schoolDeviceId]: pages.map((p) => {
          if (p.id !== pageId) return p
          if (p.kind !== 'custom') return p
          if ((p.blocks || []).length >= 4) return p
          const next: DraftBlock = { id: makeTempId(), _temp: true, type: 'text', subtitle: '', body: '' }
          setSettingsDirty(true)
          return { ...p, blocks: [...(p.blocks || []), next] }
        }),
      }
    })
  }

  const addImageBlock = (schoolDeviceId: string, pageId: string) => {
    setPagesByDeviceId((prev) => {
      const pages = prev[schoolDeviceId] || []
      return {
        ...prev,
        [schoolDeviceId]: pages.map((p) => {
          if (p.id !== pageId) return p
          if (p.kind !== 'custom') return p
          if ((p.blocks || []).length >= 4) return p
          const next: DraftBlock = {
            id: makeTempId(),
            _temp: true,
            type: 'image',
            subtitle: '',
            body: '',
            image_name: null,
            image_original_path: null,
            image_thumb_path: null,
            image_full_url: null,
            image_thumb_url: null,
          }
          setSettingsDirty(true)
          return { ...p, blocks: [...(p.blocks || []), next] }
        }),
      }
    })
  }

  const removeSettingsPage = (schoolDeviceId: string, pageId: string) => {
    setPagesByDeviceId((prev) => {
      const cur = prev[schoolDeviceId] || []
      const target = cur.find((p) => p.id === pageId)
      if (target?._pendingPreviewUrl) revokePreview(target._pendingPreviewUrl)
      for (const b of target?.blocks || []) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((b as any)._pendingPreviewUrl) revokePreview((b as any)._pendingPreviewUrl)
      }

      const remaining = cur.filter((p) => p.id !== pageId)
      // 이미지 페이지는 즉시 연속 번호로 표시(입력 불가 영역이므로)
      let imageOrd = 0
      const renamed = remaining.map((p) => {
        if (p.kind !== 'images') return p
        imageOrd += 1
        return { ...p, name: `${imageOrd}-이미지` }
      })
      const nextActive = renamed[0]?.id || null
      setActivePageId((curActive) => (curActive === pageId ? nextActive : curActive))
      setSettingsDirty(true)
      return { ...prev, [schoolDeviceId]: renamed }
    })
  }

  const updateSettingsPageName = (schoolDeviceId: string, pageId: string, name: string) => {
    setPagesByDeviceId((prev) => {
      const pages = prev[schoolDeviceId] || []
      return {
        ...prev,
        [schoolDeviceId]: pages.map((p) => (p.id === pageId ? { ...p, name } : p)),
      }
    })
    setSettingsDirty(true)
  }

  const removeBlock = (schoolDeviceId: string, pageId: string, blockId: string) => {
    setPagesByDeviceId((prev) => {
      const pages = prev[schoolDeviceId] || []
      return {
        ...prev,
        [schoolDeviceId]: pages.map((p) => {
          if (p.id !== pageId) return p
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const target = (p.blocks || []).find((b) => b.id === blockId) as any
          if (target?._pendingPreviewUrl) revokePreview(target._pendingPreviewUrl)
          setSettingsDirty(true)
          return { ...p, blocks: (p.blocks || []).filter((b) => b.id !== blockId) }
        }),
      }
    })
  }

  const updateBlock = (schoolDeviceId: string, pageId: string, blockId: string, patch: Partial<CustomBlock>) => {
    setPagesByDeviceId((prev) => {
      const pages = prev[schoolDeviceId] || []
      return {
        ...prev,
        [schoolDeviceId]: pages.map((p) => {
          if (p.id !== pageId) return p
          return {
            ...p,
            blocks: (p.blocks || []).map((b) => (b.id === blockId ? ({ ...b, ...patch } as DraftBlock) : b)),
          }
        }),
      }
    })
    setSettingsDirty(true)
  }

  const setPageImageDraft = (schoolDeviceId: string, pageId: string, file: File | null) => {
    setPagesByDeviceId((prev) => {
      const pages = prev[schoolDeviceId] || []
      return {
        ...prev,
        [schoolDeviceId]: pages.map((p) => {
          if (p.id !== pageId) return p
          if (p._pendingPreviewUrl) revokePreview(p._pendingPreviewUrl)
          const nextPreview = file ? URL.createObjectURL(file) : null
          setSettingsDirty(true)
          return { ...p, _pendingFile: file, _pendingPreviewUrl: nextPreview, _pendingClear: false }
        }),
      }
    })
  }

  const clearPageImageDraft = (schoolDeviceId: string, pageId: string) => {
    setPagesByDeviceId((prev) => {
      const pages = prev[schoolDeviceId] || []
      return {
        ...prev,
        [schoolDeviceId]: pages.map((p) => {
          if (p.id !== pageId) return p
          if (p._pendingPreviewUrl) revokePreview(p._pendingPreviewUrl)
          setSettingsDirty(true)
          return { ...p, _pendingFile: null, _pendingPreviewUrl: null, _pendingClear: true }
        }),
      }
    })
  }

  const setBlockImageDraft = (schoolDeviceId: string, pageId: string, blockId: string, file: File | null) => {
    setPagesByDeviceId((prev) => {
      const pages = prev[schoolDeviceId] || []
      return {
        ...prev,
        [schoolDeviceId]: pages.map((p) => {
          if (p.id !== pageId) return p
          return {
            ...p,
            blocks: (p.blocks || []).map((b) => {
              if (b.id !== blockId) return b
              if (b.type !== 'image') return b
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const bb = b as any
              if (bb._pendingPreviewUrl) revokePreview(bb._pendingPreviewUrl)
              const nextPreview = file ? URL.createObjectURL(file) : null
              setSettingsDirty(true)
              return { ...b, _pendingFile: file, _pendingPreviewUrl: nextPreview, _pendingClear: false }
            }),
          }
        }),
      }
    })
  }

  const clearBlockImageDraft = (schoolDeviceId: string, pageId: string, blockId: string) => {
    setPagesByDeviceId((prev) => {
      const pages = prev[schoolDeviceId] || []
      return {
        ...prev,
        [schoolDeviceId]: pages.map((p) => {
          if (p.id !== pageId) return p
          return {
            ...p,
            blocks: (p.blocks || []).map((b) => {
              if (b.id !== blockId) return b
              if (b.type !== 'image') return b
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const bb = b as any
              if (bb._pendingPreviewUrl) revokePreview(bb._pendingPreviewUrl)
              setSettingsDirty(true)
              return { ...b, _pendingFile: null, _pendingPreviewUrl: null, _pendingClear: true }
            }),
          }
        }),
      }
    })
  }

  const saveSettings = async () => {
    if (!settingsTarget) return
    if (settingsSaving) return
    const schoolDeviceId = settingsTarget.id
    const draftPages = pagesByDeviceId[schoolDeviceId] || []
    const origPages = originalPagesByDeviceId[schoolDeviceId] || []

    setSettingsSaving(true)
    try {
      const fetchJson = async (url: string, init?: RequestInit) => {
        const res = await fetch(url, { credentials: 'include', ...init })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || `요청 실패: ${res.status}`)
        return data
      }

      const pageIdMap = new Map<string, string>() // tmp -> real
      const blockIdMap = new Map<string, string>() // tmp -> real

      const origPageIds = new Set(origPages.map((p) => p.id))
      const draftRealPageIds = new Set(draftPages.filter((p) => !isTempId(p.id)).map((p) => p.id))

      // 1) 삭제된 페이지 제거
      for (const p of origPages) {
        if (!draftRealPageIds.has(p.id)) {
          await fetchJson(`/api/school/device-pages/${encodeURIComponent(p.id)}`, { method: 'DELETE' })
        }
      }

      // 2) 새 페이지 생성
      for (const p of draftPages) {
        if (!isTempId(p.id)) continue
        const created = await fetchJson('/api/school/device-pages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ school_device_id: schoolDeviceId, kind: p.kind }),
        })
        const realId = String(created?.item?.id || '')
        if (!realId) throw new Error('페이지 생성 결과가 올바르지 않습니다.')
        pageIdMap.set(p.id, realId)
        // 커스텀 페이지는 사용자가 이름을 바꿀 수 있으니 저장
        if (p.kind === 'custom' && p.name && p.name !== String(created?.item?.name || '')) {
          await fetchJson(`/api/school/device-pages/${encodeURIComponent(realId)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: p.name }),
          })
        }
      }

      const resolvePageId = (id: string) => pageIdMap.get(id) || id

      // 3) 기존 페이지 이름 변경(커스텀만)
      const origById = new Map(origPages.map((p) => [p.id, p]))
      for (const p of draftPages) {
        const pid = resolvePageId(p.id)
        if (!origPageIds.has(pid)) continue
        const orig = origById.get(pid)
        if (!orig) continue
        if (p.kind === 'custom' && String(orig.name || '') !== String(p.name || '')) {
          await fetchJson(`/api/school/device-pages/${encodeURIComponent(pid)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: p.name }),
          })
        }
      }

      // 4) 이미지 페이지 이미지 업로드/삭제(드래프트)
      for (const p of draftPages) {
        if (p.kind !== 'images') continue
        const pid = resolvePageId(p.id)
        if (p._pendingClear) {
          await fetchJson(`/api/school/device-pages/${encodeURIComponent(pid)}/image`, { method: 'DELETE' })
        } else if (p._pendingFile) {
          const form = new FormData()
          form.append('file', p._pendingFile)
          await fetchJson(`/api/school/device-pages/${encodeURIComponent(pid)}/image`, { method: 'POST', body: form })
        }
      }

      // 5) 블록 CRUD + 이미지(블록)
      for (const p of draftPages) {
        if (p.kind !== 'custom') continue
        const pid = resolvePageId(p.id)
        const origPage = origById.get(pid)
        const origBlocks = (origPage?.blocks || []) as CustomBlock[]
        const origBlockIds = new Set(origBlocks.map((b) => b.id))
        const draftBlocks = p.blocks || []
        const draftRealBlockIds = new Set(draftBlocks.filter((b) => !isTempId(b.id)).map((b) => b.id))

        // 삭제된 블록 제거
        for (const b of origBlocks) {
          if (!draftRealBlockIds.has(b.id)) {
            await fetchJson(`/api/school/device-page-blocks/${encodeURIComponent(b.id)}`, { method: 'DELETE' })
          }
        }

        // 새 블록 생성
        for (const b of draftBlocks) {
          if (!isTempId(b.id)) continue
          const created = await fetchJson('/api/school/device-page-blocks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              page_id: pid,
              type: b.type,
              subtitle: b.subtitle || '',
              body: b.body || '',
            }),
          })
          const realId = String(created?.item?.id || '')
          if (!realId) throw new Error('블록 생성 결과가 올바르지 않습니다.')
          blockIdMap.set(b.id, realId)

          // 이미지 블록이면 업로드(드래프트)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if (b.type === 'image' && (b as any)._pendingFile) {
            const form = new FormData()
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            form.append('file', (b as any)._pendingFile)
            await fetchJson(`/api/school/device-page-blocks/${encodeURIComponent(realId)}/image`, { method: 'POST', body: form })
          }
        }

        const resolveBlockId = (id: string) => blockIdMap.get(id) || id

        // 기존 블록 텍스트 업데이트 + 이미지 업로드/삭제
        const origBlockById = new Map(origBlocks.map((b) => [b.id, b]))
        for (const b of draftBlocks) {
          const bid = resolveBlockId(b.id)
          if (!origBlockIds.has(bid)) continue
          const origB = origBlockById.get(bid)
          if (!origB) continue

          if (String(origB.subtitle || '') !== String(b.subtitle || '') || String(origB.body || '') !== String(b.body || '')) {
            await fetchJson(`/api/school/device-page-blocks/${encodeURIComponent(bid)}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ subtitle: b.subtitle || '', body: b.body || '' }),
            })
          }

          if (b.type === 'image') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const bb = b as any
            if (bb._pendingClear) {
              await fetchJson(`/api/school/device-page-blocks/${encodeURIComponent(bid)}/image`, { method: 'DELETE' })
            } else if (bb._pendingFile) {
              const form = new FormData()
              form.append('file', bb._pendingFile)
              await fetchJson(`/api/school/device-page-blocks/${encodeURIComponent(bid)}/image`, { method: 'POST', body: form })
            }
          }
        }
      }

      // 6) 재로드(저장된 값으로 드래프트 초기화)
      await loadDevicePages(schoolDeviceId)
      setSettingsDirty(false)
      notify('저장 완료')
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      notify(message || '저장 실패')
    } finally {
      setSettingsSaving(false)
    }
  }

  const openMemoModal = (id: string, label: string, currentMemo: string) => {
    setMemoTarget({ id, label })
    setMemoText(currentMemo || '')
    setMemoModalOpen(true)
  }

  const saveMemo = async () => {
    if (!memoTarget) return
    setMemoSaving(true)
    try {
      const res = await fetch(`/api/school/school-devices/${encodeURIComponent(memoTarget.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ memo: memoText }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || '메모 저장 실패')

      setDevices((prev) => prev.map((d) => (d.id === memoTarget.id ? { ...d, memo: memoText } : d)))
      setMemoModalOpen(false)
      setMemoTarget(null)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      notify(e.message || '메모 저장 실패')
    } finally {
      setMemoSaving(false)
    }
  }

  // 하트 케어 ID 매핑 모달 열기
  const openHeartRateMappingModal = async (label: string) => {
    setHeartRateMappingLabel(label)
    try {
      const res = await fetch('/api/school/heart-rate-mappings', { credentials: 'include' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '매핑 데이터 조회 실패')

      // 1~30번 기본 값 생성 후 기존 데이터 병합
      const mappingsData = Array.isArray(data.mappings) ? data.mappings : []
      const initial = Array.from({ length: 30 }, (_, i) => ({
        student_no: i + 1,
        device_id: '',
      }))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mappingsData.forEach((m: any) => {
        const idx = Number(m.student_no) - 1
        if (idx >= 0 && idx < 30) {
          initial[idx].device_id = String(m.device_id || '')
        }
      })
      setHeartRateMappings(initial)
      setHeartRateMappingModalOpen(true)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      notify(e.message || '매핑 데이터 조회 실패')
    }
  }

  // 하트 케어 ID 매핑 저장
  const saveHeartRateMappings = async () => {
    if (!heartRateMappingValidation.ok) {
      notify(heartRateMappingValidation.error)
      return
    }

    setHeartRateMappingSaving(true)
    try {
      const res = await fetch('/api/school/heart-rate-mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ mappings: heartRateMappings }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || '저장 실패')

      notify('Heart Care ID 매핑이 저장되었습니다.')
      setHeartRateMappingModalOpen(false)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      notify(e.message || '저장 실패')
    } finally {
      setHeartRateMappingSaving(false)
    }
  }

  return (
    <div className="console-page space-y-5">
      <PageHeader title="디바이스 설정" eyebrow="분석·설정" />

      <div className="min-w-0">
        {loadingDevices ? (
          <div className="px-4 py-6 text-center text-muted-foreground">불러오는 중...</div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-6 text-center text-muted-foreground">배정된 디바이스가 없습니다.</div>
        ) : (
          <div className="py-2">
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {(() => {
                // 전체 목록에 대해 정렬: 디바이스명 -> created_at -> id
                const sortedItems = [...rows].sort((a, b) => {
                  const nn = (a.device_name || '').localeCompare(b.device_name || '')
                  if (nn !== 0) return nn
                  const ad = a.created_at || ''
                  const bd = b.created_at || ''
                  if (ad !== bd) return ad.localeCompare(bd)
                  return String(a.id || '').localeCompare(String(b.id || ''))
                })

                const counter = new Map<string, number>()

                return sortedItems.map((d) => {
                  const ord = (counter.get(d.device_name) || 0) + 1
                  counter.set(d.device_name, ord)


                  return (
                    <div
                      key={d.id}
                      className="border border-border bg-card p-5 text-foreground"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            {d.device_icon_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={d.device_icon_url}
                                alt={`${d.device_name} 아이콘`}
                                className="h-9 w-9 object-cover border border-border"
                              />
                            ) : (
                              <div className="h-9 w-9" />
                            )}
                            <div className="min-w-0">
                              <div className="text-[13px] font-semibold truncate">
                                {d.device_name} <span className="text-muted-foreground font-semibold">#{ord}</span>
                              </div>
                              <div className="mt-0.5 flex items-center gap-2">
                                {d.memo ? (
                                  <div className="text-xs text-muted-foreground truncate" title={d.memo}>
                                    {d.memo}
                                  </div>
                                ) : (
                                  <div className="text-xs text-muted-foreground">메모 없음</div>
                                )}
                                <Button variant="outline"
                                  type="button"
                                  onClick={() => openMemoModal(d.id, `${d.device_name} #${ord}`, d.memo)}
                                  className="px-2 py-0.5 border border-border bg-card text-foreground hover:bg-card text-xs"
                                >
                                  <StickyNote className="size-4" aria-hidden="true" /> 메모
                                </Button>
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Button variant="outline"
                            type="button"
                            onClick={async () => {
                              // "심박기록관리" 또는 "하트 케어" 콘텐츠인 경우 하트 케어 ID 매핑 모달 표시
                              if (d.content_name === '심박기록관리' || d.content_name === '하트 케어' || d.content_name === '하트케어' || d.content_name === 'Heart Care' || d.content_name === 'HeartCare') {
                                await openHeartRateMappingModal(`${d.device_name} #${ord}`)
                              } else {
                                // 그 외의 경우 기존 설정 모달 표시
                                ensurePages(d.id)
                                await openSettingsModal(d.id, `${d.device_name} #${ord}`)
                              }
                            }}
                            className="px-3 py-1.5 bg-primary hover:bg-primary text-primary-foreground text-[13px] font-medium"
                          >
                            <Settings2 className="size-4" aria-hidden="true" /> 설정
                          </Button>
                        </div>
                      </div>
                    </div>
                  )
                })
              })()}
            </div>
          </div>
        )}
      </div>

      <Dialog open={!!previewUrl} onOpenChange={(open) => { if (!open) setPreviewUrl(null) }}>
        <DialogContent className="bg-card sm:max-w-4xl" aria-describedby={undefined}>
          <DialogTitle>이미지 미리보기</DialogTitle>
          {previewUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt="미리보기" className="max-h-[75dvh] w-full object-contain" />
          )}
        </DialogContent>
      </Dialog>

      {/* 설정 모달 */}
      {settingsModalOpen && settingsTarget && (
        <Dialog open={settingsModalOpen} onOpenChange={(open) => { if (!open) void closeSettingsModal() }}>
          <DialogContent showCloseButton={false} className="bg-card max-h-[90dvh] overflow-y-auto sm:max-w-3xl" aria-describedby={undefined}>
            <div className="px-6 py-4 border-b border-border">
              {(() => {
                const pages = pagesByDeviceId[settingsTarget.id] || []
                                const pageFull = pages.length >= 8
                return (
                  <>
                    {/* 1줄: 타이틀 + 저장(닫기 왼쪽) + 닫기 */}
                    <div className="flex flex-col items-start justify-between gap-3 sm:flex-row">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 min-w-0 sm:flex-nowrap">
                          <DialogTitle className="max-sm:w-full">설정 - {settingsTarget.label}</DialogTitle>
                          <span className="shrink-0 text-xs px-2 py-0.5 border bg-muted text-foreground border-border">
                            {pages.length}/8
                          </span>
                          {settingsDirty && (
                            <span className="shrink-0 text-xs px-2 py-0.5 border bg-card text-foreground border-border">
                              저장 필요
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">변경 후 “저장”을 눌러야 반영됩니다.</div>
                      </div>

                      <div className="shrink-0 flex items-center gap-2 self-end sm:self-auto">
                        <Button variant="outline"
                          type="button"
                          disabled={!settingsDirty || settingsSaving}
                          onClick={saveSettings}
                          className={[
                            'px-3 py-1.5 text-[13px] font-semibold border disabled:opacity-60',
                            settingsDirty
                              ? 'bg-primary text-primary-foreground border-border hover:bg-primary'
                              : 'bg-muted text-muted-foreground border-border',
                          ].join(' ')}
                        >
                          {settingsSaving ? '저장 중…' : '저장'}
                        </Button>
                        <Button variant="outline"
                          type="button"
                          onClick={closeSettingsModal}
                          className="px-3 py-1.5 bg-card border border-border hover:bg-muted text-foreground text-[13px] font-semibold"
                        >
                          닫기
                        </Button>
                      </div>
                    </div>

                    {/* 2줄: 페이지 추가 버튼 (로딩 중엔 숨김) */}
                    {!settingsLoading && (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Button variant="outline"
                          type="button"
                          disabled={pageFull || settingsSaving}
                          onClick={() => addSettingsPage(settingsTarget.id, 'custom')}
                          className={[
                            'px-3 py-2 text-[13px] font-semibold border disabled:opacity-60',
                            pageFull
                              ? 'bg-muted text-muted-foreground border-border cursor-not-allowed'
                              : 'bg-primary text-primary-foreground border-border hover:bg-primary',
                          ].join(' ')}
                        >
                          커스텀 페이지 추가
                        </Button>
                        <Button variant="outline"
                          type="button"
                          disabled={pageFull || settingsSaving}
                          onClick={() => addSettingsPage(settingsTarget.id, 'images')}
                          className={[
                            'px-3 py-2 text-[13px] font-semibold border disabled:opacity-60',
                            pageFull
                              ? 'bg-muted text-muted-foreground border-border cursor-not-allowed'
                              : 'bg-primary text-primary-foreground border-border hover:bg-primary',
                          ].join(' ')}
                        >
                          이미지 페이지 추가
                        </Button>
                        {pageFull && <span className="text-xs text-muted-foreground ml-1">페이지 최대 8개</span>}
                      </div>
                    )}
                  </>
                )
              })()}
            </div>

            <div className="px-6 pb-4 pt-0 overflow-y-auto">
              {(() => {
                const deviceId = settingsTarget.id
                const pages = pagesByDeviceId[deviceId] || []

                const active = pages.find((p) => p.id === activePageId) || pages[0] || null
                const activeBlocks = active?.kind === 'custom' ? active.blocks : []
                const blockFull = active?.kind === 'custom' ? activeBlocks.length >= 4 : true

                return (
                  <div className="space-y-4">
                    {settingsLoading && (
                      <div className="border border-dashed border-border p-8 text-center text-[13px] text-muted-foreground">
                        불러오는 중...
                      </div>
                    )}

                    {/* 페이지 탭 */}
                    {!settingsLoading && pages.length > 0 && (
                      <div className="sticky top-0 z-30 -mx-6 px-6 pt-0 pb-3 bg-card backdrop-blur border-b border-border">
                        <div className="border border-border bg-muted p-2">
                          <div className="grid grid-cols-4 gap-2">
                            {pages.map((p, idx) => {
                              const selected = (active?.id || null) === p.id
                              return (
                                <div key={p.id} className="relative w-full">
                                  <Button variant="outline"
                                    type="button"
                                    onClick={async () => {
                                      setActivePageId(p.id)
                                    }}
                                    className={[
                                      'w-full px-3 py-2 text-[13px] font-semibold border flex items-center gap-2 pr-9 justify-start',
                                      selected
                                        ? 'bg-muted text-foreground border-border'
                                        : 'bg-card text-foreground border-border hover:bg-card',
                                    ].join(' ')}
                                  >
                                    <span
                                      className={[
                                        'inline-flex items-center justify-center h-6 w-6 text-xs font-extrabold',
                                        selected ? 'bg-card text-foreground' : 'bg-muted text-foreground',
                                      ].join(' ')}
                                    >
                                      {idx + 1}
                                    </span>
                                    <span className="max-w-[140px] truncate" title={p.name || `${idx + 1}페이지`}>
                                      {p.name || `${idx + 1}페이지`}
                                    </span>
                                  </Button>

                                  <Button variant="outline"
                                    type="button"
                                    onClick={async (e) => {
                                      e.preventDefault()
                                      e.stopPropagation()
                                      if (!(await confirmAction(`${p.name || `${idx + 1}페이지`}를 삭제하시겠습니까?`))) return
                                      removeSettingsPage(deviceId, p.id)
                                    }}
                                    className={[
                                      'absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 inline-flex items-center justify-center border text-xs font-bold',
                                      selected
                                        ? 'border-border bg-card text-foreground hover:bg-card'
                                        : 'border-border bg-card text-foreground hover:bg-card',
                                    ].join(' ')}
                                    aria-label={`${idx + 1}페이지 삭제`}
                                    title="페이지 삭제"
                                  >
                                    <X className="h-4 w-4" aria-hidden="true" />
                                  </Button>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* 페이지 내용 */}
                    {settingsLoading ? null : pages.length === 0 || !active ? (
                      <div className="border border-dashed border-border p-8 text-center text-[13px] text-muted-foreground">
                        아직 생성된 페이지가 없습니다. 위 버튼으로 페이지를 추가해보세요.
                      </div>
                    ) : active.kind === 'custom' ? (
                      <div className="space-y-4">
                        <div className="border border-border bg-muted p-4">
                          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                            <div>
                              <div className="font-semibold text-foreground">페이지 이름</div>
                              <div className="mt-2">
                                <Input
                                  value={active.name || ''}
                                  onChange={(e) => updateSettingsPageName(deviceId, active.id, e.target.value)}
                                  className="w-full sm:w-[250px] border border-border bg-card px-3 py-2 text-[13px]"
                                  maxLength={20}
                                />
                              </div>
                            </div>
                            {!blockFull ? (
                              <div className="flex items-center gap-2">
                                <Button variant="outline"
                                  type="button"
                                  onClick={() => addTextBlock(deviceId, active.id)}
                                  className="px-3 py-2 bg-card border border-border hover:bg-card text-foreground text-[13px] font-semibold"
                                >
                                  텍스트 추가
                                </Button>
                                <Button variant="outline"
                                  type="button"
                                  onClick={() => addImageBlock(deviceId, active.id)}
                                  className="px-3 py-2 bg-card border border-border hover:bg-card text-foreground text-[13px] font-semibold"
                                >
                                  이미지 추가
                                </Button>
                              </div>
                            ) : (
                              <div className="text-[13px] font-semibold text-muted-foreground">최대 수량(4개)에 도달했습니다.</div>
                            )}
                          </div>
                        </div>

                        {activeBlocks.length === 0 ? (
                          <div className="border border-dashed border-border p-8 text-center text-[13px] text-muted-foreground">
                            아직 등록된 컴포넌트가 없습니다. 위 버튼으로 추가해보세요.
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {activeBlocks.map((b, idx) => (
                              <div key={b.id} className="border border-border bg-card p-4">
                                <div className="flex items-center justify-between gap-3">
                                  <div className="text-[13px] font-semibold text-foreground">
                                    {idx + 1}. {b.type === 'text' ? '텍스트' : '이미지'} 컴포넌트
                                  </div>
                                  <Button variant="outline"
                                    type="button"
                                    onClick={() => removeBlock(deviceId, active.id, b.id)}
                                    className="px-3 py-1.5 bg-card hover:bg-card text-foreground text-[13px] font-semibold"
                                  >
                                    삭제
                                  </Button>
                                </div>

                                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                                  <div className="flex flex-col sm:flex-row gap-3 sm:items-start md:col-span-2">
                                    <div className="space-y-1.5 w-full sm:basis-2/5">
                                      <div className="text-xs font-semibold text-foreground">소제목</div>
                                      <Input
                                        value={b.subtitle}
                                        maxLength={10}
                                        onChange={(e) => updateBlock(deviceId, active.id, b.id, { subtitle: e.target.value })}
                                        className="w-full border border-border px-3 py-1.5 text-[13px]"
                                        placeholder="소제목" aria-label="소제목"
                                      />
                                    </div>
                                    <div className="space-y-1.5 w-full sm:basis-3/5">
                                      <div className="text-xs font-semibold text-foreground">본문</div>
                                      <textarea aria-label="내용"
                                        value={b.body}
                                        onChange={(e) => updateBlock(deviceId, active.id, b.id, { body: e.target.value })}
                                        className="w-full border border-border px-3 py-2 text-[13px] resize-none"
                                        rows={3}
                                        placeholder="본문"
                                      />
                                    </div>
                                  </div>
                                </div>

                                {b.type === 'image' && (
                                  <div className="mt-3 border border-border bg-muted p-3">
                                    {(() => {
                                      const expanded = !!expandedImageBlocks[b.id]
                                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                      const bb: any = b
                                      const pendingPreview: string | null = bb._pendingPreviewUrl || null
                                      const pendingFile: File | null = bb._pendingFile || null
                                      const pendingClear: boolean = !!bb._pendingClear
                                      const thumb = pendingClear
                                        ? null
                                        : pendingPreview || b.image_thumb_url || b.image_full_url || null
                                      const full = pendingClear ? null : pendingPreview || b.image_full_url || b.image_thumb_url || null
                                      const hasImage = !!thumb || !!full

                                      return (
                                        <>
                                          <div className="flex flex-wrap items-center justify-between gap-2">
                                            <div className="flex items-center gap-2 min-w-0">
                                              <div className="text-[13px] font-semibold text-foreground">이미지</div>
                                              <span
                                                className={[
                                                  'text-xs px-2 py-0.5 border',
                                                  hasImage
                                                    ? 'bg-card text-foreground border-border'
                                                    : 'bg-muted text-foreground border-border',
                                                ].join(' ')}
                                              >
                                                {hasImage ? '첨부됨' : '없음'}
                                              </span>
                                              {hasImage && (
                                                <Button variant="outline"
                                                  type="button"
                                                  onClick={() => {
                                                    if (full) setPreviewUrl(full)
                                                  }}
                                                  className="text-xs text-foreground hover:text-foreground font-semibold truncate max-w-[180px]"
                                                  title={pendingFile?.name || b.image_name || '첨부 이미지'}
                                                >
                                                  {pendingFile?.name || b.image_name || '첨부 이미지'}
                                                </Button>
                                              )}
                                            </div>

                                            <div className="flex items-center gap-2">
                                              <Input
                                                ref={(el) => {
                                                  customImageFileInputRefs.current[b.id] = el
                                                }}
                                                type="file"
                                                accept="image/*"
                                                className="hidden"
                                                onChange={async (e) => {
                                                  const file = Array.from(e.target.files || []).find((f) => f.type.startsWith('image/'))
                                                  if (!file) return
                                                  const prepared = await compressImageIfNeeded(file)
                                                  setBlockImageDraft(deviceId, active.id, b.id, prepared)
                                                  e.target.value = ''
                                                }}
                                              />
                                              <Button variant="outline"
                                                type="button"
                                                onClick={() => customImageFileInputRefs.current[b.id]?.click()}
                                                className="px-3 py-1.5 bg-muted hover:bg-muted text-foreground text-[13px] font-semibold"
                                              >
                                                이미지 선택
                                              </Button>
                                              {hasImage && (
                                                <Button variant="outline"
                                                  type="button"
                                                  onClick={() => clearBlockImageDraft(deviceId, active.id, b.id)}
                                                  className="px-3 py-1.5 bg-card border border-border hover:bg-muted text-[13px] font-semibold"
                                                >
                                                  초기화
                                                </Button>
                                              )}
                                              <Button variant="outline"
                                                type="button"
                                                onClick={() => setExpandedImageBlocks((prev) => ({ ...prev, [b.id]: !expanded }))}
                                                className="px-3 py-1.5 bg-card border border-border hover:bg-muted text-[13px] font-semibold"
                                              >
                                                {expanded ? '첨부 영역 닫기' : '첨부 영역 열기'}
                                              </Button>
                                            </div>
                                          </div>

                                          {/* 접힘 상태에서는 공간 최소화 */}
                                          {expanded && (
                                            <>
                                              <div className="text-xs text-muted-foreground mt-2">
                                                드래그 앤 드롭 또는 버튼으로 파일을 선택하세요.
                                              </div>

                                              <div
                                                className={[
                                                  'mt-2 border border-dashed p-3',
                                                  customImageDragOverBlockId === b.id
                                                    ? 'border-border bg-card'
                                                    : 'border-border bg-card',
                                                ].join(' ')}
                                                onDragOver={(e) => {
                                                  e.preventDefault()
                                                  setCustomImageDragOverBlockId(b.id)
                                                }}
                                                onDragLeave={() =>
                                                  setCustomImageDragOverBlockId((cur) => (cur === b.id ? null : cur))
                                                }
                                                onDrop={async (e) => {
                                                  e.preventDefault()
                                                  setCustomImageDragOverBlockId(null)
                                                  const file = Array.from(e.dataTransfer.files || []).find((f) =>
                                                    f.type.startsWith('image/'),
                                                  )
                                                  if (!file) return
                                                  const prepared = await compressImageIfNeeded(file)
                                                  setBlockImageDraft(deviceId, active.id, b.id, prepared)
                                                }}
                                              >
                                                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                                                  <div className="text-[13px] text-foreground">
                                                    <div className="font-semibold">이미지를 여기로 드래그</div>
                                                    <div className="text-xs text-muted-foreground mt-0.5">이미지 파일만 선택됩니다.</div>
                                                  </div>
                                                </div>
                                              </div>

                                              <div className="mt-2">
                                                {thumb || full ? (
                                                  <Button variant="outline"
                                                    type="button"
                                                    onClick={() => {
                                                      if (full) setPreviewUrl(full)
                                                    }}
                                                    className="block h-auto w-full p-0"
                                                  >
                                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                                    <img
                                                      src={thumb || full || ''}
                                                      alt="첨부 이미지 미리보기"
                                                      className="w-full max-h-40 object-contain border border-border bg-card"
                                                    />
                                                  </Button>
                                                ) : (
                                                  <div className="border border-dashed border-border bg-card p-4 text-center text-[13px] text-muted-foreground">
                                                    첨부된 이미지가 없습니다.
                                                  </div>
                                                )}
                                              </div>
                                            </>
                                          )}
                                        </>
                                      )
                                    })()}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      (() => {
                        const pageId = active.id
                        const isUploading = settingsSaving
                        const isDragOver = dragOverId === pageId
                        const pendingPreview: string | null = active._pendingPreviewUrl || null
                        const pendingFile: File | null = active._pendingFile || null
                        const pendingClear: boolean = !!active._pendingClear
                        const hasImage = pendingClear
                          ? false
                          : !!(pendingPreview || active.image_full_url || active.image_thumb_url || active.image_original_path)
                        const thumb = pendingClear
                          ? null
                          : pendingPreview || active.image_thumb_url || active.image_full_url || null
                        const full = pendingClear ? null : pendingPreview || active.image_full_url || active.image_thumb_url || null

                        return (
                          <div className="border border-border bg-muted p-4">
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-[13px] font-semibold text-foreground">이미지 페이지</div>
                              <div className="flex items-center gap-2">
                                <Input
                                  ref={(el) => {
                                    pageImageFileInputRefs.current[pageId] = el
                                  }}
                                  type="file"
                                  accept="image/*"
                                  disabled={isUploading}
                                  onChange={async (e) => {
                                    const file = Array.from(e.target.files || []).find((f) => f.type.startsWith('image/'))
                                    if (!file) return
                                    const prepared = await compressImageIfNeeded(file)
                                    setPageImageDraft(deviceId, pageId, prepared)
                                    e.target.value = ''
                                  }}
                                  className="hidden"
                                />

                                <Button variant="outline"
                                  type="button"
                                  disabled={isUploading}
                                  onClick={() => pageImageFileInputRefs.current[pageId]?.click()}
                                  className={[
                                    'px-3 py-1.5 text-[13px] font-semibold border disabled:opacity-60',
                                    hasImage
                                      ? 'bg-card border-border text-foreground hover:bg-card'
                                      : 'bg-muted border-border text-foreground hover:bg-muted',
                                  ].join(' ')}
                                >
                                  {isUploading ? '처리 중…' : hasImage ? '이미지 변경' : '이미지 1장 업로드'}
                                </Button>

                                {hasImage && (
                                  <Button variant="outline"
                                    type="button"
                                    disabled={isUploading}
                                    onClick={() => clearPageImageDraft(deviceId, pageId)}
                                    className="px-3 py-1.5 bg-card hover:bg-card text-foreground text-[13px] font-semibold disabled:opacity-60"
                                  >
                                    삭제
                                  </Button>
                                )}
                              </div>
                            </div>

                            {!hasImage ? (
                              <div className="mt-3 border border-dashed border-border p-6 text-center text-[13px] text-muted-foreground">
                                아직 업로드된 이미지가 없습니다.
                              </div>
                            ) : (
                              <div className="mt-3 grid grid-cols-3 sm:grid-cols-4 gap-2">
                                <div className="group relative border border-border bg-card overflow-hidden">
                                  <Button variant="outline"
                                    type="button"
                                    onClick={() => {
                                      if (full) setPreviewUrl(full)
                                    }}
                                    className="block h-auto w-full p-0"
                                    title={pendingFile?.name || active.image_name || '이미지'}
                                  >
                                    {thumb ? (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img
                                        src={thumb}
                                        alt={pendingFile?.name || active.image_name || '이미지'}
                                        className="h-24 w-full object-cover"
                                        loading="lazy"
                                      />
                                    ) : (
                                      <div className="h-24 w-full flex items-center justify-center text-xs text-muted-foreground">미리보기 불가</div>
                                    )}
                                  </Button>
                                  <div className="absolute inset-x-0 bottom-0 p-1.5 bg-card backdrop-blur opacity-0 group-hover:opacity-100 transition-opacity">
                                    <div className="text-xs text-muted-foreground truncate min-w-0" title={pendingFile?.name || active.image_name || ''}>
                                      {pendingFile?.name || active.image_name || '이미지'}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            )}

                            <div
                              className={[
                                'mt-4 border border-dashed p-4',
                                isDragOver ? 'border-border bg-card' : 'border-border bg-card',
                                isUploading ? 'opacity-60' : '',
                              ].join(' ')}
                              onDragOver={(e) => {
                                e.preventDefault()
                                if (isUploading) return
                                setDragOverId(pageId)
                              }}
                              onDragLeave={() => setDragOverId((cur) => (cur === pageId ? null : cur))}
                              onDrop={async (e) => {
                                e.preventDefault()
                                setDragOverId(null)
                                if (isUploading) return
                                const file = Array.from(e.dataTransfer.files || []).find((f) => f.type.startsWith('image/'))
                                if (!file) return
                                const prepared = await compressImageIfNeeded(file)
                                setPageImageDraft(deviceId, pageId, prepared)
                              }}
                            >
                              <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
                                <div className="text-[13px] text-foreground">
                                  <div className="font-semibold">
                                    {hasImage ? '이미지가 이미 등록되어 있습니다 (1장만 유지)' : '이미지를 여기로 드래그해서 업로드'}
                                  </div>
                                  <div className="text-xs text-muted-foreground mt-1">
                                    {hasImage ? '드래그/선택하면 기존 이미지가 변경됩니다.' : '또는 버튼을 눌러 파일을 선택하세요.'}
                                  </div>
                                </div>

                                <div className="flex items-center gap-2">
                                  <Button variant="outline"
                                    type="button"
                                    disabled={isUploading}
                                    onClick={() => pageImageFileInputRefs.current[pageId]?.click()}
                                    className="px-4 py-2 bg-muted hover:bg-muted text-foreground text-[13px] font-semibold disabled:opacity-60"
                                  >
                                    {isUploading ? '처리 중…' : hasImage ? '이미지 변경' : '이미지 1장 업로드'}
                                  </Button>
                                </div>
                              </div>
                            </div>
                          </div>
                        )
                      })()
                    )}
                  </div>
                )
              })()}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* 메모 모달 */}
      {memoModalOpen && memoTarget && (
        <Dialog open={memoModalOpen} onOpenChange={(open) => { if (!open && !memoSaving) { setMemoModalOpen(false); setMemoTarget(null) } }}>
          <DialogContent showCloseButton={false} className="bg-card max-h-[90dvh] overflow-y-auto sm:max-w-md" aria-describedby={undefined}>
            <div className="flex items-center justify-between mb-3">
              <DialogTitle>메모 - {memoTarget.label}</DialogTitle>
              <Button variant="outline"
                type="button"
                onClick={() => {
                  if (memoSaving) return
                  setMemoModalOpen(false)
                  setMemoTarget(null)
                }}
                className="text-muted-foreground hover:text-foreground"
              >
                닫기
              </Button>
            </div>
            <textarea
              className="w-full border border-border px-3 py-2 text-foreground"
              rows={4}
              value={memoText}
              onChange={(e) => setMemoText(e.target.value)}
              placeholder="메모를 입력하세요" aria-label="메모를 입력하세요"
            />
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline"
                type="button"
                onClick={() => {
                  if (memoSaving) return
                  setMemoModalOpen(false)
                  setMemoTarget(null)
                }}
                className="px-4 py-2 bg-muted hover:bg-muted text-foreground"
              >
                취소
              </Button>
              <Button variant="outline"
                type="button"
                disabled={memoSaving}
                onClick={saveMemo}
                className="px-4 py-2 bg-primary hover:bg-primary text-primary-foreground disabled:opacity-60"
              >
                저장
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* 하트 케어 ID 매핑 모달 */}
      {heartRateMappingModalOpen && (
        <Dialog open={heartRateMappingModalOpen} onOpenChange={(open) => { if (!open && !heartRateMappingSaving) setHeartRateMappingModalOpen(false) }}>
          <DialogContent showCloseButton={false} className="bg-card max-h-[90dvh] overflow-y-auto sm:max-w-4xl" aria-describedby={undefined}>
            <div className="px-6 py-4 border-b border-border">
              <div className="flex items-center justify-between">
                <DialogTitle>Heart Care ID 설정 - {heartRateMappingLabel}</DialogTitle>
                <Button variant="outline" aria-label="닫기"
                  type="button"
                  onClick={() => {
                    if (heartRateMappingSaving) return
                    setHeartRateMappingModalOpen(false)
                  }}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-5 w-5" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">1~30번 측정 슬롯은 각 학급의 같은 번호 학생에게 연결됩니다. 심박계에 표시된 7자리 숫자를 앞자리 0까지 그대로 입력하세요.</p>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                {heartRateMappings.map((mapping) => {
                  const hasInvalidFormat = mapping.device_id !== '' && !isCanonicalHeartRateDeviceId(mapping.device_id)
                  const isDuplicate = mapping.device_id !== '' && duplicateHeartRateDeviceIds.has(mapping.device_id)
                  const isInvalid = hasInvalidFormat || isDuplicate
                  const errorId = `heart-rate-id-error-${mapping.student_no}`
                  return (
                  <div key={mapping.student_no} className="flex flex-col gap-1">
                    <Label htmlFor={`heart-rate-id-${mapping.student_no}`} className="text-xs font-semibold text-foreground">
                      {mapping.student_no}번 슬롯
                    </Label>
                    <Input
                      id={`heart-rate-id-${mapping.student_no}`}
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]{7}"
                      value={mapping.device_id}
                      aria-invalid={isInvalid}
                      aria-describedby={isInvalid ? errorId : undefined}
                      onChange={(e) => {
                        const newMappings = [...heartRateMappings]
                        const idx = mapping.student_no - 1
                        newMappings[idx].device_id = e.target.value
                        setHeartRateMappings(newMappings)
                      }}
                      className={`border px-2 py-1.5 text-[13px] ${isInvalid
                        ? 'border-destructive bg-destructive/5'
                        : 'border-border'
                        }`}
                      placeholder="0000000"
                    />
                    {isInvalid && (
                      <span id={errorId} className="text-[11px] font-medium text-destructive">
                        {hasInvalidFormat ? '7자리 숫자를 입력하세요.' : '다른 측정 슬롯과 중복된 ID입니다.'}
                      </span>
                    )}
                  </div>
                  )
                })}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-border flex justify-end gap-2">
              <Button variant="outline"
                type="button"
                onClick={() => {
                  if (heartRateMappingSaving) return
                  setHeartRateMappingModalOpen(false)
                }}
                className="px-4 py-2 bg-muted hover:bg-muted text-foreground"
              >
                취소
              </Button>
              <Button variant="outline"
                type="button"
                disabled={heartRateMappingSaving || hasInvalidHeartRateMapping}
                onClick={saveHeartRateMappings}
                className="px-4 py-2 bg-primary hover:bg-primary text-primary-foreground disabled:opacity-60"
              >
                {heartRateMappingSaving ? '저장 중...' : '저장'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}


