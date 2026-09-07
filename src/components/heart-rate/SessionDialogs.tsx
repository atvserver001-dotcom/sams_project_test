'use client'

import { useState } from 'react'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { HEART_FIT_DOWNLOAD, type HeartRateBridge } from '@/lib/heart-rate/bridge'

export function InstallDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (value: boolean) => void }) {
  return <AlertDialog open={open} onOpenChange={onOpenChange}>
    <AlertDialogContent>
      <AlertDialogHeader><AlertDialogTitle>Heart Fit 실행을 확인해 주세요</AlertDialogTitle>
        <AlertDialogDescription>심박 측정 프로그램을 설치하고 실행한 뒤 다시 연결해 주세요. 기존 수신 기록은 유지됩니다.</AlertDialogDescription></AlertDialogHeader>
      <AlertDialogFooter><AlertDialogCancel>닫기</AlertDialogCancel><AlertDialogAction asChild>
        <a href={HEART_FIT_DOWNLOAD} target="_blank" rel="noopener noreferrer"><Download size={15} />Heart Fit 다운로드</a>
      </AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
}

export function SaveActions({ bridge }: { bridge: HeartRateBridge }) {
  const [confirm, setConfirm] = useState(false)
  const uncertain = bridge.saveState === 'uncertain'
  if (!uncertain && bridge.saveState !== 'missing') return null
  return <>
    <Button variant="outline" onClick={() => setConfirm(true)}>{uncertain ? '저장 결과 확인' : '수신 집계로 저장'}</Button>
    <AlertDialog open={confirm} onOpenChange={setConfirm}>
      <AlertDialogContent><AlertDialogHeader>
        <AlertDialogTitle>{uncertain ? '재저장 전 월별 기록을 확인해 주세요' : '브라우저 수신 집계로 저장할까요?'}</AlertDialogTitle>
        <AlertDialogDescription>{uncertain
          ? '서버 응답이 확인되지 않아 이미 저장되었을 수 있습니다. 월별 기록을 확인하여 미저장이 확실한 경우에만 다시 저장해 주세요. 재저장하면 기록이 중복 합산될 수 있습니다.'
          : 'Heart Fit의 최종 결과를 받지 못했습니다. 이 브라우저에서 실제 수신한 전체 세션의 최고·평균·최저와 수신 횟수를 저장합니다. 연결이 끊긴 동안의 기록은 포함되지 않습니다.'}</AlertDialogDescription>
      </AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>취소</AlertDialogCancel>
        <AlertDialogAction onClick={() => { if (uncertain) void bridge.retrySave(); else void bridge.saveLocal() }}>{uncertain ? '미저장 확인 · 다시 저장' : '수신 집계 저장'}</AlertDialogAction>
      </AlertDialogFooter></AlertDialogContent>
    </AlertDialog>
  </>
}
