"use client"

import { ChangeEvent, FormEvent, useEffect, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { LoadingOverlay, LoadingScreen } from "@/components/LoadingState"
import { colorThemes, type ColorThemeName } from "@/lib/color-themes"

type ProfileResponse = {
  id: string
  name: string
  email: string
  image?: string | null
  colorTheme?: ColorThemeName
  role: string
}

type ErpProvider = "hubsoft" | "sgp" | "ispfy" | "beesweb" | "mikweb"
type ErpLookupKey = "cpf_cnpj" | "customer_id" | "contract_id"
type ErpCredentialField = "token" | "clientId" | "username" | "password" | "clientSecret"
type OltDriver = { id: string; label: string }
type OperatorProfile = {
  id: string
  userId: string
  name: string
  driver: string
  vlan?: number | null
  serviceVlan?: number | null
  lineProfile?: string | null
  serviceProfile?: string | null
  gemPort?: number | null
  tcont?: number | null
  serviceName?: string | null
  isDefault: boolean
}
type ErpConfigResponse = {
  id: string
  provider: ErpProvider
  baseUrl: string
  enabled: boolean
  allowedLookupKeys: ErpLookupKey[]
  hasToken: boolean
  hasUsername: boolean
  hasPassword: boolean
  hasClientId: boolean
  hasClientSecret: boolean
  lastConnectionStatus: string | null
  lastConnectionTestAt: string | null
  lastError: string | null
}

const erpProviderLabels: Record<ErpProvider, string> = {
  hubsoft: "HubSoft",
  sgp: "SGP",
  ispfy: "ISPFY",
  beesweb: "Beesweb",
  mikweb: "MikWeb",
}

const erpLookupKeyLabels: Record<ErpLookupKey, string> = {
  cpf_cnpj: "CPF/CNPJ",
  customer_id: "ID cliente",
  contract_id: "ID contrato/servico",
}

const erpCredentialHelp: Record<ErpProvider, {
  token: string
  clientId: string
  username: string
  password: string
  clientSecret: string
}> = {
  hubsoft: {
    token: "Token Bearer",
    clientId: "Client ID",
    username: "Usuario OAuth",
    password: "Senha OAuth",
    clientSecret: "Client secret",
  },
  sgp: {
    token: "Token",
    clientId: "App",
    username: "Usuario",
    password: "Senha",
    clientSecret: "Client secret",
  },
  ispfy: {
    token: "Token",
    clientId: "Client ID",
    username: "Usuario",
    password: "Senha",
    clientSecret: "Client secret",
  },
  beesweb: {
    token: "Token Bearer",
    clientId: "Client ID",
    username: "Email",
    password: "Senha",
    clientSecret: "Client secret",
  },
  mikweb: {
    token: "Token Bearer",
    clientId: "Client ID",
    username: "Usuario",
    password: "Senha",
    clientSecret: "Client secret",
  },
}

const erpProviderLookupKeys: Record<ErpProvider, ErpLookupKey[]> = {
  hubsoft: ["cpf_cnpj", "customer_id", "contract_id"],
  sgp: ["cpf_cnpj", "customer_id", "contract_id"],
  ispfy: ["cpf_cnpj", "customer_id", "contract_id"],
  beesweb: ["cpf_cnpj", "customer_id", "contract_id"],
  mikweb: ["cpf_cnpj", "customer_id"],
}

const erpCredentialFields: Record<ErpProvider, ErpCredentialField[]> = {
  hubsoft: ["token", "clientId", "username", "password", "clientSecret"],
  sgp: ["token", "clientId"],
  ispfy: ["token"],
  beesweb: ["token", "username", "password"],
  mikweb: ["token"],
}

export default function ProfileWorkspace() {
  const router = useRouter()
  const { data: session, status, update } = useSession()
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [profileImage, setProfileImage] = useState<string | null>(null)
  const [colorTheme, setColorTheme] = useState<ColorThemeName>("orange")
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [role, setRole] = useState("")
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [erpConfig, setErpConfig] = useState<ErpConfigResponse | null>(null)
  const [erpProvider, setErpProvider] = useState<ErpProvider>("hubsoft")
  const [erpBaseUrl, setErpBaseUrl] = useState("")
  const [erpEnabled, setErpEnabled] = useState(false)
  const [erpAllowedKeys, setErpAllowedKeys] = useState<ErpLookupKey[]>(["cpf_cnpj", "customer_id", "contract_id"])
  const [erpToken, setErpToken] = useState("")
  const [erpUsername, setErpUsername] = useState("")
  const [erpPassword, setErpPassword] = useState("")
  const [erpClientId, setErpClientId] = useState("")
  const [erpClientSecret, setErpClientSecret] = useState("")
  const [oltDrivers, setOltDrivers] = useState<OltDriver[]>([])
  const [profileId, setProfileId] = useState("")
  const [profileName, setProfileName] = useState("ZTE C650 - padrao")
  const [profileDriver, setProfileDriver] = useState("zte-c650")
  const [profileVlan, setProfileVlan] = useState("")
  const [profileServiceVlan, setProfileServiceVlan] = useState("")
  const [profileLineProfile, setProfileLineProfile] = useState("")
  const [profileServiceProfile, setProfileServiceProfile] = useState("")
  const [profileGemPort, setProfileGemPort] = useState("1")
  const [profileTcont, setProfileTcont] = useState("1")
  const [profileServiceName, setProfileServiceName] = useState("internet")
  const erpCredentialLabels = erpCredentialHelp[erpProvider]
  const compatibleErpLookupKeys = erpProviderLookupKeys[erpProvider]

  const applyOperatorProfile = (profile: OperatorProfile | null) => {
    setProfileId(profile?.id || "")
    setProfileName(profile?.name || "ZTE C650 - padrao")
    setProfileDriver(profile?.driver || "zte-c650")
    setProfileVlan(profile?.vlan ? String(profile.vlan) : "")
    setProfileServiceVlan(profile?.serviceVlan ? String(profile.serviceVlan) : "")
    setProfileLineProfile(profile?.lineProfile || "")
    setProfileServiceProfile(profile?.serviceProfile || "")
    setProfileGemPort(profile?.gemPort ? String(profile.gemPort) : "1")
    setProfileTcont(profile?.tcont ? String(profile.tcont) : "1")
    setProfileServiceName(profile?.serviceName || "internet")
  }

  const applyErpConfig = (config: ErpConfigResponse) => {
    setErpConfig(config)
    setErpProvider(config.provider)
    setErpBaseUrl(config.baseUrl)
    setErpEnabled(config.enabled)
    setErpAllowedKeys(config.allowedLookupKeys.length ? config.allowedLookupKeys : ["cpf_cnpj", "customer_id", "contract_id"])
    setErpToken("")
    setErpUsername("")
    setErpPassword("")
    setErpClientId("")
    setErpClientSecret("")
  }

  useEffect(() => {
    if (status !== "authenticated") return

    const loadProfile = async () => {
      setIsLoading(true)
      setError("")
      try {
        const response = await fetch("/api/profile", { credentials: "same-origin" })
        const body = await response.json().catch(() => ({ error: "Erro ao carregar perfil." }))
        if (!response.ok) {
          throw new Error(body.error || "Erro ao carregar perfil.")
        }

        const profile = body as ProfileResponse
        setName(profile.name || "")
        setEmail(profile.email || "")
        setProfileImage(profile.image || null)
        setColorTheme(profile.colorTheme || "orange")
        setRole(profile.role || "")
        if (profile.role !== "admin") {
          const [erpResponse, operatorProfilesResponse, oltDriversResponse] = await Promise.all([
            fetch("/api/operator/erp/config", { credentials: "same-origin" }),
            fetch("/api/operator-profiles", { credentials: "same-origin" }),
            fetch("/api/olt/drivers", { credentials: "same-origin" }),
          ])
          const erpBody = await erpResponse.json().catch(() => ({ config: null }))
          if (erpResponse.ok && erpBody.config) {
            applyErpConfig(erpBody.config as ErpConfigResponse)
          }
          const operatorProfiles = operatorProfilesResponse.ok ? await operatorProfilesResponse.json().catch(() => []) as OperatorProfile[] : []
          applyOperatorProfile(operatorProfiles.find((item) => item.isDefault) || operatorProfiles[0] || null)
          if (oltDriversResponse.ok) {
            const driversBody = await oltDriversResponse.json().catch(() => ({ drivers: [] }))
            setOltDrivers(Array.isArray(driversBody.drivers) ? driversBody.drivers : [])
          }
        }
      } catch (profileError) {
        setError((profileError as Error).message || "Erro ao carregar perfil.")
      } finally {
        setIsLoading(false)
      }
    }

    void loadProfile()
  }, [status])

  const toggleErpLookupKey = (key: ErpLookupKey) => {
    setErpAllowedKeys((current) => {
      const next = current.includes(key) ? current.filter((item) => item !== key) : [...current, key]
      return next.length ? next : current
    })
  }

  const handleErpProviderChange = (provider: ErpProvider) => {
    setErpProvider(provider)
    setErpAllowedKeys((current) => {
      const compatibleKeys = erpProviderLookupKeys[provider]
      const next = current.filter((key) => compatibleKeys.includes(key))
      return next.length ? next : compatibleKeys
    })
  }

  const erpCredentialValue = (field: ErpCredentialField) => {
    if (field === "token") return erpToken
    if (field === "clientId") return erpClientId
    if (field === "username") return erpUsername
    if (field === "password") return erpPassword
    return erpClientSecret
  }

  const setErpCredentialValue = (field: ErpCredentialField, value: string) => {
    if (field === "token") setErpToken(value)
    if (field === "clientId") setErpClientId(value)
    if (field === "username") setErpUsername(value)
    if (field === "password") setErpPassword(value)
    if (field === "clientSecret") setErpClientSecret(value)
  }

  const hasSavedErpCredential = (field: ErpCredentialField) => {
    if (field === "token") return Boolean(erpConfig?.hasToken)
    if (field === "clientId") return Boolean(erpConfig?.hasClientId)
    if (field === "username") return Boolean(erpConfig?.hasUsername)
    if (field === "password") return Boolean(erpConfig?.hasPassword)
    return Boolean(erpConfig?.hasClientSecret)
  }

  const handleImageChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ""
    setMessage("")
    setError("")

    if (!file) return
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setError("Escolha uma imagem PNG, JPG ou WebP.")
      return
    }
    if (file.size > 750_000) {
      setError("A imagem deve ter ate 750 KB.")
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setProfileImage(reader.result)
      }
    }
    reader.onerror = () => setError("Nao foi possivel carregar a imagem.")
    reader.readAsDataURL(file)
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setMessage("")
    setError("")

    if (!name.trim() || !email.trim()) {
      setError("Informe nome e email.")
      return
    }
    if (newPassword && newPassword !== confirmPassword) {
      setError("A confirmacao de senha nao confere.")
      return
    }
    if (newPassword && !currentPassword) {
      setError("Informe a senha atual para alterar sua senha.")
      return
    }

    setIsLoading(true)
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, image: profileImage, colorTheme, currentPassword, newPassword }),
      })
      const body = await response.json().catch(() => ({ error: "Erro ao atualizar perfil." }))
      if (!response.ok) {
        throw new Error(body.error || "Erro ao atualizar perfil.")
      }

      const updatedProfile = body as ProfileResponse
      setName(updatedProfile.name)
      setEmail(updatedProfile.email)
      setProfileImage(updatedProfile.image || null)
      setColorTheme(updatedProfile.colorTheme || "orange")
      setRole(updatedProfile.role)
      setCurrentPassword("")
      setNewPassword("")
      setConfirmPassword("")
      await update({ name: updatedProfile.name, email: updatedProfile.email })
      setMessage("Perfil atualizado com sucesso.")
    } catch (profileError) {
      setError((profileError as Error).message || "Erro ao atualizar perfil.")
    } finally {
      setIsLoading(false)
    }
  }

  const saveErpConfig = async () => {
    setMessage("")
    setError("")
    if (!erpBaseUrl.trim()) {
      setError("Informe a URL base do ERP.")
      return
    }

    setIsLoading(true)
    try {
      const response = await fetch("/api/operator/erp/config", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: erpProvider,
          baseUrl: erpBaseUrl,
          enabled: erpEnabled,
          allowedLookupKeys: erpAllowedKeys,
          token: erpToken,
          username: erpUsername,
          password: erpPassword,
          clientId: erpClientId,
          clientSecret: erpClientSecret,
        }),
      })
      const body = await response.json().catch(() => ({ error: "Erro ao salvar ERP." }))
      if (!response.ok) throw new Error(body.error || "Erro ao salvar ERP.")
      applyErpConfig(body.config as ErpConfigResponse)
      setMessage("Configuracao ERP salva.")
    } catch (configError) {
      setError((configError as Error).message || "Erro ao salvar ERP.")
    } finally {
      setIsLoading(false)
    }
  }

  const saveOperatorProfile = async () => {
    setMessage("")
    setError("")
    if (!profileName.trim() || !profileDriver || !profileVlan.trim()) {
      setError("Informe nome, driver e VLAN do perfil operacional.")
      return
    }

    setIsLoading(true)
    try {
      const response = await fetch("/api/operator-profiles", {
        method: profileId ? "PATCH" : "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: profileId || undefined,
          name: profileName,
          driver: profileDriver,
          vlan: profileVlan || null,
          serviceVlan: profileServiceVlan || null,
          lineProfile: profileLineProfile,
          serviceProfile: profileServiceProfile,
          gemPort: profileGemPort || null,
          tcont: profileTcont || null,
          serviceName: profileServiceName,
          isDefault: true,
        }),
      })
      const body = await response.json().catch(() => ({ error: "Erro ao salvar perfil operacional." }))
      if (!response.ok) throw new Error(body.error || "Erro ao salvar perfil operacional.")
      applyOperatorProfile(body as OperatorProfile)
      setMessage("Perfil operacional salvo.")
    } catch (profileError) {
      setError((profileError as Error).message || "Erro ao salvar perfil operacional.")
    } finally {
      setIsLoading(false)
    }
  }

  const testErpConfig = async () => {
    setMessage("")
    setError("")
    setIsLoading(true)
    try {
      const response = await fetch("/api/operator/erp/config", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: erpProvider,
          baseUrl: erpBaseUrl,
          enabled: erpEnabled,
          allowedLookupKeys: erpAllowedKeys,
          token: erpToken,
          username: erpUsername,
          password: erpPassword,
          clientId: erpClientId,
          clientSecret: erpClientSecret,
        }),
      })
      const body = await response.json().catch(() => ({ error: "Erro ao testar ERP." }))
      if (body.config) applyErpConfig(body.config as ErpConfigResponse)
      if (!response.ok) throw new Error(body.error || "Erro ao testar ERP.")
      setMessage("Conexao ERP validada.")
    } catch (configError) {
      setError((configError as Error).message || "Erro ao testar ERP.")
    } finally {
      setIsLoading(false)
    }
  }

  if (status === "loading") {
    return <LoadingScreen title="Carregando perfil" description="Buscando seus dados de acesso." />
  }

  if (!session) {
    return (
      <main className={`profile-page profile-palette-${colorTheme}`}>
        <section className="profile-card">
          <h1>Sessao expirada</h1>
          <p className="profile-muted">Entre novamente para editar seu perfil.</p>
          <Link href="/" className="profile-primary-action">Voltar ao acesso</Link>
        </section>
      </main>
    )
  }

  return (
    <main className={`profile-page profile-palette-${colorTheme}`}>
      <LoadingOverlay visible={isLoading} title="Atualizando perfil" description="Salvando e sincronizando suas preferencias." />
      <section className="profile-card">
        <div className="profile-header">
          <div className="profile-header-main">
            <div className="profile-photo-preview">
              {profileImage ? <Image src={profileImage} alt="Foto do perfil" width={84} height={84} unoptimized /> : <span>{name.trim().charAt(0).toUpperCase() || "U"}</span>}
            </div>
            <div className="min-w-0">
              <p className="profile-eyebrow">Perfil do operador</p>
              <h1>Editar perfil</h1>
              <p className="profile-muted">Atualize seus dados de acesso e identificacao.</p>
              <div className="profile-photo-actions">
                <label className="profile-photo-action">
                  Adicionar imagem
                  <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleImageChange} disabled={isLoading} />
                </label>
                {profileImage ? (
                  <button type="button" onClick={() => setProfileImage(null)} className="profile-photo-remove" disabled={isLoading}>
                    Remover
                  </button>
                ) : null}
              </div>
            </div>
          </div>
          <span className="profile-role">{role === "admin" ? "Admin" : "Operador"}</span>
        </div>

        {message ? <div className="profile-message profile-message-success">{message}</div> : null}
        {error ? <div className="profile-message profile-message-error">{error}</div> : null}

        <form onSubmit={handleSubmit} className="profile-form">
          <div className="profile-form-section">
            <p className="profile-section-title">Tema de cores</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Tema de cores">
              {colorThemes.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setColorTheme(item.id)}
                  className={`flex items-center justify-between gap-3 rounded-[8px] border px-3 py-3 text-left text-sm font-bold transition ${
                    colorTheme === item.id
                      ? "border-[var(--profile-accent)] bg-[var(--profile-accent-soft)] text-[var(--profile-accent-strong)]"
                      : "border-slate-300 bg-white text-slate-900"
                  }`}
                  role="radio"
                  aria-checked={colorTheme === item.id}
                  disabled={isLoading}
                >
                  <span className="flex items-center">
                    {item.colors.map((color) => (
                      <span
                        key={color}
                        className="-ml-1 first:ml-0 h-5 w-5 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(15_23_42_/_0.08)]"
                        style={{ background: color }}
                      />
                    ))}
                  </span>
                  <span className="min-w-0 truncate">{item.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="profile-form-section">
            <p className="profile-section-title">Dados pessoais</p>
            <div className="profile-form-grid">
              <label className="profile-field">
                <span>Nome</span>
                <input value={name} onChange={(event) => setName(event.target.value)} disabled={isLoading} />
              </label>
              <label className="profile-field">
                <span>Email</span>
                <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" disabled={isLoading} />
              </label>
            </div>
          </div>

          {role !== "admin" ? (
            <>
              <div className="profile-form-section">
                <p className="profile-section-title">Perfil operacional</p>
                <div className="profile-form-grid">
                  <label className="profile-field">
                    <span>Nome do perfil</span>
                    <input value={profileName} onChange={(event) => setProfileName(event.target.value)} placeholder="Nome do perfil operacional" disabled={isLoading} />
                  </label>
                  <label className="profile-field">
                    <span>Driver OLT</span>
                    <select value={profileDriver} onChange={(event) => setProfileDriver(event.target.value)} disabled={isLoading}>
                      {driverOptions(oltDrivers).map((driver) => <option key={driver.id} value={driver.id}>{driver.label}</option>)}
                    </select>
                  </label>
                  <label className="profile-field">
                    <span>VLAN do operador</span>
                    <input value={profileVlan} onChange={(event) => setProfileVlan(event.target.value)} placeholder="2003" type="number" disabled={isLoading} />
                  </label>
                  <label className="profile-field">
                    <span>Service VLAN</span>
                    <input value={profileServiceVlan} onChange={(event) => setProfileServiceVlan(event.target.value)} placeholder="600" type="number" disabled={isLoading} />
                  </label>
                  <label className="profile-field">
                    <span>GEM Port</span>
                    <input value={profileGemPort} onChange={(event) => setProfileGemPort(event.target.value)} placeholder="1" type="number" disabled={isLoading} />
                  </label>
                  <label className="profile-field">
                    <span>TCONT</span>
                    <input value={profileTcont} onChange={(event) => setProfileTcont(event.target.value)} placeholder="1" type="number" disabled={isLoading} />
                  </label>
                  <label className="profile-field">
                    <span>Servico</span>
                    <input value={profileServiceName} onChange={(event) => setProfileServiceName(event.target.value)} placeholder="internet" disabled={isLoading} />
                  </label>
                  <label className="profile-field">
                    <span>Line profile</span>
                    <input value={profileLineProfile} onChange={(event) => setProfileLineProfile(event.target.value)} placeholder="Opcional" disabled={isLoading} />
                  </label>
                  <label className="profile-field">
                    <span>Service profile</span>
                    <input value={profileServiceProfile} onChange={(event) => setProfileServiceProfile(event.target.value)} placeholder="Opcional" disabled={isLoading} />
                  </label>
                </div>
                <div className="profile-actions">
                  <button type="button" onClick={saveOperatorProfile} className="profile-primary-action" disabled={isLoading}>
                    Salvar perfil operacional
                  </button>
                </div>
              </div>

              <div className="profile-form-section">
                <p className="profile-section-title">Integracao ERP</p>
                <div className="profile-form-grid">
                  <label className="profile-field">
                    <span>ERP</span>
                    <select value={erpProvider} onChange={(event) => handleErpProviderChange(event.target.value as ErpProvider)} disabled={isLoading}>
                      {(Object.keys(erpProviderLabels) as ErpProvider[]).map((provider) => (
                        <option key={provider} value={provider}>{erpProviderLabels[provider]}</option>
                      ))}
                    </select>
                  </label>
                  <label className="profile-field">
                    <span>URL base</span>
                    <input value={erpBaseUrl} onChange={(event) => setErpBaseUrl(event.target.value)} placeholder="https://erp.exemplo.com.br" disabled={isLoading} />
                  </label>
                  {erpCredentialFields[erpProvider].map((field) => {
                    const saved = hasSavedErpCredential(field)
                    return (
                      <label className="profile-field" key={field}>
                        <span>{erpCredentialLabels[field]} {saved ? "(salvo)" : ""}</span>
                        <input
                          value={erpCredentialValue(field)}
                          onChange={(event) => setErpCredentialValue(field, event.target.value)}
                          type={field === "token" || field === "password" || field === "clientSecret" ? "password" : "text"}
                          placeholder={saved ? "Manter atual" : erpCredentialLabels[field]}
                          disabled={isLoading}
                          autoComplete="off"
                        />
                      </label>
                    )
                  })}
                </div>
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {compatibleErpLookupKeys.map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => toggleErpLookupKey(key)}
                      className={`rounded-[8px] border px-3 py-3 text-sm font-bold ${erpAllowedKeys.includes(key) ? "border-[var(--profile-accent)] bg-[var(--profile-accent-soft)] text-[var(--profile-accent-strong)]" : "border-slate-300 bg-white text-slate-700"}`}
                      disabled={isLoading}
                    >
                      {erpLookupKeyLabels[key]}
                    </button>
                  ))}
                </div>
                <label className="mt-3 flex items-center gap-2 text-sm font-bold text-slate-800">
                  <input type="checkbox" checked={erpEnabled} onChange={(event) => setErpEnabled(event.target.checked)} disabled={isLoading} />
                  Ativar busca no ERP no provisionamento
                </label>
                {erpConfig?.lastConnectionStatus ? (
                  <p className="profile-muted mt-2">
                    Status: {erpConfig.lastConnectionStatus === "ok" ? "conectado" : "erro"}
                    {erpConfig.lastError ? ` - ${erpConfig.lastError}` : ""}
                  </p>
                ) : null}
                <div className="profile-actions">
                  <button type="button" onClick={testErpConfig} className="profile-secondary-action" disabled={isLoading || !erpBaseUrl.trim()}>
                    Testar ERP
                  </button>
                  <button type="button" onClick={saveErpConfig} className="profile-primary-action" disabled={isLoading}>
                    Salvar ERP
                  </button>
                </div>
              </div>
            </>
          ) : null}

          <div className="profile-form-section">
            <p className="profile-section-title">Senha</p>
            <div className="profile-form-grid">
              <label className="profile-field">
                <span>Senha atual</span>
                <input value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} type="password" disabled={isLoading} autoComplete="current-password" />
              </label>
              <label className="profile-field">
                <span>Nova senha</span>
                <input value={newPassword} onChange={(event) => setNewPassword(event.target.value)} type="password" disabled={isLoading} autoComplete="new-password" />
              </label>
              <label className="profile-field">
                <span>Confirmar nova senha</span>
                <input value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} type="password" disabled={isLoading} autoComplete="new-password" />
              </label>
            </div>
          </div>

          <div className="profile-actions">
            <button type="button" onClick={() => router.back()} className="profile-secondary-action" disabled={isLoading}>
              Voltar
            </button>
            <button type="submit" className="profile-primary-action" disabled={isLoading}>
              {isLoading ? "Salvando..." : "Salvar alteracoes"}
            </button>
          </div>
        </form>
      </section>
    </main>
  )
}

function driverOptions(drivers: OltDriver[]) {
  return drivers.length ? drivers : [{ id: "zte-c650", label: "ZTE C650" }]
}
