"use client"

import { SessionProvider } from "next-auth/react"
import ApplicationTitle from "@/components/ApplicationTitle"

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ApplicationTitle />
      {children}
    </SessionProvider>
  )
}
