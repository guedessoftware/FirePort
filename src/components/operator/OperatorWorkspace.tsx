"use client"

import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react"
import dynamic from "next/dynamic"
import Image from "next/image"
import Link from "next/link"
import { useSession } from "next-auth/react"
import { LoadingInline, LoadingOverlay, LoadingScreen } from "@/components/LoadingState"
import { normalizeColorTheme, type ColorThemeName } from "@/lib/color-themes"
import { hardSignOut } from "@/lib/client-auth"

const ProvisionMap = dynamic(
  () => import("@/components/ProvisionMap").then((mod) => mod.ProvisionMap),
  { ssr: false },
)

type CtoPort = { id: string; number: number; status: string; ctoId?: string }
type CTO = { id: string; name: string; address: string; lat: number; lng: number; ports: CtoPort[] }
type NearbyCTO = CTO & { distance: number; distanceMeters: number }
type CPEModel = { id: string; name: string; description?: string }
type ErpProvider = "hubsoft" | "sgp" | "ispfy" | "beesweb" | "mikweb"
type ErpLookupKey = "cpf_cnpj" | "customer_id" | "contract_id"
type ErpConfigStatus = {
  provider: ErpProvider
  enabled: boolean
  allowedLookupKeys: ErpLookupKey[]
  lastConnectionStatus: string | null
}
type NormalizedErpAddress = {
  cep: string | null
  fullAddress: string | null
  street: string | null
  number: string | null
  neighborhood: string | null
  city: string | null
  state: string | null
  complement: string | null
  reference: string | null
  lat: number | null
  lng: number | null
}
type NormalizedErpService = {
  externalServiceId: string | null
  externalContractId: string | null
  displayCode: string | null
  contractNumber: string
  status: string | null
  planName: string | null
  login: string | null
  pppoePassword: string | null
  serial: string | null
  address: NormalizedErpAddress | null
  externalUrl: string | null
  raw: unknown
}
type NormalizedErpCustomer = {
  externalCustomerId: string | null
  displayCode: string | null
  name: string
  document: string | null
  phone: string | null
  email: string | null
  status: string | null
  externalUrl: string | null
  address: NormalizedErpAddress | null
  services: NormalizedErpService[]
  raw: unknown
}
type NormalizedErpLookupResponse = {
  provider: ErpProvider
  lookupKey: ErpLookupKey
  query: string
  customers: NormalizedErpCustomer[]
}
type PendingErpLink = {
  provider: ErpProvider
  customerExternalId: string | null
  customerDisplayCode: string | null
  customerUrl: string | null
  serviceExternalId: string | null
  contractExternalId: string | null
  serviceDisplayCode: string | null
  serviceUrl: string | null
  planName: string | null
  login: string | null
  pppoePassword: string | null
  document: string | null
  rawJson: string | null
}

const WIFI_PASSWORD_POLICY_MESSAGE = "A senha do Wi-Fi deve ter no minimo 8 caracteres, com letra maiuscula, minuscula, numero e caractere especial."
const WIFI_SSID_POLICY_MESSAGE = "O nome do Wi-Fi deve usar apenas letras, numeros e os caracteres especiais permitidos: : - _."

function getWifiSsidPolicyError(ssid: string) {
  const cleanSsid = ssid.trim()
  if (!cleanSsid) return null
  return /^[A-Za-z0-9:_-]+$/.test(cleanSsid) ? null : WIFI_SSID_POLICY_MESSAGE
}

function getWifiPasswordPolicyError(password: string) {
  if (!password) return null
  if (
    password.length < 8
    || !/[A-Z]/.test(password)
    || !/[a-z]/.test(password)
    || !/\d/.test(password)
    || !/[^A-Za-z0-9\s]/.test(password)
  ) {
    return WIFI_PASSWORD_POLICY_MESSAGE
  }

  return null
}

type ContractErpLink = Omit<PendingErpLink, "rawJson"> & { id: string; linkedAt: string }
type Provisioning = {
  id: string
  status: string
  createdAt: string
  updatedAt: string
  serial: string
  signal?: number | null
  onuStatus?: string | null
  onuDistanceMeters?: number | null
  onuOnlineDuration?: string | null
  onuRxPower?: number | null
  onuTxPower?: number | null
  genieAcsDeviceId?: string | null
  genieAcsSerialParameter?: string | null
  genieAcsLinkedAt?: string | null
  genieAcsLastInformAt?: string | null
  genieAcsLastSyncAt?: string | null
  genieAcsSummaryJson?: string | null
  contract: {
    name: string
    contractNumber: string
    address?: string
    pppoeLogin?: string | null
    pppoePassword?: string | null
    lat: number
    lng: number
    erpLink?: ContractErpLink | null
  }
  port: { id?: string; number: number; cto: { id?: string; name: string; lat?: number; lng?: number } }
  cpeModel: { name: string }
}

type GenieAcsConnectedDevice = {
  index: string
  hostName: string | null
  ipAddress: string | null
  macAddress: string | null
  interfaceType: string | null
  addressSource: string | null
  active: boolean | null
  leaseTimeRemaining: string | null
  wifiBand?: string | null
  clientMode?: string | null
  rssi?: string | null
  bandwidth?: string | null
  rate?: string | null
  noise?: string | null
  uptime?: string | null
  rxBytes?: string | null
  txBytes?: string | null
  authenticationState?: string | null
}

type GenieAcsWifiInfo = {
  band24: {
    ssid: string | null
    password: string | null
  }
  band5: {
    ssid: string | null
    password: string | null
  }
}

type OperatorStaticCache = {
  ctos: CTO[]
  models: CPEModel[]
  erpConfig: ErpConfigStatus | null
  updatedAt: number
}

type OperatorAccountCache = {
  invoices: BillingInvoice[]
  accessControlStatus: AccessControlStatus
  contractStatus: ContractRequirementStatus
  updatedAt: number
}

type GenieAcsPanelCache = {
  provisioning?: Partial<Provisioning>
  hosts: GenieAcsConnectedDevice[]
  wifi: GenieAcsWifiInfo | null
  updatedAt: number
}

type ProvisioningLog = {
  id: string
  level: string
  stage: string
  message: string
  details?: Record<string, unknown> | null
  createdAt: string
}

type OnuCurrent = {
  id: string
  provisioningId?: string | null
  serial?: string | null
  provisioningCreatedAt?: string | null
  provisioningUpdatedAt?: string | null
  cpeModelName?: string | null
  contractName?: string | null
  contractNumber?: string | null
  oltId: string
  oltName: string
  oltHost: string
  porta: string
  ponIndex: number
  onuId: number
  statusName: string | null
  rxDbm: number | null
  txDbm: number | null
  lastOnline: string | null
  lastOffline: string | null
  learnedMac: string | null
  collectedAt: string
}

type OnuSummary = {
  total: number
  online: number
  los: number
  offline: number
  dyingGasp: number
  warningSignal: number
  criticalSignal: number
}

type PublicApplicationSettings = {
  applicationName: string
  companyName: string
  companyLogo: string | null
  companyLogoDark: string | null
  useCompanyLogo: boolean
  description: string
  websiteUrl: string
  viabilityRadiusMeters: number
}

type BillingInvoice = {
  id: string
  hubsoftInvoiceId: string | null
  hubsoftClientServiceId: string
  competence: string | null
  dueDate: string | null
  amountCents: number | null
  status: string | null
  rawPayload: string | null
  syncedAt: string
}

type AccessControlStatus = {
  billingAccountId: string | null
  state: string
  financialState: string
  overdueDays: number
  administrativeBlockActive: boolean
  administrativeBlockReason: string | null
  confidenceReleaseUntil: string | null
  pendingAction: string | null
  pendingError: string | null
  canViewPortal: boolean
  canUseBilling: boolean
  canUseSupport: boolean
  canProvision: boolean
  canChangeData: boolean
  visibleTabs: string[]
  message: string
}

type ContractRequirementStatus = {
  required: boolean
  accepted: boolean
  pending: boolean
  acceptanceId: string | null
  message: string
  version: {
    id: string
    templateId: string
    versionNumber: number
    title: string
    bodyText: string
    bodyHtml: string
    contentHash: string
    pdfHash: string | null
    publishedAt: string | null
  } | null
}

type BillingInvoiceRaw = {
  link?: string
  valor_pago?: number
  data_pagamento?: string | null
  forma_cobranca?: { descricao?: string }
  nosso_numero?: string
  codigo_barras?: string
  linha_digitavel?: string
  pix_copia_e_cola?: string
}

type ProvisioningImportStatus = "imported" | "updated" | "skipped" | "valid" | "failed"
type ProvisioningImportResult = {
  dryRun: boolean
  summary: {
    total: number
    imported: number
    updated: number
    skipped: number
    valid: number
    failed: number
  }
  results: {
    line: number
    status: ProvisioningImportStatus
    message: string
    contractNumber?: string
    serial?: string
    provisioningId?: string
    ctoName?: string
    portNumber?: number
    oltPort?: string
  }[]
}
type ViabilityResponse = {
  radiusMeters: number
  ctos: NearbyCTO[]
}
type ViabilityResult = {
  lat: number
  lng: number
  radiusMeters: number
  ctos: NearbyCTO[]
}
type ViabilityOutcome = "idle" | "result" | "no-result" | "error"

