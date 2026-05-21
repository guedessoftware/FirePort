"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Suspense, useState } from "react"
import { LoadingOverlay, LoadingScreen } from "@/components/LoadingState"

function PasswordResetConfirmForm() {
  const searchParams = useSearchParams()
  const token = searchParams.get("token") || ""
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [message, setMessage] = useState("")
  const [isDone, setIsDone] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  const confirmReset = async () => {
    if (password !== confirmPassword) {
      setMessage("As senhas nao conferem.")
      return
    }

    setIsLoading(true)
    setMessage("")
    try {
      const response = await fetch("/api/auth/password-reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || "Falha ao redefinir senha.")
      setIsDone(true)
      setMessage("Senha redefinida. Voce ja pode entrar com a nova senha.")
    } catch (error) {
      setMessage((error as Error).message || "Falha ao redefinir senha.")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#fff7ed] px-6 py-10 text-slate-950">
      <LoadingOverlay visible={isLoading} title="Redefinindo senha" description="Salvando sua nova credencial." />
      <section className="w-full max-w-[420px] rounded-[8px] border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold">Redefinir senha</h1>
        <p className="mt-2 text-sm text-slate-600">Use uma senha longa e unica para esta conta.</p>
        <div className="mt-6 grid gap-3">
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Nova senha"
            type="password"
            autoComplete="new-password"
            disabled={isDone}
            className="rounded-[8px] border border-slate-200 px-4 py-3 outline-none transition focus:border-orange-700 disabled:opacity-60"
          />
          <input
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            placeholder="Confirmar nova senha"
            type="password"
            autoComplete="new-password"
            disabled={isDone}
            className="rounded-[8px] border border-slate-200 px-4 py-3 outline-none transition focus:border-orange-700 disabled:opacity-60"
          />
          <button
            onClick={confirmReset}
            disabled={isLoading || isDone || !token}
            className="rounded-[8px] bg-orange-800 px-5 py-3 font-medium text-white transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Salvar nova senha
          </button>
          <Link href="/" className="rounded-[8px] border border-slate-300 px-5 py-3 text-center font-medium text-slate-800 transition hover:bg-slate-50">Voltar ao acesso</Link>
          {!token ? <p className="text-sm text-red-600">Token ausente.</p> : null}
          {message ? <p className={`text-sm ${isDone ? "text-emerald-700" : "text-red-600"}`}>{message}</p> : null}
        </div>
      </section>
    </main>
  )
}

export default function PasswordResetConfirmPage() {
  return (
    <Suspense fallback={<LoadingScreen title="Carregando redefinicao" description="Validando o link recebido." />}>
      <PasswordResetConfirmForm />
    </Suspense>
  )
}
