import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/contexts/AuthContext";
import { FeedbackProvider } from '@/components/console/feedback-provider';
import { TooltipProvider } from '@/components/ui/tooltip';

const FAVICON_VERSION = "20260119";


export const metadata: Metadata = {
  title: "atv.학생운동기록관리",
  description: "atv.학생운동기록관리",
  icons: {
    icon: `/favicon.ico?v=${FAVICON_VERSION}`,
    shortcut: `/favicon.ico?v=${FAVICON_VERSION}`,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body
        className="antialiased"
      >
        <AuthProvider>
          <TooltipProvider><FeedbackProvider>{children}</FeedbackProvider></TooltipProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