const statusLabels: Record<string, string> = {
  active: "Ativo",
  inactive: "Inativo",
  olt_pending: "Pendente OLT",
  olt_failed: "Falha OLT",
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

type OperatorTab = "dashboard" | "provisionings" | "onus" | "billing" | "alerts"
type ThemeName = "light" | "dark"
type BillingInvoiceFilter = "all" | "overdue" | "open" | "paid"
type BillingInvoiceStatus = "open" | "overdue" | "paid" | "inactive"
type OnuListFilter = "all" | "alerts" | "offline" | "online"
type OperatorIconName = "alert" | "calendar" | "chevron" | "clock" | "copy" | "cto" | "dashboard" | "distance" | "document" | "edit" | "eye" | "eyeOff" | "list" | "logout" | "moon" | "olt" | "payment" | "pending" | "phone" | "plus" | "reboot" | "router" | "signal" | "sun" | "transfer" | "upload" | "user" | "wifi"
type OperatorAlert = { tone: "danger" | "warn"; text: string; item?: Provisioning; action?: "open-onu" }

const operatorTabs: { id: OperatorTab; label: string; icon: OperatorIconName }[] = [
  { id: "dashboard", label: "Dashboard", icon: "dashboard" },
  { id: "provisionings", label: "Provisionamentos", icon: "olt" },
  { id: "onus", label: "CPEs", icon: "signal" },
  { id: "billing", label: "Faturamento", icon: "document" },
  { id: "alerts", label: "Alertas", icon: "alert" },
]
const operatorPageTitles: Record<OperatorTab, string> = {
  dashboard: "Dashboard",
  provisionings: "Provisionamentos",
  onus: "CPEs vinculadas",
  billing: "Faturamento",
  alerts: "Alertas",
}

const OPERATOR_DATA_REFRESH_INTERVAL_MS = 15_000
const OPERATOR_STATIC_CACHE_TTL_MS = 10 * 60_000
const OPERATOR_ACCOUNT_CACHE_TTL_MS = 60_000
const emptyOnuSummary: OnuSummary = { total: 0, online: 0, los: 0, offline: 0, dyingGasp: 0, warningSignal: 0, criticalSignal: 0 }

function isValidCepValue(value: string) {
  return /^[0-9]{8}$/.test(value.replace(/\D/g, ""))
}

const defaultApplicationSettings: PublicApplicationSettings = {
  applicationName: "FirePort",
  companyName: "Empresa",
  companyLogo: null,
  companyLogoDark: null,
  useCompanyLogo: false,
  description: "Area do cliente",
  websiteUrl: "",
  viabilityRadiusMeters: 150,
}

const defaultAccessControlStatus: AccessControlStatus = {
  billingAccountId: null,
  state: "active_normal",
  financialState: "active_normal",
  overdueDays: 0,
  administrativeBlockActive: false,
  administrativeBlockReason: null,
  confidenceReleaseUntil: null,
  pendingAction: null,
  pendingError: null,
  canViewPortal: true,
  canUseBilling: true,
  canUseSupport: true,
  canProvision: true,
  canChangeData: true,
  visibleTabs: ["dashboard", "provisionings", "onus", "billing", "alerts"],
  message: "Acesso normal.",
}

const defaultContractStatus: ContractRequirementStatus = {
  required: false,
  accepted: true,
  pending: false,
  acceptanceId: null,
  message: "Contrato nao exigido.",
  version: null,
}

function OperatorIcon({ name, className = "" }: { name: OperatorIconName; className?: string }) {
  const commonProps = {
    className: `operator-icon ${className}`,
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 2,
    viewBox: "0 0 24 24",
    "aria-hidden": true,
  }

  if (name === "dashboard") {
    return <svg {...commonProps}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>
  }
  if (name === "olt") {
    return <svg {...commonProps}><rect x="4" y="11" width="16" height="8" rx="2" /><path d="M8 15h.01" /><path d="M12 15h.01" /><path d="M16 15h.01" /><path d="M12 11V8" /><path d="M8 7a6 6 0 0 1 8 0" /><path d="M5.5 4.5a10 10 0 0 1 13 0" /></svg>
  }
  if (name === "pending") {
    return <svg {...commonProps}><path d="M8 7V4h8v3" /><rect x="5" y="7" width="14" height="13" rx="2" /><path d="M15.5 14.5 13 12v-4" /><circle cx="13" cy="12" r="5" /></svg>
  }
  if (name === "alert") {
    return <svg {...commonProps}><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.3 4.1 2.5 18a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 4.1a2 2 0 0 0-3.4 0Z" /></svg>
  }
  if (name === "router") {
    return <svg {...commonProps}><rect x="5" y="12" width="14" height="7" rx="2" /><path d="M8 15.5h.01" /><path d="M12 15.5h.01" /><path d="M16 15.5h.01" /><path d="M12 12V9" /><path d="M8.5 8.2a5.6 5.6 0 0 1 7 0" /><path d="M6 5.8a9.5 9.5 0 0 1 12 0" /></svg>
  }
  if (name === "wifi") {
    return <svg {...commonProps}><path d="M5 12.5a10 10 0 0 1 14 0" /><path d="M8.5 16a5 5 0 0 1 7 0" /><path d="M12 20h.01" /></svg>
  }
  if (name === "phone") {
    return <svg {...commonProps}><rect x="7" y="3" width="10" height="18" rx="2" /><path d="M11 6h2" /><path d="M12 17h.01" /></svg>
  }
  if (name === "cto") {
    return <svg {...commonProps}><rect x="10" y="3" width="4" height="5" rx="1" /><path d="M12 8v5" /><path d="M5 13h14" /><path d="M7 13v3" /><path d="M17 13v3" /><rect x="4" y="16" width="6" height="5" rx="1" /><rect x="14" y="16" width="6" height="5" rx="1" /></svg>
  }
  if (name === "signal") {
    return <svg {...commonProps}><path d="M5 20v-3" /><path d="M10 20v-7" /><path d="M15 20V8" /><path d="M20 20V4" /></svg>
  }
  if (name === "clock") {
    return <svg {...commonProps}><circle cx="12" cy="12" r="8" /><path d="M12 8v5l3 2" /></svg>
  }
  if (name === "distance") {
    return <svg {...commonProps}><path d="M12 21s7-4.4 7-11a7 7 0 1 0-14 0c0 6.6 7 11 7 11Z" /><circle cx="12" cy="10" r="2" /></svg>
  }
  if (name === "transfer") {
    return <svg {...commonProps}><path d="M7 7h11" /><path d="m14 3 4 4-4 4" /><path d="M17 17H6" /><path d="m10 13-4 4 4 4" /></svg>
  }
  if (name === "calendar") {
    return <svg {...commonProps}><rect x="4" y="5" width="16" height="16" rx="2" /><path d="M16 3v4" /><path d="M8 3v4" /><path d="M4 10h16" /></svg>
  }
  if (name === "chevron") {
    return <svg {...commonProps}><path d="m6 9 6 6 6-6" /></svg>
  }
  if (name === "document") {
    return <svg {...commonProps}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" /><path d="M14 3v5h5" /><path d="M9 13h6" /><path d="M9 17h4" /></svg>
  }
  if (name === "upload") {
    return <svg {...commonProps}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" /><path d="M14 3v5h5" /><path d="M12 17V10" /><path d="m9 13 3-3 3 3" /></svg>
  }
  if (name === "eyeOff") {
    return <svg {...commonProps}><path d="m3 3 18 18" /><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" /><path d="M9.9 5.1A9.5 9.5 0 0 1 12 5c5 0 8.5 4.4 9.7 6a13.8 13.8 0 0 1-2.3 2.8" /><path d="M6.6 6.6A13.8 13.8 0 0 0 2.3 12c1.2 1.6 4.7 6 9.7 6 1.5 0 2.9-.4 4.1-1" /></svg>
  }
  if (name === "eye") {
    return <svg {...commonProps}><path d="M2.3 12s3.7-6 9.7-6 9.7 6 9.7 6-3.7 6-9.7 6-9.7-6-9.7-6Z" /><circle cx="12" cy="12" r="3" /></svg>
  }
  if (name === "plus") {
    return <svg {...commonProps}><path d="M12 5v14" /><path d="M5 12h14" /></svg>
  }
  if (name === "reboot") {
    return <svg {...commonProps}><path d="M20 11a8 8 0 1 0-2.35 5.65" /><path d="M20 5v6h-6" /><path d="M12 8v4l2.5 2.5" /></svg>
  }
  if (name === "copy") {
    return <svg {...commonProps}><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" /></svg>
  }
  if (name === "payment") {
    return <svg {...commonProps}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18" /><path d="M7 15h.01" /><path d="M11 15h2" /></svg>
  }
  if (name === "moon") {
    return <svg {...commonProps}><path d="M20.9 13.5A8.5 8.5 0 1 1 10.5 3.1 7 7 0 0 0 20.9 13.5Z" /></svg>
  }
  if (name === "sun") {
    return <svg {...commonProps}><circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" /></svg>
  }
  if (name === "user") {
    return <svg {...commonProps}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>
  }
  if (name === "edit") {
    return <svg {...commonProps}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
  }
  if (name === "logout") {
    return <svg {...commonProps}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></svg>
  }
  return <svg {...commonProps}><path d="M7 7h10" /><path d="M7 12h10" /><path d="M7 17h10" /></svg>
}

export default function OperatorWorkspace() {
  const { data: session, status } = useSession()
  const [activeTab, setActiveTab] = useState<OperatorTab>("dashboard")
  const [theme, setTheme] = useState<ThemeName>("light")
  const [message, setMessage] = useState("")
  const [criticalNotice, setCriticalNotice] = useState("")
  const [profileImage, setProfileImage] = useState<string | null>(null)
  const [colorTheme, setColorTheme] = useState<ColorThemeName>("orange")
  const [applicationSettings, setApplicationSettings] = useState<PublicApplicationSettings>(defaultApplicationSettings)
  const [accessControlStatus, setAccessControlStatus] = useState<AccessControlStatus>(defaultAccessControlStatus)
  const [contractStatus, setContractStatus] = useState<ContractRequirementStatus>(defaultContractStatus)
  const [contractOtpId, setContractOtpId] = useState("")
  const [contractOtpCode, setContractOtpCode] = useState("")
  const [contractOtpDestination, setContractOtpDestination] = useState<string | null>(null)
  const [contractAcceptanceChecked, setContractAcceptanceChecked] = useState(false)
  const [isProfileOpen, setIsProfileOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isCepLoading, setIsCepLoading] = useState(false)
  const [isGeocoding, setIsGeocoding] = useState(false)
  const [isProvisionFormOpen, setIsProvisionFormOpen] = useState(false)
  const [isImportPanelOpen, setIsImportPanelOpen] = useState(false)
  const [hideInactiveProvisionings, setHideInactiveProvisionings] = useState(false)
  const [provisioningSearchQuery, setProvisioningSearchQuery] = useState("")
  const [showProvisioningLogModal, setShowProvisioningLogModal] = useState(false)
  const [provisioningLogTitle, setProvisioningLogTitle] = useState("")
  const [provisioningLogs, setProvisioningLogs] = useState<ProvisioningLog[]>([])
  const [genieAcsProvisioning, setGenieAcsProvisioning] = useState<Provisioning | null>(null)
  const [genieAcsHosts, setGenieAcsHosts] = useState<GenieAcsConnectedDevice[]>([])
  const [genieAcsWifi, setGenieAcsWifi] = useState<GenieAcsWifiInfo | null>(null)
  const [genieAcsMessage, setGenieAcsMessage] = useState("")
  const [wifi24Ssid, setWifi24Ssid] = useState("")
  const [wifi24Password, setWifi24Password] = useState("")
  const [wifi5Ssid, setWifi5Ssid] = useState("")
  const [wifi5Password, setWifi5Password] = useState("")
  const [isGenieAcsLoading, setIsGenieAcsLoading] = useState(false)
  const [isGenieAcsEditorOpen, setIsGenieAcsEditorOpen] = useState(false)
  const [importCsv, setImportCsv] = useState("")
  const [importFileName, setImportFileName] = useState("")
  const [importResult, setImportResult] = useState<ProvisioningImportResult | null>(null)
  const billingInvoiceSyncStartedRef = useRef(false)
  const operatorStaticCacheRef = useRef<OperatorStaticCache | null>(null)
  const operatorAccountCacheRef = useRef<OperatorAccountCache | null>(null)
  const genieAcsPanelCacheRef = useRef<Map<string, GenieAcsPanelCache>>(new Map())
  const messageTimeoutRef = useRef<number | null>(null)
  const [erpConfig, setErpConfig] = useState<ErpConfigStatus | null>(null)
  const [erpLookupKey, setErpLookupKey] = useState<ErpLookupKey>("cpf_cnpj")
  const [erpLookupQuery, setErpLookupQuery] = useState("")
  const [erpLookupResult, setErpLookupResult] = useState<NormalizedErpLookupResponse | null>(null)
  const [selectedErpCustomerIndex, setSelectedErpCustomerIndex] = useState(0)
  const [selectedErpServiceIndex, setSelectedErpServiceIndex] = useState(0)
  const [pendingErpLink, setPendingErpLink] = useState<PendingErpLink | null>(null)
  const [isErpImportPromptOpen, setIsErpImportPromptOpen] = useState(false)

  const clearMessage = useCallback(() => {
    if (messageTimeoutRef.current) {
      window.clearTimeout(messageTimeoutRef.current)
      messageTimeoutRef.current = null
    }
    setMessage("")
  }, [])

  const showMessage = useCallback((text: string, durationMs = 4500) => {
    if (messageTimeoutRef.current) window.clearTimeout(messageTimeoutRef.current)
    setMessage(text)
    if (durationMs > 0) {
      messageTimeoutRef.current = window.setTimeout(() => {
        setMessage("")
        messageTimeoutRef.current = null
      }, durationMs)
    }
  }, [])

  const showCriticalNotice = (text: string) => {
    showMessage(text, 0)
    setCriticalNotice(text)
  }

  const reviewErpImport = () => {
    setIsErpImportPromptOpen(false)
    setActiveTab("provisionings")
    setIsProvisionFormOpen(true)
    window.setTimeout(() => {
      document.getElementById("operator-provision-fields")?.scrollIntoView({ behavior: "smooth", block: "start" })
    }, 50)
  }

  useEffect(() => {
    return () => {
      if (messageTimeoutRef.current) window.clearTimeout(messageTimeoutRef.current)
    }
  }, [showMessage])

  const [models, setModels] = useState<CPEModel[]>([])
  const [, setCtos] = useState<CTO[]>([])
  const [provisionings, setProvisionings] = useState<Provisioning[]>([])
  const [billingInvoices, setBillingInvoices] = useState<BillingInvoice[]>([])
  const [billingInvoiceFilter, setBillingInvoiceFilter] = useState<BillingInvoiceFilter>("all")
  const [onuCurrent, setOnuCurrent] = useState<OnuCurrent[]>([])
  const [onuSummary, setOnuSummary] = useState<OnuSummary>(emptyOnuSummary)
  const [selectedCpeProvisioningId, setSelectedCpeProvisioningId] = useState<string | null>(null)
  const [maneuverProvisioning, setManeuverProvisioning] = useState<Provisioning | null>(null)
  const [maneuverCtoId, setManeuverCtoId] = useState("")
  const [maneuverPortId, setManeuverPortId] = useState("")
  const [maneuverCep, setManeuverCep] = useState("")
  const [maneuverAddress, setManeuverAddress] = useState("")
  const [maneuverNumber, setManeuverNumber] = useState("")
  const [maneuverComplement, setManeuverComplement] = useState("")
  const [maneuverReference, setManeuverReference] = useState("")
  const [maneuverLatitude, setManeuverLatitude] = useState<number | null>(null)
  const [maneuverLongitude, setManeuverLongitude] = useState<number | null>(null)
  const [maneuverNearbyCtos, setManeuverNearbyCtos] = useState<NearbyCTO[]>([])
  const [isManeuverGeocoding, setIsManeuverGeocoding] = useState(false)
  const [selectedCto, setSelectedCto] = useState<CTO | null>(null)
  const [nearestCto, setNearestCto] = useState<CTO | null>(null)
  const [nearbyCtos, setNearbyCtos] = useState<NearbyCTO[]>([])
  const [selectedNearbyCto, setSelectedNearbyCto] = useState<NearbyCTO | null>(null)
  const [selectedPort, setSelectedPort] = useState<CtoPort | null>(null)
  const [selectedModelId, setSelectedModelId] = useState("")

  const [clientName, setClientName] = useState("")
  const [contractNumber, setContractNumber] = useState("")
  const [pppoeLogin, setPppoeLogin] = useState("")
  const [pppoePassword, setPppoePassword] = useState("")
  const [cep, setCep] = useState("")
  const [cepError, setCepError] = useState("")
  const [address, setAddress] = useState("")
  const [addressNumber, setAddressNumber] = useState("")
  const [complement, setComplement] = useState("")
  const [reference, setReference] = useState("")
  const [serial, setSerial] = useState("")
  const [latitude, setLatitude] = useState(-2.9857472)
  const [longitude, setLongitude] = useState(-60.0030611)
  const radiusMeters = applicationSettings.viabilityRadiusMeters
  const [isViabilityModalOpen, setIsViabilityModalOpen] = useState(false)
  const [isViabilityLoading, setIsViabilityLoading] = useState(false)
  const [viabilityLatitude, setViabilityLatitude] = useState("")
  const [viabilityLongitude, setViabilityLongitude] = useState("")
  const [viabilityMessage, setViabilityMessage] = useState("")
  const [viabilityResult, setViabilityResult] = useState<ViabilityResult | null>(null)
  const [viabilityOutcome, setViabilityOutcome] = useState<ViabilityOutcome>("idle")
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === "admin"
  const operatorProfile = session?.user as { name?: string | null; email?: string | null; role?: string | null } | undefined
  const operatorHeaderTitle = operatorPageTitles[activeTab]
  const activeCompanyLogo = applicationSettings.useCompanyLogo
    ? theme === "dark"
      ? applicationSettings.companyLogoDark || applicationSettings.companyLogo
      : applicationSettings.companyLogo
    : null
  const isTotalBlocked = accessControlStatus.state === "financial_total_block"
  const isAccessLimited = isTotalBlocked
    || accessControlStatus.state === "financial_partial_block"
    || accessControlStatus.state === "administrative_partial_block"
    || Boolean(accessControlStatus.pendingAction)

  const alerts: OperatorAlert[] = [
    ...provisionings
      .filter((item) => item.status === "olt_failed")
      .map((item): OperatorAlert => ({ tone: "danger", text: `Falha no registro OLT do contrato ${item.contract.contractNumber}.`, item })),
    ...provisionings
      .filter((item) => item.status === "olt_pending")
      .map((item): OperatorAlert => ({ tone: "warn", text: `Contrato ${item.contract.contractNumber} aguardando registro na OLT.`, item })),
    ...provisionings
      .filter((item) => typeof item.signal === "number" && item.signal < -27)
      .map((item): OperatorAlert => ({ tone: "warn", text: `Sinal baixo na CPE ${item.serial}.`, item, action: "open-onu" })),
  ]
  const activeProvisionings = provisionings.filter((item) => item.status === "active")
  const openBillingInvoices = billingInvoices.filter((invoice) => {
    const status = getEffectiveBillingStatus(invoice)
    return status === "open" || status === "overdue"
  })
  const openBillingInvoiceAmountCents = openBillingInvoices.reduce((total, invoice) => total + Number(invoice.amountCents || 0), 0)
  const overdueBillingInvoices = billingInvoices.filter((invoice) => getEffectiveBillingStatus(invoice) === "overdue")
  const currentBillingInvoices = billingInvoices.filter((invoice) => getEffectiveBillingStatus(invoice) === "open")
  const paidBillingInvoices = billingInvoices.filter((invoice) => getEffectiveBillingStatus(invoice) === "paid")
  const overdueBillingInvoiceAmountCents = overdueBillingInvoices.reduce((total, invoice) => total + Number(invoice.amountCents || 0), 0)
  const currentBillingInvoiceAmountCents = currentBillingInvoices.reduce((total, invoice) => total + Number(invoice.amountCents || 0), 0)
  const paidBillingInvoiceAmountCents = paidBillingInvoices.reduce((total, invoice) => total + Number(invoice.amountCents || 0), 0)
  const visibleBillingInvoices = billingInvoices.filter((invoice) => (
    billingInvoiceFilter === "all" || getEffectiveBillingStatus(invoice) === billingInvoiceFilter
  ))
  const billingFilterTitles: Record<BillingInvoiceFilter, string> = {
    all: "Minhas faturas",
    overdue: "Faturas atrasadas",
    open: "Faturas em dia",
    paid: "Faturas pagas",
  }
  const inactiveProvisioningsCount = provisionings.filter((item) => item.status === "inactive").length
  const sortedProvisionings = [...provisionings].sort((left, right) =>
    new Date(right.updatedAt || right.createdAt).getTime() - new Date(left.updatedAt || left.createdAt).getTime()
  )
  const visibleProvisionings = hideInactiveProvisionings
    ? sortedProvisionings.filter((item) => item.status !== "inactive")
    : sortedProvisionings
  const normalizedProvisioningSearch = provisioningSearchQuery.trim().toLowerCase()
  const searchedProvisionings = normalizedProvisioningSearch
    ? visibleProvisionings.filter((item) => [
      item.contract.name,
      item.contract.contractNumber,
    ].some((value) => value.toLowerCase().includes(normalizedProvisioningSearch)))
    : visibleProvisionings
  const genieAcsActiveHostCount = genieAcsHosts.filter((host) => host.active !== false).length
  const availablePorts = selectedCto?.ports.filter((port) => port.status === "available") ?? []
  const maneuverAvailableCtos = maneuverNearbyCtos
    .map((cto) => ({
      ...cto,
      ports: cto.ports.filter((port) => port.status === "available"),
    }))
    .filter((cto) => cto.ports.length > 0 && cto.id !== maneuverProvisioning?.port.cto.id)
  const selectedManeuverCto = maneuverAvailableCtos.find((cto) => cto.id === maneuverCtoId) ?? null

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      const storedTheme = window.localStorage.getItem("operator-theme")
      if (storedTheme === "light" || storedTheme === "dark") {
        setTheme(storedTheme)
        return
      }

      if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
        setTheme("dark")
      }
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [])

  const selectNearbyCto = (ctoId: string) => {
    const cto = nearbyCtos.find((item) => item.id === ctoId) ?? null
    setSelectedNearbyCto(cto)
    setSelectedCto(cto)
    setSelectedPort(cto?.ports.find((port) => port.status === "available") ?? null)
  }

  const refreshBillingInvoices = useCallback(async ({ sync = false }: { sync?: boolean } = {}) => {
    try {
      if (sync) {
        const syncResponse = await fetch("/api/operator/billing/invoices/sync", {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
        })
        if (!syncResponse.ok) {
          const body = await syncResponse.json().catch(() => ({ error: "Falha ao sincronizar faturas." }))
          throw new Error(body.error || "Falha ao sincronizar faturas.")
        }
      }

      const invoicesResponse = await fetch("/api/operator/billing/invoices", { cache: "no-store" })
      const invoices = invoicesResponse.ok ? await invoicesResponse.json() as BillingInvoice[] : []
      setBillingInvoices(invoices)
      if (operatorAccountCacheRef.current) {
        operatorAccountCacheRef.current = { ...operatorAccountCacheRef.current, invoices, updatedAt: Date.now() }
      }
    } catch (error) {
      if (sync) showMessage((error as Error).message || "Nao foi possivel sincronizar suas faturas.")
    }
  }, [showMessage])

  const loadData = useCallback(async ({ silent = false, forceStatic = !silent }: { silent?: boolean; forceStatic?: boolean } = {}) => {
    if (!silent) setIsLoading(true)
    try {
      const requestOptions: RequestInit = { cache: "no-store" }
      const now = Date.now()
      const staticCache = operatorStaticCacheRef.current
      const accountCache = operatorAccountCacheRef.current
      const shouldRefreshStatic = forceStatic || !staticCache || now - staticCache.updatedAt > OPERATOR_STATIC_CACHE_TTL_MS
      const shouldRefreshAccount = forceStatic || !accountCache || now - accountCache.updatedAt > OPERATOR_ACCOUNT_CACHE_TTL_MS

      const dynamicDataPromise = Promise.all([
        fetch("/api/provisionings", requestOptions),
        fetch("/api/onu-monitoring/current", requestOptions),
      ])
      const staticDataPromise = shouldRefreshStatic
        ? Promise.all([
          fetch("/api/cto", requestOptions),
          fetch("/api/cpemodels", requestOptions),
          fetch("/api/operator/erp/config", requestOptions),
        ])
        : null
      const accountDataPromise = shouldRefreshAccount
        ? Promise.all([
          fetch("/api/operator/billing/invoices", requestOptions),
          fetch("/api/operator/access-control/status", requestOptions),
          fetch("/api/operator/contracts/status", requestOptions),
        ])
        : null

      if (staticCache && !shouldRefreshStatic) {
        setCtos(staticCache.ctos)
        setModels(staticCache.models)
        setErpConfig(staticCache.erpConfig)
        setSelectedCto((current) => current ?? staticCache.ctos[0] ?? null)
      }
      if (accountCache && !shouldRefreshAccount) {
        setBillingInvoices(accountCache.invoices)
        setAccessControlStatus(accountCache.accessControlStatus)
        setContractStatus(accountCache.contractStatus)
      }

      const [provRes, onuCurrentRes] = await dynamicDataPromise
      setProvisionings(provRes.ok ? await provRes.json() : [])
      const onuData = onuCurrentRes.ok ? await onuCurrentRes.json() as { summary?: OnuSummary; items?: OnuCurrent[] } : null
      setOnuSummary(onuData?.summary ?? emptyOnuSummary)
      setOnuCurrent(onuData?.items ?? [])

      if (staticDataPromise) {
        const [ctosRes, modelsRes, erpRes] = await staticDataPromise
        const ctoData = ctosRes.ok ? await ctosRes.json() as CTO[] : []
        const modelData = modelsRes.ok ? await modelsRes.json() as CPEModel[] : []
        const erpBody = erpRes.ok ? await erpRes.json().catch(() => ({ config: null })) as { config?: ErpConfigStatus | null } : { config: null }
        const nextErpConfig = erpBody.config && erpBody.config.enabled ? erpBody.config : null
        operatorStaticCacheRef.current = {
          ctos: ctoData,
          models: modelData,
          erpConfig: nextErpConfig,
          updatedAt: Date.now(),
        }
        setCtos(ctoData)
        setModels(modelData)
        setErpConfig(nextErpConfig)
        if (erpBody.config?.enabled && erpBody.config.allowedLookupKeys.length && !erpBody.config.allowedLookupKeys.includes(erpLookupKey)) {
          setErpLookupKey(erpBody.config.allowedLookupKeys[0])
        }
        setSelectedCto((current) => current ?? ctoData[0] ?? null)
      }

      if (accountDataPromise) {
        const [invoicesRes, accessRes, contractRes] = await accountDataPromise
        const invoices = invoicesRes.ok ? await invoicesRes.json() as BillingInvoice[] : []
        const nextAccessControlStatus = accessRes.ok ? await accessRes.json() as AccessControlStatus : defaultAccessControlStatus
        const nextContractStatus = contractRes.ok ? await contractRes.json() as ContractRequirementStatus : defaultContractStatus
        operatorAccountCacheRef.current = {
          invoices,
          accessControlStatus: nextAccessControlStatus,
          contractStatus: nextContractStatus,
          updatedAt: Date.now(),
        }
        setBillingInvoices(invoices)
        setAccessControlStatus(nextAccessControlStatus)
        setContractStatus(nextContractStatus)
      }
    } catch {
      if (!silent) showMessage("Nao foi possivel carregar seus dados.")
    } finally {
      if (!silent) setIsLoading(false)
    }
  }, [erpLookupKey, showMessage])

  useEffect(() => {
    if (status !== "authenticated") return

    let isRefreshing = false
    const refreshData = async (silent: boolean) => {
      if (isRefreshing) return
      isRefreshing = true
      try {
        await loadData({ silent })
      } finally {
        isRefreshing = false
      }
    }

    void refreshData(false)
    const intervalId = window.setInterval(() => {
      void refreshData(true)
    }, OPERATOR_DATA_REFRESH_INTERVAL_MS)

    return () => window.clearInterval(intervalId)
  }, [loadData, status])

  useEffect(() => {
    if (!genieAcsMessage || isLoading || isGenieAcsLoading) return

    const timeoutId = window.setTimeout(() => {
      setGenieAcsMessage("")
    }, 4200)

    return () => window.clearTimeout(timeoutId)
  }, [genieAcsMessage, isLoading, isGenieAcsLoading])

  useEffect(() => {
    if (status !== "authenticated" || activeTab !== "billing" || billingInvoiceSyncStartedRef.current) return

    billingInvoiceSyncStartedRef.current = true
    void refreshBillingInvoices({ sync: true })
  }, [activeTab, refreshBillingInvoices, status])

  useEffect(() => {
    if (!isTotalBlocked) return
    const frameId = window.requestAnimationFrame(() => {
      if (activeTab !== "billing" && activeTab !== "alerts") {
        setActiveTab("billing")
      }
      setIsProvisionFormOpen(false)
      setIsImportPanelOpen(false)
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [activeTab, isTotalBlocked])

  useEffect(() => {
    if (status !== "authenticated") return

    const loadApplicationSettings = async () => {
      try {
        const response = await fetch("/api/settings/application/public")
        if (!response.ok) return
        const settings = await response.json()
        setApplicationSettings({
          applicationName: typeof settings.applicationName === "string" ? settings.applicationName : defaultApplicationSettings.applicationName,
          companyName: typeof settings.companyName === "string" ? settings.companyName : defaultApplicationSettings.companyName,
          companyLogo: typeof settings.companyLogo === "string" ? settings.companyLogo : null,
          companyLogoDark: typeof settings.companyLogoDark === "string" ? settings.companyLogoDark : null,
          useCompanyLogo: typeof settings.useCompanyLogo === "boolean" ? settings.useCompanyLogo : false,
          description: typeof settings.description === "string" ? settings.description : defaultApplicationSettings.description,
          websiteUrl: typeof settings.websiteUrl === "string" ? settings.websiteUrl : defaultApplicationSettings.websiteUrl,
          viabilityRadiusMeters: Number.isFinite(Number(settings.viabilityRadiusMeters)) ? Number(settings.viabilityRadiusMeters) : defaultApplicationSettings.viabilityRadiusMeters,
        })
      } catch {
      }
    }

    const loadProfileImage = async () => {
      try {
        const response = await fetch("/api/profile", { credentials: "same-origin" })
        if (!response.ok) return
        const profile = await response.json()
        setProfileImage(typeof profile.image === "string" ? profile.image : null)
        setColorTheme(normalizeColorTheme(profile.colorTheme) ?? "orange")
      } catch {
      }
    }

    void loadApplicationSettings()
    void loadProfileImage()
  }, [status])

  const buildGeocodeQuery = (rawAddress: string) => {
    const normalized = rawAddress.trim().replace(/\s+/g, " ")
    if (!normalized) return ""
    const postalCode = normalized.replace(/\D/g, "")
    if (/^\d{8}$/.test(postalCode)) return postalCode
    const cleanAddress = normalized.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    const [streetAndNeighborhoodPart, cityStatePart = ""] = cleanAddress.split(/\s*-\s*/).map((part) => part.trim())
    const parts = streetAndNeighborhoodPart.split(",").map((part) => part.trim()).filter(Boolean)
    const street = parts[0] || ""
    const neighborhood = parts.slice(1).join(", ")
    return [street, neighborhood, cityStatePart].filter(Boolean).join(", ")
  }

  const formatCanonicalGeocodeAddress = (street: string, number: string, neighborhood: string, city: string, state: string) => {
    const streetAndNumber = [street.trim(), number.trim()].filter(Boolean).join(", ")
    const neighborhoodPart = neighborhood.trim() ? ` - ${neighborhood.trim()}` : ""
    const cityState = [city.trim(), state.trim().toUpperCase()].filter(Boolean).join(" - ")
    return [streetAndNumber ? `${streetAndNumber}${neighborhoodPart}` : "", cityState].filter(Boolean).join(", ")
  }

  const buildCanonicalGeocodeAddress = (rawAddress: string, number: string) => {
    const normalized = rawAddress.trim().replace(/\s+/g, " ")
    const cleanNumber = number.trim()
    if (!normalized || !cleanNumber) return ""

    const canonicalMatch = normalized.match(/^(.+?),\s*(?:(\d+[a-zA-Z-]*)\s*-\s*)?(.+?),\s*([^,/]+?)\s*[-/]\s*([a-zA-Z]{2})$/)
    if (canonicalMatch) {
      return formatCanonicalGeocodeAddress(
        canonicalMatch[1] || "",
        cleanNumber,
        canonicalMatch[3] || "",
        canonicalMatch[4] || "",
        canonicalMatch[5] || "",
      )
    }

    const viaCepMatch = normalized.match(/^(.+?),\s*(.+?)\s*-\s*([^/,-]+?)\s*\/\s*([a-zA-Z]{2})$/)
    if (viaCepMatch) {
      return formatCanonicalGeocodeAddress(
        viaCepMatch[1] || "",
        cleanNumber,
        viaCepMatch[2] || "",
        viaCepMatch[3] || "",
        viaCepMatch[4] || "",
      )
    }

    const addressWithoutNeighborhoodMatch = normalized.match(/^(.+?)\s*-\s*([^/,-]+?)\s*\/\s*([a-zA-Z]{2})$/)
    if (addressWithoutNeighborhoodMatch) {
      return formatCanonicalGeocodeAddress(
        addressWithoutNeighborhoodMatch[1] || "",
        cleanNumber,
        "",
        addressWithoutNeighborhoodMatch[2] || "",
        addressWithoutNeighborhoodMatch[3] || "",
      )
    }

    return ""
  }

  const geocodeAddress = async (value: string, number = "", context = "") => {
    if (!value.trim()) return null
    setIsGeocoding(true)
    showMessage("")
    try {
      const params = new URLSearchParams({ address: value })
      if (number) params.set("number", number)
      if (context.trim()) params.set("context", buildGeocodeQuery(context))
      const response = await fetch(`/api/geocode?${params.toString()}`)
      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: "Falha ao buscar coordenadas" }))
        showMessage(body.error || "Falha ao buscar coordenadas")
        return null
      }
      const data = await response.json()
      if (typeof data.lat === "number" && typeof data.lng === "number") {
        setLatitude(data.lat)
        setLongitude(data.lng)
        await fetchNearestCto(data.lat, data.lng)
        return { lat: data.lat, lng: data.lng }
      }
      return null
    } catch {
      showMessage("Nao foi possivel atualizar as coordenadas.")
      return null
    } finally {
      setIsGeocoding(false)
    }
  }

  const fetchNearestCto = async (lat: number, lng: number, showCtoMessage = false) => {
    setIsLoading(true)
    try {
      const response = await fetch(`/api/cto/nearest?lat=${lat}&lng=${lng}`)
      if (!response.ok) throw new Error("Falha ao buscar CTO.")
      const data: NearbyCTO[] = await response.json()
      setNearbyCtos(data)
      const nearest = data[0]
      if (!nearest) {
        setNearestCto(null)
        setSelectedCto(null)
        setSelectedNearbyCto(null)
        setSelectedPort(null)
        if (showCtoMessage) showMessage(`Nenhuma CTO dentro de ${radiusMeters} metros.`)
        return []
      }

      setNearestCto(nearest)
      setSelectedCto(nearest)
      setSelectedNearbyCto(nearest)
      setSelectedPort(nearest.ports.find((port) => port.status === "available") || null)
      if (showCtoMessage) {
        showMessage(data.length > 1 ? `${data.length} CTOs encontradas. Selecione a CTO desejada para esta instalacao.` : "CTO localizada para esta instalacao.")
      }
      return data
    } catch {
      showMessage("Erro ao localizar a CTO mais proxima.")
      setNearbyCtos([])
      setNearestCto(null)
      setSelectedCto(null)
      setSelectedNearbyCto(null)
      setSelectedPort(null)
      return []
    } finally {
      setIsLoading(false)
    }
  }

  const openViabilityModal = () => {
    setViabilityLatitude(Number.isFinite(latitude) ? String(Number(latitude.toFixed(7))) : "")
    setViabilityLongitude(Number.isFinite(longitude) ? String(Number(longitude.toFixed(7))) : "")
    setViabilityMessage("")
    setViabilityResult(null)
    setViabilityOutcome("idle")
    setIsViabilityModalOpen(true)
  }

  const resetViabilitySearch = () => {
    setViabilityMessage("")
    setViabilityResult(null)
    setViabilityOutcome("idle")
  }

  const continueProvisioningFromViability = (lat: number, lng: number, viableCtos: NearbyCTO[]) => {
    const nearest = viableCtos[0]
    if (!nearest) return

    if (!accessControlStatus.canProvision) {
      setIsViabilityModalOpen(false)
      showCriticalNotice(accessControlStatus.message)
      return
    }

    setLatitude(lat)
    setLongitude(lng)
    setNearbyCtos(viableCtos)
    setNearestCto(nearest)
    setSelectedCto(nearest)
    setSelectedNearbyCto(nearest)
    setSelectedPort(nearest.ports[0] ?? null)
    setIsProvisionFormOpen(true)
    setActiveTab("provisionings")
    setIsViabilityModalOpen(false)
    showMessage(`${nearest.name} encontrada a ${Math.round(nearest.distanceMeters)}m com ${nearest.ports.length} porta${nearest.ports.length === 1 ? "" : "s"} livre${nearest.ports.length === 1 ? "" : "s"}. Complete os dados do cliente para provisionar.`)
  }

  const checkLocalViability = async () => {
    const lat = Number(viabilityLatitude.replace(",", "."))
    const lng = Number(viabilityLongitude.replace(",", "."))

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setViabilityMessage("Informe latitude e longitude validas.")
      setViabilityOutcome("error")
      return
    }

    setIsViabilityLoading(true)
    setViabilityMessage("")
    setViabilityResult(null)
    setViabilityOutcome("idle")
    try {
      const params = new URLSearchParams({
        lat: String(lat),
        lng: String(lng),
      })
      const response = await fetch(`/api/cto/viability?${params.toString()}`, { cache: "no-store" })
      const body = await response.json().catch(() => ({ error: "Falha ao consultar viabilidade." }))
      if (!response.ok) throw new Error(body.error || "Falha ao consultar viabilidade.")

      const data = body as ViabilityResponse
      if (!data.ctos.length) {
        setViabilityMessage(`Nenhuma CTO local com porta livre foi encontrada dentro de ${Math.round(data.radiusMeters)}m.`)
        setViabilityOutcome("no-result")
        return
      }

      setViabilityResult({
        lat,
        lng,
        radiusMeters: data.radiusMeters,
        ctos: data.ctos,
      })
      setViabilityOutcome("result")
      setViabilityMessage("")
    } catch (error) {
      setViabilityMessage((error as Error).message || "Erro ao consultar viabilidade local.")
      setViabilityOutcome("error")
    } finally {
      setIsViabilityLoading(false)
    }
  }

  const pasteViabilityCoordinates = (event: React.ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData("text").trim()
    const match = text.match(/^\s*(-?\d+(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d+(?:[.,]\d+)?)\s*$/)
    if (!match) return

    const lat = Number(match[1].replace(",", "."))
    const lng = Number(match[2].replace(",", "."))
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return

    event.preventDefault()
    setViabilityLatitude(String(lat))
    setViabilityLongitude(String(lng))
    resetViabilitySearch()
  }

  const isValidCep = isValidCepValue

  const fetchAddressByCep = async (value: string) => {
    const cleanCep = value.replace(/\D/g, "")
    if (!isValidCep(cleanCep)) {
      setCepError("CEP invalido. Informe 8 digitos.")
      return
    }
    setCepError("")
    setIsCepLoading(true)
    try {
      const response = await fetch(`/api/cep?cep=${cleanCep}`)
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "CEP nao encontrado")
      }
      const data = await response.json()
      const formattedAddress = `${data.logradouro || ""}${data.bairro ? `, ${data.bairro}` : ""}${data.localidade ? ` - ${data.localidade}` : ""}${data.uf ? `/${data.uf}` : ""}`
      setAddress(formattedAddress)
    } catch (error) {
      setCepError((error as Error).message || "Nao foi possivel buscar o CEP")
    } finally {
      setIsCepLoading(false)
    }
  }

  const formatErpAddress = (erpAddress: NormalizedErpAddress | null) => {
    if (!erpAddress) return ""
    if (erpAddress.fullAddress) return erpAddress.fullAddress
    const cityState = [erpAddress.city, erpAddress.state].filter(Boolean).join("/")
    return [erpAddress.street, erpAddress.neighborhood, cityState].filter(Boolean).join(", ")
  }

  const buildPendingErpLink = (customer: NormalizedErpCustomer, service: NormalizedErpService): PendingErpLink => ({
    provider: erpLookupResult?.provider ?? erpConfig?.provider ?? "hubsoft",
    customerExternalId: customer.externalCustomerId,
    customerDisplayCode: customer.displayCode,
    customerUrl: customer.externalUrl,
    serviceExternalId: service.externalServiceId,
    contractExternalId: service.externalContractId,
    serviceDisplayCode: service.displayCode,
    serviceUrl: service.externalUrl,
    planName: service.planName,
    login: service.login,
    pppoePassword: service.pppoePassword,
    document: customer.document,
    rawJson: JSON.stringify({ customer: customer.raw, service: service.raw }),
  })

  const applyErpSelection = async (customer: NormalizedErpCustomer, service: NormalizedErpService) => {
    const erpAddress = service.address ?? customer.address
    const nextAddress = formatErpAddress(erpAddress)
    const nextNumber = erpAddress?.number || ""

    setClientName(customer.name || "")
    setContractNumber(service.contractNumber || service.displayCode || service.externalServiceId || "")
    setPppoeLogin(service.login || "")
    setPppoePassword(service.pppoePassword || "")
    setCep(erpAddress?.cep || "")
    setAddress(nextAddress)
    setAddressNumber(nextNumber)
    setComplement(erpAddress?.complement || "")
    setReference(erpAddress?.reference || "")
    setSerial(service.serial || "")
    setPendingErpLink(buildPendingErpLink(customer, service))

    if (typeof erpAddress?.lat === "number" && typeof erpAddress.lng === "number") {
      setLatitude(erpAddress.lat)
      setLongitude(erpAddress.lng)
      await fetchNearestCto(erpAddress.lat, erpAddress.lng, true)
    } else if (nextNumber.trim()) {
      const canonicalAddress = buildCanonicalGeocodeAddress(nextAddress, nextNumber)
      if (canonicalAddress) {
        await geocodeAddress(canonicalAddress)
      } else if (erpAddress?.cep) {
        await geocodeAddress(erpAddress.cep, nextNumber, nextAddress)
      }
    }

  }

  const handleErpLookup = async () => {
    if (!erpConfig?.enabled) return
    showMessage("")
    setIsLoading(true)
    setErpLookupResult(null)
    setPendingErpLink(null)
    setIsErpImportPromptOpen(false)
    let shouldOpenImportPrompt = false
    try {
      const response = await fetch("/api/operator/erp/lookup", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: erpLookupKey, query: erpLookupQuery }),
      })
      const body = await response.json().catch(() => ({ error: "Erro ao consultar ERP." }))
      if (!response.ok) throw new Error(body.error || "Erro ao consultar ERP.")
      const result = body as NormalizedErpLookupResponse
      setErpLookupResult(result)
      setSelectedErpCustomerIndex(0)
      setSelectedErpServiceIndex(0)
      const firstCustomer = result.customers[0]
      const firstService = firstCustomer?.services[0]
      if (result.customers.length === 1 && firstService && firstCustomer.services.length === 1) {
        await applyErpSelection(firstCustomer, firstService)
        shouldOpenImportPrompt = true
      } else {
        showMessage(result.customers.length ? "Selecione o cliente e o servico retornados pelo ERP." : "Nenhum cliente encontrado no ERP.")
      }
    } catch (error) {
      showMessage((error as Error).message || "Erro ao consultar ERP.")
    } finally {
      setIsLoading(false)
      if (shouldOpenImportPrompt) {
        window.setTimeout(() => setIsErpImportPromptOpen(true), 0)
      }
    }
  }

  const selectErpService = async (customerIndex: number, serviceIndex: number) => {
    const customer = erpLookupResult?.customers[customerIndex]
    const service = customer?.services[serviceIndex]
    if (!customer || !service) return
    setSelectedErpCustomerIndex(customerIndex)
    setSelectedErpServiceIndex(serviceIndex)
    await applyErpSelection(customer, service)
    window.setTimeout(() => setIsErpImportPromptOpen(true), 0)
  }

  const handleProvision = async () => {
    if (!accessControlStatus.canProvision) {
      showCriticalNotice(accessControlStatus.message)
      setIsProvisionFormOpen(false)
      return
    }
    if (!clientName.trim() || !contractNumber.trim() || !isValidCep(cep) || !address.trim() || !addressNumber.trim()) {
      showCriticalNotice("Preencha os dados obrigatorios do cliente.")
      return
    }
    if (!selectedPort || !selectedModelId || !serial.trim()) {
      showCriticalNotice("Selecione porta, modelo da CPE e informe o serial GPON.")
      return
    }
    if ((latitude === -2.9857472 && longitude === -60.0030611) || !latitude || !longitude) {
      showCriticalNotice("Busque o endereco antes de provisionar.")
      return
    }

    setIsLoading(true)
    showMessage("")
    try {
      const contractResponse = await fetch("/api/contracts", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: clientName,
          contractNumber,
          cep,
          address,
          number: addressNumber,
          complement,
          reference,
          lat: latitude,
          lng: longitude,
          pppoeLogin,
          pppoePassword,
          erpLink: pendingErpLink
            ? {
                ...pendingErpLink,
                login: pppoeLogin.trim() || null,
                pppoePassword: pppoePassword.trim() || null,
              }
            : null,
        }),
      })
      if (!contractResponse.ok) {
        const body = await contractResponse.json().catch(() => ({ error: "Falha ao criar contrato." }))
        throw new Error(body.message || body.error || body.details || "Falha ao criar contrato.")
      }

      const contract = await contractResponse.json()
      const response = await fetch("/api/provisionings", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contractId: contract.id, portId: selectedPort.id, cpeModelId: selectedModelId, serial }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: "Falha no provisionamento." }))
        if (body.canDeprovision && body.existingProvisioningId) {
          const confirmed = window.confirm(`${body.message || "A ONU/CPE ja existe na OLT."} Deseja desprovisionar agora?`)
          if (confirmed) {
            await deprovisionOltById(body.existingProvisioningId)
            setActiveTab("provisionings")
            return
          }
        }
        throw new Error(body.message || body.error || body.details || "Falha no provisionamento.")
      }

      const createdProvisioning = await response.json()
      showMessage(createdProvisioning.olt?.message || createdProvisioning.message || "Provisionamento criado com sucesso.")
      setClientName("")
      setContractNumber("")
      setPppoeLogin("")
      setPppoePassword("")
      setCep("")
      setAddress("")
      setAddressNumber("")
      setComplement("")
      setReference("")
      setSerial("")
      setPendingErpLink(null)
      setIsErpImportPromptOpen(false)
      setErpLookupResult(null)
      setErpLookupQuery("")
      setSelectedModelId("")
      setSelectedPort(null)
      setIsProvisionFormOpen(false)
      setActiveTab("provisionings")
      await loadData()
    } catch (error) {
      showCriticalNotice((error as Error).message || "Erro no provisionamento.")
    } finally {
      setIsLoading(false)
    }
  }

  const handleImportFile = async (file?: File | null) => {
    if (!file) return
    showMessage("")
    setImportResult(null)
    setImportFileName(file.name)
    setImportCsv(await file.text())
  }

  const downloadImportTemplate = () => {
    const headers = [
      "cliente",
      "contrato",
      "cep",
      "endereco",
      "numero",
      "complemento",
      "referencia",
      "latitude",
      "longitude",
      "cto",
      "porta",
      "modelo_cpe",
      "serial",
      "status",
      "onu_id",
    ].join(";")
    const example = [
      "Cliente Exemplo",
      "1001",
      "69000000",
      "Rua Exemplo, Centro - Manaus/AM",
      "123",
      "",
      "",
      "-3.1019",
      "-60.0250",
      "CTO-001",
      "1",
      models[0]?.name || "Modelo CPE",
      "ZTEG12345678",
      "active",
      "",
    ].join(";")
    const blob = new Blob([`${headers}\n${example}\n`], { type: "text/csv;charset=utf-8" })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = "modelo-importacao-provisionamentos.csv"
    link.click()
    window.URL.revokeObjectURL(url)
  }

  const handleProvisioningImport = async (dryRun = false) => {
    if (!accessControlStatus.canProvision) {
      showMessage(accessControlStatus.message)
      setIsImportPanelOpen(false)
      return
    }
    if (!importCsv.trim()) {
      showMessage("Selecione um CSV ou cole o conteudo da importacao.")
      return
    }

    setIsLoading(true)
    showMessage("")
    try {
      const response = await fetch("/api/provisionings/import", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: importCsv, dryRun }),
      })
      const body = await response.json().catch(() => ({ error: "Falha ao importar CSV." }))
      if (!response.ok) {
        throw new Error(body.message || body.error || "Falha ao importar CSV.")
      }

      setImportResult(body)
      const summary = body.summary as ProvisioningImportResult["summary"]
      showMessage(dryRun
        ? `${summary.valid} linha${summary.valid === 1 ? "" : "s"} valida${summary.valid === 1 ? "" : "s"} e ${summary.failed} com erro.`
        : `${summary.imported} importado${summary.imported === 1 ? "" : "s"}, ${summary.updated} atualizado${summary.updated === 1 ? "" : "s"} e ${summary.failed} com erro.`
      )
      if (!dryRun) await loadData()
    } catch (error) {
      showMessage((error as Error).message || "Erro ao importar CSV.")
    } finally {
      setIsLoading(false)
    }
  }

  const retryOlt = async (provisioningId: string) => {
    if (!accessControlStatus.canProvision) {
      showCriticalNotice(accessControlStatus.message)
      return
    }
    setIsLoading(true)
    showMessage("")
    try {
      const response = await fetch(`/api/provisionings/${provisioningId}/olt`, { method: "POST" })
      const body = await response.json().catch(() => ({ error: "Erro ao registrar ONU/CPE." }))
      if (!response.ok) {
        throw new Error(body.error || body.message || "Erro ao registrar ONU/CPE.")
      }
      showMessage(body.olt?.message || "Registro OLT processado.")
      await loadData()
    } catch (error) {
      showCriticalNotice((error as Error).message || "Erro ao registrar ONU/CPE.")
    } finally {
      setIsLoading(false)
    }
  }

  const deprovisionOltById = async (provisioningId: string) => {
    if (!accessControlStatus.canProvision) {
      showCriticalNotice(accessControlStatus.message)
      return
    }
    setIsLoading(true)
    showMessage("")
    try {
      const response = await fetch(`/api/provisionings/${provisioningId}/olt`, { method: "DELETE" })
      const body = await response.json().catch(() => ({ error: "Erro ao desprovisionar ONU/CPE." }))
      if (!response.ok) {
        throw new Error(body.olt?.message || body.error || body.message || "Erro ao desprovisionar ONU/CPE.")
      }
      showMessage(body.olt?.message || "Desprovisionamento processado.")
      await loadData()
    } catch (error) {
      showCriticalNotice((error as Error).message || "Erro ao desprovisionar ONU/CPE.")
    } finally {
      setIsLoading(false)
    }
  }

  const deprovisionOlt = async (provisioning: Provisioning) => {
    const confirmed = window.confirm(`Desprovisionar a ONU/CPE ${provisioning.serial} do contrato ${provisioning.contract.contractNumber}?`)
    if (!confirmed) return

    await deprovisionOltById(provisioning.id)
  }

  const openCtoManeuver = (provisioning: Provisioning) => {
    setManeuverProvisioning(provisioning)
    setManeuverCep("")
    setManeuverAddress(provisioning.contract.address || "")
    setManeuverNumber("")
    setManeuverComplement("")
    setManeuverReference("")
    setManeuverLatitude(null)
    setManeuverLongitude(null)
    setManeuverNearbyCtos([])
    setManeuverCtoId("")
    setManeuverPortId("")
  }

  const closeCtoManeuver = () => {
    setManeuverProvisioning(null)
    setManeuverCtoId("")
    setManeuverPortId("")
    setManeuverCep("")
    setManeuverAddress("")
    setManeuverNumber("")
    setManeuverComplement("")
    setManeuverReference("")
    setManeuverLatitude(null)
    setManeuverLongitude(null)
    setManeuverNearbyCtos([])
  }

  const fetchManeuverAddressByCep = async () => {
    const cleanCep = maneuverCep.replace(/\D/g, "")
    if (!isValidCep(cleanCep)) {
      showMessage("CEP invalido. Informe 8 digitos.")
      return
    }

    setIsCepLoading(true)
    showMessage("")
    try {
      const response = await fetch(`/api/cep?cep=${cleanCep}`)
      const body = await response.json().catch(() => ({ error: "CEP nao encontrado." }))
      if (!response.ok) throw new Error(body.error || "CEP nao encontrado.")
      const formattedAddress = `${body.logradouro || ""}${body.bairro ? `, ${body.bairro}` : ""}${body.localidade ? ` - ${body.localidade}` : ""}${body.uf ? `/${body.uf}` : ""}`
      setManeuverCep(cleanCep)
      setManeuverAddress(formattedAddress)
    } catch (error) {
      showMessage((error as Error).message || "Nao foi possivel buscar o CEP.")
    } finally {
      setIsCepLoading(false)
    }
  }

  const loadManeuverNearbyCtos = async (lat: number, lng: number) => {
    const ctoResponse = await fetch(`/api/cto/nearest?lat=${lat}&lng=${lng}`, { cache: "no-store" })
    const ctoBody = await ctoResponse.json().catch(() => [])
    if (!ctoResponse.ok) throw new Error(ctoBody.error || "Falha ao buscar CTOs proximas.")
    const nearby = (Array.isArray(ctoBody) ? ctoBody : []) as NearbyCTO[]
    const candidates = nearby
      .map((cto) => ({ ...cto, ports: cto.ports.filter((port) => port.status === "available") }))
      .filter((cto) => cto.ports.length > 0 && cto.id !== maneuverProvisioning?.port.cto.id)

    setManeuverNearbyCtos(candidates)
    setManeuverCtoId(candidates[0]?.id ?? "")
    setManeuverPortId(candidates[0]?.ports[0]?.id ?? "")
    return candidates
  }

  const findManeuverNearestCtos = async () => {
    const cleanManeuverCep = maneuverCep.replace(/\D/g, "")
    if (!isValidCep(cleanManeuverCep) || !maneuverNumber.trim()) {
      showMessage("Informe o novo CEP e numero antes de localizar a CTO.")
      return
    }

    setIsManeuverGeocoding(true)
    showMessage("")
    try {
      const params = new URLSearchParams({
        address: cleanManeuverCep,
        number: maneuverNumber,
        context: buildGeocodeQuery(maneuverAddress),
      })
      const geocodeResponse = await fetch(`/api/geocode?${params.toString()}`)
      const geocodeBody = await geocodeResponse.json().catch(() => ({ error: "Falha ao buscar coordenadas." }))
      if (!geocodeResponse.ok || typeof geocodeBody.lat !== "number" || typeof geocodeBody.lng !== "number") {
        throw new Error(geocodeBody.error || "Falha ao buscar coordenadas.")
      }

      setManeuverLatitude(geocodeBody.lat)
      setManeuverLongitude(geocodeBody.lng)

      const candidates = await loadManeuverNearbyCtos(geocodeBody.lat, geocodeBody.lng)
      showMessage(candidates.length ? `${candidates.length} CTOs proximas encontradas para o novo endereco.` : "Nenhuma CTO com porta disponivel foi encontrada proxima ao novo endereco.")
    } catch (error) {
      setManeuverNearbyCtos([])
      setManeuverCtoId("")
      setManeuverPortId("")
      showMessage((error as Error).message || "Erro ao localizar CTOs proximas.")
    } finally {
      setIsManeuverGeocoding(false)
    }
  }

  const handleManeuverLocationChange = async (lat: number, lng: number) => {
    const roundedLat = Number(lat.toFixed(7))
    const roundedLng = Number(lng.toFixed(7))
    setManeuverLatitude(roundedLat)
    setManeuverLongitude(roundedLng)
    setIsManeuverGeocoding(true)
    showMessage("")
    try {
      const candidates = await loadManeuverNearbyCtos(roundedLat, roundedLng)
      showMessage(candidates.length ? `${candidates.length} CTOs proximas encontradas para a georreferencia ajustada.` : "Nenhuma CTO com porta disponivel foi encontrada proxima a georreferencia ajustada.")
    } catch (error) {
      setManeuverNearbyCtos([])
      setManeuverCtoId("")
      setManeuverPortId("")
      showMessage((error as Error).message || "Erro ao localizar CTOs proximas.")
    } finally {
      setIsManeuverGeocoding(false)
    }
  }

  const handleCtoManeuver = async () => {
    if (!maneuverProvisioning || !maneuverPortId) {
      showCriticalNotice("Selecione a CTO e a porta de destino.")
      return
    }
    if (!maneuverAddress.trim() || !maneuverNumber.trim() || !maneuverLatitude || !maneuverLongitude) {
      showCriticalNotice("Localize a nova georreferencia antes de confirmar a manobra.")
      return
    }

    const targetCto = maneuverAvailableCtos.find((cto) => cto.id === maneuverCtoId)
    const targetPort = targetCto?.ports.find((port) => port.id === maneuverPortId)
    const isSameCurrentPort = maneuverPortId === maneuverProvisioning.port.id
    if (isSameCurrentPort && maneuverProvisioning.status === "active") {
      const samePortMessage = `A porta selecionada ja e a porta atual do contrato ${maneuverProvisioning.contract.contractNumber}. Selecione outra CTO/porta para realizar a manobra.`
      showCriticalNotice(samePortMessage)
      return
    }

    const confirmed = window.confirm(
      isSameCurrentPort
        ? `Este cadastro ja esta na porta selecionada, mas esta ${statusLabels[maneuverProvisioning.status] || maneuverProvisioning.status}. Deseja tentar reprovisionar o contrato ${maneuverProvisioning.contract.contractNumber} em ${targetCto?.name || "CTO"} porta ${targetPort?.number || "-"}?`
        : `Manobrar contrato ${maneuverProvisioning.contract.contractNumber} para o novo endereco e para ${targetCto?.name || "CTO"} porta ${targetPort?.number || "-"}?`,
    )
    if (!confirmed) return

    setIsLoading(true)
    showMessage("")
    try {
      const response = await fetch(`/api/provisionings/${maneuverProvisioning.id}/maneuver`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetPortId: maneuverPortId,
          address: maneuverAddress,
          number: maneuverNumber,
          cep: maneuverCep,
          complement: maneuverComplement,
          reference: maneuverReference,
          lat: maneuverLatitude,
          lng: maneuverLongitude,
        }),
      })
      const body = await response.json().catch(() => ({ error: "Erro ao manobrar CTO." }))
      if (!response.ok) {
        const errorMessage = body.message || body.error || "Erro ao manobrar CTO."
        if (response.status === 400) {
          showCriticalNotice(`${errorMessage}\n\nRevise a CTO/porta selecionada e tente novamente.`)
          return
        }
        throw new Error(errorMessage)
      }
      showMessage(body.message || "Manobra concluida.")
      closeCtoManeuver()
      await loadData()
    } catch (error) {
      showCriticalNotice((error as Error).message || "Erro ao manobrar CTO.")
    } finally {
      setIsLoading(false)
    }
  }

  const loadProvisioningLogs = async (provisioning: Provisioning) => {
    setIsLoading(true)
    showMessage("")
    setProvisioningLogs([])
    setProvisioningLogTitle(`${provisioning.contract.name} - contrato ${provisioning.contract.contractNumber}`)
    setShowProvisioningLogModal(true)
    try {
      const response = await fetch(`/api/provisionings/${provisioning.id}/logs`, { credentials: "same-origin" })
      const body = await response.json().catch(() => ({ error: "Erro ao carregar logs do provisionamento." }))
      if (!response.ok) {
        throw new Error(body.error || "Erro ao carregar logs do provisionamento.")
      }
      setProvisioningLogs(body)
    } catch (error) {
      showMessage((error as Error).message || "Erro ao carregar logs do provisionamento.")
    } finally {
      setIsLoading(false)
    }
  }

  const applyGenieAcsCache = (provisioning: Provisioning, cache: GenieAcsPanelCache) => {
    setGenieAcsProvisioning((current) => current && current.id === provisioning.id
      ? { ...current, ...cache.provisioning, contract: current.contract, port: current.port, cpeModel: current.cpeModel }
      : { ...provisioning, ...cache.provisioning, contract: provisioning.contract, port: provisioning.port, cpeModel: provisioning.cpeModel })
    setGenieAcsHosts(cache.hosts)
    setGenieAcsWifi(cache.wifi)
    setWifi24Ssid(cache.wifi?.band24?.ssid || "")
    setWifi24Password(cache.wifi?.band24?.password || "")
    setWifi5Ssid(cache.wifi?.band5?.ssid || "")
    setWifi5Password(cache.wifi?.band5?.password || "")
  }

  const openGenieAcsPanel = async (provisioning: Provisioning) => {
    const cachedPanel = genieAcsPanelCacheRef.current.get(provisioning.id)
    setGenieAcsProvisioning(provisioning)
    if (cachedPanel) {
      applyGenieAcsCache(provisioning, cachedPanel)
    } else {
      setGenieAcsHosts([])
      setGenieAcsWifi(null)
      setWifi24Ssid("")
      setWifi24Password("")
      setWifi5Ssid("")
      setWifi5Password("")
    }
    setGenieAcsMessage("")
    setIsGenieAcsLoading(true)
    try {
      const response = await fetch(`/api/provisionings/${provisioning.id}/genieacs`, { credentials: "same-origin" })
      const body = await response.json().catch(() => ({ error: "Erro ao consultar GenieACS." }))
      if (!response.ok) {
        throw new Error(body.error || "Erro ao consultar GenieACS.")
      }
      if (body.provisioning) {
        setGenieAcsProvisioning((current) => current && current.id === provisioning.id
          ? { ...current, ...body.provisioning, contract: current.contract, port: current.port, cpeModel: current.cpeModel }
          : current)
      }
      const nextHosts = body.hosts ?? []
      const nextWifi = body.wifi ?? null
      setGenieAcsHosts(nextHosts)
      setGenieAcsWifi(nextWifi)
      setWifi24Ssid(nextWifi?.band24?.ssid || "")
      setWifi24Password(nextWifi?.band24?.password || "")
      setWifi5Ssid(nextWifi?.band5?.ssid || "")
      setWifi5Password(nextWifi?.band5?.password || "")
      genieAcsPanelCacheRef.current.set(provisioning.id, {
        provisioning: body.provisioning,
        hosts: nextHosts,
        wifi: nextWifi,
        updatedAt: Date.now(),
      })
      setGenieAcsMessage(body.queued ? "Consulta enfileirada. Exibindo os ultimos dados conhecidos." : "")
      await loadData({ silent: true, forceStatic: false })
    } catch (error) {
      setGenieAcsMessage((error as Error).message || "Erro ao consultar GenieACS.")
    } finally {
      setIsGenieAcsLoading(false)
    }
  }

  const associateGenieAcs = async () => {
    if (!genieAcsProvisioning) return
    setIsGenieAcsLoading(true)
    setGenieAcsMessage("Associando CPE ao GenieACS...")
    try {
      const response = await fetch(`/api/provisionings/${genieAcsProvisioning.id}/genieacs`, {
        method: "POST",
        credentials: "same-origin",
      })
      const body = await response.json().catch(() => ({ error: "Erro ao associar GenieACS." }))
      if (!response.ok) {
        throw new Error(body.error || body.message || "Erro ao associar GenieACS.")
      }
      setGenieAcsMessage(body.message || "CPE associada ao GenieACS.")
      await loadData({ silent: true, forceStatic: false })
      if (genieAcsProvisioning) {
        await openGenieAcsPanel(genieAcsProvisioning)
      }
    } catch (error) {
      setGenieAcsMessage((error as Error).message || "Erro ao associar GenieACS.")
    } finally {
      setIsGenieAcsLoading(false)
    }
  }

  const saveGenieAcsWifi = async () => {
    if (!genieAcsProvisioning) return
    const ssidPolicyError = getWifiSsidPolicyError(wifi24Ssid) ?? getWifiSsidPolicyError(wifi5Ssid)
    if (ssidPolicyError) {
      setGenieAcsMessage(ssidPolicyError)
      return
    }
    const passwordPolicyError = getWifiPasswordPolicyError(wifi24Password) ?? getWifiPasswordPolicyError(wifi5Password)
    if (passwordPolicyError) {
      setGenieAcsMessage(passwordPolicyError)
      return
    }
    setIsGenieAcsLoading(true)
    setGenieAcsMessage("Enviando configuracao Wi-Fi...")
    try {
      const response = await fetch(`/api/provisionings/${genieAcsProvisioning.id}/genieacs`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ssid: wifi24Ssid,
          password: wifi24Password,
          ssid5: wifi5Ssid,
          password5: wifi5Password,
        }),
      })
      const body = await response.json().catch(() => ({ error: "Erro ao alterar Wi-Fi." }))
      if (!response.ok) {
        throw new Error(body.error || body.message || "Erro ao alterar Wi-Fi.")
      }
      const nextWifi = body.wifi ?? null
      setGenieAcsWifi(nextWifi)
      setWifi24Ssid(nextWifi?.band24?.ssid || "")
      setWifi24Password(nextWifi?.band24?.password || "")
      setWifi5Ssid(nextWifi?.band5?.ssid || "")
      setWifi5Password(nextWifi?.band5?.password || "")
      const cachedPanel = genieAcsPanelCacheRef.current.get(genieAcsProvisioning.id)
      genieAcsPanelCacheRef.current.set(genieAcsProvisioning.id, {
        provisioning: cachedPanel?.provisioning,
        hosts: cachedPanel?.hosts ?? genieAcsHosts,
        wifi: nextWifi,
        updatedAt: Date.now(),
      })
      setGenieAcsMessage(body.message || "Alteracao Wi-Fi enviada.")
      await loadData({ silent: true, forceStatic: false })
    } catch (error) {
      setGenieAcsMessage((error as Error).message || "Erro ao alterar Wi-Fi.")
    } finally {
      setIsGenieAcsLoading(false)
    }
  }

  const openProvisioningCpe = (provisioning: Provisioning) => {
    setSelectedCpeProvisioningId(provisioning.id)
    showMessage("")
    setActiveTab("onus")
  }

  const requestContractOtp = async () => {
    if (!contractStatus.version) return
    setIsLoading(true)
    setContractOtpDestination(null)
    try {
      const response = await fetch("/api/operator/contracts/otp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ versionId: contractStatus.version.id }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || "Falha ao gerar codigo de aceite.")
      if (body.sent === false) throw new Error(body.error || "Nao foi possivel enviar o codigo por email.")
      setContractOtpId(body.otpId || "")
      setContractOtpDestination(typeof body.destination === "string" ? body.destination : null)
      showMessage(body.message || "Codigo enviado para o email cadastrado.", 7000)
    } catch (error) {
      showMessage((error as Error).message || "Falha ao gerar codigo de aceite.")
    } finally {
      setIsLoading(false)
    }
  }

  const acceptCurrentContract = async () => {
    if (!contractStatus.version || !contractAcceptanceChecked) {
      showMessage("Confirme a leitura do contrato antes de aceitar.")
      return
    }
    if (!contractOtpId || !contractOtpCode.trim()) {
      showMessage("Gere e informe o codigo de aceite.")
      return
    }
    setIsLoading(true)
    try {
      const response = await fetch("/api/operator/contracts/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          versionId: contractStatus.version.id,
          otpId: contractOtpId,
          code: contractOtpCode,
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || "Falha ao registrar aceite.")
      setContractOtpCode("")
      setContractOtpId("")
      setContractOtpDestination(null)
      setContractAcceptanceChecked(false)
      operatorAccountCacheRef.current = null
      await loadData({ silent: true, forceStatic: false })
      showMessage("Aceite registrado. Uso da rede liberado.")
    } catch (error) {
      showMessage((error as Error).message || "Falha ao registrar aceite.")
    } finally {
      setIsLoading(false)
    }
  }

  const renderNavigation = (placement: "sidebar" | "mobile") => (
    <nav className={`operator-nav operator-nav-${placement}`} aria-label="Navegacao do operador">
      {operatorTabs
        .filter((item) => accessControlStatus.visibleTabs.includes(item.id))
        .filter((item) => placement !== "mobile" || item.id !== "alerts")
        .map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => setActiveTab(item.id)}
          className={`operator-nav-item ${activeTab === item.id ? "operator-nav-item-active" : ""}`}
        >
          <OperatorIcon name={item.icon} />
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  )

  const isOperatorLoadingOverlayVisible = (isLoading && !isGenieAcsLoading && !showProvisioningLogModal) || isCepLoading || isManeuverGeocoding
  const operatorLoadingTitle = isCepLoading
    ? "Buscando CEP"
    : isManeuverGeocoding
      ? "Localizando CTO"
      : "Processando operacao"
  const operatorLoadingDescription = isCepLoading
    ? "Consultando o endereco informado."
    : isManeuverGeocoding
      ? "Calculando as CTOs mais proximas."
      : "Aguarde enquanto atualizamos os dados."

  if (status === "loading") {
    return <LoadingScreen title="Carregando operador" description="Abrindo sua area operacional." />
  }

  if (!session) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <div className="rounded-[8px] bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-950">Sessao expirada</h1>
          <p className="mt-2 text-sm text-slate-600">Entre novamente para acessar sua area.</p>
          <Link href="/" className="mt-5 inline-flex rounded-[8px] bg-orange-800 px-4 py-2 text-white">Voltar ao acesso</Link>
        </div>
      </main>
    )
  }

  if (contractStatus.pending && contractStatus.version) {
    return (
      <main className={`operator-shell operator-theme-${theme} operator-palette-${colorTheme}`}>
        <LoadingOverlay visible={isLoading} title="Registrando aceite" description="Aguarde enquanto validamos a evidencia." />
        <div className="min-h-screen px-4 py-6 sm:px-6">
          <div className="mx-auto grid max-w-6xl gap-5 lg:grid-cols-[1fr_360px]">
            <section className="operator-contract-panel rounded-[8px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase text-orange-800">Aceite contratual pendente</p>
                  <h1 className="mt-1 text-2xl font-semibold text-slate-950">{contractStatus.version.title}</h1>
                  <p className="mt-1 text-sm text-slate-500">Versao {contractStatus.version.versionNumber} · hash {contractStatus.version.contentHash.slice(0, 18)}...</p>
                </div>
                <button type="button" onClick={() => void hardSignOut()} className="rounded-[8px] border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700">Sair</button>
              </div>
              <div
                className="operator-contract-reader"
                dangerouslySetInnerHTML={{ __html: contractStatus.version.bodyHtml }}
              />
            </section>

              <aside className="self-start rounded-[8px] border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-lg font-semibold text-slate-950">Assinatura eletronica</h2>
                <p className="mt-2 text-sm text-slate-600">
                Para usar a rede, confirme a leitura e valide o codigo enviado ao e-mail cadastrado do operador. O aceite registrara data, usuario, IP, dispositivo e hashes de integridade.
              </p>
              {message ? <div className="mt-4 rounded-[8px] border border-orange-200 bg-orange-50 px-3 py-3 text-sm text-orange-900">{message}</div> : null}
              <label className="mt-5 flex gap-3 rounded-[8px] border border-slate-200 p-3 text-sm text-slate-700">
                <input type="checkbox" checked={contractAcceptanceChecked} onChange={(event) => setContractAcceptanceChecked(event.target.checked)} />
                <span>Li integralmente e aceito os termos desta versao do contrato.</span>
              </label>
              <button type="button" onClick={requestContractOtp} disabled={isLoading || !contractAcceptanceChecked} className="mt-4 w-full rounded-[8px] border border-orange-300 px-4 py-3 text-sm font-semibold text-orange-900 disabled:opacity-50">
                Enviar codigo por email
              </button>
              {contractOtpDestination ? (
                <div className="mt-3 rounded-[8px] bg-slate-100 p-3 text-sm text-slate-700">
                  Codigo enviado para <span className="font-semibold">{contractOtpDestination}</span>.
                </div>
              ) : null}
              <label className="mt-4 grid gap-1.5">
                <span className="text-xs font-medium uppercase text-slate-500">Codigo OTP</span>
                <input value={contractOtpCode} onChange={(event) => setContractOtpCode(event.target.value)} inputMode="numeric" className="rounded-[8px] border border-slate-200 px-3 py-3 text-sm outline-none focus:border-orange-700" />
              </label>
              <button type="button" onClick={acceptCurrentContract} disabled={isLoading || !contractAcceptanceChecked || !contractOtpId} className="mt-4 w-full rounded-[8px] bg-orange-800 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60">
                Assinar e aceitar contrato
              </button>
            </aside>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className={`operator-shell operator-theme-${theme} operator-palette-${colorTheme}`}>
      <LoadingOverlay visible={isOperatorLoadingOverlayVisible} title={operatorLoadingTitle} description={operatorLoadingDescription} />
      <div className="operator-layout">
        <aside className="operator-sidebar">
          <div className="operator-sidebar-brand">
            {!activeCompanyLogo ? (
              <span className="operator-brand-icon">
                <OperatorIcon name="olt" />
              </span>
            ) : null}
            <div>
              {activeCompanyLogo ? (
                <Image
                  src={activeCompanyLogo}
                  alt={applicationSettings.companyName}
                  width={240}
                  height={58}
                  unoptimized
                  className="operator-company-logo"
                />
              ) : (
                <p className="operator-company">{applicationSettings.companyName}</p>
              )}
              {!activeCompanyLogo ? <p className="operator-eyebrow">Operador</p> : null}
            </div>
          </div>
          {renderNavigation("sidebar")}
        </aside>

        <div className="operator-content">
          <header className="operator-header">
            <div className="operator-heading">
              <div className="operator-brand operator-brand-mobile">
                <div>
                  {activeCompanyLogo ? (
                    <Image
                      src={activeCompanyLogo}
                      alt={applicationSettings.companyName}
                      width={180}
                      height={46}
                      unoptimized
                      className="operator-company-logo"
                    />
                  ) : (
                    <p className="operator-company">{applicationSettings.companyName}</p>
                  )}
                </div>
              </div>
              <h1>{operatorHeaderTitle}</h1>
            </div>
            <div className="operator-header-actions">
              <div className="operator-header-action-stack">
                <div className="operator-header-icon-row">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab("alerts")
                      setIsProfileOpen(false)
                    }}
                    className={`operator-icon-button operator-icon-button-alert ${activeTab === "alerts" ? "operator-icon-button-active" : ""}`}
                    aria-label="Abrir alertas"
                    title="Alertas"
                    aria-pressed={activeTab === "alerts"}
                  >
                    <OperatorIcon name="alert" />
                    {alerts.length > 0 ? <span className="operator-icon-badge">{alerts.length}</span> : null}
                  </button>
                  <button
                    type="button"
                    onClick={() => setTheme((value) => {
                      const nextTheme = value === "dark" ? "light" : "dark"
                      window.localStorage.setItem("operator-theme", nextTheme)
                      return nextTheme
                    })}
                    className="operator-icon-button"
                    aria-label={theme === "dark" ? "Ativar tema claro" : "Ativar tema escuro"}
                    title={theme === "dark" ? "Tema claro" : "Tema escuro"}
                  >
                    <OperatorIcon name={theme === "dark" ? "sun" : "moon"} />
                  </button>
                  <div className="operator-profile">
                    <button
                      type="button"
                      onClick={() => setIsProfileOpen((value) => !value)}
                      className="operator-icon-button"
                      aria-label="Abrir informacoes do perfil"
                      title="Perfil do operador"
                      aria-expanded={isProfileOpen}
                    >
                      <OperatorIcon name="user" />
                    </button>
                    {isProfileOpen ? (
                      <div className="operator-profile-card">
                        <div className="operator-profile-avatar">
                          {profileImage ? <Image src={profileImage} alt="Foto do perfil" width={78} height={78} unoptimized /> : <OperatorIcon name="user" />}
                        </div>
                        <div className="operator-profile-identity">
                          <div className="operator-profile-title-row">
                            <p className="operator-profile-name">{operatorProfile?.name || "Operador"}</p>
                            <span className="operator-profile-role">{operatorProfile?.role === "admin" ? "Admin" : "Operador"}</span>
                          </div>
                          <p className="operator-profile-email">{operatorProfile?.email || "Email nao informado"}</p>
                        </div>
                        <div className="operator-profile-actions" aria-label="Acoes do perfil">
                          <Link href="/perfil" className="operator-profile-action" aria-label="Editar perfil" title="Editar perfil">
                            <OperatorIcon name="edit" />
                            <span>Editar Perfil</span>
                          </Link>
                          <button type="button" onClick={() => void hardSignOut()} className="operator-profile-action" aria-label="Sair" title="Sair">
                            <OperatorIcon name="logout" />
                            <span>Sair</span>
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
                <p className="operator-eyebrow operator-action-role">Operador</p>
              </div>
              {isAdmin ? <Link href="/admin" className="operator-ghost-button">Area admin</Link> : null}
            </div>
          </header>

          <div className="operator-content-inner">
            {message ? (
              <div className="operator-message">
                <span>{message}</span>
                <button type="button" onClick={clearMessage} aria-label="Fechar mensagem">Fechar</button>
              </div>
            ) : null}
            {isAccessLimited ? (
              <div className="operator-message">
                {accessControlStatus.message}
                {accessControlStatus.overdueDays > 0 ? ` Dias de atraso: ${accessControlStatus.overdueDays}.` : ""}
                {accessControlStatus.pendingAction ? " A aplicacao esta pendente para revisao interna." : ""}
              </div>
            ) : null}

            {activeTab === "dashboard" ? (
              <section className="operator-dashboard">
                <div className="operator-metrics">
                  <Metric icon="olt" title="CPEs ativas" value={activeProvisionings.length} detail="em operacao" />
                  <Metric icon="signal" title="ONUs online" value={onuSummary.online} detail={`${onuSummary.total} vinculadas`} tone={onuSummary.criticalSignal ? "warn" : "default"} />
                  <Metric icon="pending" title="Pendentes" value={provisionings.filter((item) => item.status === "olt_pending").length} detail="aguardando OLT" />
                  <Metric icon="document" title="Faturas abertas" value={openBillingInvoices.length} detail={formatMoney(openBillingInvoiceAmountCents)} tone={openBillingInvoices.some((invoice) => invoice.status === "overdue") ? "warn" : "default"} />
                </div>

                <div className="operator-dashboard-grid">
                  <Panel
                    title="Mapa de provisionamento"
                    className="operator-map-panel"
                    actions={(
                      <button
                        type="button"
                        onClick={openViabilityModal}
                        className="operator-secondary-button inline-flex items-center gap-2 px-4 py-2 text-sm"
                      >
                        <OperatorIcon name="distance" className="h-4 w-4" />
                        Consultar viabilidade
                      </button>
                    )}
                  >
                    <div className="operator-map-shell">
                      <ProvisionMap
                        location={{ lat: latitude, lng: longitude }}
                        cto={selectedNearbyCto ?? nearestCto ?? selectedCto ?? undefined}
                        nearbyCtos={nearbyCtos}
                        radiusMeters={radiusMeters}
                        provisionings={activeProvisionings}
                        onViewCpe={(item) => {
                          const provisioning = provisionings.find((provisioningItem) => provisioningItem.id === item.id)
                          if (provisioning) openProvisioningCpe(provisioning)
                        }}
                        onOpenLogs={(item) => {
                          const provisioning = provisionings.find((provisioningItem) => provisioningItem.id === item.id)
                          if (provisioning) void loadProvisioningLogs(provisioning)
                        }}
                      />
                    </div>
                  </Panel>
                  <div className="operator-side-panels">
                    <Panel title="Ultimos alertas">
                      <AlertList alerts={alerts.slice(0, 5)} onOpenCpe={openProvisioningCpe} />
                    </Panel>
                    <Panel title="Status do servico">
                      <div className="grid gap-3 text-sm">
                        <ServiceRow label="Provisionamento local" status="online" />
                        <ServiceRow label="Registro OLT" status={alerts.some((alert) => alert.tone === "danger") ? "atencao" : "online"} />
                        <ServiceRow label="Mapa e CTOs" status={selectedCto ? "online" : "atencao"} />
                      </div>
                    </Panel>
                  </div>
                </div>
              </section>
            ) : null}

            {activeTab === "provisionings" ? (
              <section className="grid gap-5">
                <div className="operator-section-header operator-provisioning-toolbar">
                  <h2>Provisionamentos</h2>
                  <label className="operator-provisioning-toolbar-search">
                    <span className="sr-only">Pesquisar provisionamentos</span>
                    <input
                      type="search"
                      value={provisioningSearchQuery}
                      onChange={(event) => setProvisioningSearchQuery(event.target.value)}
                      placeholder="Nome ou contrato"
                      className="operator-input"
                    />
                  </label>
                  <div className="operator-section-actions operator-provisioning-toolbar-actions">
                    <button
                      onClick={() => setHideInactiveProvisionings((value) => !value)}
                      className={`operator-ghost-button operator-provisioning-toolbar-button${hideInactiveProvisionings ? " operator-filter-button-active" : ""}`}
                      aria-pressed={hideInactiveProvisionings}
                      aria-label={hideInactiveProvisionings ? `Mostrar inativos (${inactiveProvisioningsCount})` : `Ocultar inativos (${inactiveProvisioningsCount})`}
                    >
                      <span className="operator-provisioning-visibility-icon">
                        <OperatorIcon name={hideInactiveProvisionings ? "eyeOff" : "eye"} />
                      </span>
                      <span className="operator-provisioning-desktop-label">
                        Inativo{inactiveProvisioningsCount > 0 ? ` (${inactiveProvisioningsCount})` : ""}
                      </span>
                      <span className="operator-provisioning-mobile-label">Inativo{inactiveProvisioningsCount > 0 ? ` (${inactiveProvisioningsCount})` : ""}</span>
                    </button>
                    <button onClick={() => setIsImportPanelOpen((value) => !value)} disabled={!accessControlStatus.canProvision} className="operator-ghost-button operator-provisioning-toolbar-button" aria-label={isImportPanelOpen ? "Fechar importacao" : "Importar CSV"}>
                      <OperatorIcon name="upload" />
                      <span className="operator-provisioning-desktop-label">Importar</span>
                      <span className="operator-provisioning-mobile-label">Importar</span>
                    </button>
                    <button onClick={() => setIsProvisionFormOpen((value) => !value)} disabled={!accessControlStatus.canProvision} className="operator-primary-button operator-provisioning-toolbar-button operator-provisioning-new-button">
                      <OperatorIcon name="plus" />
                      <span className="operator-provisioning-desktop-label">Novo</span>
                      <span className="operator-provisioning-mobile-label">Novo</span>
                    </button>
                  </div>
                </div>

                {isProvisionFormOpen && accessControlStatus.canProvision ? (
                  <ProvisionForm
                    clientName={clientName}
                    setClientName={setClientName}
                    contractNumber={contractNumber}
                    setContractNumber={setContractNumber}
                    pppoeLogin={pppoeLogin}
                    setPppoeLogin={setPppoeLogin}
                    pppoePassword={pppoePassword}
                    setPppoePassword={setPppoePassword}
                    cep={cep}
                    setCep={setCep}
                    cepError={cepError}
                    isCepLoading={isCepLoading}
                    fetchAddressByCep={fetchAddressByCep}
                    address={address}
                    setAddress={setAddress}
                    addressNumber={addressNumber}
                    setAddressNumber={setAddressNumber}
                    complement={complement}
                    setComplement={setComplement}
                    reference={reference}
                    setReference={setReference}
                    latitude={latitude}
                    setLatitude={setLatitude}
                    longitude={longitude}
                    setLongitude={setLongitude}
                    geocodeAddress={geocodeAddress}
                    buildCanonicalGeocodeAddress={buildCanonicalGeocodeAddress}
                    fetchNearestCto={fetchNearestCto}
                    isGeocoding={isGeocoding}
                    selectedCto={selectedCto}
                    selectedNearbyCto={selectedNearbyCto}
                    nearbyCtos={nearbyCtos}
                    radiusMeters={radiusMeters}
                    selectNearbyCto={selectNearbyCto}
                    availablePorts={availablePorts}
                    selectedPort={selectedPort}
                    setSelectedPort={setSelectedPort}
                    models={models}
                    selectedModelId={selectedModelId}
                    setSelectedModelId={setSelectedModelId}
                    serial={serial}
                    setSerial={setSerial}
                    erpConfig={erpConfig}
                    erpLookupKey={erpLookupKey}
                    setErpLookupKey={setErpLookupKey}
                    erpLookupQuery={erpLookupQuery}
                    setErpLookupQuery={setErpLookupQuery}
                    erpLookupResult={erpLookupResult}
                    selectedErpCustomerIndex={selectedErpCustomerIndex}
                    selectedErpServiceIndex={selectedErpServiceIndex}
	                  pendingErpLink={pendingErpLink}
	                  handleErpLookup={handleErpLookup}
                    selectErpService={selectErpService}
                    handleProvision={handleProvision}
                    isLoading={isLoading}
                  />
                ) : null}

                {isImportPanelOpen && accessControlStatus.canProvision ? (
                  <ProvisioningImportPanel
                    csv={importCsv}
                    setCsv={setImportCsv}
                    fileName={importFileName}
                    onFile={handleImportFile}
                    onDownloadTemplate={downloadImportTemplate}
                    onImport={handleProvisioningImport}
                    result={importResult}
                    isLoading={isLoading}
                  />
                ) : null}

                <ProvisioningList provisionings={searchedProvisionings} onRetry={retryOlt} onViewCpe={openProvisioningCpe} onDeprovision={deprovisionOlt} onManeuver={openCtoManeuver} onLogs={loadProvisioningLogs} isLoading={isLoading} canMutate={accessControlStatus.canProvision} />
              </section>
            ) : null}

            {activeTab === "onus" ? (
              <Panel title="CPEs vinculadas">
                <OnuCurrentList
                  items={onuCurrent}
                  selectedProvisioningId={selectedCpeProvisioningId}
                  onConfigureCpe={(item) => {
                    const provisioning = provisionings.find((provisioningItem) => provisioningItem.id === item.provisioningId)
                    if (provisioning) void openGenieAcsPanel(provisioning)
                  }}
                  isLoading={isLoading || isGenieAcsLoading}
                />
              </Panel>
            ) : null}

            {activeTab === "billing" ? (
              <section className="grid gap-5">
                <div className="operator-section-header">
                  <div>
                    <h2 className="text-lg font-semibold">Faturamento</h2>
                  </div>
                </div>
                <div className="operator-metrics">
                  <Metric icon="document" title="Faturas" value={billingInvoices.length} detail={formatMoney(billingInvoices.reduce((total, invoice) => total + Number(invoice.amountCents || 0), 0))} active={billingInvoiceFilter === "all"} onClick={() => setBillingInvoiceFilter("all")} />
                  <Metric icon="alert" title="Atrasadas" value={overdueBillingInvoices.length} detail={formatMoney(overdueBillingInvoiceAmountCents)} tone={overdueBillingInvoices.length ? "warn" : "default"} active={billingInvoiceFilter === "overdue"} onClick={() => setBillingInvoiceFilter("overdue")} />
                  <Metric icon="calendar" title="Em dia" value={currentBillingInvoices.length} detail={formatMoney(currentBillingInvoiceAmountCents)} active={billingInvoiceFilter === "open"} onClick={() => setBillingInvoiceFilter("open")} />
                  <Metric icon="document" title="Pagas" value={paidBillingInvoices.length} detail={formatMoney(paidBillingInvoiceAmountCents)} active={billingInvoiceFilter === "paid"} onClick={() => setBillingInvoiceFilter("paid")} />
                </div>
                <Panel title={billingFilterTitles[billingInvoiceFilter]}>
                  <BillingInvoiceList invoices={visibleBillingInvoices} filter={billingInvoiceFilter} />
                </Panel>
              </section>
            ) : null}

            {activeTab === "alerts" ? (
              <Panel title="Monitor de alertas">
                <AlertList alerts={alerts} onOpenCpe={openProvisioningCpe} />
              </Panel>
            ) : null}
          </div>
        </div>
      </div>

      {renderNavigation("mobile")}

      {isViabilityModalOpen ? (
        <div className="operator-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="viability-title" onClick={() => setIsViabilityModalOpen(false)}>
          <form
            className="operator-modal operator-viability-modal"
            onClick={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault()
              void checkLocalViability()
            }}
          >
            <div className="operator-log-modal-header grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
              <div className="operator-log-modal-title">
                <span className="operator-log-modal-icon">
                  <OperatorIcon name="distance" />
                </span>
                <div>
                  <h2 id="viability-title">Consultar viabilidade</h2>
                  <p>Busca local por CTO com porta livre dentro do raio configurado de {radiusMeters}m.</p>
                </div>
              </div>
              <button type="button" onClick={() => setIsViabilityModalOpen(false)} className="operator-ghost-button operator-log-close-button">Fechar</button>
            </div>

            {viabilityOutcome !== "no-result" ? (
              <div className="operator-viability-fields">
                <Input value={viabilityLatitude} onChange={(value) => { setViabilityLatitude(value); resetViabilitySearch() }} placeholder="Latitude" type="number" onPaste={pasteViabilityCoordinates} />
                <Input value={viabilityLongitude} onChange={(value) => { setViabilityLongitude(value); resetViabilitySearch() }} placeholder="Longitude" type="number" onPaste={pasteViabilityCoordinates} />
              </div>
            ) : null}

            {viabilityMessage ? (
              <div className="operator-inline-note mt-4 px-4 py-3 text-sm">
                {viabilityMessage}
              </div>
            ) : null}

            {viabilityResult ? (
              <div className="operator-viability-result">
                <div className="operator-inline-note px-4 py-3 text-sm">
                  Viabilidade encontrada: <span className="font-semibold">{viabilityResult.ctos[0]?.name}</span> a <span className="font-semibold">{Math.round(viabilityResult.ctos[0]?.distanceMeters ?? 0)}m</span>, com <span className="font-semibold">{viabilityResult.ctos[0]?.ports.length ?? 0} porta{viabilityResult.ctos[0]?.ports.length === 1 ? "" : "s"} livre{viabilityResult.ctos[0]?.ports.length === 1 ? "" : "s"}</span>.
                </div>
                <button
                  type="button"
                  onClick={() => continueProvisioningFromViability(viabilityResult.lat, viabilityResult.lng, viabilityResult.ctos)}
                  className="operator-primary-button w-full px-5 py-3 text-sm"
                >
                  Confirmar e abrir provisionamento
                </button>
              </div>
            ) : viabilityOutcome === "no-result" ? (
              <button type="button" onClick={() => setIsViabilityModalOpen(false)} className="operator-primary-button mt-5 w-full px-5 py-3 text-sm">
                Entendi
              </button>
            ) : (
              <button type="submit" disabled={isViabilityLoading} className="operator-primary-button mt-5 w-full px-5 py-3 text-sm disabled:opacity-60">
                {isViabilityLoading ? "Pesquisando..." : "Pesquisar"}
              </button>
            )}
          </form>
        </div>
      ) : null}

      {isErpImportPromptOpen && pendingErpLink ? (
        <div className="operator-modal-backdrop" role="alertdialog" aria-modal="true" aria-labelledby="operator-erp-import-title" aria-describedby="operator-erp-import-message">
          <div className="operator-modal operator-critical-modal">
            <div className="operator-critical-header">
              <span className="operator-critical-icon">
                <OperatorIcon name="alert" />
              </span>
              <div>
                <h2 id="operator-erp-import-title">Revise os dados importados</h2>
                <p id="operator-erp-import-message">Dados do ERP foram aplicados ao provisionamento. Revise cliente, contrato, endereco, CTO, porta, modelo e serial antes de continuar.</p>
              </div>
            </div>
            <button type="button" onClick={reviewErpImport} className="operator-primary-button operator-critical-action">
              Revisar agora
            </button>
          </div>
        </div>
      ) : null}

      {criticalNotice ? (
        <div className="operator-modal-backdrop" role="alertdialog" aria-modal="true" aria-labelledby="operator-critical-title" aria-describedby="operator-critical-message" onClick={() => setCriticalNotice("")}>
          <div className="operator-modal operator-critical-modal" onClick={(event) => event.stopPropagation()}>
            <div className="operator-critical-header">
              <span className="operator-critical-icon">
                <OperatorIcon name="alert" />
              </span>
              <div>
                <h2 id="operator-critical-title">Atenção necessária</h2>
                <p id="operator-critical-message">{criticalNotice}</p>
              </div>
            </div>
            <button type="button" onClick={() => setCriticalNotice("")} className="operator-primary-button operator-critical-action">
              Entendi
            </button>
          </div>
        </div>
      ) : null}

      {maneuverProvisioning ? (
        <div className="operator-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="cto-maneuver-title" onClick={closeCtoManeuver}>
          <div className="operator-modal operator-maneuver-modal" onClick={(event) => event.stopPropagation()}>
            <div className="operator-log-modal-header grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
              <div className="operator-log-modal-title">
                <span className="operator-log-modal-icon">
                  <OperatorIcon name="transfer" />
                </span>
                <div>
                  <h2 id="cto-maneuver-title">Manobrar CTO</h2>
                  <p>{maneuverProvisioning.contract.name} - contrato {maneuverProvisioning.contract.contractNumber}</p>
                </div>
              </div>
              <button onClick={closeCtoManeuver} className="operator-ghost-button operator-log-close-button">Fechar</button>
            </div>

            <div className="operator-maneuver-body grid gap-4">
              <div className="operator-inline-note px-4 py-3 text-sm">
                Atual: <span className="font-semibold">{maneuverProvisioning.port.cto.name}</span> porta <span className="font-semibold">{maneuverProvisioning.port.number}</span>
              </div>
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                <Input value={maneuverCep} onChange={setManeuverCep} placeholder="Novo CEP" />
                <button type="button" onClick={fetchManeuverAddressByCep} disabled={isLoading || isCepLoading || !maneuverCep.trim()} className="operator-secondary-button px-4 py-3 text-sm disabled:opacity-60">
                  Buscar CEP
                </button>
              </div>
              <Input value={maneuverAddress} onChange={setManeuverAddress} placeholder="Novo endereco completo" />
              <div className="grid gap-3 md:grid-cols-2">
                <Input value={maneuverNumber} onChange={setManeuverNumber} placeholder="Numero" />
                <Input value={maneuverComplement} onChange={setManeuverComplement} placeholder="Complemento" />
              </div>
              <Input value={maneuverReference} onChange={setManeuverReference} placeholder="Referencia" />
              <button type="button" onClick={findManeuverNearestCtos} disabled={isLoading || isManeuverGeocoding || !maneuverCep.trim() || !maneuverNumber.trim()} className="operator-secondary-button px-4 py-3 text-sm disabled:opacity-60">
                {isManeuverGeocoding ? "Localizando..." : "Localizar CTO proxima"}
              </button>
              {maneuverLatitude && maneuverLongitude ? (
                <div className="operator-inline-note px-4 py-3 text-sm">
                  Georreferencia: <span className="font-semibold">{maneuverLatitude.toFixed(7)}, {maneuverLongitude.toFixed(7)}</span>
                </div>
              ) : null}
              {maneuverLatitude && maneuverLongitude ? (
                <div className="operator-map-shell operator-maneuver-map h-[280px]">
                  <ProvisionMap
                    location={{ lat: maneuverLatitude, lng: maneuverLongitude }}
                    cto={selectedManeuverCto ?? undefined}
                    nearbyCtos={maneuverNearbyCtos}
                    radiusMeters={radiusMeters}
                    onLocationChange={handleManeuverLocationChange}
                  />
                </div>
              ) : null}
              {maneuverAvailableCtos.length ? (
                <select
                  value={maneuverCtoId}
                  onChange={(event) => {
                    const nextCto = maneuverAvailableCtos.find((cto) => cto.id === event.target.value) ?? null
                    setManeuverCtoId(event.target.value)
                    setManeuverPortId(nextCto?.ports[0]?.id ?? "")
                  }}
                  className="operator-select px-3 py-3 text-sm"
                  disabled={isLoading}
                >
                  {maneuverAvailableCtos.map((cto) => (
                    <option key={cto.id} value={cto.id}>
                      {cto.name} - {Math.round(cto.distanceMeters)}m - {cto.ports.length} porta{cto.ports.length === 1 ? "" : "s"} livre{cto.ports.length === 1 ? "" : "s"}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="operator-empty-state p-4 text-sm">Informe o novo endereco e localize as CTOs proximas.</p>
              )}
              {maneuverAvailableCtos.length ? (
                <select value={maneuverPortId} onChange={(event) => setManeuverPortId(event.target.value)} className="operator-select px-3 py-3 text-sm" disabled={isLoading}>
                  <option value="">Porta de destino</option>
                  {selectedManeuverCto?.ports.map((port) => (
                    <option key={port.id} value={port.id}>Porta {port.number}</option>
                  ))}
                </select>
              ) : null}
              <div className="operator-message">
                A manobra atualiza o endereco do contrato, remove a ONU/CPE da OLT atual, libera a porta antiga, move o cadastro para a nova porta e reprovisiona a ONU.
              </div>
              <button type="button" onClick={handleCtoManeuver} disabled={isLoading || !maneuverPortId || !maneuverLatitude || !maneuverLongitude} className="operator-primary-button px-5 py-3 text-sm disabled:opacity-60">
                {isLoading ? "Manobrando..." : "Confirmar manobra"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {genieAcsProvisioning ? (
        <div className="operator-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="genieacs-title" onClick={() => setGenieAcsProvisioning(null)}>
          <div className="operator-modal operator-cpe-config-modal" aria-busy={isGenieAcsLoading} onClick={(event) => event.stopPropagation()}>
            <div className="operator-cpe-config-header">
              <div>
                <p className="operator-cpe-config-kicker">Configura CPE</p>
                <h2 id="genieacs-title">{genieAcsProvisioning.contract.name}</h2>
                <span>Contrato {genieAcsProvisioning.contract.contractNumber}</span>
              </div>
              <div className="operator-cpe-header-actions">
                <button type="button" onClick={() => void openGenieAcsPanel(genieAcsProvisioning)} disabled={isGenieAcsLoading} className="operator-cpe-header-button disabled:opacity-60">
                  <OperatorIcon name="reboot" />
                  Atualizar
                </button>
                <button onClick={() => setGenieAcsProvisioning(null)} className="operator-cpe-close-button" aria-label="Fechar configuração da CPE">Fechar</button>
              </div>
            </div>

            <div className="operator-cpe-config-shell">
              {genieAcsMessage ? (
                <div className="operator-cpe-message" role="alert">
                  <div className="operator-cpe-message-icon" aria-hidden="true">
                    <OperatorIcon name="alert" />
                  </div>
                  <div className="operator-cpe-message-copy">
                    <strong>Atenção!</strong>
                    <p>{genieAcsMessage}</p>
                  </div>
                  <button type="button" onClick={() => setGenieAcsMessage("")} className="operator-cpe-message-action">
                    Ok
                  </button>
                </div>
              ) : null}

              <section className="operator-cpe-wifi-grid" aria-label="Informacoes atuais do Wi-Fi">
                <article className="operator-cpe-wifi-card operator-cpe-wifi-card-24">
                  <div className="operator-cpe-wifi-title">
                    <OperatorIcon name="wifi" />
                    <strong>Wi-Fi 2.4G</strong>
                  </div>
                  <span>SSID</span>
                  <p>{genieAcsWifi?.band24.ssid || "sem leitura"}</p>
                  <span>Senha</span>
                  <p>{genieAcsWifi?.band24.password || "sem leitura"}</p>
                </article>
                <article className="operator-cpe-wifi-card operator-cpe-wifi-card-5">
                  <div className="operator-cpe-wifi-title">
                    <OperatorIcon name="wifi" />
                    <strong>Wi-Fi 5G</strong>
                  </div>
                  <span>SSID</span>
                  <p>{genieAcsWifi?.band5.ssid || "sem leitura"}</p>
                  <span>Senha</span>
                  <p>{genieAcsWifi?.band5.password || "sem leitura"}</p>
                </article>
              </section>

              <section className={`operator-cpe-edit-card ${isGenieAcsEditorOpen ? "operator-cpe-edit-card-open" : ""}`}>
                <button type="button" className="operator-cpe-edit-toggle" onClick={() => setIsGenieAcsEditorOpen((value) => !value)} aria-expanded={isGenieAcsEditorOpen}>
                  <span>EDITAR CONFIGURAÇÕES</span>
                  <OperatorIcon name="chevron" />
                </button>

                {isGenieAcsEditorOpen ? (
                  <div className="operator-cpe-edit-body">
                    <div className="operator-cpe-field">
                      <label htmlFor="wifi24-ssid">Banda 2.4G</label>
                      <Input id="wifi24-ssid" value={wifi24Ssid} onChange={setWifi24Ssid} placeholder="Nome Wi-Fi 2.4G" disabled={isGenieAcsLoading} />
                      <Input value={wifi24Password} onChange={setWifi24Password} placeholder="Senha Wi-Fi 2.4G" type="password" disabled={isGenieAcsLoading} />
                    </div>
                    <div className="operator-cpe-field">
                      <label htmlFor="wifi5-ssid">Banda 5G</label>
                      <Input id="wifi5-ssid" value={wifi5Ssid} onChange={setWifi5Ssid} placeholder="Nome Wi-Fi 5G" disabled={isGenieAcsLoading} />
                      <Input value={wifi5Password} onChange={setWifi5Password} placeholder="Senha Wi-Fi 5G" type="password" disabled={isGenieAcsLoading} />
                    </div>
                    <div className="operator-cpe-actions">
                      <button type="button" onClick={saveGenieAcsWifi} disabled={isGenieAcsLoading || (!wifi24Ssid.trim() && !wifi24Password && !wifi5Ssid.trim() && !wifi5Password)} className="operator-cpe-save-button disabled:opacity-60">
                        Salvar Wi-Fi
                      </button>
                      <button type="button" onClick={associateGenieAcs} disabled={isGenieAcsLoading} className="operator-cpe-action-button disabled:opacity-60">
                        <OperatorIcon name="transfer" />
                        Associar
                      </button>
                    </div>
                  </div>
                ) : null}
              </section>

              <section className="operator-cpe-connected-section">
                <div className="operator-cpe-connected-header">
                  <h3>Dispositivos conectados</h3>
                  <span>{genieAcsActiveHostCount} ATIVO{genieAcsActiveHostCount === 1 ? "" : "S"}</span>
                </div>
                {genieAcsHosts.length === 0 ? (
                  <p className="operator-cpe-empty-state">Nenhum dispositivo conectado retornado pelo GenieACS.</p>
                ) : (
                  <div className="operator-cpe-device-list">
                    {genieAcsHosts.map((host) => {
                      const isWifiConnection = Boolean(host.wifiBand)
                        || /802\.11|wlan|wi-?fi/i.test(host.interfaceType || "")
                        || Boolean(host.rssi || host.clientMode)
                      const connectionLabel = isWifiConnection
                        ? `Wi-Fi ${host.wifiBand || ""}`.trim()
                        : "Cabo"
                      const connectionSignal = isWifiConnection ? formatGenieAcsSignal(host.rssi) : null
                      const metrics = [
                        { label: "Modo", value: host.clientMode },
                        { label: "Largura", value: host.bandwidth },
                        { label: "Rate", value: formatGenieAcsRate(host.rate) },
                        { label: "Ruido", value: formatGenieAcsSignal(host.noise) },
                        { label: "Uptime", value: formatGenieAcsDuration(host.uptime) },
                        { label: "RX", value: formatGenieAcsBytes(host.rxBytes) },
                        { label: "TX", value: formatGenieAcsBytes(host.txBytes) },
                      ].filter((item) => item.value)

                      return (
                        <details key={`${host.index}-${host.macAddress || host.ipAddress || host.hostName}`} className="operator-cpe-device-card">
                          <summary className="operator-cpe-device-summary">
                            <span className="operator-cpe-device-icon">
                              <OperatorIcon name="phone" />
                            </span>
                            <div className="operator-cpe-device-main">
                              <strong>{host.hostName || host.macAddress || `Host ${host.index}`}</strong>
                              <span className="operator-cpe-device-ip-row">{host.ipAddress || "sem IP"} <b aria-hidden="true">•</b></span>
                              <span className="operator-cpe-device-mac-row">{host.macAddress || "sem MAC"}</span>
                            </div>
                            <div className="operator-cpe-device-side">
                              <span className={`operator-cpe-device-pill ${host.active === false ? "operator-cpe-device-pill-inactive" : ""}`}>
                                {host.active === false ? "INATIVO" : "ATIVO"}
                              </span>
                              <div className="operator-cpe-device-tech">
                                <strong>{connectionLabel}</strong>
                                <span>{connectionSignal || (isWifiConnection ? "sem sinal" : "ethernet")}</span>
                              </div>
                            </div>
                            <OperatorIcon name="chevron" className="operator-cpe-device-chevron" />
                          </summary>
                          {metrics.length > 0 || host.authenticationState ? (
                            <div className="operator-cpe-device-detail-panel">
                              <div className="operator-cpe-device-metrics">
                                {metrics.map((metric) => (
                                  <span key={metric.label}>
                                    <b>{metric.label}</b>
                                    {metric.value}
                                  </span>
                                ))}
                                {host.authenticationState ? (
                                  <span>
                                    <b>Status</b>
                                    {host.authenticationState}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          ) : null}
                        </details>
                      )
                    })}
                  </div>
                )}
              </section>
            </div>
            <LoadingOverlay visible={isGenieAcsLoading} title="Consultando CPE" description="Atualizando dados e dispositivos conectados." />
          </div>
        </div>
      ) : null}

      {showProvisioningLogModal ? (
        <div className="operator-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="provisioning-log-title" onClick={() => setShowProvisioningLogModal(false)}>
          <div className="operator-modal" onClick={(event) => event.stopPropagation()}>
            <div className="operator-log-modal-header grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
              <div className="operator-log-modal-title">
                <span className="operator-log-modal-icon">
                  <OperatorIcon name="document" />
                </span>
                <div>
                  <h2 id="provisioning-log-title">Log de provisionamento</h2>
                  <p>{provisioningLogTitle}</p>
                </div>
              </div>
              <button onClick={() => setShowProvisioningLogModal(false)} className="operator-ghost-button operator-log-close-button">Fechar</button>
            </div>

            <ProvisioningLogTimeline logs={provisioningLogs} isLoading={isLoading} />
          </div>
        </div>
      ) : null}
    </main>
  )
}

function ProvisionForm(props: {
  clientName: string
  setClientName: (value: string) => void
  contractNumber: string
  setContractNumber: (value: string) => void
  pppoeLogin: string
  setPppoeLogin: (value: string) => void
  pppoePassword: string
  setPppoePassword: (value: string) => void
  cep: string
  setCep: (value: string) => void
  cepError: string
  isCepLoading: boolean
  fetchAddressByCep: (value: string) => Promise<void>
  address: string
  setAddress: (value: string) => void
  addressNumber: string
  setAddressNumber: (value: string) => void
  complement: string
  setComplement: (value: string) => void
  reference: string
  setReference: (value: string) => void
  latitude: number
  setLatitude: (value: number) => void
  longitude: number
  setLongitude: (value: number) => void
  geocodeAddress: (value: string, number?: string, context?: string) => Promise<{ lat: number; lng: number } | null>
  buildCanonicalGeocodeAddress: (address: string, number: string) => string
  fetchNearestCto: (lat: number, lng: number, showMessage?: boolean) => Promise<NearbyCTO[]>
  isGeocoding: boolean
  selectedCto: CTO | null
  selectedNearbyCto: NearbyCTO | null
  nearbyCtos: NearbyCTO[]
  radiusMeters: number
  selectNearbyCto: (ctoId: string) => void
  availablePorts: CtoPort[]
  selectedPort: CtoPort | null
  setSelectedPort: (value: CtoPort | null) => void
  models: CPEModel[]
  selectedModelId: string
  setSelectedModelId: (value: string) => void
  serial: string
  setSerial: (value: string) => void
  erpConfig: ErpConfigStatus | null
  erpLookupKey: ErpLookupKey
  setErpLookupKey: (value: ErpLookupKey) => void
  erpLookupQuery: string
  setErpLookupQuery: (value: string) => void
  erpLookupResult: NormalizedErpLookupResponse | null
  selectedErpCustomerIndex: number
  selectedErpServiceIndex: number
  pendingErpLink: PendingErpLink | null
  handleErpLookup: () => Promise<void>
  selectErpService: (customerIndex: number, serviceIndex: number) => Promise<void>
  handleProvision: () => Promise<void>
  isLoading: boolean
}) {
  const selectedCtoId = props.selectedNearbyCto?.id || props.selectedCto?.id || ""
  const [isGeoAdjustOpen, setIsGeoAdjustOpen] = useState(false)

  const handleNumberBlur = () => {
    const cleanCep = props.cep.replace(/\D/g, "")
    const cleanNumber = props.addressNumber.trim()
    if (!isValidCepValue(cleanCep) || !cleanNumber) return
    const canonicalAddress = props.buildCanonicalGeocodeAddress(props.address, cleanNumber)
    if (!canonicalAddress) return
    void props.geocodeAddress(canonicalAddress)
  }

  const handleManualLocationChange = (lat: number, lng: number) => {
    const roundedLat = Number(lat.toFixed(7))
    const roundedLng = Number(lng.toFixed(7))

    props.setLatitude(roundedLat)
    props.setLongitude(roundedLng)
    void props.fetchNearestCto(roundedLat, roundedLng, true)
  }

  return (
    <Panel title="Novo provisionamento">
      {props.erpConfig?.enabled ? (
        <div className="mb-4 rounded-[8px] border border-orange-200 bg-orange-50 p-4">
          <div className="grid gap-3 md:grid-cols-[180px_minmax(0,1fr)_auto]">
            <select value={props.erpLookupKey} onChange={(event) => props.setErpLookupKey(event.target.value as ErpLookupKey)} className="operator-select px-3 py-3 text-sm" disabled={props.isLoading}>
              {props.erpConfig.allowedLookupKeys.map((key) => (
                <option key={key} value={key}>{erpLookupKeyLabels[key]}</option>
              ))}
            </select>
            <Input value={props.erpLookupQuery} onChange={props.setErpLookupQuery} placeholder={`Buscar no ${erpProviderLabels[props.erpConfig.provider]}`} />
            <button type="button" onClick={props.handleErpLookup} disabled={props.isLoading || !props.erpLookupQuery.trim()} className="operator-secondary-button px-4 py-3 text-sm disabled:opacity-60">
              Buscar ERP
            </button>
          </div>
          {props.erpLookupResult?.customers.length ? (
            <div className="mt-3 grid gap-2">
              {props.erpLookupResult.customers.map((customer, customerIndex) => (
                <div key={`${customer.externalCustomerId ?? customerIndex}`} className="rounded-[8px] border border-orange-100 bg-white p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-extrabold text-slate-950">{customer.name}</p>
                      <p className="text-xs font-semibold text-slate-500">{customer.document || "Documento nao informado"} · {customer.services.length} servico{customer.services.length === 1 ? "" : "s"}</p>
                    </div>
                    {customer.externalUrl ? (
                      <a href={customer.externalUrl} target="_blank" rel="noreferrer" className="operator-provisioning-action">
                        ERP {customer.displayCode || customer.externalCustomerId}
                      </a>
                    ) : null}
                  </div>
                  <div className="mt-2 grid gap-2 md:grid-cols-2">
                    {customer.services.map((service, serviceIndex) => {
                      const selected = props.selectedErpCustomerIndex === customerIndex && props.selectedErpServiceIndex === serviceIndex
                      const serviceDetails = [
                        service.planName,
                        service.login ? `PPPoE ${service.login}` : null,
                        service.pppoePassword ? "senha PPPoE importada" : null,
                        service.status,
                      ].filter(Boolean).join(" · ")
                      return (
                        <button
                          key={`${service.externalServiceId ?? service.contractNumber}-${serviceIndex}`}
                          type="button"
                          onClick={() => props.selectErpService(customerIndex, serviceIndex)}
                          className={`rounded-[8px] border p-3 text-left text-sm transition ${selected ? "border-orange-500 bg-orange-50" : "border-slate-200 bg-slate-50"}`}
                          disabled={props.isLoading}
                        >
                          <span className="block font-extrabold text-slate-950">Contrato/servico {service.contractNumber}</span>
                          <span className="block text-xs font-semibold text-slate-500">{serviceDetails || "Sem detalhes"}</span>
                          {service.externalUrl ? <span className="mt-1 block text-xs font-bold text-orange-800">Abrir cadastro do servico no ERP</span> : null}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {props.pendingErpLink ? (
            <p className="mt-2 text-xs font-bold text-orange-900">
              Vinculado ao ERP: cliente {props.pendingErpLink.customerDisplayCode || props.pendingErpLink.customerExternalId || "-"} · servico {props.pendingErpLink.serviceDisplayCode || props.pendingErpLink.serviceExternalId || props.pendingErpLink.contractExternalId || "-"}
              {props.pendingErpLink.login ? ` · PPPoE ${props.pendingErpLink.login}` : ""}
              {props.pendingErpLink.pppoePassword ? " · senha PPPoE importada" : ""}
            </p>
          ) : null}
        </div>
      ) : null}
      <div id="operator-provision-fields" className="scroll-mt-24 grid gap-4 md:grid-cols-2">
        <Input value={props.clientName} onChange={props.setClientName} placeholder="Nome do cliente" />
        <Input value={props.contractNumber} onChange={props.setContractNumber} placeholder="Numero do contrato" />
        <Input value={props.pppoeLogin} onChange={props.setPppoeLogin} placeholder="Login PPPoE" />
        <Input value={props.pppoePassword} onChange={props.setPppoePassword} placeholder="Senha PPPoE" type="password" />
        <div className="md:col-span-2">
          <Input value={props.cep} onChange={props.setCep} onBlur={() => props.fetchAddressByCep(props.cep)} placeholder="CEP" disabled={props.isCepLoading} />
          {props.cepError ? <p className="mt-2 text-sm text-red-600">{props.cepError}</p> : null}
        </div>
        <Input value={props.addressNumber} onChange={props.setAddressNumber} placeholder="Numero" onBlur={handleNumberBlur} />
        <Input value={props.complement} onChange={props.setComplement} placeholder="Complemento" />
        <Input value={props.reference} onChange={props.setReference} placeholder="Referencia" />
        <Input value={props.address} onChange={props.setAddress} placeholder="Endereco completo" />
        <Input value={String(props.latitude)} onChange={(value) => props.setLatitude(Number(value))} placeholder="Latitude" type="number" />
        <Input value={String(props.longitude)} onChange={(value) => props.setLongitude(Number(value))} placeholder="Longitude" type="number" />
      </div>
      {props.isGeocoding ? <p className="mt-3 text-sm text-slate-500">Atualizando coordenadas...</p> : null}
      <div className="mt-4">
        <button
          type="button"
          onClick={() => setIsGeoAdjustOpen((value) => !value)}
          className="operator-secondary-button px-4 py-3 text-sm transition"
        >
          {isGeoAdjustOpen ? "Ocultar ajuste de georreferencia" : "Ajustar georreferencia"}
        </button>
      </div>
      {isGeoAdjustOpen ? (
        <div className="operator-map-shell mt-4 h-[360px]">
          <ProvisionMap
            location={{ lat: props.latitude, lng: props.longitude }}
            cto={props.selectedNearbyCto ?? props.selectedCto ?? undefined}
            nearbyCtos={props.nearbyCtos}
            radiusMeters={props.radiusMeters}
            onLocationChange={handleManualLocationChange}
          />
        </div>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-3">
        <button onClick={() => props.fetchNearestCto(props.latitude, props.longitude, true)} disabled={props.isLoading} className="operator-primary-button px-4 py-3 text-sm disabled:opacity-60">Encontrar CTO</button>
        {props.nearbyCtos.length > 1 ? (
          <select value={selectedCtoId} onChange={(event) => props.selectNearbyCto(event.target.value)} className="operator-select w-full px-3 py-3 text-sm font-medium sm:w-auto sm:min-w-72">
            {props.nearbyCtos.map((cto) => {
              const availablePortCount = cto.ports.filter((port) => port.status === "available").length
              return (
                <option key={cto.id} value={cto.id}>
                  {cto.name} - {Math.round(cto.distanceMeters)}m - {availablePortCount} porta{availablePortCount === 1 ? "" : "s"} livre{availablePortCount === 1 ? "" : "s"}
                </option>
              )
            })}
          </select>
        ) : (
          <div className="operator-inline-note px-4 py-3 text-sm">
            CTO: <span className="font-semibold">{props.selectedNearbyCto?.name || props.selectedCto?.name || "Nao selecionada"}</span>
          </div>
        )}
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <select value={props.selectedPort?.id || ""} onChange={(event) => props.setSelectedPort(props.availablePorts.find((item) => item.id === event.target.value) ?? null)} className="operator-select px-3 py-3 text-sm">
          <option value="">Porta disponivel</option>
          {props.availablePorts.map((port) => <option key={port.id} value={port.id}>Porta {port.number}</option>)}
        </select>
        <select value={props.selectedModelId} onChange={(event) => props.setSelectedModelId(event.target.value)} className="operator-select px-3 py-3 text-sm">
          <option value="">Modelo da CPE</option>
          {props.models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
        </select>
        <Input value={props.serial} onChange={props.setSerial} placeholder="Serial GPON" />
      </div>
      <button onClick={props.handleProvision} disabled={props.isLoading} className="operator-primary-button mt-5 px-5 py-3 text-sm disabled:opacity-60">
        Confirmar provisionamento
      </button>
    </Panel>
  )
}

function ProvisioningImportPanel(props: {
  csv: string
  setCsv: (value: string) => void
  fileName: string
  onFile: (file?: File | null) => Promise<void>
  onDownloadTemplate: () => void
  onImport: (dryRun?: boolean) => Promise<void>
  result: ProvisioningImportResult | null
  isLoading: boolean
}) {
  return (
    <Panel title="Importar CSV">
      <div className="operator-import-grid">
        <label className="operator-import-file">
          <span>{props.fileName || "Arquivo CSV"}</span>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => props.onFile(event.target.files?.[0])}
            disabled={props.isLoading}
          />
        </label>
        <button type="button" onClick={props.onDownloadTemplate} className="operator-secondary-button px-4 py-3 text-sm">
          Baixar modelo CSV
        </button>
      </div>
      <textarea
        value={props.csv}
        onChange={(event) => props.setCsv(event.target.value)}
        className="operator-import-textarea"
        placeholder="cliente;contrato;cep;endereco;numero;latitude;longitude;cto;porta;modelo_cpe;serial;status"
        spellCheck={false}
      />
      <div className="operator-import-actions">
        <button type="button" onClick={() => props.onImport(true)} disabled={props.isLoading || !props.csv.trim()} className="operator-secondary-button px-4 py-3 text-sm disabled:opacity-60">
          Validar CSV
        </button>
        <button type="button" onClick={() => props.onImport(false)} disabled={props.isLoading || !props.csv.trim()} className="operator-primary-button px-4 py-3 text-sm disabled:opacity-60">
          Importar provisionamentos
        </button>
      </div>
      {props.result ? (
        <div className="operator-import-result">
          <div className="operator-import-summary">
            <span>Total {props.result.summary.total}</span>
            <span>Importados {props.result.summary.imported}</span>
            <span>Atualizados {props.result.summary.updated}</span>
            <span>Ignorados {props.result.summary.skipped}</span>
            <span>Erros {props.result.summary.failed}</span>
          </div>
          <div className="operator-import-table-wrap">
            <table className="operator-import-table">
              <thead>
                <tr>
                  <th>Linha</th>
                  <th>Status</th>
                  <th>Contrato</th>
                  <th>Serial</th>
                  <th>CTO</th>
                  <th>Porta CTO</th>
                  <th>Porta OLT</th>
                  <th>Resultado</th>
                </tr>
              </thead>
              <tbody>
                {props.result.results.map((item) => (
                  <tr key={`${item.line}-${item.serial || item.message}`}>
                    <td>{item.line}</td>
                    <td><span className={importStatusClass(item.status)}>{importStatusLabel(item.status)}</span></td>
                    <td>{item.contractNumber || "-"}</td>
                    <td>{item.serial || "-"}</td>
                    <td>{item.ctoName || "-"}</td>
                    <td>{typeof item.portNumber === "number" ? item.portNumber : "-"}</td>
                    <td>{item.oltPort || "-"}</td>
                    <td>{item.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </Panel>
  )
}

function OnuCurrentList({ items, selectedProvisioningId, onConfigureCpe, isLoading }: { items: OnuCurrent[]; selectedProvisioningId?: string | null; onConfigureCpe: (item: OnuCurrent) => void | Promise<void>; isLoading: boolean }) {
  const [searchQuery, setSearchQuery] = useState("")
  const [activeFilter, setActiveFilter] = useState<OnuListFilter>("all")
  const [expandedCards, setExpandedCards] = useState<string[]>([])
  const [rebootingOnuId, setRebootingOnuId] = useState<string | null>(null)
  const [actionMessage, setActionMessage] = useState("")

  if (items.length === 0) {
    return <p className="operator-empty-state p-4 text-sm">Nenhuma CPE vinculada ao seu usuario.</p>
  }

  const uniqueItems = Array.from(new Map(
    items.map((item) => [`${item.id}:${item.provisioningId ?? "no-provisioning"}`, item]),
  ).values()).sort((left, right) =>
    new Date(right.provisioningUpdatedAt || right.collectedAt).getTime() - new Date(left.provisioningUpdatedAt || left.collectedAt).getTime()
  )
  const normalizedSearch = searchQuery.trim().toLowerCase()
  const selectedItem = selectedProvisioningId
    ? uniqueItems.find((item) => item.provisioningId === selectedProvisioningId)
    : null
  const visibleItems = selectedItem
    ? [selectedItem, ...uniqueItems.filter((item) => item.id !== selectedItem.id || item.provisioningId !== selectedItem.provisioningId)]
    : uniqueItems
  const searchedItems = normalizedSearch
    ? visibleItems.filter((item) => [
      item.serial,
      item.contractName,
      item.contractNumber,
      item.cpeModelName,
      item.oltName,
    ].some((value) => value?.toLowerCase().includes(normalizedSearch)))
    : visibleItems
  const filteredItems = searchedItems.filter((item) => matchesOnuFilter(item, activeFilter))
  const filterOptions: { id: OnuListFilter; label: string; count: number; icon: OperatorIconName }[] = [
    { id: "all", label: "Todas", count: searchedItems.length, icon: "list" },
    { id: "alerts", label: "Alertas", count: searchedItems.filter((item) => matchesOnuFilter(item, "alerts")).length, icon: "alert" },
    { id: "offline", label: "Offlines", count: searchedItems.filter((item) => matchesOnuFilter(item, "offline")).length, icon: "pending" },
    { id: "online", label: "Onlines", count: searchedItems.filter((item) => matchesOnuFilter(item, "online")).length, icon: "signal" },
  ]
  const handleRebootOnu = async (item: OnuCurrent, event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    const label = item.serial || `${item.porta} ONU ${item.onuId}`
    const confirmed = window.confirm(`Reiniciar a ONU/CPE ${label}?`)
    if (!confirmed) {
      return
    }

    setRebootingOnuId(item.id)
    setActionMessage("")
    try {
      const response = await fetch("/api/olt/management/onu-reboot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ onuCurrentId: item.id }),
      })
      const body = await response.json().catch(() => ({ error: "Erro ao reiniciar ONU/CPE." }))
      if (!response.ok) {
        throw new Error(body.error || "Erro ao reiniciar ONU.")
      }
      const successMessage = body.message || "Comando de reboot enviado para a ONU/CPE."
      setActionMessage(successMessage)
      window.alert(successMessage)
    } catch (error) {
      const errorMessage = (error as Error).message || "Erro ao reiniciar ONU/CPE."
      setActionMessage(errorMessage)
      window.alert(errorMessage)
    } finally {
      setRebootingOnuId(null)
    }
  }

  return (
    <div className="operator-onu-list grid gap-3">
      <label className="operator-onu-search">
        <span>Pesquisar CPE</span>
        <input
          type="search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Serial, nome ou contrato"
          className="operator-input"
        />
      </label>
      <div className="operator-onu-filters" aria-label="Filtrar CPEs">
        {filterOptions.map((filter) => (
          <button
            key={filter.id}
            type="button"
            onClick={() => setActiveFilter(filter.id)}
            className={`operator-onu-filter inline-flex min-h-11 min-w-0 items-center justify-between gap-2 rounded-[8px] border px-3 py-2 text-sm font-extrabold transition ${activeFilter === filter.id ? "operator-onu-filter-active" : ""}`}
            aria-pressed={activeFilter === filter.id}
          >
            <span className="operator-onu-filter-label inline-flex min-w-0 items-center gap-2">
              <OperatorIcon name={filter.icon} />
              <span>{filter.label}</span>
            </span>
            <strong className="operator-onu-filter-count">{filter.count}</strong>
          </button>
        ))}
      </div>
      {selectedProvisioningId && !selectedItem ? (
        <p className="operator-empty-state p-4 text-sm">A CPE associada ainda nao tem leitura vinculada.</p>
      ) : null}
      {actionMessage ? (
        <p className="operator-empty-state p-4 text-sm">{actionMessage}</p>
      ) : null}
      {filteredItems.length === 0 ? (
        <p className="operator-empty-state p-4 text-sm">Nenhuma CPE encontrada para essa pesquisa ou filtro.</p>
      ) : null}
      {filteredItems.map((item) => {
        const isSelected = item.provisioningId === selectedProvisioningId
        const cardKey = `${item.id}:${item.provisioningId ?? item.onuId}`
        const isExpanded = expandedCards.includes(cardKey)
        const hasBadSignal = typeof item.rxDbm === "number" && item.rxDbm < -25
        const modelName = item.cpeModelName || item.oltName
        const serialTitle = item.serial ? `${item.serial} - ${modelName}` : modelName
        const canConfigureCpe = Boolean(item.provisioningId)
        const toggleCard = () => {
          setExpandedCards((current) =>
            current.includes(cardKey)
              ? current.filter((key) => key !== cardKey)
              : [...current, cardKey]
          )
        }
        return (
        <div
          key={cardKey}
          className={`operator-provisioning-card operator-onu-session-card operator-onu-toggle-card ${isSelected ? "operator-cpe-card-selected" : ""} ${isExpanded ? "operator-onu-card-expanded" : ""}`}
          role="button"
          tabIndex={0}
          aria-expanded={isExpanded}
          onClick={toggleCard}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault()
              toggleCard()
            }
          }}
        >
          <div className="operator-provisioning-header">
            <div className="operator-provisioning-title">
              <p>
                {serialTitle}
                {hasBadSignal ? (
                  <span className="operator-onu-signal-alert" title={`Sinal ruim: ${formatPower(item.rxDbm)}`} aria-label={`Sinal ruim: ${formatPower(item.rxDbm)}`}>
                    <OperatorIcon name="alert" />
                  </span>
                ) : null}
              </p>
              {item.contractNumber ? <span>Contrato: {item.contractNumber}</span> : null}
              {item.contractName ? <span>Nome: {item.contractName}</span> : null}
              <span>OLT: {item.oltName}</span>
              <span>Porta: {item.porta} - ONU {item.onuId}</span>
            </div>
            <div className="operator-onu-status-stack">
              <span className={onuStatusClass(item.statusName)}>{displayOnuStatus(item.statusName)}</span>
              {canConfigureCpe ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    void onConfigureCpe(item)
                  }}
                  onKeyDown={(event) => event.stopPropagation()}
                  disabled={isLoading}
                  className="operator-provisioning-action operator-onu-config-action"
                >
                  <OperatorIcon name="wifi" />
                  <span>Configurar</span>
                </button>
              ) : null}
              <button
                type="button"
                onClick={(event) => void handleRebootOnu(item, event)}
                onKeyDown={(event) => event.stopPropagation()}
                disabled={rebootingOnuId === item.id}
                className="operator-provisioning-action operator-onu-reboot-action"
              >
                <OperatorIcon name="reboot" />
                <span>{rebootingOnuId === item.id ? "Enviando" : "Reiniciar"}</span>
              </button>
              <span className="operator-onu-expand-indicator" aria-label={isExpanded ? "Recolher detalhes" : "Expandir detalhes"} title={isExpanded ? "Recolher detalhes" : "Expandir detalhes"}>
                <OperatorIcon name="chevron" />
              </span>
            </div>
          </div>
          {isExpanded ? (
            <div className="operator-provisioning-details operator-onu-details">
              <PowerInfo rx={item.rxDbm} tx={item.txDbm} />
              <Info icon="calendar" label="Atualizado" value={formatDateTime(item.collectedAt)} compact />
              <Info icon="clock" label="Ultima online" value={formatDateTime(item.lastOnline)} compact />
              <Info icon="clock" label="Ultima offline" value={formatDateTime(item.lastOffline)} compact />
            </div>
          ) : null}
        </div>
      )})}
    </div>
  )
}

function ProvisioningList({ provisionings, onRetry, onViewCpe, onDeprovision, onManeuver, onLogs, isLoading, canMutate }: { provisionings: Provisioning[]; onRetry: (id: string) => Promise<void>; onViewCpe: (provisioning: Provisioning) => void; onDeprovision: (provisioning: Provisioning) => Promise<void>; onManeuver: (provisioning: Provisioning) => void; onLogs: (provisioning: Provisioning) => Promise<void>; isLoading: boolean; canMutate: boolean }) {
  const [expandedProvisioningIds, setExpandedProvisioningIds] = useState<Set<string>>(new Set())
  const [locationProvisioning, setLocationProvisioning] = useState<Provisioning | null>(null)

  const toggleProvisioning = (id: string) => {
    setExpandedProvisioningIds((current) => {
      const next = new Set(current)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const selectedLocationLinks = locationProvisioning ? getProvisioningMapLinks(locationProvisioning) : null
  const selectedCtoLocationLink = locationProvisioning ? getCtoMapLink(locationProvisioning) : null

  return (
    <>
    <div className="grid gap-3">
      {provisionings.length === 0 ? (
        <p className="operator-empty-state p-4 text-sm">Nenhum provisionamento encontrado.</p>
      ) : null}
      {provisionings.map((item) => {
        const isExpanded = expandedProvisioningIds.has(item.id)
        const detailsId = `provisioning-details-${item.id}`
        const mapLinks = getProvisioningMapLinks(item)
        const erpOpenUrl = getErpOpenUrl(item.contract.erpLink)

        return (
          <div key={item.id} className={`operator-provisioning-card ${isExpanded ? "operator-provisioning-card-expanded" : ""}`}>
            <button
              type="button"
              className="operator-provisioning-header operator-provisioning-toggle"
              aria-expanded={isExpanded}
              aria-controls={detailsId}
              onClick={() => toggleProvisioning(item.id)}
            >
              <div className="operator-provisioning-title">
                <p>{item.contract.name}</p>
                <span>Contrato {item.contract.contractNumber}</span>
                <span className="operator-provisioning-created">
                  <OperatorIcon name="calendar" />
                  Provisionado em {new Date(item.updatedAt || item.createdAt).toLocaleString("pt-BR")}
                </span>
              </div>
              <div className="operator-provisioning-actions">
                <span className={statusClass(item.status)}>{statusLabels[item.status] || item.status}</span>
                <span className="operator-provisioning-expand-icon" aria-hidden="true">
                  <OperatorIcon name="chevron" />
                </span>
              </div>
            </button>
            {isExpanded ? (
              <div className="operator-provisioning-secondary-actions">
                {item.status !== "active" ? (
                  <button onClick={() => onRetry(item.id)} disabled={isLoading || !canMutate} className="operator-provisioning-action">Reprovisionar</button>
                ) : null}
                {item.status !== "inactive" ? (
                  <>
                    {erpOpenUrl ? (
                      <a href={erpOpenUrl} target="_blank" rel="noreferrer" className="operator-provisioning-action">
                        <OperatorIcon name="document" />
                        <span>Abrir no ERP</span>
                      </a>
                    ) : null}
                    {mapLinks ? (
                      <button type="button" onClick={() => setLocationProvisioning(item)} className="operator-provisioning-action">
                          <OperatorIcon name="distance" />
                          <span>Localização</span>
                      </button>
                    ) : null}
                    <button onClick={() => onViewCpe(item)} disabled={isLoading} className="operator-provisioning-action">CPE</button>
                    <button onClick={() => onManeuver(item)} disabled={isLoading || !canMutate} className="operator-provisioning-action">Manobrar CTO</button>
                    <button onClick={() => onDeprovision(item)} disabled={isLoading || !canMutate} className="operator-provisioning-action operator-provisioning-action-danger">Desprovisionar</button>
                  </>
                ) : null}
                <button onClick={() => onLogs(item)} disabled={isLoading} className="operator-provisioning-action operator-provisioning-log-action">
                  <OperatorIcon name="document" />
                  <span>Logs</span>
                </button>
              </div>
            ) : null}
            {isExpanded ? (
              <div id={detailsId} className="operator-provisioning-details">
                <Info icon="router" label="CPE" value={item.cpeModel.name} detail={item.serial} featured />
                <Info icon="cto" label="CTO" value={item.port.cto.name} detail={`Porta ${item.port.number}`} featured />
                {item.contract.erpLink ? (
                  <div className="operator-info-tile operator-info-tile-rich operator-info-tile-featured">
                    <span className="operator-info-icon"><OperatorIcon name="document" /></span>
                    <span className="operator-info-copy">
                      <span className="operator-info-label">{erpProviderLabels[item.contract.erpLink.provider]} ERP</span>
                      <span className="operator-info-value">
                        {item.contract.erpLink.customerUrl ? (
                          <a href={item.contract.erpLink.customerUrl} target="_blank" rel="noreferrer">
                            Cliente {item.contract.erpLink.customerDisplayCode || item.contract.erpLink.customerExternalId || "-"}
                          </a>
                        ) : (
                          `Cliente ${item.contract.erpLink.customerDisplayCode || item.contract.erpLink.customerExternalId || "-"}`
                        )}
                      </span>
                      <span className="operator-info-detail">
                        {item.contract.erpLink.serviceUrl ? (
                          <a href={item.contract.erpLink.serviceUrl} target="_blank" rel="noreferrer">
                            Servico {item.contract.erpLink.serviceDisplayCode || item.contract.erpLink.serviceExternalId || item.contract.erpLink.contractExternalId || "-"}
                          </a>
                        ) : (
                          `Servico ${item.contract.erpLink.serviceDisplayCode || item.contract.erpLink.serviceExternalId || item.contract.erpLink.contractExternalId || "-"}`
                        )}
                      </span>
                    </span>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
    {locationProvisioning && selectedLocationLinks ? (
      <div className="operator-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="provisioning-location-title" onClick={() => setLocationProvisioning(null)}>
        <div className="operator-modal operator-location-modal" onClick={(event) => event.stopPropagation()}>
          <div className="operator-log-modal-header grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
            <div className="operator-log-modal-title">
              <span className="operator-log-modal-icon">
                <OperatorIcon name="distance" />
              </span>
              <div>
                <h2 id="provisioning-location-title">Localização</h2>
                <p>{locationProvisioning.contract.name} - contrato {locationProvisioning.contract.contractNumber}</p>
              </div>
            </div>
            <button type="button" onClick={() => setLocationProvisioning(null)} className="operator-ghost-button operator-log-close-button">Fechar</button>
          </div>

          <div className="operator-location-options">
            <a href={selectedLocationLinks.google} target="_blank" rel="noreferrer" className="operator-provisioning-action operator-location-option">
              <OperatorIcon name="distance" />
              <span>Localização do cliente</span>
            </a>
            {selectedCtoLocationLink ? (
              <a href={selectedCtoLocationLink} target="_blank" rel="noreferrer" className="operator-provisioning-action operator-location-option">
                <OperatorIcon name="cto" />
                <span>Localização da CTO</span>
              </a>
            ) : null}
          </div>
        </div>
      </div>
    ) : null}
    </>
  )
}

function getErpOpenUrl(link?: ContractErpLink | null) {
  if (!link) return null

  if (link.provider === "mikweb" && link.customerExternalId) {
    return `https://painel.mikweb.com.br/admin/customers/${encodeURIComponent(link.customerExternalId)}/billings`
  }

  if (link.provider === "hubsoft" && link.customerExternalId) {
    const sourceUrl = link.customerUrl || link.serviceUrl
    if (sourceUrl) {
      try {
        const url = new URL(sourceUrl)
        return `${url.origin}/cliente/editar/${encodeURIComponent(link.customerExternalId)}/servico`
      } catch {
        return null
      }
    }
  }

  return link.serviceUrl || link.customerUrl
}

function getProvisioningMapLinks(provisioning: Provisioning) {
  const lat = Number(provisioning.contract.lat)
  const lng = Number(provisioning.contract.lng)
  const hasCoordinates = Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)
  const address = provisioning.contract.address?.trim()

  if (!hasCoordinates && !address) {
    return null
  }

  const query = hasCoordinates ? `${lat},${lng}` : address || ''
  return {
    google: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`,
  }
}

function getCtoMapLink(provisioning: Provisioning) {
  const lat = Number(provisioning.port.cto.lat)
  const lng = Number(provisioning.port.cto.lng)
  const hasCoordinates = Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)

  if (!hasCoordinates) {
    return null
  }

  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`
}

function ProvisioningLogTimeline({ logs, isLoading }: { logs: ProvisioningLog[]; isLoading: boolean }) {
  if (isLoading && logs.length === 0) {
    return <LoadingInline title="Carregando log" description="Buscando os eventos do provisionamento." />
  }

  if (logs.length === 0) {
    return <p className="operator-log-empty">Nenhum evento de provisionamento registrado.</p>
  }

  return (
    <div className="operator-log-timeline">
      {logs.map((log, index) => (
        <article key={log.id} className={`operator-log-item ${logLevelClass(log.level)}`}>
          <div className="operator-log-marker" aria-hidden="true">{index + 1}</div>
          <div className="operator-log-card">
            <div className="operator-log-card-header grid grid-cols-[minmax(0,1fr)_auto] gap-3">
              <div className="operator-log-heading">
                <h3>{log.message}</h3>
                <div className="operator-log-meta">
                  <span className="operator-log-level">{logLevelLabel(log.level)}</span>
                  <span>{log.stage}</span>
                  <time dateTime={log.createdAt}>{formatLogDate(log.createdAt)}</time>
                </div>
              </div>
              <span className="operator-log-step" aria-label={`Evento ${index + 1}`}>{String(index + 1).padStart(2, "0")}</span>
            </div>
            {log.details ? (
              <details className="operator-log-details">
                <summary>Ver detalhes tecnicos</summary>
                <pre>{JSON.stringify(log.details, null, 2)}</pre>
              </details>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  )
}

function logLevelClass(level: string) {
  if (level === "success") return "operator-log-success"
  if (level === "warn") return "operator-log-warning"
  if (level === "error") return "operator-log-error"
  return "operator-log-info"
}

function logLevelLabel(level: string) {
  if (level === "success") return "Sucesso"
  if (level === "warn") return "Atencao"
  if (level === "error") return "Erro"
  return "Info"
}

function importStatusLabel(status: ProvisioningImportStatus) {
  const labels: Record<ProvisioningImportStatus, string> = {
    imported: "Importado",
    updated: "Atualizado",
    skipped: "Ignorado",
    valid: "Valido",
    failed: "Erro",
  }

  return labels[status]
}

function importStatusClass(status: ProvisioningImportStatus) {
  if (status === "failed") return "operator-import-status operator-import-status-failed"
  if (status === "skipped") return "operator-import-status operator-import-status-skipped"
  if (status === "valid") return "operator-import-status operator-import-status-valid"
  return "operator-import-status operator-import-status-imported"
}

function formatLogDate(value: string) {
  return new Date(value).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  })
}

function formatPower(value?: number | null) {
  return typeof value === "number" ? `${value.toFixed(2)} dBm` : "Sem leitura"
}

function formatMoney(value?: number | null) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(value || 0) / 100)
}

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleDateString("pt-BR") : "-"
}

function formatDateTime(value?: string | null) {
  return value ? new Date(value).toLocaleString("pt-BR") : "Sem leitura"
}

function formatGenieAcsBytes(value?: string | null) {
  if (!value) return null
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue)) return value
  const units = ["B", "KB", "MB", "GB", "TB"]
  let amount = numericValue
  let unitIndex = 0
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024
    unitIndex += 1
  }
  const digits = unitIndex === 0 ? 0 : amount >= 10 ? 1 : 2
  return `${amount.toLocaleString("pt-BR", { maximumFractionDigits: digits })} ${units[unitIndex]}`
}

function formatGenieAcsDuration(value?: string | null) {
  if (!value) return null
  const seconds = Number(value)
  if (!Number.isFinite(seconds)) return value
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}min`
  return `${minutes}min`
}

function formatGenieAcsSignal(value?: string | null) {
  if (!value) return null
  return /dbm$/i.test(value) ? value : `${value} dBm`
}

function formatGenieAcsRate(value?: string | null) {
  if (!value) return null
  return /bps|bit|mb|gb/i.test(value) ? value : `${value} Mbps`
}

function billingStatusLabel(status?: string | null) {
  const labels: Record<string, string> = {
    open: "Em dia",
    overdue: "Atrasada",
    paid: "Paga",
    inactive: "Inativa",
  }

  return labels[status || ""] || status || "-"
}

function getEffectiveBillingStatus(invoice: BillingInvoice): BillingInvoiceStatus {
  if (invoice.status === "paid") return "paid"
  if (invoice.status === "inactive") return "inactive"

  const dueDate = invoice.dueDate ? new Date(invoice.dueDate) : null
  if (dueDate && !Number.isNaN(dueDate.getTime())) {
    dueDate.setHours(23, 59, 59, 999)
    if (dueDate.getTime() < Date.now()) return "overdue"
  }

  if (invoice.status === "overdue") return "overdue"
  return "open"
}

function invoiceRaw(invoice: BillingInvoice) {
  if (!invoice.rawPayload) return null
  try {
    return JSON.parse(invoice.rawPayload) as BillingInvoiceRaw
  } catch {
    return null
  }
}

function shortPaymentCode(value?: string | null) {
  if (!value) return "Nao disponivel"
  if (value.length <= 36) return value
  return `${value.slice(0, 18)}...${value.slice(-10)}`
}

function displayOnuStatus(status?: string | null) {
  const normalizedStatus = status?.trim().toLowerCase().replace(/[^a-z0-9]/g, "") ?? ""

  if (normalizedStatus === "dyinggasp") return "Desligado"
  if (normalizedStatus === "working") return "Online"
  return status || "Sem leitura"
}

function isOnuOnline(status?: string | null) {
  return status?.trim().toLowerCase() === "working"
}

function matchesOnuFilter(item: OnuCurrent, filter: OnuListFilter) {
  if (filter === "alerts") return typeof item.rxDbm === "number" && item.rxDbm < -25
  if (filter === "online") return isOnuOnline(item.statusName)
  if (filter === "offline") return !isOnuOnline(item.statusName)
  return true
}

function onuStatusClass(status?: string | null) {
  const normalizedStatus = status?.trim().toLowerCase() ?? ""
  if (isOnuOnline(status)) return "operator-status-pill operator-status-active"
  if (normalizedStatus === "los" || normalizedStatus === "offline" || normalizedStatus === "dyinggasp") return "operator-status-pill operator-status-danger"
  return "operator-status-pill operator-status-warning"
}

function Metric({
  icon,
  title,
  value,
  detail,
  tone = "default",
  active = false,
  onClick,
}: {
  icon: OperatorIconName
  title: string
  value: number
  detail: string
  tone?: "default" | "warn"
  active?: boolean
  onClick?: () => void
}) {
  const content = (
    <>
      <span className="operator-metric-icon">
        <OperatorIcon name={icon} />
      </span>
      <span className="operator-metric-copy">
        <strong>{value}</strong>
        <span className="operator-muted">{title}</span>
        <span className="operator-metric-detail">{detail}</span>
      </span>
    </>
  )

  const className = `operator-metric ${tone === "warn" ? "operator-metric-warn" : ""} ${active ? "operator-metric-active" : ""} ${onClick ? "operator-metric-clickable" : ""}`

  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-pressed={active} className={className}>
        {content}
      </button>
    )
  }

  return (
    <div className={className}>
      {content}
    </div>
  )
}

function Panel({ title, children, className = "", actions }: { title: string; children: React.ReactNode; className?: string; actions?: React.ReactNode }) {
  return (
    <section className={`operator-panel ${className}`}>
      <div className="operator-panel-header">
        <h2 className="text-lg font-semibold">{title}</h2>
        {actions ? <div className="operator-panel-actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  )
}

function AlertList({ alerts, onOpenCpe }: { alerts: OperatorAlert[]; onOpenCpe?: (provisioning: Provisioning) => void }) {
  if (alerts.length === 0) return <p className="operator-empty-state p-4 text-sm">Nenhum alerta no momento.</p>
  return (
    <div className="grid gap-3">
      {alerts.map((alert, index) => {
        const alertClassName = `rounded-[8px] border px-4 py-3 text-left text-sm ${alert.tone === "danger" ? "border-red-200 bg-red-50 text-red-900" : "border-amber-200 bg-amber-50 text-amber-900"}`
        const provisioning = alert.item
        const canOpenCpe = alert.action === "open-onu" && provisioning && onOpenCpe

        if (canOpenCpe) {
          return (
            <button
              key={`${alert.text}-${index}`}
              type="button"
              onClick={() => onOpenCpe(provisioning)}
              className={`${alertClassName} w-full cursor-pointer transition hover:-translate-y-0.5 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2`}
              aria-label={`Abrir CPE do alerta: ${alert.text}`}
            >
              {alert.text}
            </button>
          )
        }

        return (
          <div key={`${alert.text}-${index}`} className={alertClassName}>
            {alert.text}
          </div>
        )
      })}
    </div>
  )
}

function BillingInvoiceList({ invoices, filter }: { invoices: BillingInvoice[]; filter: BillingInvoiceFilter }) {
  const [selectedInvoice, setSelectedInvoice] = useState<BillingInvoice | null>(null)
  const [copiedPaymentOption, setCopiedPaymentOption] = useState("")
  const emptyMessages: Record<BillingInvoiceFilter, string> = {
    all: "Nenhuma fatura encontrada.",
    overdue: "Nenhuma fatura atrasada.",
    open: "Nenhuma fatura em dia.",
    paid: "Nenhuma fatura paga.",
  }

  const selectedRaw = selectedInvoice ? invoiceRaw(selectedInvoice) : null
  const selectedBarcode = selectedRaw?.codigo_barras || selectedRaw?.linha_digitavel || ""
  const selectedPix = selectedRaw?.pix_copia_e_cola || ""

  const copyPaymentValue = async (label: string, value?: string | null) => {
    if (!value) return

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value)
      } else {
        const textarea = document.createElement("textarea")
        textarea.value = value
        textarea.setAttribute("readonly", "true")
        textarea.style.position = "fixed"
        textarea.style.opacity = "0"
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand("copy")
        document.body.removeChild(textarea)
      }
      setCopiedPaymentOption(label)
      window.setTimeout(() => setCopiedPaymentOption((current) => current === label ? "" : current), 2400)
    } catch {
      setCopiedPaymentOption(`${label}-error`)
      window.setTimeout(() => setCopiedPaymentOption((current) => current === `${label}-error` ? "" : current), 2400)
    }
  }

  if (invoices.length === 0) return <p className="operator-empty-state p-4 text-sm">{emptyMessages[filter]}</p>

  return (
    <>
      <div className="grid gap-3">
        {invoices.map((invoice) => {
          const raw = invoiceRaw(invoice)
          const status = getEffectiveBillingStatus(invoice)
          const hasPaymentOptions = Boolean(raw?.codigo_barras || raw?.linha_digitavel || raw?.pix_copia_e_cola || raw?.link)
          const canPay = status === "open" || status === "overdue"

          return (
            <div key={invoice.id} className="operator-list-card">
              <div className="operator-list-main">
                <div>
                  <p className="operator-list-title">Fatura {invoice.hubsoftInvoiceId || "-"}</p>
                  <p className="operator-muted text-sm">
                    Vencimento {formatDate(invoice.dueDate)} · {billingStatusLabel(status)}
                  </p>
                  {raw?.nosso_numero ? <p className="operator-muted text-xs">Nosso número {raw.nosso_numero}</p> : null}
                </div>
                <div className="text-right">
                  <p className="operator-list-title">{formatMoney(invoice.amountCents)}</p>
                  <p className="operator-muted text-xs">sync {formatDateTime(invoice.syncedAt)}</p>
                </div>
              </div>
              <div className="operator-list-actions">
                {canPay && hasPaymentOptions ? (
                  <button type="button" onClick={() => { setSelectedInvoice(invoice); setCopiedPaymentOption("") }} className="operator-secondary-button inline-flex items-center gap-2 px-4 py-2 text-sm">
                    <OperatorIcon name="payment" className="h-4 w-4" />
                    Pagar
                  </button>
                ) : null}
                {status === "paid" && raw?.link ? (
                  <a href={raw.link} target="_blank" rel="noreferrer" className="operator-secondary-button inline-flex items-center gap-2 px-4 py-2 text-sm">
                    <OperatorIcon name="document" className="h-4 w-4" />
                    Comprovante
                  </a>
                ) : null}
                {typeof raw?.valor_pago === "number" && raw.valor_pago > 0 ? <span className="operator-muted text-sm">Pago {formatMoney(Math.round(raw.valor_pago * 100))}</span> : null}
              </div>
            </div>
          )
        })}
      </div>

      {selectedInvoice ? (
        <div className="operator-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="billing-payment-title" onClick={() => setSelectedInvoice(null)}>
          <div className="operator-modal operator-payment-modal" onClick={(event) => event.stopPropagation()}>
            <div className="operator-log-modal-header grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
              <div className="operator-log-modal-title">
                <span className="operator-log-modal-icon">
                  <OperatorIcon name="payment" />
                </span>
                <div>
                  <h2 id="billing-payment-title">Pagar fatura {selectedInvoice.hubsoftInvoiceId || "-"}</h2>
                  <p>{formatMoney(selectedInvoice.amountCents)} · vencimento {formatDate(selectedInvoice.dueDate)}</p>
                </div>
              </div>
              <button type="button" onClick={() => setSelectedInvoice(null)} className="operator-ghost-button operator-log-close-button">Fechar</button>
            </div>

            <div className="operator-payment-options">
              <div className="operator-payment-option">
                <div className="operator-payment-copy">
                  <strong>Codigo de barras</strong>
                  <span>{shortPaymentCode(selectedBarcode)}</span>
                </div>
                <button type="button" onClick={() => void copyPaymentValue("barcode", selectedBarcode)} disabled={!selectedBarcode} className="operator-secondary-button inline-flex items-center gap-2 px-4 py-2 text-sm disabled:opacity-50">
                  <OperatorIcon name="copy" className="h-4 w-4" />
                  {copiedPaymentOption === "barcode" ? "Copiado" : copiedPaymentOption === "barcode-error" ? "Falhou" : "Copiar"}
                </button>
              </div>

              <div className="operator-payment-option">
                <div className="operator-payment-copy">
                  <strong>Pix Copia e Cola</strong>
                  <span>{shortPaymentCode(selectedPix)}</span>
                </div>
                <button type="button" onClick={() => void copyPaymentValue("pix", selectedPix)} disabled={!selectedPix} className="operator-secondary-button inline-flex items-center gap-2 px-4 py-2 text-sm disabled:opacity-50">
                  <OperatorIcon name="copy" className="h-4 w-4" />
                  {copiedPaymentOption === "pix" ? "Copiado" : copiedPaymentOption === "pix-error" ? "Falhou" : "Copiar"}
                </button>
              </div>

              <div className="operator-payment-option">
                <div className="operator-payment-copy">
                  <strong>PDF da fatura</strong>
                  <span>{selectedRaw?.link ? "Disponivel para abrir e enviar" : "Nao disponivel"}</span>
                </div>
                {selectedRaw?.link ? (
                  <a href={selectedRaw.link} target="_blank" rel="noreferrer" className="operator-secondary-button inline-flex items-center gap-2 px-4 py-2 text-sm">
                    <OperatorIcon name="document" className="h-4 w-4" />
                    Abrir PDF
                  </a>
                ) : (
                  <button type="button" disabled className="operator-secondary-button inline-flex items-center gap-2 px-4 py-2 text-sm opacity-50">
                    <OperatorIcon name="document" className="h-4 w-4" />
                    Abrir PDF
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

function ServiceRow({ label, status }: { label: string; status: "online" | "atencao" }) {
  return (
    <div className="operator-service-row px-4 py-3">
      <span>{label}</span>
      <span className={status === "online" ? "font-semibold text-emerald-700" : "font-semibold text-amber-700"}>{status === "online" ? "Online" : "Atencao"}</span>
    </div>
  )
}

function Input(props: { value: string; onChange: (value: string) => void; placeholder: string; id?: string; type?: string; disabled?: boolean; onBlur?: () => void; onPaste?: (event: React.ClipboardEvent<HTMLInputElement>) => void }) {
  return (
    <input
      id={props.id}
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
      onBlur={props.onBlur}
      onPaste={props.onPaste}
      placeholder={props.placeholder}
      type={props.type || "text"}
      disabled={props.disabled}
      className="operator-input w-full px-3 py-3 text-sm disabled:opacity-60"
    />
  )
}

function Info({ icon, label, value, detail, compact = false, featured = false }: { icon: OperatorIconName; label: string; value: string; detail?: string; compact?: boolean; featured?: boolean }) {
  return (
    <div className={`operator-info-tile operator-info-tile-rich ${compact ? "operator-info-tile-compact" : ""} ${featured ? "operator-info-tile-featured" : ""}`}>
      <span className="operator-info-icon">
        <OperatorIcon name={icon} />
      </span>
      <span className="operator-info-copy">
        <span className="operator-info-label">{label}</span>
        <strong>{value}</strong>
        {detail ? <span className="operator-info-detail">{detail}</span> : null}
      </span>
    </div>
  )
}

function PowerInfo({ rx, tx }: { rx?: number | null; tx?: number | null }) {
  const hasBadSignal = typeof rx === "number" && rx < -25

  return (
    <div className={`operator-info-tile operator-info-tile-rich operator-info-tile-compact operator-power-tile ${hasBadSignal ? "operator-power-tile-danger" : ""}`}>
      <span className="operator-info-icon">
        <OperatorIcon name="transfer" />
      </span>
      <span className="operator-info-copy">
        <span className="operator-info-label">Sinal</span>
        <span className="operator-power-stack">
          <span className="operator-power-row">
            <span>RX:</span>
            <strong>{formatPower(rx)}</strong>
          </span>
          <span className="operator-power-row">
            <span>TX:</span>
            <strong>{formatPower(tx)}</strong>
          </span>
        </span>
      </span>
    </div>
  )
}

function statusClass(status: string) {
  if (status === "active") return "operator-status-pill operator-status-active"
  if (status === "olt_failed") return "operator-status-pill operator-status-danger"
  if (status === "inactive") return "operator-status-pill operator-status-muted"
  return "operator-status-pill operator-status-warning"
}
