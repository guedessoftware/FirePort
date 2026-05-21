"use client"

import { useEffect } from "react"

const FALLBACK_APPLICATION_TITLE = "FirePort"

export default function ApplicationTitle() {
  useEffect(() => {
    let isMounted = true

    const applyTitle = (value: unknown) => {
      const title = typeof value === "string" ? value.trim() : ""
      document.title = title || FALLBACK_APPLICATION_TITLE
    }

    const loadApplicationTitle = async () => {
      try {
        const response = await fetch("/api/settings/application/public", { cache: "no-store" })
        if (!response.ok) {
          applyTitle(FALLBACK_APPLICATION_TITLE)
          return
        }

        const settings = await response.json() as { applicationName?: unknown }
        if (isMounted) {
          applyTitle(settings.applicationName)
        }
      } catch {
        if (isMounted && (!document.title || document.title === "Aplicacao")) {
          applyTitle(FALLBACK_APPLICATION_TITLE)
        }
      }
    }

    void loadApplicationTitle()

    return () => {
      isMounted = false
    }
  }, [])

  return null
}
