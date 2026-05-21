"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import Image from "next/image"
import { signIn, useSession } from "next-auth/react"
import { LoadingOverlay, LoadingScreen } from "@/components/LoadingState"
import { clearAuthCookies } from "@/lib/client-auth"

type PublicApplicationSettings = {
  applicationName: string
  companyName: string
  companyLogo: string | null
  useCompanyLogo: boolean
  description: string
  websiteUrl: string
}

const defaultApplicationSettings: PublicApplicationSettings = {
  applicationName: "FirePort",
  companyName: "Empresa",
  companyLogo: null,
  useCompanyLogo: false,
  description: "Area do cliente",
  websiteUrl: "",
}

export default function Home() {
  const router = useRouter()
  const { data: session, status } = useSession()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [mfaCode, setMfaCode] = useState("")
  const [setupToken, setSetupToken] = useState("")
  const [message, setMessage] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [canCreateInitialAdmin, setCanCreateInitialAdmin] = useState(false)
  const [applicationSettings, setApplicationSettings] = useState<PublicApplicationSettings>(defaultApplicationSettings)

  useEffect(() => {
    if (status !== "authenticated") return

    const sessionUser = session?.user as { role?: string; requiresMfa?: boolean } | undefined
    const role = sessionUser?.role
    if (sessionUser?.requiresMfa) {
      router.replace("/mfa/setup")
      return
    }
    router.replace(role === "admin" ? "/admin" : "/operador")
  }, [router, session, status])

  useEffect(() => {
    const loadApplicationSettings = async () => {
      try {
        const response = await fetch("/api/settings/application/public")
        if (!response.ok) return
        const settings = await response.json()
        setApplicationSettings({
          applicationName: typeof settings.applicationName === "string" ? settings.applicationName : defaultApplicationSettings.applicationName,
          companyName: typeof settings.companyName === "string" ? settings.companyName : defaultApplicationSettings.companyName,
          companyLogo: typeof settings.companyLogo === "string" ? settings.companyLogo : null,
          useCompanyLogo: typeof settings.useCompanyLogo === "boolean" ? settings.useCompanyLogo : false,
          description: typeof settings.description === "string" ? settings.description : defaultApplicationSettings.description,
          websiteUrl: typeof settings.websiteUrl === "string" ? settings.websiteUrl : defaultApplicationSettings.websiteUrl,
        })
      } catch {
      }
    }

    void loadApplicationSettings()
  }, [])

  useEffect(() => {
    const loadInitialAdminStatus = async () => {
      try {
        const response = await fetch("/api/auth/register", { cache: "no-store" })
        if (!response.ok) return
        const body = await response.json()
        setCanCreateInitialAdmin(body.canCreateInitialAdmin === true)
      } catch {
      }
    }

    void loadInitialAdminStatus()
  }, [])

  const handleLogin = async () => {
    setIsLoading(true)
    setMessage("")
    await clearAuthCookies()
    const result = await signIn("credentials", {
      redirect: false,
      email,
      password,
      mfaCode,
    })

    if (result?.error) {
      setMessage("Falha no login. Verifique seu email e senha.")
    }
    setIsLoading(false)
  }

  const handleRegister = async () => {
    setIsLoading(true)
    setMessage("")
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name: "Administrador", setupToken }),
      })
      if (!response.ok) {
        const body = await response.json()
        throw new Error(body.error || "Falha no cadastro")
      }
      setMessage("Primeiro administrador criado. Faca login para continuar.")
    } catch (error) {
      setMessage((error as Error).message || "Erro no cadastro.")
    } finally {
      setIsLoading(false)
    }
  }

  if (status === "loading" || status === "authenticated") {
    return <LoadingScreen title="Carregando area do sistema" description="Validando sua sessao." />
  }

  return (
    <main className="min-h-screen bg-[#fff7ed] px-6 py-10 text-slate-950">
      <LoadingOverlay visible={isLoading} title="Processando acesso" description="Validando seus dados de entrada." />
      <div className="mx-auto grid min-h-[calc(100vh-5rem)] max-w-6xl content-center items-center justify-items-center gap-10 lg:grid-cols-[1fr_420px] lg:justify-items-stretch">
        <section className="flex max-w-2xl flex-col items-center text-center lg:items-start lg:text-left">
          {applicationSettings.useCompanyLogo && applicationSettings.companyLogo ? (
            <Image
              src={applicationSettings.companyLogo}
              alt={applicationSettings.companyName}
              width={420}
              height={128}
              unoptimized
              className="h-auto max-h-32 w-auto max-w-full object-contain sm:max-w-[420px]"
            />
          ) : (
            <p className="text-3xl font-semibold text-orange-700 sm:text-4xl">{applicationSettings.companyName}</p>
          )}
          <p className="mt-7 text-lg leading-8 text-slate-600">
            {applicationSettings.description}
          </p>
        </section>

        <section className="w-full max-w-[420px] rounded-[8px] border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold text-slate-950">Acesso {applicationSettings.applicationName}</h2>
          <p className="mt-2 text-sm text-slate-600">Entre para abrir sua area conforme o perfil do usuario.</p>

          <div className="mt-6 grid gap-3">
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Email"
              className="rounded-[8px] border border-slate-200 px-4 py-3 outline-none transition focus:border-orange-700"
            />
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Senha"
              type="password"
              className="rounded-[8px] border border-slate-200 px-4 py-3 outline-none transition focus:border-orange-700"
            />
            <input
              value={mfaCode}
              onChange={(event) => setMfaCode(event.target.value)}
              placeholder="Codigo MFA (admins)"
              inputMode="numeric"
              autoComplete="one-time-code"
              className="rounded-[8px] border border-slate-200 px-4 py-3 outline-none transition focus:border-orange-700"
            />
            {canCreateInitialAdmin ? (
              <input
                value={setupToken}
                onChange={(event) => setSetupToken(event.target.value)}
                placeholder="Token de configuracao inicial"
                type="password"
                autoComplete="one-time-code"
                className="rounded-[8px] border border-slate-200 px-4 py-3 outline-none transition focus:border-orange-700"
              />
            ) : null}
            <button
              onClick={handleLogin}
              disabled={isLoading}
              className="rounded-[8px] bg-orange-800 px-5 py-3 font-medium text-white transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Entrar
            </button>
            {canCreateInitialAdmin ? (
              <button
                onClick={handleRegister}
                disabled={isLoading}
                className="rounded-[8px] border border-slate-300 px-5 py-3 font-medium text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Criar primeiro administrador
              </button>
            ) : null}
            <Link href="/senha/recuperar" className="text-center text-sm font-medium text-orange-800">
              Esqueci minha senha
            </Link>
            {message ? <p className="text-sm text-red-600">{message}</p> : null}
          </div>
        </section>
      </div>
    </main>
  )
}
