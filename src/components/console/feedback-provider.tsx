'use client'
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
type Notice = { message: string; confirmation: boolean }
type Feedback = {
  notify: (message: string) => void
  confirmAction: (message: string) => Promise<boolean>
}
const Context = createContext<Feedback | null>(null)
export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<Notice | null>(null)
  const resolve = useRef<((accepted: boolean) => void) | null>(null)
  const finish = useCallback((accepted: boolean) => {
    resolve.current?.(accepted)
    resolve.current = null
    setNotice(null)
  }, [])
  const notify = useCallback((message: string) => {
    resolve.current?.(false)
    resolve.current = null
    setNotice({ message, confirmation: false })
  }, [])
  const confirmAction = useCallback(
    (message: string) =>
      new Promise<boolean>((done) => {
        resolve.current?.(false)
        resolve.current = done
        setNotice({ message, confirmation: true })
      }),
    [],
  )
  return (
    <Context.Provider value={{ notify, confirmAction }}>
      {children}
      <AlertDialog
        open={!!notice}
        onOpenChange={(open) => {
          if (!open) finish(false)
        }}
      >
        <AlertDialogContent className="bg-white">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {notice?.confirmation ? '작업 확인' : '알림'}
            </AlertDialogTitle>
            <AlertDialogDescription className="whitespace-pre-wrap">
              {notice?.message}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            {notice?.confirmation && (
              <AlertDialogCancel onClick={() => finish(false)}>
                취소
              </AlertDialogCancel>
            )}
            <AlertDialogAction onClick={() => finish(true)}>
              확인
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Context.Provider>
  )
}
export function useFeedback() {
  const context = useContext(Context)
  if (!context) throw new Error('FeedbackProvider is required')
  return context
}
