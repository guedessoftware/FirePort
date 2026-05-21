"use client"

import Link from "next/link"
import { useState } from "react"
import { LoadingOverlay } from "@/components/LoadingState"

export default function PasswordResetRequestPage() {
  const [email, setEmail] = useState("")
  const [message, setMessage] = useState("")
  const [debugUrl, setDebugUrl] = useState("")
  const [isLoading, setIsLoading] = useState(false)

  const requestReset = async () => {
    setIsLoading(true)
    setMessage("")
    setDebugUrl("")
    try {
      const response = await fetch("/api/auth/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || "Falha ao solicitar redefinicao.")
      setMessage("Se o email existir, enviaremos um link de redefinicao.")
      if (typeof body.debugResetUrl === "string") setDebugUrl(body.debugResetUrl)
    } catch (error) {
      setMessage((error as Error).message || "Falha ao solicitar redefinicao.")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#fff7ed] px-6 py-10 text-slate-950">
      <LoadingOverlay visible={isLoading} title="Enviando link" description="Registrando sua solicitacao de redefinicao." />
      <section className="w-full max-w-[420px] rounded-[8px] border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold">Recuperar senha</h1>
        <p className="mt-2 text-sm text-slate-600">Informe seu email para receber um link de redefinicao.</p>
        <div className="mt-6 grid gap-3">
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Email"
            type="email"
            className="rounded-[8px] border border-slate-200 px-4 py-3 outline-none transition focus:border-orange-700"
          />
          <button
            onClick={requestReset}
            disabled={isLoading}
            className="rounded-[8px] bg-orange-800 px-5 py-3 font-medium text-white transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Enviar link
          </button>
          <Link href="/" className="rounded-[8px] border border-slate-300 px-5 py-3 text-center font-medium text-slate-800 transition hover:bg-slate-50">Voltar</Link>
          {message ? <p className="text-sm text-slate-600">{message}</p> : null}
          {debugUrl ? <Link href={debugUrl} className="break-all text-sm font-medium text-orange-800">Link de teste local</Link> : null}
        </div>
      </section>
    </main>
  )
}
