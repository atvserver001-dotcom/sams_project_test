'use client'
import { useEffect, useState } from 'react'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import { FeedbackProvider, useFeedback } from '@/components/console/feedback-provider'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { RotateCcw } from 'lucide-react'
import { HEART_FIT_DOWNLOAD, heartRateBridge } from '@/lib/heart-rate/bridge'
import { installPreviewTransport } from './transport'

let releaseTransport: (() => void) | null = null
export function stopPreviewTransport() {
  releaseTransport?.()
  releaseTransport = null
}

export default function PreviewRuntime({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const abort = new AbortController()
    const uninstall = installPreviewTransport({ academicYear: () => heartRateBridge.session?.context.year })
    releaseTransport = uninstall
    // Establish one browser session before the unchanged pages issue parallel reads.
    void fetch('/api/preview/status', { signal: abort.signal, cache: 'no-store' }).then(response => {
      if (!response.ok) throw new Error('샘플 저장소 연결 실패')
      if (!abort.signal.aborted) setReady(true)
    }).catch(reason => {
      if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : '샘플 저장소 연결 실패')
    })
    return () => {
      abort.abort()
      uninstall()
      if (releaseTransport === uninstall) releaseTransport = null
    }
  }, [])
  if (!ready) return <main className="flex min-h-screen flex-col items-center justify-center gap-4" role={error ? 'alert' : 'status'}>
    {error || '샘플 미리보기 준비 중...'}
    {error && <Button variant="outline" onClick={() => window.location.reload()}><RotateCcw />다시 연결</Button>}
  </main>
  return <AuthProvider><PreviewAuthProbe /><TooltipProvider><FeedbackProvider><PreviewDeviceBoundary>{children}</PreviewDeviceBoundary></FeedbackProvider></TooltipProvider></AuthProvider>
}

// Local synthetic browser tests observe the real provider lifecycle without
// adding diagnostics to the deployed application or reading session cookies.
function PreviewAuthProbe() {
  const { user, loading, schoolInfo, refreshUser } = useAuth()
  useEffect(() => {
    const refresh = () => { void refreshUser() }
    window.addEventListener('preview:refresh-auth', refresh)
    return () => window.removeEventListener('preview:refresh-auth', refresh)
  }, [refreshUser])
  return <output hidden id="preview-auth-state" data-user={user?.id ?? ''} data-school={schoolInfo?.id ?? ''} data-loading={String(loading)} />
}

function PreviewDeviceBoundary({ children }: { children: React.ReactNode }) {
  const { notify } = useFeedback()
  useEffect(() => {
    const preventInstaller = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest('a') : null
      if (anchor?.href === HEART_FIT_DOWNLOAD || anchor?.protocol === 'fitness-bridge:') {
        event.preventDefault()
        event.stopPropagation()
        notify('샘플 미리보기에서는 실제 기기를 연결하거나 설치하지 않습니다.')
      }
    }
    document.addEventListener('click', preventInstaller, true)
    return () => document.removeEventListener('click', preventInstaller, true)
  }, [notify])
  return children
}
