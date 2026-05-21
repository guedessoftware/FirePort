"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

type ContractTemplate = {
  id: string
  title: string
  description: string | null
  isActive: boolean
  activeVersionId: string | null
  createdAt: string | null
  versions: Array<{
    id: string
    versionNumber: number
    title: string
    bodyText: string
    contentHash: string
    publishedAt: string | null
    status: string
    acceptanceCount: number
  }>
}

type ContractAcceptance = {
  id: string
  versionTitle: string
  versionNumber: number
  userName: string | null
  userEmail: string | null
  landlordName: string | null
  signatureMethod: string
  ipAddress: string | null
  acceptanceHash: string
  acceptedAt: string | null
}

const contractVariables = [
  ["empresa_razao_social", "Razao social nas configuracoes da aplicacao"],
  ["empresa_cnpj", "CNPJ/documento da empresa"],
  ["empresa_endereco", "Endereco comercial da empresa"],
  ["empresa_endereco_cep", "CEP da empresa"],
  ["empresa_cidade", "Cidade da empresa"],
  ["empresa_endereco_uf_sigla", "UF da empresa"],
  ["empresa_telefone", "Telefone de suporte"],
  ["empresa_email", "Email de suporte"],
  ["empresa_site", "Site da empresa"],
  ["nome_cliente", "Razao social/nome do operador"],
  ["cpf_cliente", "CNPJ/CPF do operador"],
  ["endereco_instalacao_cliente", "Endereco mais recente de contrato/provisionamento"],
  ["telefone1_cliente", "Telefone principal do operador no ERP"],
  ["telefone2_cliente", "Telefone secundario do operador no ERP"],
  ["email_cliente", "Email do operador"],
  ["vencimento_mensalidade", "Dia de vencimento da conta financeira"],
  ["forma_cobranca", "Forma de cobranca padrao"],
  ["tipo_cobranca", "Tipo de cobranca padrao"],
  ["valor_unitario_porta_adicional", "Valor excedente por porta"],
  ["descricao_pacotes", "Quantidade de portas inclusas"],
  ["valor_liquido_servico", "Valor minimo mensal"],
  ["taxa_instalacao", "Taxa de instalacao padrao"],
  ["parcela_instalacao", "Parcelamento da instalacao"],
  ["quantidade_portas_adicionais", "Portas ativas acima da franquia"],
  ["prazo_vigencia_contrato", "Prazo padrao de vigencia"],
  ["data_aceite", "Data do aceite eletronico"],
] as const

function formatDateTime(value?: string | null) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date)
}

