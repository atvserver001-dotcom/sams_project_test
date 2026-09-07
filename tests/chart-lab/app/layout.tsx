import type { Metadata } from 'next'
import '@/app/globals.css'

export const metadata: Metadata = { title: 'ATVCMS · 그래프 검증', robots: { index: false, follow: false }, icons: { icon: '/logo_atvcms.svg' } }

export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="ko"><body>{children}</body></html>
}
