import type { Metadata } from 'next'
import '@/app/globals.css'
import PreviewRuntime from '../runtime'

export const metadata: Metadata = {
  title: 'ATVCMS · 학교 샘플 미리보기',
  robots: { index: false, follow: false },
  icons: { icon: '/image/logo_atvcms.svg' },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="ko"><body className="antialiased"><PreviewRuntime>{children}</PreviewRuntime></body></html>
}