export default function AdminContractsPanel() {
  const [templates, setTemplates] = useState<ContractTemplate[]>([])
  const [acceptances, setAcceptances] = useState<ContractAcceptance[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState("")
  const [title, setTitle] = useState("Contrato de uso da rede neutra")
  const [description, setDescription] = useState("")
  const [bodyText, setBodyText] = useState("")
  const [message, setMessage] = useState("")
  const [isLoading, setIsLoading] = useState(false)

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) ?? null,
    [selectedTemplateId, templates],
  )
  const activeVersion = selectedTemplate?.versions.find((version) => version.id === selectedTemplate.activeVersionId)
    ?? selectedTemplate?.versions[0]
    ?? null

  const loadData = useCallback(async ({ selectFirst = false }: { selectFirst?: boolean } = {}) => {
    setIsLoading(true)
    try {
      const [templatesRes, acceptancesRes] = await Promise.all([
        fetch("/api/admin/contracts", { cache: "no-store" }),
        fetch("/api/admin/contracts/acceptances", { cache: "no-store" }),
      ])
      const nextTemplates = templatesRes.ok ? await templatesRes.json() as ContractTemplate[] : []
      setTemplates(nextTemplates)
      setAcceptances(acceptancesRes.ok ? await acceptancesRes.json() as ContractAcceptance[] : [])
      if (selectFirst && nextTemplates[0]) {
        setSelectedTemplateId(nextTemplates[0].id)
        setTitle(nextTemplates[0].title)
        setDescription(nextTemplates[0].description || "")
        setBodyText(nextTemplates[0].versions[0]?.bodyText || "")
      }
    } catch {
      setMessage("Nao foi possivel carregar contratos.")
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadData({ selectFirst: true })
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [loadData])

  const selectTemplate = (templateId: string) => {
    const template = templates.find((item) => item.id === templateId)
    setSelectedTemplateId(templateId)
    setTitle(template?.title || "")
    setDescription(template?.description || "")
    setBodyText(template?.versions[0]?.bodyText || "")
  }

  const publish = async () => {
    setIsLoading(true)
    setMessage("")
    try {
      const endpoint = selectedTemplateId
        ? `/api/admin/contracts/${selectedTemplateId}/versions`
        : "/api/admin/contracts"
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, description, bodyText }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || "Falha ao publicar contrato.")
      setMessage(selectedTemplateId ? "Nova versao publicada. Operadores precisarao aceitar novamente." : "Contrato publicado.")
      await loadData()
    } catch (error) {
      setMessage((error as Error).message || "Falha ao publicar contrato.")
    } finally {
      setIsLoading(false)
    }
  }

  const startNewTemplate = () => {
    setSelectedTemplateId("")
    setTitle("Contrato de uso da rede neutra")
    setDescription("")
    setBodyText("")
  }

  return (
    <section className="grid gap-5">
      {message ? <div className="rounded-[8px] border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-900">{message}</div> : null}

      <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
        <section className="rounded-[8px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Modelos</h2>
              <p className="text-sm text-slate-500">Versoes publicadas ficam imutaveis.</p>
            </div>
            <button type="button" onClick={startNewTemplate} className="rounded-[8px] border border-slate-300 px-3 py-2 text-sm font-medium">
              Novo
            </button>
          </div>

          <div className="grid gap-2">
            {templates.length === 0 ? (
              <p className="rounded-[8px] bg-slate-50 p-4 text-sm text-slate-600">Nenhum contrato publicado ainda.</p>
            ) : templates.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => selectTemplate(template.id)}
                className={`rounded-[8px] border p-4 text-left ${selectedTemplateId === template.id ? "border-orange-300 bg-orange-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}
              >
                <span className="block text-sm font-semibold text-slate-950">{template.title}</span>
                <span className="mt-1 block text-xs text-slate-500">
                  {template.versions.length} versao(oes) · {template.versions.reduce((total, version) => total + Number(version.acceptanceCount || 0), 0)} aceite(s)
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-[8px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-slate-950">{selectedTemplateId ? "Publicar nova versao" : "Novo contrato"}</h2>
            <p className="text-sm text-slate-500">Ao publicar nova versao, o aceite anterior deixa de liberar o operador para uso da rede.</p>
          </div>

          <div className="grid gap-4">
            <label className="grid gap-1.5">
              <span className="text-xs font-medium uppercase text-slate-500">Titulo</span>
              <input value={title} onChange={(event) => setTitle(event.target.value)} className="rounded-[8px] border border-slate-200 px-3 py-3 text-sm outline-none focus:border-orange-700" />
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs font-medium uppercase text-slate-500">Descricao interna</span>
              <input value={description} onChange={(event) => setDescription(event.target.value)} className="rounded-[8px] border border-slate-200 px-3 py-3 text-sm outline-none focus:border-orange-700" />
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs font-medium uppercase text-slate-500">Texto do contrato</span>
              <textarea value={bodyText} onChange={(event) => setBodyText(event.target.value)} rows={14} className="resize-y rounded-[8px] border border-slate-200 px-3 py-3 text-sm outline-none focus:border-orange-700" />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={publish} disabled={isLoading} className="rounded-[8px] bg-orange-800 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60">
                {selectedTemplateId ? "Publicar nova versao" : "Publicar contrato"}
              </button>
              {activeVersion ? (
                <span className="text-xs text-slate-500">Hash atual: <span className="font-mono">{activeVersion.contentHash.slice(0, 18)}...</span></span>
              ) : null}
            </div>
          </div>
        </section>

        <section className="rounded-[8px] border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Variaveis do modelo</h2>
          <p className="mt-1 text-sm text-slate-500">Use o formato [[variavel]]. No aceite, o contrato exibido e hashado ja sai com os valores reais do operador.</p>
          <div className="mt-4 grid max-h-[420px] gap-2 overflow-auto pr-1">
            {contractVariables.map(([key, description]) => (
              <div key={key} className="rounded-[8px] border border-slate-100 bg-slate-50 p-3">
                <p className="font-mono text-xs font-semibold text-slate-950">[[{key}]]</p>
                <p className="mt-1 text-xs text-slate-500">{description}</p>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="rounded-[8px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-slate-950">Aceites registrados</h2>
          <p className="text-sm text-slate-500">Ultimos 200 aceites com exportacao de dossie HTML.</p>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="border-b border-slate-100 py-2 pr-4">Operador</th>
                <th className="border-b border-slate-100 py-2 pr-4">Contrato</th>
                <th className="border-b border-slate-100 py-2 pr-4">Aceito em</th>
                <th className="border-b border-slate-100 py-2 pr-4">IP</th>
                <th className="border-b border-slate-100 py-2 pr-4">Hash</th>
                <th className="border-b border-slate-100 py-2 pr-4">Dossie</th>
              </tr>
            </thead>
            <tbody>
              {acceptances.length === 0 ? (
                <tr><td colSpan={6} className="py-4 text-slate-500">Nenhum aceite registrado.</td></tr>
              ) : acceptances.map((acceptance) => (
                <tr key={acceptance.id}>
                  <td className="border-b border-slate-100 py-3 pr-4">
                    <p className="font-medium text-slate-950">{acceptance.landlordName || acceptance.userName || "Operador"}</p>
                    <p className="text-xs text-slate-500">{acceptance.userEmail}</p>
                  </td>
                  <td className="border-b border-slate-100 py-3 pr-4">{acceptance.versionTitle} v{acceptance.versionNumber}</td>
                  <td className="border-b border-slate-100 py-3 pr-4">{formatDateTime(acceptance.acceptedAt)}</td>
                  <td className="border-b border-slate-100 py-3 pr-4">{acceptance.ipAddress || "-"}</td>
                  <td className="border-b border-slate-100 py-3 pr-4 font-mono text-xs">{acceptance.acceptanceHash.slice(0, 18)}...</td>
                  <td className="border-b border-slate-100 py-3 pr-4">
                    <a href={`/api/admin/contracts/acceptances/${acceptance.id}/evidence`} className="font-medium text-orange-800">Exportar</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  )
}
