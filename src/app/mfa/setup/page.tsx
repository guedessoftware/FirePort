"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { LoadingInline, LoadingOverlay } from "@/components/LoadingState"
import { hardSignOut } from "@/lib/client-auth"

type SetupState = {
  enabled: boolean
  secret?: string
  otpauthUrl?: string
}

export default function MfaSetupPage() {
  const [setup, setSetup] = useState<SetupState | null>(null)
  const [code, setCode] = useState("")
  const [message, setMessage] = useState("")
  const [isLoading, setIsLoading] = useState(true)
  const [isDone, setIsDone] = useState(false)

  useEffect(() => {
    const loadSetup = async () => {
      try {
        const response = await fetch("/api/auth/mfa/setup", { cache: "no-store" })
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(body.error || "Falha ao iniciar MFA.")
        setSetup(body)
      } catch (error) {
        setMessage((error as Error).message || "Falha ao iniciar MFA.")
      } finally {
        setIsLoading(false)
      }
    }

    void loadSetup()
  }, [])

  const confirmSetup = async () => {
    setIsLoading(true)
    setMessage("")
    try {
      const response = await fetch("/api/auth/mfa/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || "Codigo MFA invalido.")
      setIsDone(true)
      setMessage("MFA ativado. Entre novamente usando email, senha e o codigo do app autenticador.")
    } catch (error) {
      setMessage((error as Error).message || "Falha ao confirmar MFA.")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#fff7ed] px-6 py-10 text-slate-950">
      <LoadingOverlay visible={isLoading && Boolean(setup)} title="Ativando MFA" description="Conferindo o codigo do autenticador." />
      <section className="w-full max-w-[460px] rounded-[8px] border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold">Configurar MFA</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Contas administrativas precisam de um app autenticador para acessar a area admin.
        </p>

        {isLoading && !setup ? <LoadingInline title="Carregando configuracao" description="Gerando os dados do autenticador." /> : null}

        {setup?.enabled ? (
          <div className="mt-6 grid gap-4">
            <p className="text-sm text-emerald-700">MFA ja esta ativo nesta conta.</p>
            <Link href="/admin" className="rounded-[8px] bg-orange-800 px-5 py-3 text-center font-medium text-white">Ir para admin</Link>
          </div>
        ) : null}

        {setup && !setup.enabled && !isDone ? (
          <div className="mt-6 grid gap-4">
            <div className="rounded-[8px] border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase text-slate-500">Chave de configuracao</p>
              <p className="mt-2 break-all font-mono text-sm text-slate-950">{setup.secret}</p>
              {setup.otpauthUrl ? (
                <a href={setup.otpauthUrl} className="mt-3 inline-flex text-sm font-medium text-orange-800">Abrir no app autenticador</a>
              ) : null}
            </div>
            <input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="Codigo de 6 digitos"
              inputMode="numeric"
              autoComplete="one-time-code"
              className="rounded-[8px] border border-slate-200 px-4 py-3 outline-none transition focus:border-orange-700"
            />
            <button
              onClick={confirmSetup}
              disabled={isLoading}
              className="rounded-[8px] bg-orange-800 px-5 py-3 font-medium text-white transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Ativar MFA
            </button>
          </div>
        ) : null}

        {isDone ? (
          <div className="mt-6 grid gap-4">
            <button onClick={() => void hardSignOut()} className="rounded-[8px] bg-orange-800 px-5 py-3 font-medium text-white">
              Entrar novamente
            </button>
          </div>
        ) : null}

        {message ? <p className={`mt-4 text-sm ${isDone ? "text-emerald-700" : "text-red-600"}`}>{message}</p> : null}
      </section>
    </main>
  )
}
