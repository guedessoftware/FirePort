"use client"

import { Fragment, useEffect, useMemo, useState } from "react"
import { useSession } from "next-auth/react"
import Image from "next/image"
import Link from "next/link"
import { LoadingInline, LoadingOverlay, LoadingScreen } from "@/components/LoadingState"
import AdminContractsPanel from "@/components/admin/AdminContractsPanel"
import { formatCnpj, isValidCnpj, normalizeCnpj } from "@/lib/cnpj"
import { hardSignOut } from "@/lib/client-auth"

type MonitoringTab = "olt" | "onu" | "status" | "alerts"

type ManagedUser = {
  id: string
  email: string
  name: string
  role: string
  vlan?: number | null
  cnpj?: string | null
  hubsoftClientId?: string | null
  hubsoftClientUuid?: string | null
  hubsoftClientCode?: number | null
  hubsoftLegalName?: string | null
  hubsoftTradeName?: string | null
  hubsoftPrimaryPhone?: string | null
  hubsoftSecondaryPhone?: string | null
  hubsoftPrimaryEmail?: string | null
  hubsoftMunicipalRegistration?: string | null
  hubsoftStateRegistration?: string | null
  hubsoftRegisteredAt?: string | null
  hubsoftImportedAt?: string | null
  billingAccountId?: string | null
  hubsoftClientServiceId?: string | null
  hubsoftServiceName?: string | null
  minimumAmountCents?: number | null
  includedProvisionings?: number | null
  extraProvisioningAmountCents?: number | null
  dueDay?: number | null
  billingStatus?: string | null
  billingNotes?: string | null
  provisioningProfileCount?: number
  defaultProvisioningProfile?: { id: string; name: string; vlan?: number | null } | null
}

type UserContractView = {
  required: boolean
  accepted: boolean
  pending: boolean
  message: string
  contract: {
    acceptanceId?: string
    versionId: string
    title: string
    versionNumber: number
    contentHash: string
    acceptanceHash?: string | null
    acceptedAt?: string | null
    signatureMethod?: string | null
    ipAddress?: string | null
    bodyHtml: string
    bodyText?: string
  } | null
}

type HubsoftClientLookup = {
  idCliente: string
  codigoCliente: number | null
  legalName: string
  tradeName: string | null
  cnpj: string
  primaryPhone: string | null
  secondaryPhone: string | null
  primaryEmail: string | null
  municipalRegistration: string | null
  stateRegistration: string | null
  registeredAt: string | null
  services: Array<{
    idClienteServico: string
    name: string
    status: string | null
    statusPrefix: string | null
    login: string | null
    vlan: number | null
  }>
}

type Provisioning = {
  id: string
  status: string
  serial: string
  createdAt: string
  updatedAt: string
  signal?: number | null
  onuStatus?: string | null
  onuDistanceMeters?: number | null
  onuOnlineDuration?: string | null
  onuRxPower?: number | null
  onuTxPower?: number | null
  contract: {
    name: string
    contractNumber: string
    landlord?: { user?: { name?: string; email?: string } }
  }
  port: { number: number; cto: { name: string } }
  cpeModel: { name: string }
}

type ProvisioningLog = {
  id: string
  level: string
  stage: string
  message: string
  details?: Record<string, unknown> | null
  createdAt: string
}

type CtoStatus = {
  total: number
  synced: number
  failed: number
  missingInHubsoft: number
  auditItems: number
  lastSync?: string
}

type OnuMonitoringSettings = {
  enabled: boolean
  intervalMinutes: number
  lastRunAt: string | null
  lastFinishedAt: string | null
  lastActiveChecked: number
  lastSuccess: number
  lastFailed: number
  lastError: string | null
}

type OltMonitoringSettings = OnuMonitoringSettings & {
  trafficIntervalSeconds: number
}

type GenieAcsSettings = {
  enabled: boolean
  baseUrl: string
  authHeaderName: string
  authHeaderValueSet: boolean
  authHeaderValue?: string
  serialParameter: string
  wifiSsidParameter: string
  wifiPasswordParameter: string
  wifi5SsidParameter: string
  wifi5PasswordParameter: string
  hostsObjectPath: string
  connectionRequest: boolean
  connectionRequestTimeoutMs: number
  provisioningWaitSeconds: number
  lastConnectionStatus: string | null
  lastConnectionTestAt: string | null
  lastError: string | null
}

type ApplicationSettings = {
  applicationName: string
  companyName: string
  companyLegalName: string
  companyLogo: string | null
  companyLogoDark: string | null
  useCompanyLogo: boolean
  companyDocument: string
  supportEmail: string
  supportPhone: string
  websiteUrl: string
  address: string
  addressPostalCode: string
  city: string
  state: string
  description: string
  viabilityRadiusMeters: number
}

type NotificationTemplateStage = "late_warning" | "suspension_warning" | "financial_partial_block" | "financial_total_block"
type NotificationSettings = {
  emailEnabled: boolean
  smtpHost: string
  smtpPort: number
  smtpSecure: boolean
  smtpUser: string
  smtpPassword: string
  smtpPasswordSet: boolean
  smtpFromEmail: string
  smtpFromName: string
  whatsappEnabled: boolean
  whatsappGatewayUrl: string
  whatsappMethod: "POST" | "GET"
  whatsappToken: string
  whatsappTokenSet: boolean
  whatsappTokenHeader: string
  whatsappBodyTemplate: string
  maxAttempts: number
  templates: Record<NotificationTemplateStage, { emailSubject: string; message: string }>
}

type CtoAudit = {
  id: string
  ctoName: string
  action: string
  reason: string | null
  provisioningCount: number
  createdAt: string
}

type Cto = {
  id: string
  name: string
  address: string
  lat: number
  lng: number
  hubsoftId?: string | null
  hubsoftOltDeviceId?: string | null
  hubsoftOltInterfaceId?: string | null
  oltDeviceName?: string | null
  oltIpv4?: string | null
  oltInterfaceName?: string | null
  oltInterfaceType?: string | null
  oltInterfaceIdentifier?: string | null
  oltChassi?: number | null
  oltSlot?: number | null
  oltPon?: number | null
  oltVlan?: number | null
  oltInterfaceId?: string | null
  syncStatus?: string | null
  syncError?: string | null
  ports: { id: string; number: number; status: string; ctoId: string }[]
  oltInterface?: {
    id: string
    oltDeviceId: string
    name: string
    description?: string | null
    chassi: number
    slot: number
    pon: number
    vlan?: number | null
    oltDevice?: { id: string; name: string; host: string; ipv4?: string | null }
  } | null
}

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
  user?: { id: string; name?: string | null; email?: string | null }
}
type CpeModel = {
  id: string
  name: string
  description?: string | null
  provisioningCount?: number
  oltProfiles?: CpeModelOltProfile[]
}
type CpeModelOltProfile = {
  id?: string
  cpeModelId?: string
  oltManufacturer: string
  oltModel: string
  oltDriver: string
  onuType?: string | null
  authorizationCommands?: string | null
  provisioningCommands?: string | null
  deprovisioningCommands?: string | null
  deauthorizationCommands?: string | null
  tr069Commands?: string | null
  genieAcsParameterMapJson?: string | null
  requiredVariablesJson?: string | null
}
type OltDevice = {
  id: string
  hubsoftId?: string | null
  name: string
  manufacturer: string
  model: string
  pop?: string | null
  managementServer?: string | null
  host: string
  ipv4?: string | null
  ipv6?: string | null
  username: string
  port: number
  useEnableMode?: boolean
  driver: string
  profileId?: string | null
  terminalLengthCommand?: string | null
  enterConfigCommand?: string | null
  showOnuStateCommand?: string | null
  serialLookupCommand?: string | null
  rebootOnuCommand?: string | null
  saveConfigCommand?: string | null
  exitCommands?: string | null
  snmpEnabled: boolean
  snmpVersion: string
  snmpPort: number
  snmpVendor: string
  hasEnablePassword?: boolean
  hasSnmpCommunity?: boolean
  isDefault: boolean
  isActive: boolean
}
type OltInterface = {
  id: string
  oltDeviceId: string
  type: string
  name: string
  description?: string | null
  chassi: number
  slot: number
  pon: number
  vlan?: number | null
  routingInterface?: string | null
  defaultCpeProfileId?: string | null
  requireCtoLink: boolean
  blockOverutilization: boolean
  enableScan: boolean
  scanType?: string | null
  alarmSubscriberSignal?: number | null
  alarmEquipmentSignal?: number | null
  sequencePort?: number | null
  isActive: boolean
}

type OnuCurrent = {
  id: string
  oltId: string
  oltName: string
  oltHost: string
  porta: string
  ponIndex: number
  onuId: number
  statusCode: number | null
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

type OltProcessorCurrent = {
  processorIndex: string
  character: string
  role: string | null
  cpu5sPercent: number | null
  cpu1mPercent: number | null
  cpu5mPercent: number | null
  peakCpuPercent: number | null
  physicalMemMb: number | null
  freeMemMb: number | null
  memUsedPercent: number | null
}

type OltTemperatureCurrent = {
  sensorIndex: string
  board: string | null
  sensor: string | null
  statusCode: number | null
  statusName: string | null
  temperatureC: number | null
}

type OltUplinkCurrent = {
  ifIndex: number
  interfaceName: string
  operStatus: string
  rxMbps: number | null
  txMbps: number | null
  observation: string | null
}

type BillingSettings = {
  closingDay: number
  automaticClosingEnabled: boolean
  lastAutomaticClosingAt: string | null
  lastAutomaticClosingCompetence: string | null
  lastAutomaticClosingError: string | null
  defaultDueDay: number
  defaultMinimumAmountCents: number
  defaultIncludedProvisionings: number
  defaultExtraProvisioningAmountCents: number
  defaultBillingMethod: string
  defaultChargeType: string
  defaultInstallationFeeCents: number
  defaultInstallationInstallments: number
  defaultContractTermMonths: number
}

type BillingAccount = {
  id: string
  landlordId: string
  hubsoftClientServiceId: string | null
  hubsoftServiceName: string
  billingPlanId: string | null
  minimumAmountCents: number
  includedProvisionings: number
  extraProvisioningAmountCents: number
  dueDay: number
  firstActivationAt: string | null
  billingStartedAt: string | null
  status: string
  notes: string | null
  landlordName?: string
  userId?: string
  userName?: string
  userEmail?: string
  serviceCount?: number
  runCount?: number
  openAlertCount?: number
}

type BillingRun = {
  id: string
  competence: string
  billingAccountId: string
  hubsoftClientServiceId: string | null
  dueDay: number
  activeProvisioningCount: number
  includedProvisioningCount: number
  extraProvisioningCount: number
  minimumAmountCents: number
  extraAmountCents: number
  penaltyAmountCents: number
  totalAmountCents: number
  status: string
  idempotencyKey: string
  closingAt?: string
  landlordName?: string
  userName?: string
  userEmail?: string
  hubsoftEventStatus?: string | null
  itemCount?: number
  openAlertCount?: number
  createdAt?: string
}

type BillingPenalty = {
  id: string
  billingAccountId: string
  amountCents: number
  reason: string
  evidence: string | null
  status: string
  includedInBillingRunId?: string | null
  createdAt: string
  landlordName?: string
  userName?: string
  userEmail?: string
  includedCompetence?: string | null
}

type BillingAlert = {
  id: string
  billingAccountId: string | null
  billingRunId: string | null
  provisioningId: string | null
  type: string
  severity: string
  message: string
  details: string | null
  status: string
  createdAt: string
  landlordName?: string | null
  userName?: string | null
  userEmail?: string | null
  competence?: string | null
  provisioningSerial?: string | null
  provisioningStatus?: string | null
}

type BillingInvoice = {
  id: string
  billingAccountId: string
  billingRunId: string | null
  hubsoftInvoiceId: string | null
  hubsoftClientServiceId: string
  competence: string | null
  dueDate: string | null
  amountCents: number | null
  status: string | null
  rawPayload: string | null
  syncedAt: string
  createdAt: string
  landlordName?: string
  userName?: string
  userEmail?: string
}

type AccessControlItem = {
  billingAccountId: string
  landlordName?: string | null
  userId?: string | null
  userName?: string | null
  userEmail?: string | null
  state?: string | null
  financialState?: string | null
  administrativeBlockActive?: boolean | number | null
  administrativeBlockReason?: string | null
  confidenceReleaseUntil?: string | null
  overdueDays?: number | null
  lastEvaluatedAt?: string | null
  pendingAction?: string | null
  pendingError?: string | null
  pendingNotificationCount?: number | null
}

const accessBlockReasons = [
  "Falta de documentação",
  "Descumprimento de regras",
  "Bloqueio administrativo manual",
]

type OltMonitoringCurrent = {
  oltId: string
  oltName: string
  oltHost: string
  temperatureC: number | null
  processorCount: number
  maxCpu5sPercent: number | null
  maxCpu1mPercent: number | null
  maxCpu5mPercent: number | null
  maxMemUsedPercent: number | null
  sensorWarningCount: number
  sensorCriticalCount: number
  uplinkCount: number
  uplinkDownCount: number
  collectedAt: string
  processors: OltProcessorCurrent[]
  temperatures: OltTemperatureCurrent[]
  uplinks: OltUplinkCurrent[]
}

type OltMonitoringSummary = {
  total: number
  highCpu: number
  highMemory: number
  sensorAlerts: number
  uplinkDown: number
}

const statusLabels: Record<string, string> = {
  active: "Ativo",
  inactive: "Inativo",
  olt_pending: "Pendente OLT",
  olt_failed: "Falha OLT",
}

const onuPageSizeOptions = [10, 20, 50, 100, 500]

function isActiveHubsoftService(service?: HubsoftClientLookup["services"][number] | null) {
  const statusPrefix = String(service?.statusPrefix ?? "").trim().toLowerCase()
  const status = String(service?.status ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()

  return statusPrefix === "servico_habilitado" || status === "servico habilitado"
}

function selectActiveHubsoftService(client: HubsoftClientLookup | null) {
  return client?.services.find(isActiveHubsoftService) ?? null
}

function defaultUserCommercialRule(settings: BillingSettings | null) {
  return {
    minimumAmount: centsToMoneyInput(settings?.defaultMinimumAmountCents ?? 0),
    includedProvisionings: String(settings?.defaultIncludedProvisionings ?? 0),
    extraAmount: centsToMoneyInput(settings?.defaultExtraProvisioningAmountCents ?? 0),
    dueDay: String(settings?.defaultDueDay ?? 10),
  }
}

const defaultAuthorizationCommands = `conf t
interface gpon_olt-[[chassi]]/[[slot]]/[[pon]]
onu [[indice_onu]] type [[onu_type]] sn [[phy_addr]]
exit`

const defaultProvisioningCommands = `configure terminal
interface gpon_onu-[[chassi]]/[[slot]]/[[pon]]:[[indice_onu]]
tcont 1 profile 1G
gemport 1 tcont 1
gemport 2 tcont 1
exit
interface vport-[[chassi]]/[[slot]]/[[pon]].[[indice_onu]]:1
service-port 1 user-vlan 600 vlan [[vlan]]
exit
interface vport-[[chassi]]/[[slot]]/[[pon]].[[indice_onu]]:2
service-port 2 user-vlan 998 vlan 998
exit
pon-onu-mng gpon_onu-[[chassi]]/[[slot]]/[[pon]]:[[indice_onu]]
service 1 gemport 1 vlan 600
service 2 gemport 2 vlan 998
wan-ip 1 ipv4 mode dhcp vlan-profile 998 host 1
wan-ip 2 ipv4 mode pppoe username [[login]] password [[senha]] vlan-profile 600 host 2
wan-ip ipv4 ping-response enable traceroute-response enable
security-mgmt 1 ingress-type wan state enable mode forward protocol https web
tr069-mgmt 1 acs http://tr069.firecdn.com.br:7547 tag pri 0 vlan 998
exit
exit
write`

const defaultRemovalCommands = `configure terminal
interface gpon_olt-[[chassi]]/[[slot]]/[[pon]]
no onu [[indice_onu]]
exit
exit
write`

const defaultApplicationSettings: ApplicationSettings = {
  applicationName: "FirePort",
  companyName: "Empresa",
  companyLegalName: "",
  companyLogo: null,
  companyLogoDark: null,
  useCompanyLogo: false,
  companyDocument: "",
  supportEmail: "",
  supportPhone: "",
  websiteUrl: "",
  address: "",
  addressPostalCode: "",
  city: "",
  state: "",
  description: "Area do cliente",
  viabilityRadiusMeters: 150,
}
const defaultGenieAcsSettings: GenieAcsSettings = {
  enabled: false,
  baseUrl: "",
  authHeaderName: "Authorization",
  authHeaderValueSet: false,
  authHeaderValue: "",
  serialParameter: "InternetGatewayDevice.DeviceInfo.X_ZTE-COM_GPONSN",
  wifiSsidParameter: "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID",
  wifiPasswordParameter: "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.KeyPassphrase",
  wifi5SsidParameter: "InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.SSID",
  wifi5PasswordParameter: "InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.PreSharedKey.1.KeyPassphrase",
  hostsObjectPath: "InternetGatewayDevice.LANDevice.1.Hosts.Host",
  connectionRequest: true,
  connectionRequestTimeoutMs: 10000,
  provisioningWaitSeconds: 45,
  lastConnectionStatus: null,
  lastConnectionTestAt: null,
  lastError: null,
}
const notificationTemplateStages: { id: NotificationTemplateStage; label: string }[] = [
  { id: "late_warning", label: "3 dias - aviso" },
  { id: "suspension_warning", label: "5 dias - suspensão" },
  { id: "financial_partial_block", label: "10 dias - parcial" },
  { id: "financial_total_block", label: "15 dias - total" },
]
const defaultNotificationSettings: NotificationSettings = {
  emailEnabled: false,
  smtpHost: "",
  smtpPort: 587,
  smtpSecure: false,
  smtpUser: "",
  smtpPassword: "",
  smtpPasswordSet: false,
  smtpFromEmail: "",
  smtpFromName: "Fireport",
  whatsappEnabled: false,
  whatsappGatewayUrl: "",
  whatsappMethod: "POST",
  whatsappToken: "",
  whatsappTokenSet: false,
  whatsappTokenHeader: "Authorization",
  whatsappBodyTemplate: JSON.stringify({ phone: "{{telefone}}", message: "{{mensagem}}" }, null, 2),
  maxAttempts: 3,
  templates: {
    late_warning: {
      emailSubject: "{{empresa}} - aviso de atraso",
      message: "Olá {{cliente}}, identificamos {{dias_atraso}} dia(s) de atraso. Regularize suas faturas no portal {{portal_url}} para evitar bloqueios.",
    },
    suspension_warning: {
      emailSubject: "{{empresa}} - aviso de suspensão",
      message: "Olá {{cliente}}, sua conta está com {{dias_atraso}} dia(s) de atraso e poderá ser suspensa. Acesse {{portal_url}} para regularizar.",
    },
    financial_partial_block: {
      emailSubject: "{{empresa}} - bloqueio parcial aplicado",
      message: "Olá {{cliente}}, sua conta está com {{dias_atraso}} dia(s) de atraso. Novas alterações e provisionamentos estão bloqueados até a regularização.",
    },
    financial_total_block: {
      emailSubject: "{{empresa}} - suspensão total aplicada",
      message: "Olá {{cliente}}, sua conta está com {{dias_atraso}} dia(s) de atraso e o acesso foi suspenso. Faturas e suporte continuam disponíveis em {{portal_url}}.",
    },
  },
}

function defaultGenieAcsParameterMap() {
  return JSON.stringify({
    serialParameter: defaultGenieAcsSettings.serialParameter,
    wifiSsidParameter: defaultGenieAcsSettings.wifiSsidParameter,
    wifiPasswordParameter: defaultGenieAcsSettings.wifiPasswordParameter,
    wifi5SsidParameter: defaultGenieAcsSettings.wifi5SsidParameter,
    wifi5PasswordParameter: defaultGenieAcsSettings.wifi5PasswordParameter,
    hostsObjectPath: defaultGenieAcsSettings.hostsObjectPath,
    wifi24AssociatedDevicePath: "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.AssociatedDevice",
    wifi5AssociatedDevicePath: "InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.AssociatedDevice",
  }, null, 2)
}

function defaultRequiredVariables() {
  return JSON.stringify(["vlan", "chassi", "slot", "pon", "indice_onu", "phy_addr", "onu_type"], null, 2)
}

function createDefaultCpeModelProfile(modelName = ""): CpeModelOltProfile {
  return {
    oltManufacturer: "ZTE",
    oltModel: "C650",
    oltDriver: "zte-c650",
    onuType: modelName,
    authorizationCommands: defaultAuthorizationCommands,
    provisioningCommands: defaultProvisioningCommands,
    deprovisioningCommands: defaultRemovalCommands,
    deauthorizationCommands: "",
    tr069Commands: "",
    genieAcsParameterMapJson: defaultGenieAcsParameterMap(),
    requiredVariablesJson: defaultRequiredVariables(),
  }
}

function formatJsonText(value?: string | null, fallback = "") {
  if (!value) return fallback
  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return value
  }
}

function getCpeModelProfileSummary(model: CpeModel) {
  const firstProfile = model.oltProfiles?.[0]
  if (!firstProfile) return "Sem matriz OLT"
  const suffix = (model.oltProfiles?.length ?? 0) > 1 ? ` +${(model.oltProfiles?.length ?? 1) - 1}` : ""
  return `${firstProfile.oltManufacturer} ${firstProfile.oltModel} / ${firstProfile.oltDriver}${suffix}`
}

const defaultRebootOnuCommand = [
  "configure terminal",
  "pon-onu-mng gpon_onu-[[chassi]]/[[slot]]/[[pon]]:[[onu_id]]",
  "reboot",
  "yes",
].join("\n")

export default function AdminWorkspace() {
  const { data: session, status } = useSession()
  const [activeTab, setActiveTab] = useState("overview")
  const [adminTheme, setAdminTheme] = useState<"light" | "dark">("light")
  const [monitoringTab, setMonitoringTab] = useState<MonitoringTab>("olt")
  const [settingsTab, setSettingsTab] = useState<"application" | "monitoring" | "integrations" | "billing" | "notifications">("application")
  const [billingTab, setBillingTab] = useState<"dashboard" | "accounts" | "runs" | "invoices" | "penalties" | "alerts" | "access">("dashboard")
  const [infraTab, setInfraTab] = useState<"olts" | "ctos" | "models" | "profiles">("olts")
  const [oltEditTab, setOltEditTab] = useState<"dados" | "commands" | "interfaces">("dados")
  const [message, setMessage] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [provisionings, setProvisionings] = useState<Provisioning[]>([])
  const [provisioningLogs, setProvisioningLogs] = useState<ProvisioningLog[]>([])
  const [provisioningLogTitle, setProvisioningLogTitle] = useState("")
  const [showProvisioningLogModal, setShowProvisioningLogModal] = useState(false)
  const [ctoStatus, setCtoStatus] = useState<CtoStatus | null>(null)
  const [onuMonitoringSettings, setOnuMonitoringSettings] = useState<OnuMonitoringSettings | null>(null)
  const [oltMonitoringSettings, setOltMonitoringSettings] = useState<OltMonitoringSettings | null>(null)
  const [applicationSettings, setApplicationSettings] = useState<ApplicationSettings>(defaultApplicationSettings)
  const [applicationForm, setApplicationForm] = useState<ApplicationSettings>(defaultApplicationSettings)
  const [genieAcsSettings, setGenieAcsSettings] = useState<GenieAcsSettings>(defaultGenieAcsSettings)
  const [genieAcsForm, setGenieAcsForm] = useState<GenieAcsSettings>(defaultGenieAcsSettings)
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings>(defaultNotificationSettings)
  const [notificationForm, setNotificationForm] = useState<NotificationSettings>(defaultNotificationSettings)
  const [ctos, setCtos] = useState<Cto[]>([])
  const [ctoAudits, setCtoAudits] = useState<CtoAudit[]>([])
  const [oltDrivers, setOltDrivers] = useState<OltDriver[]>([])
  const [operatorProfiles, setOperatorProfiles] = useState<OperatorProfile[]>([])
  const [cpeModels, setCpeModels] = useState<CpeModel[]>([])
  const [oltDevices, setOltDevices] = useState<OltDevice[]>([])
  const [oltInterfaces, setOltInterfaces] = useState<OltInterface[]>([])
  const [onuCurrent, setOnuCurrent] = useState<OnuCurrent[]>([])
  const [onuSummary, setOnuSummary] = useState<OnuSummary>({ total: 0, online: 0, los: 0, offline: 0, dyingGasp: 0, warningSignal: 0, criticalSignal: 0 })
  const [oltMonitoringCurrent, setOltMonitoringCurrent] = useState<OltMonitoringCurrent[]>([])
  const [oltMonitoringSummary, setOltMonitoringSummary] = useState<OltMonitoringSummary>({ total: 0, highCpu: 0, highMemory: 0, sensorAlerts: 0, uplinkDown: 0 })
  const [billingSettings, setBillingSettings] = useState<BillingSettings | null>(null)
  const [billingAccounts, setBillingAccounts] = useState<BillingAccount[]>([])
  const [billingRuns, setBillingRuns] = useState<BillingRun[]>([])
  const [billingInvoices, setBillingInvoices] = useState<BillingInvoice[]>([])
  const [billingPenalties, setBillingPenalties] = useState<BillingPenalty[]>([])
  const [billingAlerts, setBillingAlerts] = useState<BillingAlert[]>([])
  const [accessControls, setAccessControls] = useState<AccessControlItem[]>([])
  const [billingClosingDay, setBillingClosingDay] = useState("25")
  const [billingAutomaticClosingEnabled, setBillingAutomaticClosingEnabled] = useState(false)
  const [billingDefaultDueDay, setBillingDefaultDueDay] = useState("10")
  const [billingDefaultMinimumAmount, setBillingDefaultMinimumAmount] = useState("")
  const [billingDefaultIncludedProvisionings, setBillingDefaultIncludedProvisionings] = useState("")
  const [billingDefaultExtraAmount, setBillingDefaultExtraAmount] = useState("")
  const [billingDefaultBillingMethod, setBillingDefaultBillingMethod] = useState("Boleto bancario")
  const [billingDefaultChargeType, setBillingDefaultChargeType] = useState("Mensalidade recorrente")
  const [billingDefaultInstallationFee, setBillingDefaultInstallationFee] = useState("")
  const [billingDefaultInstallationInstallments, setBillingDefaultInstallationInstallments] = useState("1")
  const [billingDefaultContractTermMonths, setBillingDefaultContractTermMonths] = useState("12")
  const [selectedBillingAccountId, setSelectedBillingAccountId] = useState("")
  const [billingHubsoftClientServiceId, setBillingHubsoftClientServiceId] = useState("")
  const [billingAccountMinimumAmount, setBillingAccountMinimumAmount] = useState("")
  const [billingAccountIncludedProvisionings, setBillingAccountIncludedProvisionings] = useState("")
  const [billingAccountExtraAmount, setBillingAccountExtraAmount] = useState("")
  const [billingAccountDueDay, setBillingAccountDueDay] = useState("")
  const [billingAccountStatus, setBillingAccountStatus] = useState("active")
  const [billingAccountNotes, setBillingAccountNotes] = useState("")
  const [billingRunYear, setBillingRunYear] = useState(String(new Date().getFullYear()))
  const [billingRunMonth, setBillingRunMonth] = useState(String(new Date().getMonth() + 1))
  const [penaltyBillingAccountId, setPenaltyBillingAccountId] = useState("")
  const [penaltyAmount, setPenaltyAmount] = useState("")
  const [penaltyReason, setPenaltyReason] = useState("")
  const [penaltyEvidence, setPenaltyEvidence] = useState("")
  const [onuStatusFilter, setOnuStatusFilter] = useState("")
  const [onuOltFilter, setOnuOltFilter] = useState("")
  const [onuPortFilter, setOnuPortFilter] = useState("")
  const [onuRxBelowFilter, setOnuRxBelowFilter] = useState("")
  const [onuPageSize, setOnuPageSize] = useState(10)
  const [onuCurrentPage, setOnuCurrentPage] = useState(1)

  const [userId, setUserId] = useState("")
  const [userName, setUserName] = useState("")
  const [userEmail, setUserEmail] = useState("")
  const [userPassword, setUserPassword] = useState("")
  const [userRole, setUserRole] = useState("landlord")
  const [userVlan, setUserVlan] = useState("")
  const [userCnpj, setUserCnpj] = useState("")
  const [userProvisioningProfileId, setUserProvisioningProfileId] = useState("")
  const [userHubsoftClientServiceId, setUserHubsoftClientServiceId] = useState("")
  const [userMinimumAmount, setUserMinimumAmount] = useState("")
  const [userIncludedProvisionings, setUserIncludedProvisionings] = useState("")
  const [userExtraAmount, setUserExtraAmount] = useState("")
  const [userDueDay, setUserDueDay] = useState("")
  const [userBillingStatus, setUserBillingStatus] = useState("active")
  const [userBillingNotes, setUserBillingNotes] = useState("")
  const [hubsoftLookup, setHubsoftLookup] = useState<HubsoftClientLookup | null>(null)
  const [isHubsoftLookupLoading, setIsHubsoftLookupLoading] = useState(false)
  const [showUserModal, setShowUserModal] = useState(false)
  const [userFormError, setUserFormError] = useState("")
  const [showUserContractModal, setShowUserContractModal] = useState(false)
  const [selectedUserContractUserId, setSelectedUserContractUserId] = useState("")
  const [selectedUserContractName, setSelectedUserContractName] = useState("")
  const [selectedUserContract, setSelectedUserContract] = useState<UserContractView | null>(null)
  const [showProfileModal, setShowProfileModal] = useState(false)
  const [showBillingAccountModal, setShowBillingAccountModal] = useState(false)
  const [showAccessBlockModal, setShowAccessBlockModal] = useState(false)
  const [cpeModelId, setCpeModelId] = useState("")
  const [cpeModelName, setCpeModelName] = useState("")
  const [cpeModelDescription, setCpeModelDescription] = useState("")
  const [cpeModelProfiles, setCpeModelProfiles] = useState<CpeModelOltProfile[]>([])
  const [selectedAccessBlockAccount, setSelectedAccessBlockAccount] = useState<AccessControlItem | null>(null)
  const [accessBlockReason, setAccessBlockReason] = useState(accessBlockReasons[0])
  const [accessBlockDetails, setAccessBlockDetails] = useState("")

  const [ctoId, setCtoId] = useState("")
  const [ctoSearch, setCtoSearch] = useState("")
  const [ctoName, setCtoName] = useState("")
  const [ctoAddress, setCtoAddress] = useState("")
  const [ctoLat, setCtoLat] = useState("")
  const [ctoLng, setCtoLng] = useState("")
  const [ctoOltDeviceId, setCtoOltDeviceId] = useState("")
  const [ctoOltInterfaceId, setCtoOltInterfaceId] = useState("")

  const [deviceId, setDeviceId] = useState("")
  const [deviceName, setDeviceName] = useState("ZTE 01")
  const [manufacturer, setManufacturer] = useState("ZTE")
  const [model, setModel] = useState("ZXA10 C610")
  const [pop, setPop] = useState("CENTRAL-POP1")
  const [managementServer, setManagementServer] = useState("Nenhum")
  const [host, setHost] = useState("")
  const [ipv4, setIpv4] = useState("")
  const [ipv6, setIpv6] = useState("")
  const [username, setUsername] = useState("")
  const [sshPort, setSshPort] = useState("22")
  const [sshPassword, setSshPassword] = useState("")
  const [enablePassword, setEnablePassword] = useState("")
  const [useEnableMode, setUseEnableMode] = useState(false)
  const [deviceDriver, setDeviceDriver] = useState("zte-c650")
  const [snmpEnabled, setSnmpEnabled] = useState(false)
  const [snmpVersion, setSnmpVersion] = useState("2c")
  const [snmpCommunity, setSnmpCommunity] = useState("")
  const [snmpPort, setSnmpPort] = useState("161")
  const [snmpVendor, setSnmpVendor] = useState("zte_titan")
  const [terminalLengthCommand, setTerminalLengthCommand] = useState("terminal length 0")
  const [enterConfigCommand, setEnterConfigCommand] = useState("conf t")
  const [showOnuStateCommand, setShowOnuStateCommand] = useState("show gpon onu state gpon_olt-[[chassi]]/[[slot]]/[[pon]]")
  const [serialLookupCommand, setSerialLookupCommand] = useState("show gpon onu by sn [[serial]]")
  const [rebootOnuCommand, setRebootOnuCommand] = useState(defaultRebootOnuCommand)
  const [saveConfigCommand, setSaveConfigCommand] = useState("write")
  const [exitCommands, setExitCommands] = useState("exit\nexit")
  const [deviceDefault, setDeviceDefault] = useState(true)
  const [deviceActive, setDeviceActive] = useState(true)

  const [profileId, setProfileId] = useState("")
  const [profileUserId, setProfileUserId] = useState("")
  const [profileName, setProfileName] = useState("ZTE C650 - padrao")
  const [profileDriver, setProfileDriver] = useState("zte-c650")
  const [profileVlan, setProfileVlan] = useState("")
  const [profileServiceVlan, setProfileServiceVlan] = useState("")
  const [profileLineProfile, setProfileLineProfile] = useState("")
  const [profileServiceProfile, setProfileServiceProfile] = useState("")
  const [profileGemPort, setProfileGemPort] = useState("1")
  const [profileTcont, setProfileTcont] = useState("1")
  const [profileServiceName, setProfileServiceName] = useState("internet")
  const [profileDefault, setProfileDefault] = useState(true)
  const [interfaceId, setInterfaceId] = useState("")
  const [interfaceType, setInterfaceType] = useState("GPON")
  const [interfaceName, setInterfaceName] = useState("")
  const [interfaceDescription, setInterfaceDescription] = useState("")
  const [interfaceChassi, setInterfaceChassi] = useState("1")
  const [interfaceSlot, setInterfaceSlot] = useState("1")
  const [interfacePon, setInterfacePon] = useState("1")
  const [interfaceVlan, setInterfaceVlan] = useState("")
  const [interfaceRouting, setInterfaceRouting] = useState("")
  const [interfaceRequireCto, setInterfaceRequireCto] = useState(false)
  const [interfaceBlockOveruse, setInterfaceBlockOveruse] = useState(false)
  const [interfaceEnableScan, setInterfaceEnableScan] = useState(true)
  const [interfaceScanType, setInterfaceScanType] = useState("Detalhado")
  const [interfaceAlarmSubscriber, setInterfaceAlarmSubscriber] = useState("-28")
  const [interfaceAlarmEquipment, setInterfaceAlarmEquipment] = useState("-28")
  const [interfaceSequence, setInterfaceSequence] = useState("")
  const [bulkChassiStart, setBulkChassiStart] = useState("1")
  const [bulkChassiEnd, setBulkChassiEnd] = useState("1")
  const [bulkSlotStart, setBulkSlotStart] = useState("1")
  const [bulkSlotEnd, setBulkSlotEnd] = useState("1")
  const [bulkPonStart, setBulkPonStart] = useState("1")
  const [bulkPonEnd, setBulkPonEnd] = useState("16")
  const [bulkVlanStart, setBulkVlanStart] = useState("")
  const [bulkVlanIncrement, setBulkVlanIncrement] = useState("0")
  const [bulkNamePrefix, setBulkNamePrefix] = useState("")
  const [showInterfaceModal, setShowInterfaceModal] = useState(false)
  const [showBulkInterfaceModal, setShowBulkInterfaceModal] = useState(false)
  const [showOnuStateModal, setShowOnuStateModal] = useState(false)
  const [onuStateTitle, setOnuStateTitle] = useState("")
  const [onuStateCommand, setOnuStateCommand] = useState("")
  const [onuStateOutput, setOnuStateOutput] = useState("")
  const [onuStateTotalPositions, setOnuStateTotalPositions] = useState(128)
  const [onuStateOccupiedPositions, setOnuStateOccupiedPositions] = useState<number[]>([])
  const [onuStateFreePositions, setOnuStateFreePositions] = useState<number[]>([])
  const [onuStateNextFreePosition, setOnuStateNextFreePosition] = useState<number | null>(null)
  const [onuMonitoringEnabled, setOnuMonitoringEnabled] = useState(true)
  const [onuMonitoringInterval, setOnuMonitoringInterval] = useState("5")
  const [oltMonitoringEnabled, setOltMonitoringEnabled] = useState(true)
  const [oltMonitoringInterval, setOltMonitoringInterval] = useState("5")
  const [oltTrafficInterval, setOltTrafficInterval] = useState("5")

  const sessionUser = session?.user as { id?: string; role?: string; mfaVerified?: boolean; requiresMfa?: boolean } | undefined
  const isAdmin = sessionUser?.role === "admin"
  const isMfaVerified = sessionUser?.mfaVerified === true
  const requiresMfa = sessionUser?.requiresMfa === true
  const activeAdminLogo = adminTheme === "dark"
    ? applicationSettings.companyLogoDark || applicationSettings.companyLogo
    : applicationSettings.companyLogo
  const currentUserId = sessionUser?.id
  const activeOlts = oltDevices.filter((item) => item.isActive)
  const onlineUplinkTotal = oltMonitoringCurrent.reduce((total, item) => total + item.uplinks.filter(isOnlineUplink).length, 0)
  const selectedDevice = oltDevices.find((item) => item.id === deviceId)
  const selectedCto = ctos.find((item) => item.id === ctoId)
  const selectedCtoOltInterfaces = oltInterfaces
    .filter((item) => item.oltDeviceId === ctoOltDeviceId && item.isActive)
    .sort((left, right) => left.chassi - right.chassi || left.slot - right.slot || left.pon - right.pon || (left.sequencePort ?? 0) - (right.sequencePort ?? 0))
  const selectedDeviceInterfaces = oltInterfaces.filter((item) => item.oltDeviceId === deviceId)
  const onuPortOptions = useMemo(() => Array.from(new Set(
    onuCurrent
      .filter((item) => !onuOltFilter || item.oltId === onuOltFilter)
      .map((item) => item.porta),
  )).sort(comparePortLabels), [onuCurrent, onuOltFilter])
  const filteredOnuCurrent = onuCurrent.filter((item) => {
    if (onuOltFilter && item.oltId !== onuOltFilter) return false
    if (onuPortFilter.trim() && item.porta !== onuPortFilter.trim()) return false
    if (onuStatusFilter && item.statusName !== onuStatusFilter) return false
    if (onuRxBelowFilter.trim()) {
      const threshold = Number(onuRxBelowFilter)
      if (!Number.isFinite(threshold) || item.rxDbm === null || item.rxDbm >= threshold) return false
    }
    return true
  })
  const onuTotalPages = Math.max(1, Math.ceil(filteredOnuCurrent.length / onuPageSize))
  const onuSafeCurrentPage = Math.min(onuCurrentPage, onuTotalPages)
  const onuPageStartIndex = (onuSafeCurrentPage - 1) * onuPageSize
  const paginatedOnuCurrent = filteredOnuCurrent.slice(onuPageStartIndex, onuPageStartIndex + onuPageSize)
  const onuPageStartItem = filteredOnuCurrent.length ? onuPageStartIndex + 1 : 0
  const onuPageEndItem = Math.min(onuPageStartIndex + paginatedOnuCurrent.length, filteredOnuCurrent.length)
  const filteredCtos = ctos.filter((cto) => {
    const query = ctoSearch.trim().toLowerCase()
    if (!query) return true

    const values = [
      cto.name,
      cto.address,
      cto.hubsoftId,
      cto.oltDeviceName,
      cto.oltIpv4,
      cto.oltInterfaceName,
      cto.oltInterfaceIdentifier,
      cto.oltInterface?.name,
      cto.oltInterface?.description,
      cto.oltInterface?.oltDevice?.name,
      cto.oltInterface ? `${cto.oltInterface.chassi}/${cto.oltInterface.slot}/${cto.oltInterface.pon}` : "",
      cto.oltChassi !== null && cto.oltChassi !== undefined && cto.oltSlot !== null && cto.oltSlot !== undefined && cto.oltPon !== null && cto.oltPon !== undefined
        ? `${cto.oltChassi}/${cto.oltSlot}/${cto.oltPon}`
        : "",
    ]

    return values.some((value) => String(value || "").toLowerCase().includes(query))
  })
  const groupedDeviceInterfaces = selectedDeviceInterfaces
    .slice()
    .sort((left, right) => left.chassi - right.chassi || left.slot - right.slot || left.pon - right.pon || (left.sequencePort ?? 0) - (right.sequencePort ?? 0))
    .reduce<Array<{ key: string; chassi: number; slot: number; items: OltInterface[] }>>((groups, item) => {
      const key = `${item.chassi}-${item.slot}`
      const group = groups.find((current) => current.key === key)
      if (group) {
        group.items.push(item)
      } else {
        groups.push({ key, chassi: item.chassi, slot: item.slot, items: [item] })
      }
      return groups
    }, [])
  const failedProvisionings = provisionings.filter((item) => item.status === "olt_failed")
  const pendingProvisionings = provisionings.filter((item) => item.status === "olt_pending")
  const neutralNetworkOperators = users.filter((user) => user.role !== "admin")
  const systemUsers = users.filter((user) => user.role === "admin")
  const operatorsWithoutProfiles = neutralNetworkOperators.filter((user) => !user.provisioningProfileCount)
  const alerts = [
    ...failedProvisionings.map((item) => `Provisionamento ${item.contract.contractNumber} falhou na OLT.`),
    ...pendingProvisionings.slice(0, 5).map((item) => `Provisionamento ${item.contract.contractNumber} pendente de OLT.`),
    ...operatorsWithoutProfiles.slice(0, 5).map((user) => `Operador ${user.name || user.email} sem perfil operacional.`),
    ...(activeOlts.length === 0 ? ["Nenhuma OLT ativa cadastrada."] : []),
    ...ctoAudits.slice(0, 3).map((item) => `${item.ctoName}: ${item.reason || item.action}`),
  ]
  const billingAccountsWithHubsoft = billingAccounts.filter((account) => account.hubsoftClientServiceId)
  const billingAccountsWithoutHubsoft = billingAccounts.filter((account) => !account.hubsoftClientServiceId)
  const billingReadyRuns = billingRuns.filter((run) => run.status === "ready")
  const billingFailedRuns = billingRuns.filter((run) => run.status === "failed")
  const billingOpenPenalties = billingPenalties.filter((penalty) => penalty.status === "approved")
  const billingOpenPenaltyAmountCents = billingOpenPenalties.reduce((total, penalty) => total + Number(penalty.amountCents || 0), 0)
  const billingOpenAlerts = billingAlerts.filter((alert) => alert.status === "open")
  const billingErrorAlerts = billingOpenAlerts.filter((alert) => alert.severity === "error")
  const billingCurrentRunTotalCents = billingRuns
    .slice(0, 5)
    .reduce((total, run) => total + Number(run.totalAmountCents || 0), 0)
  const billingOpenInvoices = billingInvoices.filter((invoice) => invoice.status === "open" || invoice.status === "overdue")
  const billingOpenInvoiceAmountCents = billingOpenInvoices.reduce((total, invoice) => total + Number(invoice.amountCents || 0), 0)
  const accessPendingControls = accessControls.filter((item) => item.pendingAction)
  const accessBlockedControls = accessControls.filter((item) => item.state && item.state !== "active_normal" && item.state !== "confidence_release")
  const accessAdministrativeBlocks = accessControls.filter((item) => Boolean(item.administrativeBlockActive))
  const accessConfidenceReleases = accessControls.filter((item) => item.state === "confidence_release")
  const accessNotificationQueueCount = accessControls.reduce((total, item) => total + Number(item.pendingNotificationCount || 0), 0)
  const accessControlForOperator = (user: ManagedUser): AccessControlItem | null => {
    const existing = accessControls.find((item) => item.userId === user.id || item.billingAccountId === user.billingAccountId)
    if (existing) return existing
    if (!user.billingAccountId) return null

    return {
      billingAccountId: user.billingAccountId,
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      state: "active_normal",
      financialState: "active_normal",
      administrativeBlockActive: false,
      administrativeBlockReason: null,
      confidenceReleaseUntil: null,
      overdueDays: 0,
      lastEvaluatedAt: null,
      pendingAction: null,
      pendingError: null,
      pendingNotificationCount: 0,
    }
  }

  const loadData = async () => {
    if (!isAdmin) return
    setIsLoading(true)
    try {
      const [usersRes, provRes, ctosRes, statusRes, auditsRes, profilesRes, cpeModelsRes, driversRes, devicesRes, interfacesRes, onuMonitoringRes, oltMonitoringRes, applicationSettingsRes, genieAcsSettingsRes, notificationSettingsRes, onuCurrentRes, oltCurrentRes, billingSettingsRes, billingAccountsRes, billingRunsRes, billingInvoicesRes, billingPenaltiesRes, billingAlertsRes, accessControlsRes] = await Promise.all([
        fetch("/api/users"),
        fetch("/api/provisionings"),
        fetch("/api/cto"),
        fetch("/api/cto/status"),
        fetch("/api/cto/audits"),
        fetch("/api/operator-profiles"),
        fetch("/api/cpemodels"),
        fetch("/api/olt/drivers"),
        fetch("/api/olt/devices"),
        fetch("/api/olt/interfaces"),
        fetch("/api/settings/onu-monitoring"),
        fetch("/api/settings/olt-monitoring"),
        fetch("/api/settings/application"),
        fetch("/api/settings/genieacs"),
        fetch("/api/settings/notifications"),
        fetch("/api/onu-monitoring/current"),
        fetch("/api/olt-monitoring/current"),
        fetch("/api/admin/billing/settings"),
        fetch("/api/admin/billing/accounts"),
        fetch("/api/admin/billing/runs"),
        fetch("/api/admin/billing/invoices"),
        fetch("/api/admin/billing/penalties"),
        fetch("/api/admin/billing/alerts"),
        fetch("/api/admin/access-control"),
      ])

      setUsers(usersRes.ok ? await usersRes.json() : [])
      const provisioningData = provRes.ok ? await provRes.json() as Provisioning[] : []
      setProvisionings(provisioningData.sort((left, right) =>
        new Date(right.updatedAt || right.createdAt).getTime() - new Date(left.updatedAt || left.createdAt).getTime()
      ))
      setCtos(ctosRes.ok ? await ctosRes.json() : [])
      setCtoStatus(statusRes.ok ? await statusRes.json() : null)
      setCtoAudits(auditsRes.ok ? (await auditsRes.json()).audits ?? [] : [])
      setOperatorProfiles(profilesRes.ok ? await profilesRes.json() : [])
      setCpeModels(cpeModelsRes.ok ? await cpeModelsRes.json() : [])
      setOltDrivers(driversRes.ok ? (await driversRes.json()).drivers ?? [] : [])
      setOltDevices(devicesRes.ok ? await devicesRes.json() : [])
      setOltInterfaces(interfacesRes.ok ? await interfacesRes.json() : [])
      const monitoringSettings = onuMonitoringRes.ok ? await onuMonitoringRes.json() as OnuMonitoringSettings : null
      setOnuMonitoringSettings(monitoringSettings)
      if (monitoringSettings) {
        setOnuMonitoringEnabled(monitoringSettings.enabled)
        setOnuMonitoringInterval(String(monitoringSettings.intervalMinutes))
      }
      const oltSettings = oltMonitoringRes.ok ? await oltMonitoringRes.json() as OltMonitoringSettings : null
      setOltMonitoringSettings(oltSettings)
      if (oltSettings) {
        setOltMonitoringEnabled(oltSettings.enabled)
        setOltMonitoringInterval(String(oltSettings.intervalMinutes))
        setOltTrafficInterval(String(oltSettings.trafficIntervalSeconds))
      }
      const nextApplicationSettings = applicationSettingsRes.ok ? await applicationSettingsRes.json() as ApplicationSettings : defaultApplicationSettings
      setApplicationSettings(nextApplicationSettings)
      setApplicationForm(nextApplicationSettings)
      const nextGenieAcsSettings = genieAcsSettingsRes.ok ? await genieAcsSettingsRes.json() as GenieAcsSettings : defaultGenieAcsSettings
      setGenieAcsSettings({ ...nextGenieAcsSettings, authHeaderValue: "" })
      setGenieAcsForm({ ...nextGenieAcsSettings, authHeaderValue: "" })
      const nextNotificationSettings = notificationSettingsRes.ok ? await notificationSettingsRes.json() as NotificationSettings : defaultNotificationSettings
      setNotificationSettings(nextNotificationSettings)
      setNotificationForm(nextNotificationSettings)
      const onuCurrentData = onuCurrentRes.ok ? await onuCurrentRes.json() as { summary?: OnuSummary; items?: OnuCurrent[] } : null
      setOnuSummary(onuCurrentData?.summary ?? { total: 0, online: 0, los: 0, offline: 0, dyingGasp: 0, warningSignal: 0, criticalSignal: 0 })
      setOnuCurrent(onuCurrentData?.items ?? [])
      const oltCurrentData = oltCurrentRes.ok ? await oltCurrentRes.json() as { summary?: OltMonitoringSummary; items?: OltMonitoringCurrent[] } : null
      setOltMonitoringSummary(oltCurrentData?.summary ?? { total: 0, highCpu: 0, highMemory: 0, sensorAlerts: 0, uplinkDown: 0 })
      setOltMonitoringCurrent(oltCurrentData?.items ?? [])
      const nextBillingSettings = billingSettingsRes.ok ? await billingSettingsRes.json() as BillingSettings : null
      setBillingSettings(nextBillingSettings)
      if (nextBillingSettings) {
        setBillingClosingDay(String(nextBillingSettings.closingDay))
        setBillingAutomaticClosingEnabled(nextBillingSettings.automaticClosingEnabled)
        setBillingDefaultDueDay(String(nextBillingSettings.defaultDueDay))
        setBillingDefaultMinimumAmount(centsToMoneyInput(nextBillingSettings.defaultMinimumAmountCents))
        setBillingDefaultIncludedProvisionings(String(nextBillingSettings.defaultIncludedProvisionings))
        setBillingDefaultExtraAmount(centsToMoneyInput(nextBillingSettings.defaultExtraProvisioningAmountCents))
        setBillingDefaultBillingMethod(nextBillingSettings.defaultBillingMethod)
        setBillingDefaultChargeType(nextBillingSettings.defaultChargeType)
        setBillingDefaultInstallationFee(centsToMoneyInput(nextBillingSettings.defaultInstallationFeeCents))
        setBillingDefaultInstallationInstallments(String(nextBillingSettings.defaultInstallationInstallments))
        setBillingDefaultContractTermMonths(String(nextBillingSettings.defaultContractTermMonths))
      }
      const nextBillingAccounts = billingAccountsRes.ok ? await billingAccountsRes.json() as BillingAccount[] : []
      setBillingAccounts(nextBillingAccounts)
      setBillingRuns(billingRunsRes.ok ? await billingRunsRes.json() : [])
      setBillingInvoices(billingInvoicesRes.ok ? await billingInvoicesRes.json() : [])
      setBillingPenalties(billingPenaltiesRes.ok ? await billingPenaltiesRes.json() : [])
      setBillingAlerts(billingAlertsRes.ok ? await billingAlertsRes.json() : [])
      setAccessControls(accessControlsRes.ok ? await accessControlsRes.json() : [])
      if (nextBillingAccounts.length && !selectedBillingAccountId) {
        selectBillingAccount(nextBillingAccounts[0])
      }
    } catch {
      setMessage("Nao foi possivel carregar a area administrativa.")
    } finally {
      setIsLoading(false)
    }
  }

  const refreshMonitoringData = async () => {
    if (!isAdmin) return

    try {
      const [onuMonitoringRes, oltMonitoringRes, onuCurrentRes, oltCurrentRes] = await Promise.all([
        fetch("/api/settings/onu-monitoring"),
        fetch("/api/settings/olt-monitoring"),
        fetch("/api/onu-monitoring/current"),
        fetch("/api/olt-monitoring/current"),
      ])

      const monitoringSettings = onuMonitoringRes.ok ? await onuMonitoringRes.json() as OnuMonitoringSettings : null
      if (monitoringSettings) {
        setOnuMonitoringSettings(monitoringSettings)
      }

      const oltSettings = oltMonitoringRes.ok ? await oltMonitoringRes.json() as OltMonitoringSettings : null
      if (oltSettings) {
        setOltMonitoringSettings(oltSettings)
      }

      const onuCurrentData = onuCurrentRes.ok ? await onuCurrentRes.json() as { summary?: OnuSummary; items?: OnuCurrent[] } : null
      if (onuCurrentData) {
        setOnuSummary(onuCurrentData.summary ?? { total: 0, online: 0, los: 0, offline: 0, dyingGasp: 0, warningSignal: 0, criticalSignal: 0 })
        setOnuCurrent(onuCurrentData.items ?? [])
      }

      const oltCurrentData = oltCurrentRes.ok ? await oltCurrentRes.json() as { summary?: OltMonitoringSummary; items?: OltMonitoringCurrent[] } : null
      if (oltCurrentData) {
        setOltMonitoringSummary(oltCurrentData.summary ?? { total: 0, highCpu: 0, highMemory: 0, sensorAlerts: 0, uplinkDown: 0 })
        setOltMonitoringCurrent(oltCurrentData.items ?? [])
      }
    } catch (error) {
      console.error('[ADMIN MONITORING] erro ao atualizar dados de monitoramento', error)
    }
  }

  const refreshBillingData = async () => {
    if (!isAdmin) return

    const [settingsRes, accountsRes, runsRes, invoicesRes, penaltiesRes, alertsRes, accessControlsRes] = await Promise.all([
      fetch("/api/admin/billing/settings"),
      fetch("/api/admin/billing/accounts"),
      fetch("/api/admin/billing/runs"),
      fetch("/api/admin/billing/invoices"),
      fetch("/api/admin/billing/penalties"),
      fetch("/api/admin/billing/alerts"),
      fetch("/api/admin/access-control"),
    ])
    const nextSettings = settingsRes.ok ? await settingsRes.json() as BillingSettings : null
    const nextAccounts = accountsRes.ok ? await accountsRes.json() as BillingAccount[] : []

    setBillingSettings(nextSettings)
    if (nextSettings) {
      setBillingClosingDay(String(nextSettings.closingDay))
      setBillingAutomaticClosingEnabled(nextSettings.automaticClosingEnabled)
      setBillingDefaultDueDay(String(nextSettings.defaultDueDay))
      setBillingDefaultMinimumAmount(centsToMoneyInput(nextSettings.defaultMinimumAmountCents))
      setBillingDefaultIncludedProvisionings(String(nextSettings.defaultIncludedProvisionings))
      setBillingDefaultExtraAmount(centsToMoneyInput(nextSettings.defaultExtraProvisioningAmountCents))
      setBillingDefaultBillingMethod(nextSettings.defaultBillingMethod)
      setBillingDefaultChargeType(nextSettings.defaultChargeType)
      setBillingDefaultInstallationFee(centsToMoneyInput(nextSettings.defaultInstallationFeeCents))
      setBillingDefaultInstallationInstallments(String(nextSettings.defaultInstallationInstallments))
      setBillingDefaultContractTermMonths(String(nextSettings.defaultContractTermMonths))
    }
    setBillingAccounts(nextAccounts)
    setBillingRuns(runsRes.ok ? await runsRes.json() : [])
    setBillingInvoices(invoicesRes.ok ? await invoicesRes.json() : [])
    setBillingPenalties(penaltiesRes.ok ? await penaltiesRes.json() : [])
    setBillingAlerts(alertsRes.ok ? await alertsRes.json() : [])
    setAccessControls(accessControlsRes.ok ? await accessControlsRes.json() : [])

    const selected = nextAccounts.find((account) => account.id === selectedBillingAccountId)
    if (selected) {
      selectBillingAccount(selected)
    } else if (nextAccounts[0]) {
      selectBillingAccount(nextAccounts[0])
    }
  }

  const selectBillingAccount = (account: BillingAccount) => {
    setSelectedBillingAccountId(account.id)
    setBillingHubsoftClientServiceId(account.hubsoftClientServiceId || "")
    setBillingAccountMinimumAmount(centsToMoneyInput(account.minimumAmountCents))
    setBillingAccountIncludedProvisionings(String(account.includedProvisionings))
    setBillingAccountExtraAmount(centsToMoneyInput(account.extraProvisioningAmountCents))
    setBillingAccountDueDay(String(account.dueDay))
    setBillingAccountStatus(account.status || "active")
    setBillingAccountNotes(account.notes || "")
    setPenaltyBillingAccountId(account.id)
  }

  const openBillingAccountModal = (account: BillingAccount) => {
    selectBillingAccount(account)
    setShowBillingAccountModal(true)
  }

  const saveBillingSettings = async () => {
    setIsLoading(true)
    setMessage("")
    try {
      const response = await fetch("/api/admin/billing/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          closingDay: Number(billingClosingDay),
          automaticClosingEnabled: billingAutomaticClosingEnabled,
          defaultDueDay: Number(billingDefaultDueDay),
          defaultMinimumAmountCents: moneyInputToCents(billingDefaultMinimumAmount),
          defaultIncludedProvisionings: Number(billingDefaultIncludedProvisionings || 0),
          defaultExtraProvisioningAmountCents: moneyInputToCents(billingDefaultExtraAmount),
          defaultBillingMethod: billingDefaultBillingMethod,
          defaultChargeType: billingDefaultChargeType,
          defaultInstallationFeeCents: moneyInputToCents(billingDefaultInstallationFee),
          defaultInstallationInstallments: Number(billingDefaultInstallationInstallments || 1),
          defaultContractTermMonths: Number(billingDefaultContractTermMonths || 12),
        }),
      })
      const body = await response.json().catch(() => ({ error: "Erro ao salvar financeiro." }))
      if (!response.ok) throw new Error(body.error || "Erro ao salvar financeiro.")
      setBillingSettings(body)
      setMessage("Configuracoes financeiras atualizadas.")
      await refreshBillingData()
    } catch (error) {
      setMessage((error as Error).message || "Erro ao salvar financeiro.")
    } finally {
      setIsLoading(false)
    }
  }

  const saveBillingAccount = async () => {
    if (!selectedBillingAccountId) {
      setMessage("Selecione uma conta financeira.")
      return
    }

    setIsLoading(true)
    setMessage("")
    try {
      const response = await fetch(`/api/admin/billing/accounts/${selectedBillingAccountId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hubsoftClientServiceId: billingHubsoftClientServiceId,
          minimumAmountCents: moneyInputToCents(billingAccountMinimumAmount),
          includedProvisionings: Number(billingAccountIncludedProvisionings || 0),
          extraProvisioningAmountCents: moneyInputToCents(billingAccountExtraAmount),
          dueDay: Number(billingAccountDueDay),
          status: billingAccountStatus,
          notes: billingAccountNotes,
        }),
      })
      const body = await response.json().catch(() => ({ error: "Erro ao salvar conta financeira." }))
      if (!response.ok) throw new Error(body.error || "Erro ao salvar conta financeira.")
      setMessage("Conta financeira atualizada.")
      setShowBillingAccountModal(false)
      await refreshBillingData()
    } catch (error) {
      setMessage((error as Error).message || "Erro ao salvar conta financeira.")
    } finally {
      setIsLoading(false)
    }
  }

  const generateBillingRun = async () => {
    setIsLoading(true)
    setMessage("")
    try {
      const response = await fetch("/api/admin/billing/runs/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year: Number(billingRunYear),
          month: Number(billingRunMonth),
        }),
      })
      const body = await response.json().catch(() => ({ error: "Erro ao gerar fechamento." }))
      if (!response.ok) throw new Error(body.error || "Erro ao gerar fechamento.")
      setMessage(`Fechamento gerado: ${body.runsCreatedOrExisting ?? 0} operador(es) com cobranca.`)
      await refreshBillingData()
    } catch (error) {
      setMessage((error as Error).message || "Erro ao gerar fechamento.")
    } finally {
      setIsLoading(false)
    }
  }

  const syncBillingInvoices = async () => {
    setIsLoading(true)
    setMessage("")
    try {
      const response = await fetch("/api/admin/billing/invoices/sync", { method: "POST" })
      const body = await response.json().catch(() => ({ error: "Erro ao sincronizar faturas." }))
      if (!response.ok) throw new Error(body.error || "Erro ao sincronizar faturas.")
      setMessage(`Faturas sincronizadas: ${body.invoices ?? 0} em ${body.accounts ?? 0} operador(es).`)
      await refreshBillingData()
    } catch (error) {
      setMessage((error as Error).message || "Erro ao sincronizar faturas.")
    } finally {
      setIsLoading(false)
    }
  }

  const createBillingPenalty = async () => {
    if (!penaltyBillingAccountId || !penaltyReason.trim()) {
      setMessage("Selecione o operador e informe o motivo da multa.")
      return
    }

    setIsLoading(true)
    setMessage("")
    try {
      const response = await fetch("/api/admin/billing/penalties", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          billingAccountId: penaltyBillingAccountId,
          amountCents: moneyInputToCents(penaltyAmount),
          reason: penaltyReason,
          evidence: penaltyEvidence,
        }),
      })
      const body = await response.json().catch(() => ({ error: "Erro ao criar multa." }))
      if (!response.ok) throw new Error(body.error || "Erro ao criar multa.")
      setPenaltyAmount("")
      setPenaltyReason("")
      setPenaltyEvidence("")
      setMessage("Multa registrada para o proximo fechamento.")
      await refreshBillingData()
    } catch (error) {
      setMessage((error as Error).message || "Erro ao criar multa.")
    } finally {
      setIsLoading(false)
    }
  }

  const resolveFinancialAlert = async (alert: BillingAlert) => {
    setIsLoading(true)
    setMessage("")
    try {
      const response = await fetch(`/api/admin/billing/alerts/${alert.id}/resolve`, {
        method: "POST",
      })
      const body = await response.json().catch(() => ({ error: "Erro ao resolver alerta." }))
      if (!response.ok) throw new Error(body.error || "Erro ao resolver alerta.")
      setMessage("Alerta financeiro resolvido.")
      await refreshBillingData()
    } catch (error) {
      setMessage((error as Error).message || "Erro ao resolver alerta.")
    } finally {
      setIsLoading(false)
    }
  }

  const evaluateAccessControls = async ({ sendNotifications = false }: { sendNotifications?: boolean } = {}) => {
    setIsLoading(true)
    setMessage("")
    try {
      const response = await fetch("/api/admin/access-control/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ syncHubsoft: true, sendNotifications }),
      })
      const body = await response.json().catch(() => ({ error: "Falha ao reavaliar controle de acesso." }))
      if (!response.ok) throw new Error(body.error || "Falha ao reavaliar controle de acesso.")
      const notificationText = sendNotifications ? " Avisos da regua foram enfileirados." : ""
      setMessage(`Controle de acesso reavaliado: ${body.accounts ?? 0} conta${body.accounts === 1 ? "" : "s"}.${notificationText}`)
      await refreshBillingData()
    } catch (error) {
      setMessage((error as Error).message || "Erro ao reavaliar controle de acesso.")
    } finally {
      setIsLoading(false)
    }
  }

  const applyAdministrativeBlock = async (account: AccessControlItem) => {
    setSelectedAccessBlockAccount(account)
    setAccessBlockReason(
      account.administrativeBlockReason && accessBlockReasons.includes(account.administrativeBlockReason)
        ? account.administrativeBlockReason
        : accessBlockReasons[0],
    )
    setAccessBlockDetails("")
    setShowAccessBlockModal(true)
  }

  const executeAdministrativeBlock = async () => {
    const account = selectedAccessBlockAccount
    if (!account) return

    setIsLoading(true)
    setMessage("")
    try {
      const response = await fetch(`/api/admin/access-control/${account.billingAccountId}/administrative-block`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          active: true,
          reason: accessBlockReason,
          details: accessBlockDetails.trim() || null,
        }),
      })
      const body = await response.json().catch(() => ({ error: "Falha ao aplicar bloqueio administrativo." }))
      if (!response.ok) throw new Error(body.error || "Falha ao aplicar bloqueio administrativo.")
      setMessage("Bloqueio manual parcial aplicado.")
      setShowAccessBlockModal(false)
      setSelectedAccessBlockAccount(null)
      await refreshBillingData()
    } catch (error) {
      setMessage((error as Error).message || "Erro ao aplicar bloqueio administrativo.")
    } finally {
      setIsLoading(false)
    }
  }

  const removeAdministrativeBlock = async (account: AccessControlItem) => {
    if (!window.confirm(`Remover bloqueio manual de ${account.userName || account.landlordName || account.userEmail || "operador"}?`)) return
    setIsLoading(true)
    setMessage("")
    try {
      const response = await fetch(`/api/admin/access-control/${account.billingAccountId}/administrative-block`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: false, reason: "Remocao manual" }),
      })
      const body = await response.json().catch(() => ({ error: "Falha ao remover bloqueio administrativo." }))
      if (!response.ok) throw new Error(body.error || "Falha ao remover bloqueio administrativo.")
      setMessage("Bloqueio manual removido.")
      await refreshBillingData()
    } catch (error) {
      setMessage((error as Error).message || "Erro ao remover bloqueio administrativo.")
    } finally {
      setIsLoading(false)
    }
  }

  const grantAccessConfidence = async (account: AccessControlItem) => {
    if (!window.confirm(`Conceder liberacao em confianca por 3 dias para ${account.userName || account.landlordName || account.userEmail || "operador"}?`)) return
    setIsLoading(true)
    setMessage("")
    try {
      const response = await fetch(`/api/admin/access-control/${account.billingAccountId}/confidence-release`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Liberacao em confianca manual" }),
      })
      const body = await response.json().catch(() => ({ error: "Falha ao conceder confianca." }))
      if (!response.ok) throw new Error(body.error || "Falha ao conceder confianca.")
      setMessage("Liberacao em confianca concedida por 3 dias.")
      await refreshBillingData()
    } catch (error) {
      setMessage((error as Error).message || "Erro ao conceder liberacao em confianca.")
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const storedTheme = window.localStorage.getItem("admin-theme")
      if (storedTheme === "light" || storedTheme === "dark") {
        setAdminTheme(storedTheme)
        return
      }

      if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
        setAdminTheme("dark")
      }
    }, 0)

    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (status !== "authenticated" || !isAdmin || !isMfaVerified) return

    const timer = window.setTimeout(() => {
      void loadData()
    }, 0)

    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, isAdmin, isMfaVerified])

  useEffect(() => {
    if (status !== "authenticated" || !isAdmin || !isMfaVerified) return

    const timer = window.setInterval(() => {
      void refreshMonitoringData()
    }, 30_000)

    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, isAdmin, isMfaVerified])

  const applyOperatorProfileToForm = (profile: OperatorProfile | null, user?: ManagedUser) => {
    setProfileId(profile?.id || "")
    setProfileUserId(user?.id || profile?.userId || "")
    setProfileName(profile?.name || `${user?.name || user?.email || "Operador"} - operacional`)
    setProfileDriver(profile?.driver || "zte-c650")
    setProfileVlan(profile?.vlan ? String(profile.vlan) : (user?.vlan ? String(user.vlan) : ""))
    setProfileServiceVlan(profile?.serviceVlan ? String(profile.serviceVlan) : "")
    setProfileLineProfile(profile?.lineProfile || "")
    setProfileServiceProfile(profile?.serviceProfile || "")
    setProfileGemPort(profile?.gemPort ? String(profile.gemPort) : "1")
    setProfileTcont(profile?.tcont ? String(profile.tcont) : "1")
    setProfileServiceName(profile?.serviceName || "internet")
    setProfileDefault(profile?.isDefault ?? true)
  }

  const findUserDefaultProfile = (user: ManagedUser) => (
    operatorProfiles.find((profile) => profile.id === user.defaultProvisioningProfile?.id)
    || operatorProfiles.find((profile) => profile.userId === user.id && profile.isDefault)
    || operatorProfiles.find((profile) => profile.userId === user.id)
    || null
  )

  const loadUserProfileTemplate = (profileId: string) => {
    setUserProvisioningProfileId(profileId)
    const profile = operatorProfiles.find((item) => item.id === profileId) || null
    if (profile) {
      applyOperatorProfileToForm(profile, users.find((user) => user.id === userId))
      setUserVlan(profile.vlan ? String(profile.vlan) : "")
    } else {
      applyOperatorProfileToForm(null, users.find((user) => user.id === userId))
    }
  }

  const resetUserForm = () => {
    const defaults = defaultUserCommercialRule(billingSettings)
    setUserId("")
    setUserName("")
    setUserEmail("")
    setUserPassword("")
    setUserRole("landlord")
    setUserVlan("")
    setUserCnpj("")
    setUserProvisioningProfileId("")
    setUserHubsoftClientServiceId("")
    setUserMinimumAmount(defaults.minimumAmount)
    setUserIncludedProvisionings(defaults.includedProvisionings)
    setUserExtraAmount(defaults.extraAmount)
    setUserDueDay(defaults.dueDay)
    setUserBillingStatus("active")
    setUserBillingNotes("")
    setHubsoftLookup(null)
    setUserFormError("")
    applyOperatorProfileToForm(null)
  }

  const openNewUserModal = () => {
    resetUserForm()
    setUserFormError("")
    setShowUserModal(true)
  }

  const closeUserModal = () => {
    resetUserForm()
    setUserFormError("")
    setShowUserModal(false)
  }

  const selectUser = (user: ManagedUser) => {
    const defaults = defaultUserCommercialRule(billingSettings)
    setUserId(user.id)
    setUserName(user.name)
    setUserEmail(user.email)
    setUserPassword("")
    setUserRole(user.role)
    setUserVlan(user.vlan ? String(user.vlan) : "")
    setUserCnpj(user.cnpj ? formatCnpj(user.cnpj) : "")
    const defaultProfile = findUserDefaultProfile(user)
    setUserProvisioningProfileId(defaultProfile?.id || user.defaultProvisioningProfile?.id || "")
    applyOperatorProfileToForm(defaultProfile, user)
    setUserHubsoftClientServiceId(user.hubsoftClientServiceId || "")
    setUserMinimumAmount(centsToMoneyInput(user.minimumAmountCents ?? moneyInputToCents(defaults.minimumAmount)))
    setUserIncludedProvisionings(String(user.includedProvisionings ?? defaults.includedProvisionings))
    setUserExtraAmount(centsToMoneyInput(user.extraProvisioningAmountCents ?? moneyInputToCents(defaults.extraAmount)))
    setUserDueDay(String(user.dueDay ?? defaults.dueDay))
    setUserBillingStatus(user.billingStatus || "active")
    setUserBillingNotes(user.billingNotes || "")
    setUserFormError("")
    setHubsoftLookup(user.hubsoftClientId ? {
      idCliente: user.hubsoftClientId,
      codigoCliente: user.hubsoftClientCode ?? null,
      legalName: user.hubsoftLegalName || user.name,
      tradeName: user.hubsoftTradeName ?? null,
      cnpj: user.cnpj || "",
      primaryPhone: user.hubsoftPrimaryPhone ?? null,
      secondaryPhone: user.hubsoftSecondaryPhone ?? null,
      primaryEmail: user.hubsoftPrimaryEmail ?? user.email,
      municipalRegistration: user.hubsoftMunicipalRegistration ?? null,
      stateRegistration: user.hubsoftStateRegistration ?? null,
      registeredAt: user.hubsoftRegisteredAt ?? null,
      services: user.hubsoftClientServiceId ? [{
        idClienteServico: user.hubsoftClientServiceId,
        name: user.hubsoftServiceName || "Servico Hubsoft",
        status: null,
        statusPrefix: null,
        login: null,
        vlan: user.vlan ?? null,
      }] : [],
    } : null)
    setShowUserModal(true)
  }

  const openUserContract = async (user: ManagedUser) => {
    setIsLoading(true)
    setMessage("")
    setSelectedUserContractUserId(user.id)
    setSelectedUserContractName(user.name || user.email)
    try {
      const response = await fetch(`/api/admin/contracts/users/${user.id}`, { cache: "no-store" })
      const body = await response.json().catch(() => ({ error: "Nao foi possivel consultar o contrato." }))
      if (!response.ok) throw new Error(body.error || "Nao foi possivel consultar o contrato.")
      setSelectedUserContract(body as UserContractView)
      setShowUserContractModal(true)
    } catch (error) {
      setMessage((error as Error).message || "Nao foi possivel consultar o contrato.")
    } finally {
      setIsLoading(false)
    }
  }

  const resetCtoForm = () => {
    setCtoId("")
    setCtoName("")
    setCtoAddress("")
    setCtoLat("")
    setCtoLng("")
    setCtoOltDeviceId("")
    setCtoOltInterfaceId("")
  }

  const selectCto = (cto: Cto) => {
    const linkedInterface = cto.oltInterfaceId
      ? oltInterfaces.find((item) => item.id === cto.oltInterfaceId)
      : null
    const importedInterface = !linkedInterface && cto.oltChassi !== null && cto.oltChassi !== undefined && cto.oltSlot !== null && cto.oltSlot !== undefined && cto.oltPon !== null && cto.oltPon !== undefined
      ? oltInterfaces.find((item) => {
          const device = oltDevices.find((current) => current.id === item.oltDeviceId)
          const sameDevice = cto.hubsoftOltDeviceId
            ? device?.hubsoftId === cto.hubsoftOltDeviceId
            : cto.oltIpv4
              ? device?.ipv4 === cto.oltIpv4 || device?.host === cto.oltIpv4
              : cto.oltDeviceName
                ? device?.name === cto.oltDeviceName
                : false

          return sameDevice && item.chassi === cto.oltChassi && item.slot === cto.oltSlot && item.pon === cto.oltPon
        })
      : null
    const selectedInterface = linkedInterface ?? importedInterface ?? null

    setCtoId(cto.id)
    setCtoName(cto.name)
    setCtoAddress(cto.address || "")
    setCtoLat(String(cto.lat))
    setCtoLng(String(cto.lng))
    setCtoOltDeviceId(selectedInterface?.oltDeviceId || cto.oltInterface?.oltDeviceId || "")
    setCtoOltInterfaceId(selectedInterface?.id || cto.oltInterfaceId || "")
  }

  const saveCto = async () => {
    if (!ctoId || !ctoName.trim() || !ctoLat.trim() || !ctoLng.trim()) {
      setMessage("Selecione uma CTO e informe nome, latitude e longitude.")
      return
    }

    setIsLoading(true)
    setMessage("")
    try {
      const response = await fetch("/api/cto", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: ctoId,
          name: ctoName,
          address: ctoAddress,
          lat: Number(ctoLat),
          lng: Number(ctoLng),
          oltInterfaceId: ctoOltInterfaceId || null,
        }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: "Erro ao salvar CTO." }))
        throw new Error(body.error || "Erro ao salvar CTO.")
      }
      const savedCto: Cto = await response.json()
      setMessage("CTO atualizada com sucesso.")
      await loadData()
      if (savedCto?.id) {
        selectCto(savedCto)
      }
    } catch (error) {
      setMessage((error as Error).message || "Erro ao salvar CTO.")
    } finally {
      setIsLoading(false)
    }
  }

  const syncCtos = async () => {
    setIsLoading(true)
    setMessage("")
    try {
      const response = await fetch("/api/cto/sync", {
        method: "POST",
        credentials: "same-origin",
      })
      const body = await response.json().catch(() => ({ error: "Erro ao sincronizar CTOs." }))
      if (!response.ok) {
        throw new Error(body.error || "Erro ao sincronizar CTOs.")
      }
      setMessage(body.message || `Sincronizacao concluida. ${body.synced ?? 0} CTOs sincronizadas, ${body.errors ?? 0} erros.`)
      await loadData()
    } catch (error) {
      setMessage((error as Error).message || "Erro ao sincronizar CTOs.")
    } finally {
      setIsLoading(false)
    }
  }

  const saveOnuMonitoring = async () => {
    setIsLoading(true)
    setMessage("")
    try {
      const response = await fetch("/api/settings/onu-monitoring", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: onuMonitoringEnabled,
          intervalMinutes: Number(onuMonitoringInterval),
        }),
      })
      const body = await response.json().catch(() => ({ error: "Erro ao salvar monitoramento." }))
      if (!response.ok) {
        throw new Error(body.error || "Erro ao salvar monitoramento.")
      }
      setOnuMonitoringSettings(body)
      setOnuMonitoringEnabled(body.enabled)
      setOnuMonitoringInterval(String(body.intervalMinutes))
      setMessage("Monitoramento de ONU/CPE atualizado.")
    } catch (error) {
      setMessage((error as Error).message || "Erro ao salvar monitoramento.")
    } finally {
      setIsLoading(false)
    }
  }

  const runOnuMonitoringNow = async () => {
    setIsLoading(true)
    setMessage("")
    try {
      const response = await fetch("/api/settings/onu-monitoring", {
        method: "POST",
        credentials: "same-origin",
      })
      const body = await response.json().catch(() => ({ error: "Erro ao executar monitoramento." }))
      if (response.status === 409 && body.code === "monitor_running") {
        if (body.settings) {
          setOnuMonitoringSettings(body.settings)
          setOnuMonitoringEnabled(body.settings.enabled)
          setOnuMonitoringInterval(String(body.settings.intervalMinutes))
        }
        setMessage(body.message || "Monitoramento de ONU/CPE já está em execução.")
        return
      }
      if (!response.ok) {
        throw new Error(body.error || body.message || "Erro ao executar monitoramento.")
      }
      if (body.settings) {
        setOnuMonitoringSettings(body.settings)
        setOnuMonitoringEnabled(body.settings.enabled)
        setOnuMonitoringInterval(String(body.settings.intervalMinutes))
      }
      setMessage(body.message || "Monitoramento executado.")
      await loadData()
    } catch (error) {
      setMessage((error as Error).message || "Erro ao executar monitoramento.")
    } finally {
      setIsLoading(false)
    }
  }

  const saveOltMonitoring = async () => {
    setIsLoading(true)
    setMessage("")
    try {
      const response = await fetch("/api/settings/olt-monitoring", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: oltMonitoringEnabled,
          intervalMinutes: Number(oltMonitoringInterval),
          trafficIntervalSeconds: Number(oltTrafficInterval),
        }),
      })
      const body = await response.json().catch(() => ({ error: "Erro ao salvar monitoramento de OLT." }))
      if (!response.ok) {
        throw new Error(body.error || "Erro ao salvar monitoramento de OLT.")
      }
      setOltMonitoringSettings(body)
      setOltMonitoringEnabled(body.enabled)
      setOltMonitoringInterval(String(body.intervalMinutes))
      setOltTrafficInterval(String(body.trafficIntervalSeconds))
      setMessage("Monitoramento de OLT atualizado.")
    } catch (error) {
      setMessage((error as Error).message || "Erro ao salvar monitoramento de OLT.")
    } finally {
      setIsLoading(false)
    }
  }

  const runOltMonitoringNow = async () => {
    setIsLoading(true)
    setMessage("")
    try {
      const response = await fetch("/api/settings/olt-monitoring", {
        method: "POST",
        credentials: "same-origin",
      })
      const body = await response.json().catch(() => ({ error: "Erro ao executar monitoramento de OLT." }))
      if (response.status === 409 && body.code === "monitor_running") {
        if (body.settings) {
          setOltMonitoringSettings(body.settings)
          setOltMonitoringEnabled(body.settings.enabled)
          setOltMonitoringInterval(String(body.settings.intervalMinutes))
          setOltTrafficInterval(String(body.settings.trafficIntervalSeconds))
        }
        setMessage(body.message || "Monitoramento de OLT já está em execução.")
        return
      }
      if (!response.ok) {
        throw new Error(body.error || body.message || "Erro ao executar monitoramento de OLT.")
      }
      if (body.settings) {
        setOltMonitoringSettings(body.settings)
        setOltMonitoringEnabled(body.settings.enabled)
        setOltMonitoringInterval(String(body.settings.intervalMinutes))
        setOltTrafficInterval(String(body.settings.trafficIntervalSeconds))
      }
      setMessage(body.message || "Monitoramento de OLT executado.")
      await loadData()
    } catch (error) {
      setMessage((error as Error).message || "Erro ao executar monitoramento de OLT.")
    } finally {
      setIsLoading(false)
    }
  }

  const setApplicationField = <Key extends keyof ApplicationSettings>(field: Key, value: ApplicationSettings[Key]) => {
    setApplicationForm((current) => ({ ...current, [field]: value }))
  }

  const setGenieAcsField = <Key extends keyof GenieAcsSettings>(field: Key, value: GenieAcsSettings[Key]) => {
    setGenieAcsForm((current) => ({ ...current, [field]: value }))
  }

  const setNotificationField = <Key extends keyof NotificationSettings>(field: Key, value: NotificationSettings[Key]) => {
    setNotificationForm((current) => ({ ...current, [field]: value }))
  }

  const setNotificationTemplateField = (
    stage: NotificationTemplateStage,
    field: keyof NotificationSettings["templates"][NotificationTemplateStage],
    value: string,
  ) => {
    setNotificationForm((current) => ({
      ...current,
      templates: {
        ...current.templates,
        [stage]: {
          ...current.templates[stage],
          [field]: value,
        },
      },
    }))
  }

  const handleApplicationLogoChange = (field: "companyLogo" | "companyLogoDark", file?: File | null) => {
    if (!file) return
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setMessage("Envie um logo em PNG, JPG ou WebP.")
      return
    }
    if (file.size > 750_000) {
      setMessage("O logo deve ter ate 750 KB.")
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : null
      if (!result) {
        setMessage("Nao foi possivel carregar o logo.")
        return
      }
      setApplicationForm((current) => ({ ...current, [field]: result, useCompanyLogo: true }))
      setMessage("")
    }
    reader.onerror = () => setMessage("Nao foi possivel carregar o logo.")
    reader.readAsDataURL(file)
  }

  const saveApplicationSettings = async () => {
    setIsLoading(true)
    setMessage("")
    try {
      const response = await fetch("/api/settings/application", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(applicationForm),
      })
      const body = await response.json().catch(() => ({ error: "Erro ao salvar dados da aplicacao." }))
      if (!response.ok) {
        throw new Error(body.error || "Erro ao salvar dados da aplicacao.")
      }
      setApplicationSettings(body)
      setApplicationForm(body)
      setMessage("Dados da aplicacao atualizados.")
    } catch (error) {
      setMessage((error as Error).message || "Erro ao salvar dados da aplicacao.")
    } finally {
      setIsLoading(false)
    }
  }

  const saveGenieAcsSettings = async () => {
    setIsLoading(true)
    setMessage("")
    try {
      const response = await fetch("/api/settings/genieacs", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(genieAcsForm),
      })
      const body = await response.json().catch(() => ({ error: "Erro ao salvar GenieACS." }))
      if (!response.ok) {
        throw new Error(body.error || "Erro ao salvar GenieACS.")
      }
      const nextSettings = { ...body, authHeaderValue: "" } as GenieAcsSettings
      setGenieAcsSettings(nextSettings)
      setGenieAcsForm(nextSettings)
      setMessage("Integração GenieACS atualizada.")
    } catch (error) {
      setMessage((error as Error).message || "Erro ao salvar GenieACS.")
    } finally {
      setIsLoading(false)
    }
  }

  const testGenieAcsSettings = async () => {
    setIsLoading(true)
    setMessage("")
    try {
      const response = await fetch("/api/settings/genieacs", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(genieAcsForm),
      })
      const body = await response.json().catch(() => ({ error: "Erro ao testar GenieACS." }))
      if (!response.ok || !body.ok) {
        if (body.settings) {
          const nextSettings = { ...body.settings, authHeaderValue: "" } as GenieAcsSettings
          setGenieAcsSettings(nextSettings)
          setGenieAcsForm((current) => ({ ...nextSettings, authHeaderValue: current.authHeaderValue || "" }))
        }
        throw new Error(body.error || "Erro ao testar GenieACS.")
      }
      const nextSettings = { ...body.settings, authHeaderValue: "" } as GenieAcsSettings
      setGenieAcsSettings(nextSettings)
      setGenieAcsForm(nextSettings)
      setMessage("Conexão GenieACS testada com sucesso.")
    } catch (error) {
      setMessage((error as Error).message || "Erro ao testar GenieACS.")
    } finally {
      setIsLoading(false)
    }
  }

  const saveNotificationSettings = async () => {
    setIsLoading(true)
    setMessage("")
    try {
      const response = await fetch("/api/settings/notifications", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(notificationForm),
      })
      const body = await response.json().catch(() => ({ error: "Erro ao salvar notificacoes." }))
      if (!response.ok) {
        throw new Error(body.error || "Erro ao salvar notificacoes.")
      }
      setNotificationSettings(body)
      setNotificationForm(body)
      setMessage("Configuracao de notificacoes atualizada.")
    } catch (error) {
      setMessage((error as Error).message || "Erro ao salvar notificacoes.")
    } finally {
      setIsLoading(false)
    }
  }

  const processNotificationQueueNow = async () => {
    setIsLoading(true)
    setMessage("")
    try {
      const response = await fetch("/api/settings/notifications/process", {
        method: "POST",
        credentials: "same-origin",
      })
      const body = await response.json().catch(() => ({ error: "Erro ao processar fila." }))
      if (!response.ok) {
        throw new Error(body.error || "Erro ao processar fila.")
      }
      setMessage(`Fila processada: ${body.sent ?? 0} enviada(s), ${body.failed ?? 0} falha(s).`)
      await refreshBillingData()
    } catch (error) {
      setMessage((error as Error).message || "Erro ao processar fila.")
    } finally {
      setIsLoading(false)
    }
  }

  const loadProvisioningLogs = async (provisioning: Provisioning) => {
    setIsLoading(true)
    setMessage("")
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
      setMessage((error as Error).message || "Erro ao carregar logs do provisionamento.")
    } finally {
      setIsLoading(false)
    }
  }

  const deprovisionOlt = async (provisioning: Provisioning) => {
    const confirmed = window.confirm(`Desprovisionar a ONU/CPE ${provisioning.serial} do contrato ${provisioning.contract.contractNumber}?`)
    if (!confirmed) return

    setIsLoading(true)
    setMessage("")
    try {
      const response = await fetch(`/api/provisionings/${provisioning.id}/olt`, {
        method: "DELETE",
        credentials: "same-origin",
      })
      const body = await response.json().catch(() => ({ error: "Erro ao desprovisionar ONU/CPE." }))
      if (!response.ok) {
        throw new Error(body.olt?.message || body.error || body.message || "Erro ao desprovisionar ONU/CPE.")
      }
      setMessage(body.olt?.message || "Desprovisionamento processado.")
      await loadData()
    } catch (error) {
      setMessage((error as Error).message || "Erro ao desprovisionar ONU/CPE.")
    } finally {
      setIsLoading(false)
    }
  }

  const lookupHubsoftOperator = async () => {
    const cnpj = normalizeCnpj(userCnpj)
    if (!cnpj || !isValidCnpj(cnpj)) {
      setMessage("Informe um CNPJ valido para consultar o Hubsoft.")
      return
    }

    setIsHubsoftLookupLoading(true)
    setMessage("")
    try {
      const response = await fetch(`/api/hubsoft/clientes?cnpj=${encodeURIComponent(cnpj)}`, { credentials: "same-origin" })
      const body = await response.json().catch(() => ({ error: "Erro ao consultar cliente Hubsoft." }))
      if (!response.ok) {
        throw new Error(body.error || "Erro ao consultar cliente Hubsoft.")
      }

      const client = body as HubsoftClientLookup
      const activeService = selectActiveHubsoftService(client)
      setHubsoftLookup(client)
      setUserName(client.legalName || client.tradeName || userName)
      if (client.primaryEmail) setUserEmail(client.primaryEmail)
      setUserCnpj(formatCnpj(client.cnpj))
      setUserHubsoftClientServiceId(activeService?.idClienteServico || "")
      if (!profileId) {
        setProfileName(`${client.legalName || client.tradeName || "Operador"} - operacional`)
      }
      setMessage(activeService ? "Cliente Hubsoft importado para o cadastro." : "Cliente Hubsoft encontrado, mas sem servico ativo habilitado.")
    } catch (error) {
      setHubsoftLookup(null)
      setMessage((error as Error).message || "Erro ao consultar cliente Hubsoft.")
    } finally {
      setIsHubsoftLookupLoading(false)
    }
  }

  const saveUser = async () => {
    const isEditingUser = Boolean(userId)
    if (userRole === "landlord" && (!normalizeCnpj(userCnpj) || !isValidCnpj(userCnpj))) {
      setUserFormError("Informe um CNPJ valido para salvar o operador. CPF nao e aceito.")
      return
    }
    if (userRole === "landlord" && (!profileName.trim() || !profileDriver || !profileVlan.trim())) {
      setUserFormError("Informe nome, driver e VLAN do perfil operacional do operador.")
      return
    }
    if (!userName.trim() || !userEmail.trim() || (!userId && !userPassword.trim())) {
      setUserFormError(userId ? "Informe nome e email do usuario." : "Informe nome, email e senha do usuario.")
      return
    }
    setIsLoading(true)
    setMessage("")
    setUserFormError("")
    try {
      const response = await fetch("/api/users", {
        method: userId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: userId || undefined,
          name: userName,
          email: userEmail,
          password: userPassword || undefined,
          role: userRole,
          vlan: userRole === "landlord" ? profileVlan || userVlan || null : userVlan || null,
          cnpj: userRole === "landlord" ? normalizeCnpj(userCnpj) : null,
          provisioningProfileId: userRole === "landlord" ? userProvisioningProfileId || null : null,
          provisioningProfile: userRole === "landlord" ? {
            id: profileId || userProvisioningProfileId || undefined,
            name: profileName,
            driver: profileDriver,
            vlan: profileVlan || null,
            serviceVlan: profileServiceVlan || null,
            lineProfile: profileLineProfile,
            serviceProfile: profileServiceProfile,
            gemPort: profileGemPort || null,
            tcont: profileTcont || null,
            serviceName: profileServiceName,
            isDefault: profileDefault,
          } : undefined,
          hubsoftClientServiceId: userRole === "landlord" ? userHubsoftClientServiceId || null : null,
          minimumAmountCents: userRole === "landlord" ? moneyInputToCents(userMinimumAmount) : undefined,
          includedProvisionings: userRole === "landlord" ? Number(userIncludedProvisionings || 0) : undefined,
          extraProvisioningAmountCents: userRole === "landlord" ? moneyInputToCents(userExtraAmount) : undefined,
          dueDay: userRole === "landlord" ? Number(userDueDay || billingSettings?.defaultDueDay || 10) : undefined,
          billingStatus: userRole === "landlord" ? userBillingStatus : undefined,
          billingNotes: userRole === "landlord" ? userBillingNotes : undefined,
        }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: "Erro ao salvar usuario." }))
        setUserFormError(body.error || "Erro ao salvar usuario.")
        return
      }
      resetUserForm()
      setShowUserModal(false)
      setMessage(isEditingUser ? "Usuario atualizado com sucesso." : "Usuario criado com sucesso.")
      await loadData()
    } catch (error) {
      setUserFormError((error as Error).message || "Erro ao salvar usuario.")
    } finally {
      setIsLoading(false)
    }
  }

  const deleteUser = async (user: ManagedUser) => {
    if (!window.confirm(`Excluir o usuario ${user.name}?`)) {
      return
    }

    setIsLoading(true)
    setMessage("")
    try {
      const response = await fetch("/api/users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: user.id }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: "Erro ao excluir usuario." }))
        throw new Error(body.error || "Erro ao excluir usuario.")
      }
      if (userId === user.id) {
        resetUserForm()
      }
      setMessage("Usuario excluido com sucesso.")
      await loadData()
    } catch (error) {
      setMessage((error as Error).message || "Erro ao excluir usuario.")
    } finally {
      setIsLoading(false)
    }
  }

  const resetDeviceForm = () => {
    setDeviceId("")
    setOltEditTab("dados")
    setDeviceName("ZTE 01")
    setManufacturer("ZTE")
    setModel("ZXA10 C610")
    setPop("CENTRAL-POP1")
    setManagementServer("Nenhum")
    setHost("")
    setIpv4("")
    setIpv6("")
    setUsername("")
    setSshPort("22")
    setSshPassword("")
    setEnablePassword("")
    setUseEnableMode(false)
    setDeviceDriver("zte-c650")
    setSnmpEnabled(false)
    setSnmpVersion("2c")
    setSnmpCommunity("")
    setSnmpPort("161")
    setSnmpVendor("zte_titan")
    setTerminalLengthCommand("terminal length 0")
    setEnterConfigCommand("conf t")
    setShowOnuStateCommand("show gpon onu state gpon_olt-[[chassi]]/[[slot]]/[[pon]]")
    setSerialLookupCommand("show gpon onu by sn [[serial]]")
    setRebootOnuCommand(defaultRebootOnuCommand)
    setSaveConfigCommand("write")
    setExitCommands("exit\nexit")
    setDeviceDefault(true)
    setDeviceActive(true)
  }

  const selectDevice = (device: OltDevice) => {
    setDeviceId(device.id)
    setOltEditTab("dados")
    setDeviceName(device.name)
    setManufacturer(device.manufacturer)
    setModel(device.model)
    setPop(device.pop || "")
    setManagementServer(device.managementServer || "")
    setHost(device.host)
    setIpv4(device.ipv4 || "")
    setIpv6(device.ipv6 || "")
    setUsername(device.username)
    setSshPort(String(device.port || 22))
    setSshPassword("")
    setEnablePassword("")
    setUseEnableMode(Boolean(device.useEnableMode))
    setDeviceDriver(device.driver)
    setSnmpEnabled(Boolean(device.snmpEnabled))
    setSnmpVersion(device.snmpVersion || "2c")
    setSnmpCommunity("")
    setSnmpPort(String(device.snmpPort || 161))
    setSnmpVendor(device.snmpVendor || "zte_titan")
    setTerminalLengthCommand(device.terminalLengthCommand || "terminal length 0")
    setEnterConfigCommand(device.enterConfigCommand || "conf t")
    setShowOnuStateCommand(device.showOnuStateCommand || "show gpon onu state gpon_olt-[[chassi]]/[[slot]]/[[pon]]")
    setSerialLookupCommand(device.serialLookupCommand || "show gpon onu by sn [[serial]]")
    setRebootOnuCommand(device.rebootOnuCommand || defaultRebootOnuCommand)
    setSaveConfigCommand(device.saveConfigCommand || "write")
    setExitCommands(device.exitCommands || "exit\nexit")
    setDeviceDefault(device.isDefault)
    setDeviceActive(device.isActive)
  }

  const toggleEnableMode = (checked: boolean) => {
    setUseEnableMode(checked)
    if (!checked) setEnablePassword("")
  }

  const saveDevice = async () => {
    if (!deviceName.trim() || !host.trim() || !username.trim()) {
      setMessage("Informe nome, host e usuario da OLT.")
      return
    }
    if (!deviceId && !sshPassword.trim()) {
      setMessage("Informe a senha SSH da OLT.")
      return
    }

    setIsLoading(true)
    setMessage("")
    try {
      const response = await fetch("/api/olt/devices", {
        method: deviceId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: deviceId || undefined,
          name: deviceName,
          manufacturer,
          model,
          pop,
          managementServer,
          host,
          ipv4,
          ipv6,
          username,
          port: Number(sshPort || 22),
          password: sshPassword || undefined,
          enablePassword: useEnableMode ? enablePassword || undefined : undefined,
          useEnableMode,
          driver: deviceDriver,
          snmpEnabled,
          snmpVersion,
          snmpCommunity: snmpCommunity || undefined,
          snmpPort: Number(snmpPort || 161),
          snmpVendor,
          profileId: null,
          terminalLengthCommand,
          enterConfigCommand,
          showOnuStateCommand,
          serialLookupCommand,
          rebootOnuCommand,
          saveConfigCommand,
          exitCommands,
          isDefault: deviceDefault,
          isActive: deviceActive,
        }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: "Erro ao salvar OLT." }))
        throw new Error(body.error || "Erro ao salvar OLT.")
      }
      const savedDevice: OltDevice = await response.json()
      setDeviceId(savedDevice.id)
      setDeviceName(savedDevice.name)
      setManufacturer(savedDevice.manufacturer)
      setModel(savedDevice.model)
      setPop(savedDevice.pop || "")
      setManagementServer(savedDevice.managementServer || "")
      setHost(savedDevice.host)
      setIpv4(savedDevice.ipv4 || "")
      setIpv6(savedDevice.ipv6 || "")
      setUsername(savedDevice.username)
      setSshPort(String(savedDevice.port || 22))
      setUseEnableMode(Boolean(savedDevice.useEnableMode))
      setDeviceDriver(savedDevice.driver)
      setSnmpEnabled(Boolean(savedDevice.snmpEnabled))
      setSnmpVersion(savedDevice.snmpVersion || "2c")
      setSnmpCommunity("")
      setSnmpPort(String(savedDevice.snmpPort || 161))
      setSnmpVendor(savedDevice.snmpVendor || "zte_titan")
      setTerminalLengthCommand(savedDevice.terminalLengthCommand || "terminal length 0")
      setEnterConfigCommand(savedDevice.enterConfigCommand || "conf t")
      setShowOnuStateCommand(savedDevice.showOnuStateCommand || "show gpon onu state gpon_olt-[[chassi]]/[[slot]]/[[pon]]")
      setSerialLookupCommand(savedDevice.serialLookupCommand || "show gpon onu by sn [[serial]]")
      setRebootOnuCommand(savedDevice.rebootOnuCommand || defaultRebootOnuCommand)
      setSaveConfigCommand(savedDevice.saveConfigCommand || "write")
      setExitCommands(savedDevice.exitCommands || "exit\nexit")
      setDeviceDefault(savedDevice.isDefault)
      setDeviceActive(savedDevice.isActive)
      setSshPassword("")
      setEnablePassword("")
      setMessage("OLT salva com sucesso.")
      await loadData()
      if (savedDevice.snmpEnabled) {
        await runOnuMonitoringNow()
      }
    } catch (error) {
      setMessage((error as Error).message || "Erro ao salvar OLT.")
    } finally {
      setIsLoading(false)
    }
  }

  const selectProfile = (profile: OperatorProfile) => {
    setProfileId(profile.id)
    setProfileUserId(profile.userId)
    setProfileName(profile.name)
    setProfileDriver(profile.driver)
    setProfileVlan(profile.vlan ? String(profile.vlan) : "")
    setProfileServiceVlan(profile.serviceVlan ? String(profile.serviceVlan) : "")
    setProfileLineProfile(profile.lineProfile || "")
    setProfileServiceProfile(profile.serviceProfile || "")
    setProfileGemPort(profile.gemPort ? String(profile.gemPort) : "1")
    setProfileTcont(profile.tcont ? String(profile.tcont) : "1")
    setProfileServiceName(profile.serviceName || "internet")
    setProfileDefault(profile.isDefault)
    setShowProfileModal(true)
  }

  const resetProfileForm = () => {
    setProfileId("")
    setProfileUserId("")
    setProfileName("ZTE C650 - padrao")
    setProfileDriver("zte-c650")
    setProfileVlan("")
    setProfileServiceVlan("")
    setProfileLineProfile("")
    setProfileServiceProfile("")
    setProfileGemPort("1")
    setProfileTcont("1")
    setProfileServiceName("internet")
    setProfileDefault(true)
  }

  const saveProfile = async () => {
    if (!profileUserId || !profileName.trim()) {
      setMessage("Selecione o operador e informe o nome do perfil operacional.")
      return
    }
    if (!profileVlan.trim()) {
      setMessage("Informe a VLAN do perfil operacional.")
      return
    }
    setIsLoading(true)
    setMessage("")
    try {
      const response = await fetch("/api/operator-profiles", {
        method: profileId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: profileId || undefined,
          userId: profileUserId,
          name: profileName,
          driver: profileDriver,
          vlan: profileVlan || null,
          serviceVlan: profileServiceVlan || null,
          lineProfile: profileLineProfile,
          serviceProfile: profileServiceProfile,
          gemPort: profileGemPort || null,
          tcont: profileTcont || null,
          serviceName: profileServiceName,
          isDefault: profileDefault,
        }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: "Erro ao salvar perfil." }))
        throw new Error(body.error || "Erro ao salvar perfil.")
      }
      setMessage("Perfil operacional salvo com sucesso.")
      setShowProfileModal(false)
      await loadData()
    } catch (error) {
      setMessage((error as Error).message || "Erro ao salvar perfil.")
    } finally {
      setIsLoading(false)
    }
  }

  const resetCpeModelForm = () => {
    setCpeModelId("")
    setCpeModelName("")
    setCpeModelDescription("")
    setCpeModelProfiles([createDefaultCpeModelProfile()])
  }

  const selectCpeModel = (item: CpeModel) => {
    setCpeModelId(item.id)
    setCpeModelName(item.name)
    setCpeModelDescription(item.description || "")
    setCpeModelProfiles((item.oltProfiles && item.oltProfiles.length > 0
      ? item.oltProfiles
      : [createDefaultCpeModelProfile(item.name)]
    ).map((profile) => ({
      ...profile,
      genieAcsParameterMapJson: formatJsonText(profile.genieAcsParameterMapJson, defaultGenieAcsParameterMap()),
      requiredVariablesJson: formatJsonText(profile.requiredVariablesJson, defaultRequiredVariables()),
    })))
  }

  const saveCpeModel = async () => {
    if (!cpeModelName.trim()) {
      setMessage("Informe o nome do modelo de ONU.")
      return
    }

    if (cpeModelProfiles.length === 0) {
      setMessage("Cadastre ao menos uma compatibilidade OLT para este modelo de ONU.")
      return
    }

    setIsLoading(true)
    setMessage("")
    try {
      const response = await fetch(cpeModelId ? `/api/cpemodels/${cpeModelId}` : "/api/cpemodels", {
        method: cpeModelId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: cpeModelName,
          description: cpeModelDescription,
          oltProfiles: cpeModelProfiles,
        }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: "Erro ao salvar modelo de ONU." }))
        throw new Error(body.error || "Erro ao salvar modelo de ONU.")
      }
      const savedModel: CpeModel = await response.json()
      selectCpeModel(savedModel)
      setMessage("Modelo de ONU salvo com sucesso.")
      await loadData()
    } catch (error) {
      setMessage((error as Error).message || "Erro ao salvar modelo de ONU.")
    } finally {
      setIsLoading(false)
    }
  }

  const deleteCpeModel = async (item: CpeModel) => {
    if ((item.provisioningCount ?? 0) > 0) {
      setMessage("Este modelo esta em uso e nao pode ser excluido.")
      return
    }

    if (!window.confirm(`Excluir o modelo ${item.name}?`)) {
      return
    }

    setIsLoading(true)
    setMessage("")
    try {
      const response = await fetch(`/api/cpemodels/${item.id}`, { method: "DELETE" })
      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: "Erro ao excluir modelo de ONU." }))
        throw new Error(body.error || "Erro ao excluir modelo de ONU.")
      }
      if (cpeModelId === item.id) {
        resetCpeModelForm()
      }
      setMessage("Modelo de ONU excluido com sucesso.")
      await loadData()
    } catch (error) {
      setMessage((error as Error).message || "Erro ao excluir modelo de ONU.")
    } finally {
      setIsLoading(false)
    }
  }

  const updateCpeModelProfile = (index: number, key: keyof CpeModelOltProfile, value: string) => {
    setCpeModelProfiles((current) => current.map((profile, profileIndex) => (
      profileIndex === index ? { ...profile, [key]: value } : profile
    )))
  }

  const addCpeModelProfile = () => {
    setCpeModelProfiles((current) => [...current, createDefaultCpeModelProfile(cpeModelName)])
  }

  const removeCpeModelProfile = (index: number) => {
    setCpeModelProfiles((current) => current.filter((_profile, profileIndex) => profileIndex !== index))
  }

  const resetInterfaceForm = () => {
    setInterfaceId("")
    setInterfaceType("GPON")
    setInterfaceName("")
    setInterfaceDescription("")
    setInterfaceChassi("1")
    setInterfaceSlot("1")
    setInterfacePon("1")
    setInterfaceVlan("")
    setInterfaceRouting("")
    setInterfaceRequireCto(false)
    setInterfaceBlockOveruse(false)
    setInterfaceEnableScan(true)
    setInterfaceScanType("Detalhado")
    setInterfaceAlarmSubscriber("-28")
    setInterfaceAlarmEquipment("-28")
    setInterfaceSequence("")
  }

  const selectInterface = (item: OltInterface) => {
    setInterfaceId(item.id)
    setDeviceId(item.oltDeviceId)
    setOltEditTab("interfaces")
    setInterfaceType(item.type)
    setInterfaceName(item.name)
    setInterfaceDescription(item.description || "")
    setInterfaceChassi(String(item.chassi))
    setInterfaceSlot(String(item.slot))
    setInterfacePon(String(item.pon))
    setInterfaceVlan(item.vlan ? String(item.vlan) : "")
    setInterfaceRouting(item.routingInterface || "")
    setInterfaceRequireCto(item.requireCtoLink)
    setInterfaceBlockOveruse(item.blockOverutilization)
    setInterfaceEnableScan(item.enableScan)
    setInterfaceScanType(item.scanType || "Detalhado")
    setInterfaceAlarmSubscriber(item.alarmSubscriberSignal ? String(item.alarmSubscriberSignal) : "-28")
    setInterfaceAlarmEquipment(item.alarmEquipmentSignal ? String(item.alarmEquipmentSignal) : "-28")
    setInterfaceSequence(item.sequencePort ? String(item.sequencePort) : "")
    setShowInterfaceModal(true)
  }

  const saveInterface = async () => {
    if (!deviceId) {
      setMessage("Selecione uma OLT antes de cadastrar interfaces.")
      return
    }
    if (!interfaceName.trim()) {
      setMessage("Informe o nome da interface.")
      return
    }

    setIsLoading(true)
    setMessage("")
    try {
      const response = await fetch("/api/olt/interfaces", {
        method: interfaceId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: interfaceId || undefined,
          oltDeviceId: deviceId,
          type: interfaceType,
          name: interfaceName,
          description: interfaceDescription,
          chassi: Number(interfaceChassi),
          slot: Number(interfaceSlot),
          pon: Number(interfacePon),
          vlan: interfaceVlan || null,
          routingInterface: interfaceRouting,
          requireCtoLink: interfaceRequireCto,
          blockOverutilization: interfaceBlockOveruse,
          enableScan: interfaceEnableScan,
          scanType: interfaceScanType,
          alarmSubscriberSignal: interfaceAlarmSubscriber || null,
          alarmEquipmentSignal: interfaceAlarmEquipment || null,
          sequencePort: interfaceSequence || null,
          isActive: true,
        }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: "Erro ao salvar interface." }))
        throw new Error(body.error || "Erro ao salvar interface.")
      }
      setMessage("Interface da OLT salva com sucesso.")
      resetInterfaceForm()
      setShowInterfaceModal(false)
      await loadData()
    } catch (error) {
      setMessage((error as Error).message || "Erro ao salvar interface.")
    } finally {
      setIsLoading(false)
    }
  }

  const bulkCreateInterfaces = async () => {
    if (!deviceId) {
      setMessage("Selecione uma OLT antes do cadastro em massa.")
      return
    }

    setIsLoading(true)
    setMessage("")
    try {
      const response = await fetch("/api/olt/interfaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "bulk",
          oltDeviceId: deviceId,
          type: interfaceType,
          namePrefix: bulkNamePrefix,
          chassiStart: Number(bulkChassiStart),
          chassiEnd: Number(bulkChassiEnd),
          slotStart: Number(bulkSlotStart),
          slotEnd: Number(bulkSlotEnd),
          ponStart: Number(bulkPonStart),
          ponEnd: Number(bulkPonEnd),
          vlanStart: bulkVlanStart || null,
          vlanIncrement: Number(bulkVlanIncrement || 0),
          routingInterface: interfaceRouting,
          requireCtoLink: interfaceRequireCto,
          blockOverutilization: interfaceBlockOveruse,
          enableScan: interfaceEnableScan,
          scanType: interfaceScanType,
          alarmSubscriberSignal: interfaceAlarmSubscriber || null,
          alarmEquipmentSignal: interfaceAlarmEquipment || null,
        }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: "Erro no cadastro em massa." }))
        throw new Error(body.error || "Erro no cadastro em massa.")
      }
      const body = await response.json()
      setMessage(`${body.interfaces?.length ?? 0} interfaces criadas.`)
      setShowBulkInterfaceModal(false)
      await loadData()
    } catch (error) {
      setMessage((error as Error).message || "Erro no cadastro em massa.")
    } finally {
      setIsLoading(false)
    }
  }

  const loadOnuState = async (item: OltInterface) => {
    setIsLoading(true)
    setMessage("")
    setOnuStateTitle(`${item.name} - ${item.chassi}/${item.slot}/${item.pon}`)
    setOnuStateCommand("")
    setOnuStateOutput("Consultando ONUs configuradas...")
    setOnuStateTotalPositions(128)
    setOnuStateOccupiedPositions([])
    setOnuStateFreePositions([])
    setOnuStateNextFreePosition(null)
    setShowOnuStateModal(true)
    try {
      const response = await fetch("/api/olt/management/onu-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interfaceId: item.id }),
      })
      const body = await response.json().catch(() => ({ error: "Erro ao consultar ONUs na OLT." }))
      if (!response.ok) {
        throw new Error(body.error || "Erro ao consultar ONUs na OLT.")
      }
      setOnuStateCommand(body.command || "")
      setOnuStateOutput([body.output, body.stderr].filter(Boolean).join("\n") || "A OLT nao retornou dados para este comando.")
      setOnuStateTotalPositions(body.positions?.totalPositions ?? 128)
      setOnuStateOccupiedPositions(body.positions?.occupiedPositions ?? [])
      setOnuStateFreePositions(body.positions?.freePositions ?? [])
      setOnuStateNextFreePosition(body.positions?.nextFreePosition ?? null)
    } catch (error) {
      setOnuStateOutput((error as Error).message || "Erro ao consultar ONUs na OLT.")
      setMessage((error as Error).message || "Erro ao consultar ONUs na OLT.")
    } finally {
      setIsLoading(false)
    }
  }

  if (status === "loading") {
    return <LoadingScreen title="Carregando admin" description="Abrindo o painel administrativo." />
  }

  if (session && requiresMfa) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <div className="rounded-[8px] bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-950">MFA obrigatorio</h1>
          <p className="mt-2 text-sm text-slate-600">Configure o app autenticador antes de acessar a area administrativa.</p>
          <Link href="/mfa/setup" className="mt-5 inline-flex rounded-[8px] bg-orange-800 px-4 py-2 text-white">Configurar MFA</Link>
        </div>
      </main>
    )
  }

  if (!session || !isAdmin) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <div className="rounded-[8px] bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-950">Area restrita</h1>
          <p className="mt-2 text-sm text-slate-600">Esta area e exclusiva para administradores.</p>
          <Link href="/" className="mt-5 inline-flex rounded-[8px] bg-orange-800 px-4 py-2 text-white">Voltar ao acesso</Link>
        </div>
      </main>
    )
  }

  if (!isMfaVerified) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <div className="rounded-[8px] bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-950">MFA obrigatorio</h1>
          <p className="mt-2 text-sm text-slate-600">Configure o app autenticador antes de acessar a area administrativa.</p>
          <Link href="/mfa/setup" className="mt-5 inline-flex rounded-[8px] bg-orange-800 px-4 py-2 text-white">Configurar MFA</Link>
        </div>
      </main>
    )
  }

  return (
    <main className={`admin-shell admin-theme-${adminTheme} min-h-screen ${adminTheme === "dark" ? "bg-[#1e2427] text-slate-100" : "bg-[#fff7ed] text-slate-950"}`}>
      <LoadingOverlay
        visible={(isLoading && !showProvisioningLogModal) || isHubsoftLookupLoading}
        title={isHubsoftLookupLoading ? "Consultando Hubsoft" : "Processando operacao"}
        description={isHubsoftLookupLoading ? "Buscando os dados do cliente." : "Aguarde enquanto atualizamos o painel."}
      />
      <header className="admin-topbar">
        <div className="admin-topbar-inner">
          <div className="admin-topbar-brand">
            {applicationSettings.useCompanyLogo && activeAdminLogo ? (
              <Image
                src={activeAdminLogo}
                alt={applicationSettings.companyName}
                width={180}
                height={44}
                unoptimized
                className="admin-topbar-logo"
              />
            ) : (
              <p className="admin-topbar-company">{applicationSettings.companyName}</p>
            )}
          </div>
          <div className="admin-topbar-actions">
            <button
              type="button"
              onClick={() => {
                const nextTheme = adminTheme === "dark" ? "light" : "dark"
                window.localStorage.setItem("admin-theme", nextTheme)
                setAdminTheme(nextTheme)
              }}
              className="group inline-flex items-center"
              aria-label={adminTheme === "dark" ? "Ativar modo claro" : "Ativar modo escuro"}
              aria-pressed={adminTheme === "dark"}
              title={adminTheme === "dark" ? "Modo claro" : "Modo escuro"}
            >
              <span className="admin-theme-toggle-track">
                <span className="admin-theme-toggle-symbol">
                  {adminTheme === "dark" ? "Escuro" : "Claro"}
                </span>
                <span className="admin-theme-toggle-knob">
                  {adminTheme === "dark" ? "☾" : "☀"}
                </span>
              </span>
            </button>
            <Link href="/operador" className="admin-topbar-link">Ver area do operador</Link>
            <button onClick={() => void hardSignOut()} className="admin-topbar-exit">Sair</button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-6">
        <nav className="admin-main-nav">
          {[
            ["overview", "Monitoramento"],
            ["provisionings", "Provisionamentos"],
            ["users", "Usuarios"],
            ["infra", "Infraestrutura"],
            ["billing", "Financeiro"],
            ["contracts", "Contratos"],
            ["settings", "Configurações"],
          ].map(([id, label]) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`admin-main-nav-item ${activeTab === id ? "admin-main-nav-item-active" : ""}`}
            >
              {label}
            </button>
          ))}
        </nav>

        {message ? <div className="mb-5 rounded-[8px] border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-900">{message}</div> : null}

        {activeTab === "overview" ? (
          <section className="grid gap-5">
            <div className="flex flex-wrap items-center gap-2 rounded-[8px] border border-slate-200 bg-white p-2 shadow-sm">
              {[
                ["olt", "OLT"],
                ["onu", "ONU/CPE"],
                ["status", "Status"],
                ["alerts", "Alertas"],
              ].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setMonitoringTab(id as MonitoringTab)}
                  aria-pressed={monitoringTab === id}
                  className={`rounded-[8px] px-4 py-2 text-sm font-medium ${monitoringTab === id ? "bg-orange-800 text-white" : "text-slate-700 hover:bg-slate-50"}`}
                >
                  {label}
                </button>
              ))}
            </div>

            {monitoringTab === "olt" ? (
              <>
                <div className="monitor-overview-surface">
                  <div className="monitor-metric-grid">
                    <MonitorMetric icon="server" title="OLTs SNMP" value={oltDevices.filter((item) => item.isActive && item.snmpEnabled).length} detail={`${activeOlts.length} OLTs ativas`} />
                    <MonitorMetric icon="pulse" title="OLTs monitoradas" value={oltMonitoringSummary.total} detail={`${oltMonitoringSummary.highCpu} CPU alta`} />
                    <MonitorMetric icon="chip" title="Memória OLT" value={oltMonitoringSummary.highMemory} detail="acima de 80%" tone={oltMonitoringSummary.highMemory ? "danger" : "default"} />
                    <MonitorMetric icon="antenna" title="Uplinks online" value={onlineUplinkTotal} detail={`${oltMonitoringSummary.sensorAlerts} sensores em alerta`} tone={oltMonitoringSummary.sensorAlerts ? "danger" : "success"} />
                  </div>

                  <section className="monitor-snmp-section">
                    <h2>OLTs coletadas por SNMP</h2>
                    <OltMonitoringTable items={oltMonitoringCurrent} />
                  </section>
                </div>
              </>
            ) : null}

            {monitoringTab === "onu" ? (
              <>
                <div className="monitor-overview-surface">
                  <div className="monitor-metric-grid">
                    <MonitorMetric icon="antenna" title="ONUs monitoradas" value={onuSummary.total} detail={`${onuSummary.online} online`} tone="success" />
                    <MonitorMetric icon="alert" title="LOS / offline" value={onuSummary.los + onuSummary.offline} detail={`${onuSummary.los} LOS · ${onuSummary.offline} offline`} tone={onuSummary.los + onuSummary.offline ? "danger" : "default"} />
                    <MonitorMetric icon="pulse" title="Sinal critico" value={onuSummary.criticalSignal} detail={`${onuSummary.warningSignal} abaixo de -25 dBm`} tone={onuSummary.criticalSignal ? "danger" : "default"} />
                    <MonitorMetric icon="server" title="OLTs SNMP" value={oltDevices.filter((item) => item.isActive && item.snmpEnabled).length} detail="origem da coleta ONU" />
                  </div>

                  <section className="monitor-snmp-section onu-snmp-section">
                    <div className="monitor-section-heading">
                      <span className="monitor-section-icon"><MonitorIcon name="antenna" /></span>
                      <h2>ONUs coletadas por SNMP</h2>
                    </div>

                    <div className="onu-filter-grid">
                      <label className="onu-filter-field">
                        <span><MonitorIcon name="server" /></span>
                        <select
                          value={onuOltFilter}
                          onChange={(event) => {
                            setOnuOltFilter(event.target.value)
                            setOnuPortFilter("")
                            setOnuCurrentPage(1)
                          }}
                          aria-label="Filtrar por OLT"
                        >
                          <option value="">Todas as OLTs</option>
                          {oltDevices.map((device) => <option key={device.id} value={device.id}>{device.name}</option>)}
                        </select>
                      </label>
                      <label className="onu-filter-field">
                        <span><MonitorIcon name="link" /></span>
                        <select
                          value={onuPortFilter}
                          onChange={(event) => {
                            setOnuPortFilter(event.target.value)
                            setOnuCurrentPage(1)
                          }}
                          aria-label="Filtrar por porta"
                        >
                          <option value="">Todas as portas</option>
                          {onuPortOptions.map((porta) => <option key={porta} value={porta}>{porta}</option>)}
                        </select>
                      </label>
                      <label className="onu-filter-field">
                        <span><MonitorIcon name="pulse" /></span>
                        <select
                          value={onuStatusFilter}
                          onChange={(event) => {
                            setOnuStatusFilter(event.target.value)
                            setOnuCurrentPage(1)
                          }}
                          aria-label="Filtrar por status"
                        >
                          <option value="">Todos os status</option>
                          <option value="working">Working</option>
                          <option value="los">LOS</option>
                          <option value="offline">Offline</option>
                          <option value="dyingGasp">DyingGasp</option>
                          <option value="authFailed">AuthFailed</option>
                        </select>
                      </label>
                      <label className="onu-filter-field">
                        <span><MonitorIcon name="temperature" /></span>
                        <input
                          value={onuRxBelowFilter}
                          onChange={(event) => {
                            setOnuRxBelowFilter(event.target.value)
                            setOnuCurrentPage(1)
                          }}
                          placeholder="RX abaixo de"
                          type="number"
                          aria-label="Filtrar RX abaixo de"
                        />
                      </label>
                    </div>

                    <OnuCurrentTable
                      items={paginatedOnuCurrent}
                      totalItems={filteredOnuCurrent.length}
                      pageSize={onuPageSize}
                      pageSizeOptions={onuPageSizeOptions}
                      currentPage={onuSafeCurrentPage}
                      totalPages={onuTotalPages}
                      pageStartItem={onuPageStartItem}
                      pageEndItem={onuPageEndItem}
                      onPageSizeChange={(pageSize) => {
                        setOnuPageSize(pageSize)
                        setOnuCurrentPage(1)
                      }}
                      onPageChange={setOnuCurrentPage}
                    />
                  </section>
                </div>
              </>
            ) : null}

            {monitoringTab === "status" ? (
              <div className="monitor-bottom-grid monitor-bottom-grid-single">
                <OperationalServicesPanel
                  services={[
                    { label: "API local", status: "online" },
                    { label: "Sincronização CTO", status: ctoStatus?.failed ? "atencao" : "online" },
                    { label: "Monitor ONU/CPE", status: onuMonitoringSettings?.enabled ? "online" : "atencao" },
                    { label: "Monitor OLT", status: oltMonitoringSettings?.enabled ? "online" : "atencao" },
                    { label: "Provisionamento OLT", status: failedProvisionings.length ? "atencao" : "online" },
                  ]}
                />
              </div>
            ) : null}

            {monitoringTab === "alerts" ? (
              <div className="monitor-bottom-grid monitor-bottom-grid-single">
                <OperationalAlertsPanel items={alerts} />
              </div>
            ) : null}
          </section>
        ) : null}

        {activeTab === "provisionings" ? (
          <Panel title="Provisionamentos dos operadores">
            <ProvisioningTable provisionings={provisionings} onDeprovision={deprovisionOlt} onLogs={loadProvisioningLogs} isLoading={isLoading} />
          </Panel>
        ) : null}

        {activeTab === "users" ? (
          <section className="grid gap-5">
            <div className="flex justify-end">
              <button type="button" onClick={openNewUserModal} className="rounded-[8px] bg-orange-800 px-4 py-3 text-sm font-medium text-white">
                Novo usuario
              </button>
            </div>
            <Panel title="Operadores de rede neutra">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1180px] text-left text-sm">
                  <thead className="text-slate-500">
                    <tr>
                      <th className="border-b border-slate-200 py-3 pr-4">Nome</th>
                      <th className="border-b border-slate-200 py-3 pr-4">Email</th>
                      <th className="border-b border-slate-200 py-3 pr-4">Hubsoft</th>
                      <th className="border-b border-slate-200 py-3 pr-4">Perfil operacional</th>
                      <th className="border-b border-slate-200 py-3 pr-4">Controle de acesso</th>
                      <th className="border-b border-slate-200 py-3 text-right">Acoes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {neutralNetworkOperators.length === 0 ? (
                      <tr><td colSpan={6} className="py-5 text-slate-500">Nenhum operador de rede neutra cadastrado.</td></tr>
                    ) : neutralNetworkOperators.map((user) => {
                      const accessControl = accessControlForOperator(user)
                      const adminBlocked = Boolean(accessControl?.administrativeBlockActive)
                      const accessBlocked = Boolean(accessControl?.state && accessControl.state !== "active_normal" && accessControl.state !== "confidence_release")

                      return (
                        <tr key={user.id} className={userId === user.id ? "bg-orange-50" : undefined}>
                          <td className="border-b border-slate-100 py-3 pr-4 font-medium">{user.name}</td>
                          <td className="border-b border-slate-100 py-3 pr-4 text-slate-600">{user.email}</td>
                          <td className="border-b border-slate-100 py-3 pr-4">
                            {user.cnpj ? (
                              <>
                                <p>{formatCnpj(user.cnpj)}</p>
                                <p className="text-xs text-slate-500">Cliente {user.hubsoftClientCode ?? user.hubsoftClientId ?? "-"} · Serviço {user.hubsoftClientServiceId ?? "-"}</p>
                                <p className="text-xs text-slate-500">{user.hubsoftPrimaryPhone || "-"} · {user.hubsoftPrimaryEmail || "-"}</p>
                              </>
                            ) : (
                              <span className="font-medium text-red-700">CNPJ obrigatório</span>
                            )}
                          </td>
                          <td className="border-b border-slate-100 py-3 pr-4">
                            {user.defaultProvisioningProfile ? (
                              <>
                                <p>{user.defaultProvisioningProfile.name}</p>
                                <p className="text-xs text-slate-500">VLAN {user.defaultProvisioningProfile.vlan ?? "sem VLAN"} · {user.provisioningProfileCount ?? 0} perfil(is)</p>
                              </>
                            ) : (
                              <span className="font-medium text-red-700">Obrigatorio</span>
                            )}
                          </td>
                          <td className="border-b border-slate-100 py-3 pr-4">
                            {accessControl ? (
                              <div className="grid gap-2">
                                <div>
                                  <p className={accessBlocked ? "font-semibold text-red-700" : "font-medium text-slate-800"}>{accessStateLabel(accessControl.state)}</p>
                                  <p className="text-xs text-slate-500">
                                    {Number(accessControl.overdueDays || 0)} dia(s) de atraso
                                    {accessControl.pendingAction ? " · pendente" : ""}
                                  </p>
                                  {adminBlocked ? <p className="text-xs font-medium text-orange-800">{accessControl.administrativeBlockReason || "Bloqueio manual"}</p> : null}
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  {adminBlocked ? (
                                    <button onClick={() => removeAdministrativeBlock(accessControl)} disabled={isLoading} className="rounded-[8px] border border-slate-300 px-3 py-2 text-xs font-medium disabled:opacity-60">Desbloquear manual</button>
                                  ) : (
                                    <button onClick={() => applyAdministrativeBlock(accessControl)} disabled={isLoading} className="rounded-[8px] border border-orange-200 px-3 py-2 text-xs font-medium text-orange-800 disabled:opacity-60">Bloquear manual</button>
                                  )}
                                  <button onClick={() => grantAccessConfidence(accessControl)} disabled={isLoading || adminBlocked} className="rounded-[8px] border border-emerald-200 px-3 py-2 text-xs font-medium text-emerald-700 disabled:opacity-50">Liberar confiança</button>
                                </div>
                              </div>
                            ) : (
                              <p className="text-sm text-slate-500">Conta financeira ainda não criada.</p>
                            )}
                          </td>
                          <td className="border-b border-slate-100 py-3">
                            <div className="flex justify-end gap-2">
                              <button onClick={() => selectUser(user)} className="rounded-[8px] border border-slate-300 px-3 py-2 text-sm font-medium">Editar</button>
                              <button onClick={() => void openUserContract(user)} className="rounded-[8px] border border-blue-200 px-3 py-2 text-sm font-medium text-blue-700">Contrato</button>
                              <button onClick={() => deleteUser(user)} disabled={isLoading || user.id === currentUserId} className="rounded-[8px] border border-red-200 px-3 py-2 text-sm font-medium text-red-700 disabled:cursor-not-allowed disabled:opacity-50">Excluir</button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Panel>
            <Panel title="Usuarios do sistema">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="text-slate-500">
                    <tr>
                      <th className="border-b border-slate-200 py-3 pr-4">Nome</th>
                      <th className="border-b border-slate-200 py-3 pr-4">Email</th>
                      <th className="border-b border-slate-200 py-3 pr-4">Perfil</th>
                      <th className="border-b border-slate-200 py-3 text-right">Acoes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {systemUsers.length === 0 ? (
                      <tr><td colSpan={4} className="py-5 text-slate-500">Nenhum usuario do sistema cadastrado.</td></tr>
                    ) : systemUsers.map((user) => (
                      <tr key={user.id} className={userId === user.id ? "bg-orange-50" : undefined}>
                        <td className="border-b border-slate-100 py-3 pr-4 font-medium">{user.name}</td>
                        <td className="border-b border-slate-100 py-3 pr-4 text-slate-600">{user.email}</td>
                        <td className="border-b border-slate-100 py-3 pr-4">Administrador</td>
                        <td className="border-b border-slate-100 py-3">
                          <div className="flex justify-end gap-2">
                            <button onClick={() => selectUser(user)} className="rounded-[8px] border border-slate-300 px-3 py-2 text-sm font-medium">Editar</button>
                            <button onClick={() => deleteUser(user)} disabled={isLoading || user.id === currentUserId} className="rounded-[8px] border border-red-200 px-3 py-2 text-sm font-medium text-red-700 disabled:cursor-not-allowed disabled:opacity-50">Excluir</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </section>
        ) : null}

        {activeTab === "billing" ? (
          <section className="grid gap-5">
            <div className="flex flex-wrap gap-2 rounded-[8px] border border-slate-200 bg-white p-2 shadow-sm">
              {[
                ["dashboard", "Dashboard"],
                ["accounts", "Contas"],
                ["runs", "Fechamentos"],
                ["invoices", "Faturas"],
                ["penalties", "Multas"],
                ["alerts", "Alertas"],
                ["access", "Acesso"],
              ].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setBillingTab(id as "dashboard" | "accounts" | "runs" | "invoices" | "penalties" | "alerts" | "access")}
                  className={`inline-flex min-h-8 items-center rounded-[8px] px-4 py-2 text-sm font-medium leading-none ${billingTab === id ? "bg-orange-800 text-white" : "text-slate-700 hover:bg-slate-50"}`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="grid gap-4 md:grid-cols-4">
              <Metric title="Contas financeiras" value={billingAccounts.length} detail={`${billingAccountsWithHubsoft.length} com id Hubsoft`} />
              <Metric title="Fechamentos" value={billingRuns.length} detail={`${billingReadyRuns.length} prontos`} tone={billingFailedRuns.length ? "danger" : "default"} />
              <Metric title="Faturas abertas" value={billingOpenInvoices.length} detail={formatMoney(billingOpenInvoiceAmountCents)} tone={billingOpenInvoices.some((invoice) => invoice.status === "overdue") ? "danger" : "default"} />
              <Metric title="Alertas financeiros" value={billingOpenAlerts.length} detail="pendentes de correção" tone={billingErrorAlerts.length ? "danger" : "default"} />
            </div>

            {billingTab === "dashboard" ? (
              <div className="grid items-start gap-5 2xl:grid-cols-[minmax(0,1fr)_360px]">
                <section className="grid min-w-0 content-start gap-5">
                  <Panel title="Resumo financeiro">
                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="rounded-[8px] border border-slate-200 bg-slate-50 p-4">
                        <p className="text-xs font-semibold uppercase text-slate-500">Gerado recente</p>
                        <p className="mt-2 text-2xl font-semibold text-slate-950">{formatMoney(billingCurrentRunTotalCents)}</p>
                        <p className="mt-1 text-sm text-slate-600">últimos 5 fechamentos</p>
                      </div>
                      <div className="rounded-[8px] border border-slate-200 bg-slate-50 p-4">
                        <p className="text-xs font-semibold uppercase text-slate-500">Sem Hubsoft</p>
                        <p className="mt-2 text-2xl font-semibold text-slate-950">{billingAccountsWithoutHubsoft.length}</p>
                        <p className="mt-1 text-sm text-slate-600">contas sem id de serviço</p>
                      </div>
                      <div className="rounded-[8px] border border-slate-200 bg-slate-50 p-4">
                        <p className="text-xs font-semibold uppercase text-slate-500">Falhas de envio</p>
                        <p className="mt-2 text-2xl font-semibold text-slate-950">{billingFailedRuns.length}</p>
                        <p className="mt-1 text-sm text-slate-600">fechamentos com erro</p>
                      </div>
                    </div>
                  </Panel>

                  <Panel title="Fechamentos recentes">
                    <BillingRunsTable runs={billingRuns.slice(0, 5)} />
                  </Panel>
                </section>

                <section className="grid content-start gap-5">
                  <Panel title="Regra ativa">
                    <div className="grid gap-4 text-sm">
                      <Info label="Fechamento" value={`Todo dia ${billingSettings?.closingDay ?? "-"}`} />
                      <Info label="Automação" value={billingSettings?.automaticClosingEnabled ? "Ativa para todos" : "Desativada"} />
                      <Info label="Vencimento padrão" value={`Dia ${billingSettings?.defaultDueDay ?? "-"}`} />
                      <Info label="Valor mínimo" value={formatMoney(billingSettings?.defaultMinimumAmountCents ?? 0)} />
                      <Info label="Franquia mínima" value={`${billingSettings?.defaultIncludedProvisionings ?? 0} provisionamentos`} />
                      <Info label="Excedente" value={formatMoney(billingSettings?.defaultExtraProvisioningAmountCents ?? 0)} />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab("settings")
                        setSettingsTab("billing")
                      }}
                      className="mt-4 rounded-[8px] border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
                    >
                      Configurações financeiras
                    </button>
                  </Panel>

                  <Panel title="Atenções">
                    <div className="grid gap-3 text-sm">
                      <Info label="Alertas abertos" value={String(billingOpenAlerts.length)} detail={`${billingErrorAlerts.length} críticos`} />
                      <Info label="Faturas abertas" value={String(billingOpenInvoices.length)} detail={formatMoney(billingOpenInvoiceAmountCents)} />
                      <Info label="Multas aprovadas" value={String(billingOpenPenalties.length)} detail={formatMoney(billingOpenPenaltyAmountCents)} />
                      <Info label="Contas sem Hubsoft" value={String(billingAccountsWithoutHubsoft.length)} />
                    </div>
                  </Panel>
                </section>
              </div>
            ) : null}

            {billingTab === "accounts" ? (
              <div className="grid gap-5">
                <Panel title="Contas financeiras">
                  <BillingAccountsList accounts={billingAccounts} selectedId={selectedBillingAccountId} onSelect={openBillingAccountModal} />
                </Panel>
              </div>
            ) : null}

            {billingTab === "runs" ? (
              <section className="grid gap-5">
                <Panel title="Gerar fechamento">
                  <div className="grid gap-3 md:grid-cols-[140px_140px_auto]">
                    <Field label="Ano">
                      <Input value={billingRunYear} onChange={setBillingRunYear} placeholder="2026" type="number" />
                    </Field>
                    <Field label="Mês">
                      <Input value={billingRunMonth} onChange={setBillingRunMonth} placeholder="5" type="number" />
                    </Field>
                    <div className="flex items-end">
                      <button onClick={generateBillingRun} disabled={isLoading} className="rounded-[8px] bg-orange-800 px-5 py-3 text-sm font-medium text-white disabled:opacity-60">Gerar fechamento</button>
                    </div>
                  </div>
                </Panel>
                <Panel title="Fechamentos gerados">
                  <BillingRunsTable runs={billingRuns} />
                </Panel>
              </section>
            ) : null}

            {billingTab === "invoices" ? (
              <section className="grid gap-5">
                <Panel title="Sincronizar faturas Hubsoft">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm text-slate-600">Atualiza as faturas existentes de cada operador pelo CNPJ cadastrado.</p>
                      <p className="mt-1 text-xs text-slate-500">Consulta Hubsoft: financeiro/fatura por cpf_cnpj.</p>
                    </div>
                    <button onClick={syncBillingInvoices} disabled={isLoading} className="rounded-[8px] bg-orange-800 px-5 py-3 text-sm font-medium text-white disabled:opacity-60">Sincronizar agora</button>
                  </div>
                </Panel>
                <Panel title="Faturas dos operadores">
                  <BillingInvoicesTable invoices={billingInvoices} />
                </Panel>
              </section>
            ) : null}

            {billingTab === "penalties" ? (
              <div className="grid gap-5 xl:grid-cols-[420px_1fr]">
                <Panel title="Aplicar multa">
                  <div className="grid gap-3">
                    <Field label="Operador">
                      <select value={penaltyBillingAccountId} onChange={(event) => setPenaltyBillingAccountId(event.target.value)} className="rounded-[8px] border border-slate-200 bg-white px-3 py-3 text-sm outline-none">
                        <option value="">Selecione</option>
                        {billingAccounts.map((account) => (
                          <option key={account.id} value={account.id}>{account.userName || account.landlordName || account.userEmail}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Valor da multa">
                      <Input value={penaltyAmount} onChange={setPenaltyAmount} placeholder="150,00" />
                    </Field>
                    <Field label="Motivo">
                      <Input value={penaltyReason} onChange={setPenaltyReason} placeholder="Motivo cabível" />
                    </Field>
                    <Field label="Comprovação / observação">
                      <TextArea value={penaltyEvidence} onChange={setPenaltyEvidence} placeholder="Descreva a evidência, regra descumprida ou referência operacional." />
                    </Field>
                    <button onClick={createBillingPenalty} disabled={isLoading} className="rounded-[8px] bg-orange-800 px-5 py-3 text-sm font-medium text-white disabled:opacity-60">Registrar multa</button>
                  </div>
                </Panel>
                <Panel title="Multas registradas">
                  <BillingPenaltiesTable penalties={billingPenalties} />
                </Panel>
              </div>
            ) : null}

            {billingTab === "alerts" ? (
              <Panel title="Alertas financeiros">
                <BillingAlertsTable alerts={billingAlerts} onResolve={resolveFinancialAlert} isLoading={isLoading} />
              </Panel>
            ) : null}

            {billingTab === "access" ? (
              <Panel title="Controle de acesso">
                <div className="mb-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
                  <div className="grid gap-3 md:grid-cols-4">
                    <Metric title="Bloqueados" value={accessBlockedControls.length} detail="parcial/total" tone={accessBlockedControls.length ? "danger" : "default"} />
                    <Metric title="Manual admin" value={accessAdministrativeBlocks.length} detail="prioridade maxima" tone={accessAdministrativeBlocks.length ? "danger" : "default"} />
                    <Metric title="Confiança" value={accessConfidenceReleases.length} detail="3 dias" />
                    <Metric title="Pendencias" value={accessPendingControls.length} detail={`${accessNotificationQueueCount} aviso(s)`} tone={accessPendingControls.length ? "danger" : "default"} />
                  </div>
                  <div className="rounded-[8px] border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                    <p className="font-semibold text-slate-950">Régua ativa</p>
                    <p className="mt-2">3 dias: aviso. 5 dias: aviso de suspensão. 10 dias: bloqueio parcial. 15 dias: bloqueio total.</p>
                    <p className="mt-2">Hubsoft é conferido a cada 15 minutos; bloqueio manual administrativo vence financeiro e confiança.</p>
                  </div>
                </div>

                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-slate-600">Use os botões por operador para bloqueio manual, remoção e liberação em confiança. Pendências são visíveis para todos os usuários internos.</p>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => evaluateAccessControls()} disabled={isLoading} className="rounded-[8px] border border-slate-300 px-5 py-3 text-sm font-medium text-slate-700 disabled:opacity-60">Reavaliar Hubsoft</button>
                    <button onClick={() => evaluateAccessControls({ sendNotifications: true })} disabled={isLoading} className="rounded-[8px] bg-orange-800 px-5 py-3 text-sm font-medium text-white disabled:opacity-60">Executar régua e avisar</button>
                  </div>
                </div>
                <AccessControlTable
                  items={accessControls}
                  onBlock={applyAdministrativeBlock}
                  onUnblock={removeAdministrativeBlock}
                  onConfidence={grantAccessConfidence}
                  isLoading={isLoading}
                />
              </Panel>
            ) : null}
          </section>
        ) : null}

        {activeTab === "contracts" ? <AdminContractsPanel /> : null}

        {activeTab === "settings" ? (
          <section className="grid gap-5">
            <div className="flex w-fit flex-wrap rounded-[8px] border border-slate-200 bg-white p-1 shadow-sm">
              <button
                onClick={() => setSettingsTab("application")}
                className={`rounded-[7px] px-4 py-2 text-sm font-medium ${settingsTab === "application" ? "bg-orange-800 text-white" : "text-slate-700"}`}
              >
                Aplicação
              </button>
              <button
                onClick={() => setSettingsTab("monitoring")}
                className={`rounded-[7px] px-4 py-2 text-sm font-medium ${settingsTab === "monitoring" ? "bg-orange-800 text-white" : "text-slate-700"}`}
              >
                Monitoramento
              </button>
              <button
                onClick={() => setSettingsTab("integrations")}
                className={`rounded-[7px] px-4 py-2 text-sm font-medium ${settingsTab === "integrations" ? "bg-orange-800 text-white" : "text-slate-700"}`}
              >
                Integrações
              </button>
              <button
                onClick={() => setSettingsTab("billing")}
                className={`rounded-[7px] px-4 py-2 text-sm font-medium ${settingsTab === "billing" ? "bg-orange-800 text-white" : "text-slate-700"}`}
              >
                Financeiro
              </button>
              <button
                onClick={() => setSettingsTab("notifications")}
                className={`rounded-[7px] px-4 py-2 text-sm font-medium ${settingsTab === "notifications" ? "bg-orange-800 text-white" : "text-slate-700"}`}
              >
                Notificações
              </button>
            </div>

            {settingsTab === "application" ? (
              <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
                <Panel title="Dados da aplicacao">
                  <div className="grid gap-4">
                    <div className="grid gap-3 md:grid-cols-3">
                      <Field label="Nome da aplicacao">
                        <Input value={applicationForm.applicationName} onChange={(value) => setApplicationField("applicationName", value)} placeholder={defaultApplicationSettings.applicationName} />
                      </Field>
                      <Field label="Empresa">
                        <Input value={applicationForm.companyName} onChange={(value) => setApplicationField("companyName", value)} placeholder={defaultApplicationSettings.companyName} />
                      </Field>
                      <Field label="Razao social">
                        <Input value={applicationForm.companyLegalName} onChange={(value) => setApplicationField("companyLegalName", value)} placeholder="Razao social da empresa" />
                      </Field>
                    </div>
                    <div className="grid gap-4 rounded-[8px] border border-slate-200 bg-slate-50 p-4">
                      <div className="grid gap-3 md:grid-cols-2">
                        <LogoPicker
                          label="Logo tema claro"
                          logo={applicationForm.companyLogo}
                          previewClassName="bg-white"
                          onChange={(file) => handleApplicationLogoChange("companyLogo", file)}
                          onRemove={() => setApplicationField("companyLogo", null)}
                        />
                        <LogoPicker
                          label="Logo tema escuro"
                          logo={applicationForm.companyLogoDark}
                          previewClassName="bg-slate-950"
                          onChange={(file) => handleApplicationLogoChange("companyLogoDark", file)}
                          onRemove={() => setApplicationField("companyLogoDark", null)}
                        />
                      </div>
                      <div className="grid gap-3">
                        <Check checked={applicationForm.useCompanyLogo} onChange={(value) => setApplicationField("useCompanyLogo", value)} label="Usar logo no lugar do nome" />
                        <p className="text-xs text-slate-500">PNG, JPG ou WebP ate 750 KB. Se o logo escuro nao for definido, o sistema usa o logo claro como alternativa.</p>
                      </div>
                    </div>
                    <div className="grid gap-3 md:grid-cols-3">
                      <Field label="CNPJ / Documento">
                        <Input value={applicationForm.companyDocument} onChange={(value) => setApplicationField("companyDocument", value)} placeholder="Documento da empresa" />
                      </Field>
                      <Field label="Email de suporte">
                        <Input value={applicationForm.supportEmail} onChange={(value) => setApplicationField("supportEmail", value)} placeholder="suporte@empresa.com.br" type="email" />
                      </Field>
                      <Field label="Telefone">
                        <Input value={applicationForm.supportPhone} onChange={(value) => setApplicationField("supportPhone", value)} placeholder="(00) 00000-0000" />
                      </Field>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <Field label="Site">
                        <Input value={applicationForm.websiteUrl} onChange={(value) => setApplicationField("websiteUrl", value)} placeholder="https://empresa.com.br" />
                      </Field>
                      <Field label="Endereco">
                        <Input value={applicationForm.address} onChange={(value) => setApplicationField("address", value)} placeholder="Endereco comercial" />
                      </Field>
                    </div>
                    <div className="grid gap-3 md:grid-cols-[1fr_160px_100px]">
                      <Field label="Cidade">
                        <Input value={applicationForm.city} onChange={(value) => setApplicationField("city", value)} placeholder="Manaus" />
                      </Field>
                      <Field label="CEP">
                        <Input value={applicationForm.addressPostalCode} onChange={(value) => setApplicationField("addressPostalCode", value)} placeholder="00000-000" />
                      </Field>
                      <Field label="UF">
                        <Input value={applicationForm.state} onChange={(value) => setApplicationField("state", value)} placeholder="AM" />
                      </Field>
                    </div>
                    <Field label="Descricao curta">
                      <TextArea value={applicationForm.description} onChange={(value) => setApplicationField("description", value)} placeholder="Descricao exibida para administradores e operadores." />
                    </Field>
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
                      <Field label="Raio de viabilidade">
                        <Input
                          value={String(applicationForm.viabilityRadiusMeters)}
                          onChange={(value) => setApplicationField("viabilityRadiusMeters", Number(value))}
                          placeholder="150"
                          type="number"
                        />
                      </Field>
                      <div className="rounded-[8px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                        Usado na consulta local por CTO com porta livre.
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-4">
                      <button onClick={saveApplicationSettings} disabled={isLoading} className="rounded-[8px] bg-orange-800 px-5 py-3 text-sm font-medium text-white disabled:opacity-60">Salvar dados</button>
                      <button onClick={() => setApplicationForm(applicationSettings)} className="rounded-[8px] border border-slate-300 px-5 py-3 text-sm font-medium">Desfazer alteracoes</button>
                    </div>
                  </div>
                </Panel>

                <Panel title="Resumo">
                  <div className="grid gap-4 text-sm">
                    <div className="rounded-[8px] border border-orange-200 bg-orange-50 p-4">
                      {applicationSettings.useCompanyLogo && applicationSettings.companyLogo ? (
                        <Image
                          src={applicationSettings.companyLogo}
                          alt={applicationSettings.companyName}
                          width={180}
                          height={56}
                          unoptimized
                          className="mb-3 max-h-12 w-auto max-w-full object-contain"
                        />
                      ) : (
                        <p className="text-xs font-semibold uppercase text-orange-700">{applicationSettings.companyName}</p>
                      )}
                      <p className="mt-2 text-xl font-semibold text-orange-950">{applicationSettings.applicationName}</p>
                      <p className="mt-1 text-orange-900">{applicationSettings.description || "Sem descricao configurada."}</p>
                    </div>
                    <Info label="Empresa" value={applicationSettings.companyName} detail={applicationSettings.companyDocument || undefined} />
                    <Info label="Razao social" value={applicationSettings.companyLegalName || "Nao informada"} />
                    <Info label="Contato" value={applicationSettings.supportEmail || "Sem email"} detail={applicationSettings.supportPhone || undefined} />
                    <Info label="Site" value={applicationSettings.websiteUrl || "Sem site"} />
                    <Info label="Endereco" value={applicationSettings.address || "Sem endereco"} detail={[applicationSettings.city, applicationSettings.state, applicationSettings.addressPostalCode].filter(Boolean).join(" / ") || undefined} />
                    <Info label="Raio de viabilidade" value={`${applicationSettings.viabilityRadiusMeters}m`} />
                  </div>
                </Panel>
              </div>
            ) : null}

            {settingsTab === "monitoring" ? (
              <div className="grid gap-5 lg:grid-cols-2">
                <Panel title="Monitoramento OLT">
                  <div className="grid gap-3">
                    <div className="grid gap-3 sm:grid-cols-[1fr_140px_140px]">
                      <Check checked={oltMonitoringEnabled} onChange={setOltMonitoringEnabled} label="Ativo" />
                      <Input value={oltMonitoringInterval} onChange={setOltMonitoringInterval} placeholder="Minutos" type="number" />
                      <Input value={oltTrafficInterval} onChange={setOltTrafficInterval} placeholder="Tráfego s" type="number" />
                    </div>
                    <div className="grid gap-3 rounded-[8px] bg-slate-50 p-4 text-sm sm:grid-cols-2">
                      <Info label="Ultima execucao" value={oltMonitoringSettings?.lastFinishedAt ? new Date(oltMonitoringSettings.lastFinishedAt).toLocaleString("pt-BR") : "sem registro"} />
                      <Info label="OLTs verificadas" value={String(oltMonitoringSettings?.lastActiveChecked ?? 0)} detail={`${oltMonitoringSettings?.lastFailed ?? 0} falhas`} />
                    </div>
                    {oltMonitoringSettings?.lastError ? <p className="rounded-[8px] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{oltMonitoringSettings.lastError}</p> : null}
                    <div className="flex flex-wrap gap-2">
                      <button onClick={saveOltMonitoring} disabled={isLoading} className="rounded-[8px] bg-orange-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">Salvar</button>
                      <button onClick={runOltMonitoringNow} disabled={isLoading} className="rounded-[8px] border border-slate-300 px-4 py-2 text-sm font-medium disabled:opacity-60">Executar agora</button>
                    </div>
                  </div>
                </Panel>

                <Panel title="Monitoramento ONU/CPE">
                  <div className="grid gap-3">
                    <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
                      <Check checked={onuMonitoringEnabled} onChange={setOnuMonitoringEnabled} label="Ativo" />
                      <Input value={onuMonitoringInterval} onChange={setOnuMonitoringInterval} placeholder="Minutos" type="number" />
                    </div>
                    <div className="grid gap-3 rounded-[8px] bg-slate-50 p-4 text-sm sm:grid-cols-2">
                      <Info label="Ultima execucao" value={onuMonitoringSettings?.lastFinishedAt ? new Date(onuMonitoringSettings.lastFinishedAt).toLocaleString("pt-BR") : "sem registro"} />
                      <Info label="CPEs verificadas" value={String(onuMonitoringSettings?.lastActiveChecked ?? 0)} detail={`${onuMonitoringSettings?.lastFailed ?? 0} falhas`} />
                    </div>
                    {onuMonitoringSettings?.lastError ? <p className="rounded-[8px] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{onuMonitoringSettings.lastError}</p> : null}
                    <div className="flex flex-wrap gap-2">
                      <button onClick={saveOnuMonitoring} disabled={isLoading} className="rounded-[8px] bg-orange-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">Salvar</button>
                      <button onClick={runOnuMonitoringNow} disabled={isLoading} className="rounded-[8px] border border-slate-300 px-4 py-2 text-sm font-medium disabled:opacity-60">Executar agora</button>
                    </div>
                  </div>
                </Panel>
              </div>
            ) : null}

            {settingsTab === "integrations" ? (
              <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
                <Panel title="GenieACS">
                  <div className="grid gap-4">
                    <div className="grid gap-3 md:grid-cols-[1fr_160px]">
                      <Field label="URL NBI">
                        <Input value={genieAcsForm.baseUrl} onChange={(value) => setGenieAcsField("baseUrl", value)} placeholder="http://genieacs:7557" />
                      </Field>
                      <Check checked={genieAcsForm.enabled} onChange={(value) => setGenieAcsField("enabled", value)} label="Ativo" />
                    </div>
                    <div className="grid gap-3 md:grid-cols-[220px_1fr]">
                      <Field label="Header auth">
                        <Input value={genieAcsForm.authHeaderName} onChange={(value) => setGenieAcsField("authHeaderName", value)} placeholder="Authorization" />
                      </Field>
                      <Field label="Valor auth">
                        <Input value={genieAcsForm.authHeaderValue || ""} onChange={(value) => setGenieAcsField("authHeaderValue", value)} placeholder={genieAcsSettings.authHeaderValueSet ? "credencial salva" : "Bearer token"} type="password" />
                      </Field>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <Field label="Serial ZTE">
                        <Input value={genieAcsForm.serialParameter} onChange={(value) => setGenieAcsField("serialParameter", value)} placeholder={defaultGenieAcsSettings.serialParameter} />
                      </Field>
                      <Field label="Espera pós-provisionamento">
                        <Input value={String(genieAcsForm.provisioningWaitSeconds)} onChange={(value) => setGenieAcsField("provisioningWaitSeconds", Number(value))} placeholder="45" type="number" />
                      </Field>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <Field label="Parâmetro SSID">
                        <Input value={genieAcsForm.wifiSsidParameter} onChange={(value) => setGenieAcsField("wifiSsidParameter", value)} placeholder={defaultGenieAcsSettings.wifiSsidParameter} />
                      </Field>
                      <Field label="Parâmetro senha Wi-Fi">
                        <Input value={genieAcsForm.wifiPasswordParameter} onChange={(value) => setGenieAcsField("wifiPasswordParameter", value)} placeholder={defaultGenieAcsSettings.wifiPasswordParameter} />
                      </Field>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <Field label="Parâmetro SSID 5G">
                        <Input value={genieAcsForm.wifi5SsidParameter} onChange={(value) => setGenieAcsField("wifi5SsidParameter", value)} placeholder={defaultGenieAcsSettings.wifi5SsidParameter} />
                      </Field>
                      <Field label="Parâmetro senha Wi-Fi 5G">
                        <Input value={genieAcsForm.wifi5PasswordParameter} onChange={(value) => setGenieAcsField("wifi5PasswordParameter", value)} placeholder={defaultGenieAcsSettings.wifi5PasswordParameter} />
                      </Field>
                    </div>
                    <div className="grid gap-3 md:grid-cols-[1fr_160px_180px]">
                      <Field label="Objeto hosts">
                        <Input value={genieAcsForm.hostsObjectPath} onChange={(value) => setGenieAcsField("hostsObjectPath", value)} placeholder={defaultGenieAcsSettings.hostsObjectPath} />
                      </Field>
                      <Field label="Timeout ms">
                        <Input value={String(genieAcsForm.connectionRequestTimeoutMs)} onChange={(value) => setGenieAcsField("connectionRequestTimeoutMs", Number(value))} placeholder="10000" type="number" />
                      </Field>
                      <Check checked={genieAcsForm.connectionRequest} onChange={(value) => setGenieAcsField("connectionRequest", value)} label="Connection request" />
                    </div>
                    <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-4">
                      <button onClick={saveGenieAcsSettings} disabled={isLoading} className="rounded-[8px] bg-orange-800 px-5 py-3 text-sm font-medium text-white disabled:opacity-60">Salvar GenieACS</button>
                      <button onClick={testGenieAcsSettings} disabled={isLoading || !genieAcsForm.baseUrl.trim()} className="rounded-[8px] border border-slate-300 px-5 py-3 text-sm font-medium disabled:opacity-60">Testar conexão</button>
                    </div>
                  </div>
                </Panel>

                <Panel title="Status">
                  <div className="grid gap-3 text-sm">
                    <Info label="Integração" value={genieAcsSettings.enabled ? "Ativa" : "Inativa"} />
                    <Info label="Último teste" value={genieAcsSettings.lastConnectionTestAt ? new Date(genieAcsSettings.lastConnectionTestAt).toLocaleString("pt-BR") : "sem registro"} detail={genieAcsSettings.lastConnectionStatus || undefined} />
                    <Info label="Busca inicial" value={genieAcsSettings.serialParameter} detail="homologação ZTE" />
                    {genieAcsSettings.lastError ? <p className="rounded-[8px] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{genieAcsSettings.lastError}</p> : null}
                  </div>
                </Panel>
              </div>
            ) : null}

            {settingsTab === "billing" ? (
              <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
                <Panel title="Configuração financeira padrão">
                  <div className="grid gap-4">
                    <div className="grid gap-3 md:grid-cols-2">
                      <Field label="Dia global de fechamento">
                        <Input value={billingClosingDay} onChange={setBillingClosingDay} placeholder="25" type="number" />
                      </Field>
                      <Field label="Vencimento padrão">
                        <Input value={billingDefaultDueDay} onChange={setBillingDefaultDueDay} placeholder="10" type="number" />
                      </Field>
                    </div>
                    <Check checked={billingAutomaticClosingEnabled} onChange={setBillingAutomaticClosingEnabled} label={`Ativar fechamento automático para todos no dia ${billingClosingDay || billingSettings?.closingDay || "-"}`} />
                    <div className="grid gap-3 md:grid-cols-3">
                      <Field label="Mínimo mensal padrão">
                        <Input value={billingDefaultMinimumAmount} onChange={setBillingDefaultMinimumAmount} placeholder="300,00" />
                      </Field>
                      <Field label="Provisionamentos inclusos">
                        <Input value={billingDefaultIncludedProvisionings} onChange={setBillingDefaultIncludedProvisionings} placeholder="10" type="number" />
                      </Field>
                      <Field label="Valor por excedente">
                        <Input value={billingDefaultExtraAmount} onChange={setBillingDefaultExtraAmount} placeholder="35,00" />
                      </Field>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <Field label="Forma de cobrança">
                        <Input value={billingDefaultBillingMethod} onChange={setBillingDefaultBillingMethod} placeholder="Boleto bancario" />
                      </Field>
                      <Field label="Tipo de cobrança">
                        <Input value={billingDefaultChargeType} onChange={setBillingDefaultChargeType} placeholder="Mensalidade recorrente" />
                      </Field>
                    </div>
                    <div className="grid gap-3 md:grid-cols-3">
                      <Field label="Taxa de instalação">
                        <Input value={billingDefaultInstallationFee} onChange={setBillingDefaultInstallationFee} placeholder="0,00" />
                      </Field>
                      <Field label="Parcelas da instalação">
                        <Input value={billingDefaultInstallationInstallments} onChange={setBillingDefaultInstallationInstallments} placeholder="1" type="number" />
                      </Field>
                      <Field label="Vigência contratual (meses)">
                        <Input value={billingDefaultContractTermMonths} onChange={setBillingDefaultContractTermMonths} placeholder="12" type="number" />
                      </Field>
                    </div>
                    <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-4">
                      <button onClick={saveBillingSettings} disabled={isLoading} className="rounded-[8px] bg-orange-800 px-5 py-3 text-sm font-medium text-white disabled:opacity-60">Salvar configuração</button>
                      <button onClick={() => void refreshBillingData()} disabled={isLoading} className="rounded-[8px] border border-slate-300 px-5 py-3 text-sm font-medium disabled:opacity-60">Recarregar</button>
                    </div>
                  </div>
                </Panel>

                <Panel title="Regra ativa">
                  <div className="grid gap-4 text-sm">
                    <Info label="Fechamento" value={`Todo dia ${billingSettings?.closingDay ?? "-"}`} />
                    <Info label="Automação" value={billingSettings?.automaticClosingEnabled ? "Ativa para todos" : "Desativada"} detail={billingSettings?.lastAutomaticClosingAt ? `Último: ${formatDateTime(billingSettings.lastAutomaticClosingAt)}` : undefined} />
                    {billingSettings?.lastAutomaticClosingError ? <Info label="Falha automática" value={billingSettings.lastAutomaticClosingError} /> : null}
                    <Info label="Vencimento padrão" value={`Dia ${billingSettings?.defaultDueDay ?? "-"}`} />
                    <Info label="Valor mínimo" value={formatMoney(billingSettings?.defaultMinimumAmountCents ?? 0)} />
                    <Info label="Franquia mínima" value={`${billingSettings?.defaultIncludedProvisionings ?? 0} provisionamentos`} />
                    <Info label="Excedente" value={formatMoney(billingSettings?.defaultExtraProvisioningAmountCents ?? 0)} />
                    <Info label="Cobrança" value={billingSettings?.defaultBillingMethod || "-"} detail={billingSettings?.defaultChargeType || undefined} />
                    <Info label="Instalação" value={formatMoney(billingSettings?.defaultInstallationFeeCents ?? 0)} detail={`${billingSettings?.defaultInstallationInstallments ?? 1} parcela(s)`} />
                    <Info label="Vigência" value={`${billingSettings?.defaultContractTermMonths ?? 12} mes(es)`} />
                  </div>
                </Panel>
              </div>
            ) : null}

            {settingsTab === "notifications" ? (
              <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
                <section className="grid gap-5">
                  <Panel title="E-mail SMTP">
                    <div className="grid gap-4">
                      <Check checked={notificationForm.emailEnabled} onChange={(value) => setNotificationField("emailEnabled", value)} label="Ativar envio por e-mail" />
                      <div className="grid gap-3 md:grid-cols-[1fr_140px_140px]">
                        <Field label="Servidor SMTP">
                          <Input value={notificationForm.smtpHost} onChange={(value) => setNotificationField("smtpHost", value)} placeholder="smtp.empresa.com.br" />
                        </Field>
                        <Field label="Porta">
                          <Input value={String(notificationForm.smtpPort)} onChange={(value) => setNotificationField("smtpPort", Number(value))} placeholder="587" type="number" />
                        </Field>
                        <Check checked={notificationForm.smtpSecure} onChange={(value) => setNotificationField("smtpSecure", value)} label="TLS direto" />
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <Field label="Usuário">
                          <Input value={notificationForm.smtpUser} onChange={(value) => setNotificationField("smtpUser", value)} placeholder="usuario SMTP" />
                        </Field>
                        <Field label={notificationSettings.smtpPasswordSet ? "Senha SMTP (preencha para trocar)" : "Senha SMTP"}>
                          <Input value={notificationForm.smtpPassword} onChange={(value) => setNotificationField("smtpPassword", value)} placeholder={notificationSettings.smtpPasswordSet ? "senha salva" : "senha"} type="password" />
                        </Field>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <Field label="E-mail remetente">
                          <Input value={notificationForm.smtpFromEmail} onChange={(value) => setNotificationField("smtpFromEmail", value)} placeholder="financeiro@empresa.com.br" type="email" />
                        </Field>
                        <Field label="Nome remetente">
                          <Input value={notificationForm.smtpFromName} onChange={(value) => setNotificationField("smtpFromName", value)} placeholder="Financeiro" />
                        </Field>
                      </div>
                    </div>
                  </Panel>

                  <Panel title="WhatsApp Gateway">
                    <div className="grid gap-4">
                      <Check checked={notificationForm.whatsappEnabled} onChange={(value) => setNotificationField("whatsappEnabled", value)} label="Ativar envio por WhatsApp" />
                      <div className="grid gap-3 md:grid-cols-[1fr_140px]">
                        <Field label="URL do gateway">
                          <Input value={notificationForm.whatsappGatewayUrl} onChange={(value) => setNotificationField("whatsappGatewayUrl", value)} placeholder="https://gateway.exemplo/send" />
                        </Field>
                        <Field label="Método">
                          <select value={notificationForm.whatsappMethod} onChange={(event) => setNotificationField("whatsappMethod", event.target.value as "POST" | "GET")} className="rounded-[8px] border border-slate-200 bg-white px-3 py-3 text-sm outline-none">
                            <option value="POST">POST</option>
                            <option value="GET">GET</option>
                          </select>
                        </Field>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <Field label="Header do token">
                          <Input value={notificationForm.whatsappTokenHeader} onChange={(value) => setNotificationField("whatsappTokenHeader", value)} placeholder="Authorization" />
                        </Field>
                        <Field label={notificationSettings.whatsappTokenSet ? "Token (preencha para trocar)" : "Token"}>
                          <Input value={notificationForm.whatsappToken} onChange={(value) => setNotificationField("whatsappToken", value)} placeholder={notificationSettings.whatsappTokenSet ? "token salvo" : "token"} type="password" />
                        </Field>
                      </div>
                      <Field label="Corpo JSON do WhatsApp">
                        <TextArea value={notificationForm.whatsappBodyTemplate} onChange={(value) => setNotificationField("whatsappBodyTemplate", value)} placeholder='{"phone":"{{telefone}}","message":"{{mensagem}}"}' />
                      </Field>
                    </div>
                  </Panel>

                  <Panel title="Templates das mensagens">
                    <div className="grid gap-5">
                      {notificationTemplateStages.map((stage) => (
                        <div key={stage.id} className="grid gap-3 rounded-[8px] border border-slate-200 bg-slate-50 p-4">
                          <p className="font-semibold text-slate-950">{stage.label}</p>
                          <Field label="Assunto do e-mail">
                            <Input value={notificationForm.templates[stage.id].emailSubject} onChange={(value) => setNotificationTemplateField(stage.id, "emailSubject", value)} placeholder="Assunto" />
                          </Field>
                          <Field label="Mensagem">
                            <TextArea value={notificationForm.templates[stage.id].message} onChange={(value) => setNotificationTemplateField(stage.id, "message", value)} placeholder="Mensagem" />
                          </Field>
                        </div>
                      ))}
                    </div>
                  </Panel>
                </section>

                <section className="grid content-start gap-5">
                  <Panel title="Entrega">
                    <div className="grid gap-4 text-sm">
                      <Info label="E-mail" value={notificationSettings.emailEnabled ? "Ativo" : "Desativado"} detail={notificationSettings.smtpHost || undefined} />
                      <Info label="WhatsApp" value={notificationSettings.whatsappEnabled ? "Ativo" : "Desativado"} detail={notificationSettings.whatsappGatewayUrl || undefined} />
                      <Field label="Tentativas por aviso">
                        <Input value={String(notificationForm.maxAttempts)} onChange={(value) => setNotificationField("maxAttempts", Number(value))} placeholder="3" type="number" />
                      </Field>
                      <div className="rounded-[8px] bg-slate-50 p-4 text-slate-600">
                        Variáveis disponíveis: {"{{cliente}}"}, {"{{dias_atraso}}"}, {"{{empresa}}"}, {"{{portal_url}}"}, {"{{telefone}}"} e {"{{mensagem}}"} no corpo do WhatsApp.
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button onClick={saveNotificationSettings} disabled={isLoading} className="rounded-[8px] bg-orange-800 px-5 py-3 text-sm font-medium text-white disabled:opacity-60">Salvar notificações</button>
                        <button onClick={processNotificationQueueNow} disabled={isLoading} className="rounded-[8px] border border-slate-300 px-5 py-3 text-sm font-medium disabled:opacity-60">Processar fila agora</button>
                      </div>
                    </div>
                  </Panel>
                </section>
              </div>
            ) : null}
          </section>
        ) : null}

        {activeTab === "infra" ? (
          <section className="grid gap-5">
            <div className="flex w-fit rounded-[8px] border border-slate-200 bg-white p-1 shadow-sm">
              <button
                onClick={() => setInfraTab("olts")}
                className={`rounded-[7px] px-4 py-2 text-sm font-medium ${infraTab === "olts" ? "bg-orange-800 text-white" : "text-slate-700"}`}
              >
                OLTs
              </button>
              <button
                onClick={() => setInfraTab("ctos")}
                className={`rounded-[7px] px-4 py-2 text-sm font-medium ${infraTab === "ctos" ? "bg-orange-800 text-white" : "text-slate-700"}`}
              >
                CTOs
              </button>
              <button
                onClick={() => setInfraTab("models")}
                className={`rounded-[7px] px-4 py-2 text-sm font-medium ${infraTab === "models" ? "bg-orange-800 text-white" : "text-slate-700"}`}
              >
                Modelos ONU
              </button>
              <button
                onClick={() => setInfraTab("profiles")}
                className={`rounded-[7px] px-4 py-2 text-sm font-medium ${infraTab === "profiles" ? "bg-orange-800 text-white" : "text-slate-700"}`}
              >
                Perfis
              </button>
            </div>

            {infraTab === "olts" ? (
            <Panel title="OLTs cadastradas">
              <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(240px,320px)_minmax(0,1fr)]">
                <div className="grid min-w-0 content-start gap-3">
                  {oltDevices.map((device) => (
                    <button
                      key={device.id}
                      onClick={() => selectDevice(device)}
                      className={`rounded-[8px] border p-4 text-left ${deviceId === device.id ? "border-orange-300 bg-orange-50" : "border-slate-200 bg-slate-50"}`}
                    >
                      <p className="font-semibold">{device.name}</p>
                      <p className="text-sm text-slate-600">{device.host}:{device.port}</p>
                      <p className="text-xs text-slate-500">{device.manufacturer} {device.model}</p>
                    </button>
                  ))}
                </div>
                <div className="grid min-w-0 gap-4">
                  <div className="flex flex-col gap-3 border-b border-slate-200 pb-3 md:flex-row md:items-center md:justify-between">
                    <div className="flex w-fit rounded-[8px] border border-slate-200 bg-slate-50 p-1">
                      <button
                        onClick={() => setOltEditTab("dados")}
                        className={`rounded-[7px] px-4 py-2 text-sm font-medium ${oltEditTab === "dados" ? "bg-white text-orange-800 shadow-sm" : "text-slate-600"}`}
                      >
                        Dados
                      </button>
                      <button
                        onClick={() => setOltEditTab("interfaces")}
                        disabled={!deviceId}
                        className={`rounded-[7px] px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${oltEditTab === "interfaces" ? "bg-white text-orange-800 shadow-sm" : "text-slate-600"}`}
                      >
                        Interfaces
                      </button>
                      <button
                        onClick={() => setOltEditTab("commands")}
                        className={`rounded-[7px] px-4 py-2 text-sm font-medium ${oltEditTab === "commands" ? "bg-white text-orange-800 shadow-sm" : "text-slate-600"}`}
                      >
                        Comandos
                      </button>
                    </div>
                    <button onClick={resetDeviceForm} className="w-fit rounded-[8px] border border-slate-300 px-4 py-2 text-sm font-medium">Nova OLT</button>
                  </div>

                  {oltEditTab === "dados" ? (
                    <div className="grid min-w-0 gap-3">
                      <div className="grid min-w-0 gap-3 md:grid-cols-3">
                        <Input value={deviceName} onChange={setDeviceName} placeholder="Nome" />
                        <Input value={ipv4} onChange={(value) => { setIpv4(value); setHost(value) }} placeholder="IPv4" />
                        <Input value={ipv6} onChange={setIpv6} placeholder="IPv6" />
                      </div>
                      <div className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <Input value={manufacturer} onChange={setManufacturer} placeholder="Fabricante" />
                        <Input value={model} onChange={setModel} placeholder="Modelo" />
                        <Input value={pop} onChange={setPop} placeholder="POP" />
                        <Input value={managementServer} onChange={setManagementServer} placeholder="Gerenciamento" />
                      </div>
                      <Input value={host} onChange={setHost} placeholder="Host" />
                      <div className="grid min-w-0 gap-3 md:grid-cols-[minmax(0,1fr)_120px]">
                        <Input value={username} onChange={setUsername} placeholder="Usuario SSH" />
                        <Input value={sshPort} onChange={setSshPort} placeholder="Porta" type="number" />
                      </div>
	                      <div className={`grid min-w-0 gap-3 ${useEnableMode ? "md:grid-cols-2" : ""}`}>
	                        <Input value={sshPassword} onChange={setSshPassword} placeholder={deviceId ? "Senha SSH nova" : "Senha SSH"} type="password" />
	                        {useEnableMode ? (
	                          <Input value={enablePassword} onChange={setEnablePassword} placeholder={deviceId ? "Senha enable nova" : "Senha enable"} type="password" />
	                        ) : null}
	                      </div>
	                      <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(160px,180px)_150px_120px_120px]">
	                        <select value={deviceDriver} onChange={(event) => setDeviceDriver(event.target.value)} className="w-full min-w-0 rounded-[8px] border border-slate-200 bg-white px-3 py-3 text-sm outline-none">
	                          {driverOptions(oltDrivers).map((driver) => <option key={driver.id} value={driver.id}>{driver.label}</option>)}
	                        </select>
	                        <Check checked={useEnableMode} onChange={toggleEnableMode} label="Usar enable" />
	                        <Check checked={deviceDefault} onChange={setDeviceDefault} label="Padrao" />
	                        <Check checked={deviceActive} onChange={setDeviceActive} label="Ativa" />
	                      </div>
                      <div className="grid min-w-0 gap-3 rounded-[8px] border border-slate-200 bg-slate-50 p-4">
                        <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-[150px_120px_minmax(0,1fr)_120px_160px]">
                          <Check checked={snmpEnabled} onChange={setSnmpEnabled} label="SNMP" />
                          <select value={snmpVersion} onChange={(event) => setSnmpVersion(event.target.value)} className="w-full min-w-0 rounded-[8px] border border-slate-200 bg-white px-3 py-3 text-sm outline-none">
                            <option value="2c">v2c</option>
                            <option value="3">v3</option>
                          </select>
                          <Input value={snmpCommunity} onChange={setSnmpCommunity} placeholder={deviceId ? "Community SNMP nova" : "Community SNMP"} type="password" />
                          <Input value={snmpPort} onChange={setSnmpPort} placeholder="Porta SNMP" type="number" />
                          <select value={snmpVendor} onChange={(event) => setSnmpVendor(event.target.value)} className="w-full min-w-0 rounded-[8px] border border-slate-200 bg-white px-3 py-3 text-sm outline-none">
                            <option value="zte_titan">ZTE/Titan</option>
                            <option value="zte_c600">ZTE C600</option>
                            <option value="zte_c650">ZTE C650</option>
                          </select>
                        </div>
                        <p className="text-xs text-slate-500">
                          {selectedDevice?.hasSnmpCommunity ? "Community SNMP ja cadastrada. Preencha apenas para trocar." : "Informe a community para habilitar a coleta SNMP."}
                        </p>
                      </div>
                      <button onClick={saveDevice} disabled={isLoading} className="w-fit rounded-[8px] bg-orange-800 px-5 py-3 text-sm font-medium text-white disabled:opacity-60">Salvar OLT</button>
                    </div>
	                  ) : null}

                  {oltEditTab === "commands" ? (
                    <div className="grid gap-3">
                      <div className="grid gap-3 md:grid-cols-2">
                        <Field label="Terminal sem paginacao">
                          <Input value={terminalLengthCommand} onChange={setTerminalLengthCommand} placeholder="terminal length 0" />
                        </Field>
                        <Field label="Entrar em configuracao">
                          <Input value={enterConfigCommand} onChange={setEnterConfigCommand} placeholder="conf t" />
                        </Field>
                        <Field label="Salvar configuracao">
                          <Input value={saveConfigCommand} onChange={setSaveConfigCommand} placeholder="write" />
                        </Field>
	                        <Field label="Consultar ONUs da PON">
	                          <Input value={showOnuStateCommand} onChange={setShowOnuStateCommand} placeholder="show gpon onu state gpon_olt-[[chassi]]/[[slot]]/[[pon]]" />
	                        </Field>
	                        <Field label="Consultar ONU por serial">
	                          <Input value={serialLookupCommand} onChange={setSerialLookupCommand} placeholder="show gpon onu by sn [[serial]]" />
	                        </Field>
	                      </div>
                      <CommandArea title="Reboot da ONU" value={rebootOnuCommand} onChange={setRebootOnuCommand} rows={3} />
                      <CommandArea title="Comandos de saida" value={exitCommands} onChange={setExitCommands} rows={4} />
                      <button onClick={saveDevice} disabled={isLoading} className="w-fit rounded-[8px] bg-orange-800 px-5 py-3 text-sm font-medium text-white disabled:opacity-60">Salvar comandos</button>
                    </div>
                  ) : null}

                  {oltEditTab === "interfaces" ? (
                    <div className="grid gap-4">
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{selectedDevice ? `${selectedDevice.name} - ${selectedDevice.host}` : deviceName}</p>
                          <p className="text-xs text-slate-500">{selectedDeviceInterfaces.length} interfaces cadastradas</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button onClick={() => { resetInterfaceForm(); setShowInterfaceModal(true) }} className="w-fit rounded-[8px] border border-slate-300 px-4 py-2 text-sm font-medium">Nova interface</button>
                          <button onClick={() => setShowBulkInterfaceModal(true)} className="w-fit rounded-[8px] bg-slate-950 px-4 py-2 text-sm font-medium text-white">Cadastro massivo</button>
                        </div>
                      </div>

                      <div className="max-h-[560px] overflow-auto rounded-[8px] border border-slate-200">
                          <table className="w-full min-w-[720px] text-left text-sm">
                            <thead className="sticky top-0 z-10 bg-slate-50 text-slate-500">
                              <tr>
                                <th className="px-3 py-3">Tipo</th>
                                <th className="px-3 py-3">Nome</th>
                              <th className="px-3 py-3">Descricao</th>
                              <th className="px-3 py-3">VLAN</th>
                              <th className="px-3 py-3">Sequencia</th>
                              <th className="px-3 py-3 text-right">Gestao</th>
                            </tr>
                          </thead>
                          <tbody>
                            {selectedDeviceInterfaces.length === 0 ? (
                              <tr><td colSpan={6} className="px-3 py-5 text-slate-500">Nenhuma interface cadastrada para esta OLT.</td></tr>
                            ) : groupedDeviceInterfaces.map((group) => (
                              <Fragment key={group.key}>
                                <tr className="border-t border-slate-200 bg-slate-100">
                                  <td colSpan={6} className="px-3 py-2 text-xs font-semibold uppercase text-slate-600">
                                    Slot {group.chassi}/{group.slot} · {group.items.length} interfaces
                                  </td>
                                </tr>
                                {group.items.map((item) => (
                                    <tr key={item.id} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50" onClick={() => selectInterface(item)}>
                                      <td className="px-3 py-3"><span className="rounded bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700">{item.type}</span></td>
                                      <td className="px-3 py-3 font-medium">{item.name}</td>
                                    <td className="px-3 py-3">{item.description || `${item.type} - ${item.chassi}/${item.slot}/${item.pon}`}</td>
                                    <td className="px-3 py-3">{item.vlan ?? "-"}</td>
                                    <td className="px-3 py-3">{item.sequencePort ?? "-"}</td>
                                    <td className="px-3 py-3 text-right">
                                      <button
                                        onClick={(event) => { event.stopPropagation(); void loadOnuState(item) }}
                                        disabled={isLoading}
                                        className="rounded-[8px] border border-slate-300 px-3 py-2 text-sm font-medium disabled:opacity-60"
                                      >
                                        ONUs
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </Fragment>
                              ))}
                            </tbody>
                          </table>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </Panel>
            ) : null}

            {infraTab === "ctos" ? (
            <Panel title="CTOs">
              <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="text-sm text-slate-600">
                  <p>{filteredCtos.length} de {ctoStatus?.total ?? ctos.length} CTOs no cadastro local</p>
                  <p className="text-xs text-slate-500">Ultima sincronizacao: {ctoStatus?.lastSync ? new Date(ctoStatus.lastSync).toLocaleString("pt-BR") : "sem registro"}</p>
                </div>
                <div className="flex flex-col gap-2 md:flex-row md:items-center">
                  <Input value={ctoSearch} onChange={setCtoSearch} placeholder="Buscar CTO" />
                  <button onClick={syncCtos} disabled={isLoading} className="w-fit rounded-[8px] bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
                    Sincronizar CTOs
                  </button>
                </div>
              </div>
              <div className="grid gap-5 lg:grid-cols-[380px_1fr]">
                <div className="max-h-[680px] overflow-auto rounded-[8px] border border-slate-200">
                  <table className="w-full text-left text-sm">
                    <thead className="sticky top-0 z-10 bg-slate-50 text-slate-500">
                      <tr>
                        <th className="px-3 py-3">CTO</th>
                        <th className="px-3 py-3">OLT</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCtos.length === 0 ? (
                        <tr><td colSpan={2} className="px-3 py-5 text-slate-500">{ctos.length === 0 ? "Nenhuma CTO cadastrada." : "Nenhuma CTO encontrada."}</td></tr>
                      ) : filteredCtos.map((cto) => (
                        <tr
                          key={cto.id}
                          onClick={() => selectCto(cto)}
                          className={`cursor-pointer border-t border-slate-100 hover:bg-slate-50 ${ctoId === cto.id ? "bg-orange-50" : ""}`}
                        >
                          <td className="px-3 py-3">
                            <p className="font-medium">{cto.name}</p>
                            <p className="text-xs text-slate-500">{cto.ports.length} portas</p>
                          </td>
                          <td className="px-3 py-3 text-slate-600">
                            {cto.oltInterface ? (
                              <>
                                <p>{cto.oltInterface.oltDevice?.name || cto.oltDeviceName || "OLT"}</p>
                                <p className="text-xs text-slate-500">{cto.oltInterface.chassi}/{cto.oltInterface.slot}/{cto.oltInterface.pon}</p>
                              </>
                            ) : cto.oltDeviceName || cto.oltIpv4 ? (
                              <>
                                <p>{cto.oltDeviceName || cto.oltIpv4}</p>
                                <p className="text-xs text-slate-500">{cto.oltChassi ?? "-"}/{cto.oltSlot ?? "-"}/{cto.oltPon ?? "-"}</p>
                              </>
                            ) : "Sem vinculo"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="grid content-start gap-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    <Field label="Nome">
                      <Input value={ctoName} onChange={setCtoName} placeholder="Nome da CTO" />
                    </Field>
                    <Field label="Endereco">
                      <Input value={ctoAddress} onChange={setCtoAddress} placeholder="Endereco" />
                    </Field>
                    <Field label="Latitude">
                      <Input value={ctoLat} onChange={setCtoLat} placeholder="Latitude" type="number" />
                    </Field>
                    <Field label="Longitude">
                      <Input value={ctoLng} onChange={setCtoLng} placeholder="Longitude" type="number" />
                    </Field>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <Field label="OLT">
                      <select
                        value={ctoOltDeviceId}
                        onChange={(event) => {
                          setCtoOltDeviceId(event.target.value)
                          setCtoOltInterfaceId("")
                        }}
                        className="rounded-[8px] border border-slate-200 bg-white px-3 py-3 text-sm outline-none"
                      >
                        <option value="">Sem OLT vinculada</option>
                        {oltDevices.map((device) => (
                          <option key={device.id} value={device.id}>{device.name} - {device.host}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Porta GPON">
                      <select
                        value={ctoOltInterfaceId}
                        onChange={(event) => setCtoOltInterfaceId(event.target.value)}
                        disabled={!ctoOltDeviceId}
                        className="rounded-[8px] border border-slate-200 bg-white px-3 py-3 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <option value="">Sem porta vinculada</option>
                        {selectedCtoOltInterfaces.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name} - {item.chassi}/{item.slot}/{item.pon}{item.vlan ? ` - VLAN ${item.vlan}` : ""}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>

                  {selectedCto ? (
                    <div className="grid gap-3 rounded-[8px] border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 md:grid-cols-3">
                      <Info label="Hubsoft" value={selectedCto.hubsoftId || "Sem ID"} />
                      <Info label="Origem importada" value={selectedCto.oltDeviceName || selectedCto.oltIpv4 || "Sem OLT"} detail={`${selectedCto.oltChassi ?? "-"}/${selectedCto.oltSlot ?? "-"}/${selectedCto.oltPon ?? "-"}`} />
                      <Info label="Portas CTO" value={String(selectedCto.ports.length)} detail={`${selectedCto.ports.filter((port) => port.status === "available").length} livres`} />
                    </div>
                  ) : (
                    <p className="rounded-[8px] bg-slate-50 p-4 text-sm text-slate-600">Selecione uma CTO para editar.</p>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <button onClick={saveCto} disabled={isLoading || !ctoId} className="rounded-[8px] bg-orange-800 px-5 py-3 text-sm font-medium text-white disabled:opacity-60">Salvar CTO</button>
                    <button onClick={resetCtoForm} className="rounded-[8px] border border-slate-300 px-5 py-3 text-sm font-medium">Limpar</button>
                  </div>
                </div>
              </div>
            </Panel>
            ) : null}

            {infraTab === "models" ? (
            <Panel title="Modelos de ONU/CPE">
              <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
                <div className="grid content-start gap-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm text-slate-600">{cpeModels.length} modelo(s) cadastrado(s)</p>
                    <button type="button" onClick={resetCpeModelForm} className="rounded-[8px] border border-slate-300 px-4 py-2 text-sm font-medium">Novo modelo</button>
                  </div>
                  <div className="max-h-[680px] overflow-auto rounded-[8px] border border-slate-200">
                    <table className="w-full text-left text-sm">
                      <thead className="sticky top-0 z-10 bg-slate-50 text-slate-500">
                        <tr>
                          <th className="px-3 py-3">Modelo</th>
                          <th className="px-3 py-3">Uso</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cpeModels.length === 0 ? (
                          <tr><td colSpan={2} className="px-3 py-5 text-slate-500">Nenhum modelo de ONU cadastrado.</td></tr>
                        ) : cpeModels.map((item) => (
                          <tr
                            key={item.id}
                            onClick={() => selectCpeModel(item)}
                            className={`cursor-pointer border-t border-slate-100 hover:bg-slate-50 ${cpeModelId === item.id ? "bg-orange-50" : ""}`}
                          >
                            <td className="px-3 py-3">
                              <p className="font-medium">{item.name}</p>
                              <p className="text-xs text-slate-500">{getCpeModelProfileSummary(item)}</p>
                            </td>
                            <td className="px-3 py-3 text-slate-600">{item.provisioningCount ?? 0}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="grid content-start gap-4">
                  <div className="grid gap-3 md:grid-cols-[1fr_220px]">
                    <Field label="Nome do modelo">
                      <Input value={cpeModelName} onChange={setCpeModelName} placeholder="Ex.: HG8245H" />
                    </Field>
                    <button type="button" onClick={addCpeModelProfile} className="self-end rounded-[8px] border border-slate-300 px-4 py-3 text-sm font-medium">Adicionar OLT</button>
                  </div>
                  <Field label="Descricao">
                    <TextArea value={cpeModelDescription} onChange={setCpeModelDescription} placeholder="Fabricante, portas, Wi-Fi, observacoes de provisionamento." />
                  </Field>
                  <div className="grid gap-4">
                    {cpeModelProfiles.length === 0 ? (
                      <p className="rounded-[8px] border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Cadastre ao menos uma compatibilidade OLT para provisionar este modelo.</p>
                    ) : null}
                    {cpeModelProfiles.map((profile, index) => (
                      <div key={`${profile.id || "new"}-${index}`} className="grid gap-3 rounded-[8px] border border-slate-200 bg-slate-50 p-4">
                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                          <div>
                            <p className="text-sm font-semibold text-slate-900">Compatibilidade OLT</p>
                            <p className="text-xs text-slate-500">{profile.oltManufacturer || "Fabricante"} {profile.oltModel || "Modelo"} / {profile.oltDriver || "driver"}</p>
                          </div>
                          <button type="button" onClick={() => removeCpeModelProfile(index)} className="w-fit rounded-[8px] border border-red-200 px-3 py-2 text-sm font-medium text-red-700">Remover</button>
                        </div>
                        <div className="grid gap-3 md:grid-cols-4">
                          <Input value={profile.oltManufacturer} onChange={(value) => updateCpeModelProfile(index, "oltManufacturer", value)} placeholder="Fabricante OLT" />
                          <Input value={profile.oltModel} onChange={(value) => updateCpeModelProfile(index, "oltModel", value)} placeholder="Modelo OLT" />
                          <select value={profile.oltDriver} onChange={(event) => updateCpeModelProfile(index, "oltDriver", event.target.value)} className="rounded-[8px] border border-slate-200 bg-white px-3 py-3 text-sm outline-none">
                            {driverOptions(oltDrivers).map((driver) => <option key={driver.id} value={driver.id}>{driver.label}</option>)}
                          </select>
                          <Input value={profile.onuType || ""} onChange={(value) => updateCpeModelProfile(index, "onuType", value)} placeholder="Tipo ONU na OLT" />
                        </div>
                        <div className="grid gap-3 xl:grid-cols-2">
                          <CommandArea title="Autorizacao" value={profile.authorizationCommands || ""} onChange={(value) => updateCpeModelProfile(index, "authorizationCommands", value)} />
                          <CommandArea title="Provisionamento" value={profile.provisioningCommands || ""} onChange={(value) => updateCpeModelProfile(index, "provisioningCommands", value)} rows={10} />
                          <CommandArea title="Desprovisionamento" value={profile.deprovisioningCommands || ""} onChange={(value) => updateCpeModelProfile(index, "deprovisioningCommands", value)} />
                          <CommandArea title="Desautorizacao" value={profile.deauthorizationCommands || ""} onChange={(value) => updateCpeModelProfile(index, "deauthorizationCommands", value)} />
                          <CommandArea title="TR-069 / GenieACS" value={profile.tr069Commands || ""} onChange={(value) => updateCpeModelProfile(index, "tr069Commands", value)} />
                          <CommandArea title="Mapa GenieACS JSON" value={profile.genieAcsParameterMapJson || ""} onChange={(value) => updateCpeModelProfile(index, "genieAcsParameterMapJson", value)} />
                          <CommandArea title="Variaveis obrigatorias JSON" value={profile.requiredVariablesJson || ""} onChange={(value) => updateCpeModelProfile(index, "requiredVariablesJson", value)} rows={5} />
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={saveCpeModel} disabled={isLoading} className="rounded-[8px] bg-orange-800 px-5 py-3 text-sm font-medium text-white disabled:opacity-60">{cpeModelId ? "Salvar modelo" : "Adicionar modelo"}</button>
                    <button type="button" onClick={resetCpeModelForm} className="rounded-[8px] border border-slate-300 px-5 py-3 text-sm font-medium">Limpar</button>
                    {cpeModelId ? (
                      <button
                        type="button"
                        onClick={() => {
                          const item = cpeModels.find((modelItem) => modelItem.id === cpeModelId)
                          if (item) void deleteCpeModel(item)
                        }}
                        disabled={isLoading || Boolean(cpeModels.find((item) => item.id === cpeModelId && (item.provisioningCount ?? 0) > 0))}
                        className="rounded-[8px] border border-red-200 px-5 py-3 text-sm font-medium text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Excluir
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            </Panel>
            ) : null}

            {infraTab === "profiles" ? (
            <Panel title="Perfis operacionais">
              <div className="grid gap-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <p className="text-sm text-slate-600">{operatorProfiles.length} perfil(is) cadastrado(s)</p>
                  <button
                    type="button"
                    onClick={() => {
                      resetProfileForm()
                      setShowProfileModal(true)
                    }}
                    className="w-fit rounded-[8px] bg-orange-800 px-4 py-2 text-sm font-medium text-white"
                  >
                    Novo perfil
                  </button>
                </div>
                <div className="grid content-start gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {operatorProfiles.map((profile) => (
                    <button key={profile.id} onClick={() => selectProfile(profile)} className="rounded-[8px] border border-slate-200 bg-slate-50 p-4 text-left">
                      <p className="font-semibold">{profile.name}</p>
                      <p className="text-sm text-slate-600">{profile.user?.name || profile.user?.email || "Operador"} · VLAN {profile.vlan ?? "-"}</p>
                      <p className="text-xs text-slate-500">{profile.driver}{profile.isDefault ? " · padrao" : ""}</p>
                    </button>
                  ))}
                  {operatorProfiles.length === 0 ? (
                    <p className="rounded-[8px] border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">Nenhum perfil operacional cadastrado.</p>
                  ) : null}
                </div>
              </div>
            </Panel>
            ) : null}
          </section>
        ) : null}
      </div>

      {showUserContractModal ? (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/40 p-4" role="dialog" aria-modal="true" aria-labelledby="user-contract-title" onClick={() => setShowUserContractModal(false)}>
          <div className="admin-contract-modal max-h-[92vh] w-full max-w-6xl overflow-hidden rounded-[8px] bg-white shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex flex-col gap-3 border-b border-slate-200 p-5 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase text-orange-700">Contrato do usuario</p>
                <h2 id="user-contract-title" className="mt-1 text-xl font-semibold text-slate-950">{selectedUserContractName || "Operador"}</h2>
                <p className="mt-1 text-sm text-slate-500">{selectedUserContract?.message || "Consultando contrato."}</p>
              </div>
              <button type="button" onClick={() => setShowUserContractModal(false)} className="w-fit rounded-[8px] border border-slate-300 px-4 py-2 text-sm font-medium">Fechar</button>
            </div>
            <div className="max-h-[calc(92vh-112px)] overflow-auto p-5">
              {selectedUserContract?.accepted && selectedUserContract.contract ? (
                <div className="grid gap-4">
                  <div className="grid gap-3 rounded-[8px] border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950 md:grid-cols-3">
                    <Info label="Status" value="Aceito" detail={selectedUserContract.contract.signatureMethod || undefined} />
                    <Info label="Aceito em" value={formatDateTime(selectedUserContract.contract.acceptedAt)} />
                    <Info label="IP" value={selectedUserContract.contract.ipAddress || "-"} />
                    <Info label="Versao" value={`v${selectedUserContract.contract.versionNumber}`} detail={selectedUserContract.contract.title} />
                    <Info label="Hash contrato" value={`${selectedUserContract.contract.contentHash.slice(0, 18)}...`} />
                    <Info label="Hash aceite" value={`${selectedUserContract.contract.acceptanceHash?.slice(0, 18) || "-"}...`} />
                  </div>
                  <div className="admin-contract-pdf-frame">
                    <iframe
                      title={`Contrato aceito de ${selectedUserContractName}`}
                      src={`/api/admin/contracts/users/${selectedUserContractUserId}/pdf`}
                    />
                  </div>
                </div>
              ) : (
                <div className="rounded-[8px] border border-orange-200 bg-orange-50 p-5 text-orange-950">
                  <h3 className="text-lg font-semibold">Aceite de contrato pendente</h3>
                  <p className="mt-2 text-sm">Este operador ainda nao aceitou o contrato vigente. Enquanto houver pendencia, o uso operacional da rede permanece bloqueado pelo mecanismo de aceite.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {showAccessBlockModal && selectedAccessBlockAccount ? (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/40 p-4" role="dialog" aria-modal="true" aria-labelledby="access-block-title" onClick={() => setShowAccessBlockModal(false)}>
          <div className="w-full max-w-xl rounded-[8px] bg-white p-5 shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 md:flex-row md:items-start md:justify-between">
              <div>
                <h2 id="access-block-title" className="text-lg font-semibold text-slate-950">Bloqueio manual parcial</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {selectedAccessBlockAccount.userName || selectedAccessBlockAccount.landlordName || selectedAccessBlockAccount.userEmail || "Operador"}
                </p>
              </div>
              <button type="button" onClick={() => setShowAccessBlockModal(false)} className="w-fit rounded-[8px] border border-slate-300 px-4 py-2 text-sm font-medium">Fechar</button>
            </div>

            <div className="mt-4 grid gap-4">
              <Field label="Motivo do bloqueio">
                <select
                  value={accessBlockReason}
                  onChange={(event) => setAccessBlockReason(event.target.value)}
                  className="rounded-[8px] border border-slate-200 bg-white px-3 py-3 text-sm outline-none"
                >
                  {accessBlockReasons.map((reason) => (
                    <option key={reason} value={reason}>{reason}</option>
                  ))}
                </select>
              </Field>
              <Field label="Observação interna">
                <TextArea value={accessBlockDetails} onChange={setAccessBlockDetails} placeholder="Detalhe documento pendente, regra descumprida ou orientação para desbloqueio." />
              </Field>
              <div className="rounded-[8px] bg-slate-50 p-4 text-sm text-slate-600">
                O bloqueio manual tem prioridade sobre bloqueio financeiro e liberação em confiança. A baixa no Hubsoft não remove esse bloqueio.
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <button type="button" onClick={() => setShowAccessBlockModal(false)} className="rounded-[8px] border border-slate-300 px-5 py-3 text-sm font-medium">Cancelar</button>
                <button type="button" onClick={executeAdministrativeBlock} disabled={isLoading} className="rounded-[8px] bg-orange-800 px-5 py-3 text-sm font-medium text-white disabled:opacity-60">Aplicar bloqueio</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {showBillingAccountModal ? (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/40 p-4" role="dialog" aria-modal="true" aria-labelledby="billing-account-form-title" onClick={() => setShowBillingAccountModal(false)}>
          <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-[8px] bg-white p-5 shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 md:flex-row md:items-start md:justify-between">
              <div>
                <h2 id="billing-account-form-title" className="text-lg font-semibold text-slate-950">Vínculo Hubsoft e regra comercial</h2>
                <p className="mt-1 text-sm text-slate-500">Ajuste o serviço Hubsoft e a regra comercial da conta selecionada.</p>
              </div>
              <button type="button" onClick={() => setShowBillingAccountModal(false)} className="w-fit rounded-[8px] border border-slate-300 px-4 py-2 text-sm font-medium">Fechar</button>
            </div>

            <div className="mt-4 grid gap-4">
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="id_cliente_servico Hubsoft">
                  <Input value={billingHubsoftClientServiceId} onChange={setBillingHubsoftClientServiceId} placeholder="ID do serviço Hubsoft" />
                </Field>
                <Field label="Status financeiro">
                  <select value={billingAccountStatus} onChange={(event) => setBillingAccountStatus(event.target.value)} className="rounded-[8px] border border-slate-200 bg-white px-3 py-3 text-sm outline-none">
                    <option value="active">Ativa</option>
                    <option value="suspended">Suspensa</option>
                    <option value="inactive">Inativa</option>
                  </select>
                </Field>
              </div>
              <div className="grid gap-3 md:grid-cols-4">
                <Field label="Mínimo mensal">
                  <Input value={billingAccountMinimumAmount} onChange={setBillingAccountMinimumAmount} placeholder="300,00" />
                </Field>
                <Field label="Inclusos">
                  <Input value={billingAccountIncludedProvisionings} onChange={setBillingAccountIncludedProvisionings} placeholder="10" type="number" />
                </Field>
                <Field label="Excedente">
                  <Input value={billingAccountExtraAmount} onChange={setBillingAccountExtraAmount} placeholder="35,00" />
                </Field>
                <Field label="Vencimento">
                  <Input value={billingAccountDueDay} onChange={setBillingAccountDueDay} placeholder="10" type="number" />
                </Field>
              </div>
              <Field label="Observações comerciais">
                <TextArea value={billingAccountNotes} onChange={setBillingAccountNotes} placeholder="Condição comercial, exceções ou observações do operador." />
              </Field>
              <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-4">
                <button type="button" onClick={saveBillingAccount} disabled={isLoading} className="rounded-[8px] bg-orange-800 px-5 py-3 text-sm font-medium text-white disabled:opacity-60">Salvar conta</button>
                <button type="button" onClick={() => {
                  const account = billingAccounts.find((item) => item.id === selectedBillingAccountId)
                  if (account) selectBillingAccount(account)
                }} className="rounded-[8px] border border-slate-300 px-5 py-3 text-sm font-medium">Desfazer</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {showProfileModal ? (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/40 p-4" role="dialog" aria-modal="true" aria-labelledby="profile-form-title" onClick={() => setShowProfileModal(false)}>
          <div className="max-h-[90vh] w-full max-w-6xl overflow-y-auto rounded-[8px] bg-white p-5 shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 md:flex-row md:items-start md:justify-between">
              <div>
                <h2 id="profile-form-title" className="text-lg font-semibold text-slate-950">{profileId ? "Editar perfil operacional" : "Novo perfil operacional"}</h2>
                <p className="mt-1 text-sm text-slate-500">Variaveis do operador usadas pelos perfis de ONU/CPE.</p>
              </div>
              <button type="button" onClick={() => setShowProfileModal(false)} className="w-fit rounded-[8px] border border-slate-300 px-4 py-2 text-sm font-medium">Fechar</button>
            </div>

            <div className="mt-4 grid gap-3">
              <div className="grid gap-3 md:grid-cols-[1fr_220px_180px_120px]">
                <Input value={profileName} onChange={setProfileName} placeholder="Nome do perfil" />
                <select value={profileUserId} onChange={(event) => setProfileUserId(event.target.value)} className="rounded-[8px] border border-slate-200 bg-white px-3 py-3 text-sm outline-none">
                  <option value="">Operador</option>
                  {users.filter((user) => user.role !== "admin").map((user) => <option key={user.id} value={user.id}>{user.name || user.email}</option>)}
                </select>
                <select value={profileDriver} onChange={(event) => setProfileDriver(event.target.value)} className="rounded-[8px] border border-slate-200 bg-white px-3 py-3 text-sm outline-none">
                  {driverOptions(oltDrivers).map((driver) => <option key={driver.id} value={driver.id}>{driver.label}</option>)}
                </select>
                <Check checked={profileDefault} onChange={setProfileDefault} label="Padrao" />
              </div>
              <div className="grid gap-3 md:grid-cols-4">
                <Input value={profileVlan} onChange={setProfileVlan} placeholder="VLAN do operador" type="number" />
                <Input value={profileServiceVlan} onChange={setProfileServiceVlan} placeholder="Service VLAN" type="number" />
                <Input value={profileGemPort} onChange={setProfileGemPort} placeholder="GEM Port" type="number" />
                <Input value={profileTcont} onChange={setProfileTcont} placeholder="TCONT" type="number" />
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <Input value={profileServiceName} onChange={setProfileServiceName} placeholder="Servico" />
                <Input value={profileLineProfile} onChange={setProfileLineProfile} placeholder="Line profile" />
                <Input value={profileServiceProfile} onChange={setProfileServiceProfile} placeholder="Service profile" />
              </div>
              <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-4">
                <button type="button" onClick={saveProfile} disabled={isLoading} className="w-fit rounded-[8px] bg-orange-800 px-5 py-3 text-sm font-medium text-white disabled:opacity-60">Salvar perfil</button>
                <button type="button" onClick={resetProfileForm} className="w-fit rounded-[8px] border border-slate-300 px-5 py-3 text-sm font-medium">Limpar</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {showUserModal ? (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/40 p-4" role="dialog" aria-modal="true" aria-labelledby="user-form-title" onClick={closeUserModal}>
          <div className="max-h-[90vh] w-full max-w-6xl overflow-y-auto rounded-[8px] bg-white p-5 shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 md:flex-row md:items-start md:justify-between">
              <div>
                <h2 id="user-form-title" className="text-lg font-semibold text-slate-950">{userId ? "Editar usuario" : "Novo usuario"}</h2>
                <p className="mt-1 text-sm text-slate-500">{userRole === "landlord" ? "Operador de rede neutra" : "Usuario administrador"}</p>
              </div>
              <button type="button" onClick={closeUserModal} className="w-fit rounded-[8px] border border-slate-300 px-4 py-2 text-sm font-medium">Fechar</button>
            </div>

            {userFormError ? (
              <div className="mt-4 rounded-[8px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900" role="alert">
                <p className="font-semibold">Nao foi possivel salvar este usuario.</p>
                <p className="mt-1">{userFormError}</p>
              </div>
            ) : null}

            <div className="mt-4 grid gap-4">
              <div className="grid gap-3 lg:grid-cols-[180px_1fr_1fr_160px]">
                <Field label="Perfil">
                  <select
                    value={userRole}
                    onChange={(event) => {
                      setUserRole(event.target.value)
                      if (event.target.value === "admin") {
                        setHubsoftLookup(null)
                        setUserProvisioningProfileId("")
                      }
                    }}
                    className="rounded-[8px] border border-slate-200 bg-white px-3 py-3 text-sm outline-none"
                  >
                    <option value="landlord">Operador</option>
                    <option value="admin">Admin</option>
                  </select>
                </Field>
                <Field label="Nome">
                  <Input value={userName} onChange={setUserName} placeholder="Razao social" />
                </Field>
                <Field label="Email">
                  <Input value={userEmail} onChange={setUserEmail} placeholder="Email de acesso" />
                </Field>
                <Field label={userId ? "Nova senha" : "Senha"}>
                  <Input value={userPassword} onChange={setUserPassword} placeholder={userId ? "Opcional" : "Senha"} type="password" />
                </Field>
              </div>

              {userRole === "landlord" ? (
                <div className="grid gap-3 border-t border-slate-200 pt-4">
                  <div className="grid gap-3 rounded-[8px] border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-col gap-1 md:flex-row md:items-start md:justify-between">
                      <div>
                        <p className="text-sm font-semibold text-slate-950">Perfil operacional</p>
                        <p className="text-xs text-slate-500">Parametros usados no provisionamento de ONU/CPE deste operador.</p>
                      </div>
                      <div className="w-full md:w-72">
                        <select
                          value={userProvisioningProfileId}
                          onChange={(event) => loadUserProfileTemplate(event.target.value)}
                          className="w-full rounded-[8px] border border-slate-200 bg-white px-3 py-3 text-sm outline-none"
                        >
                          <option value="">Novo perfil neste operador</option>
                          {operatorProfiles.map((profile) => (
                            <option key={profile.id} value={profile.id}>
                              {profile.name} · {profile.user?.name || profile.user?.email || "Operador"} · VLAN {profile.vlan ?? "-"}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="grid gap-3 lg:grid-cols-[1fr_220px_120px]">
                      <Field label="Nome do perfil">
                        <Input value={profileName} onChange={setProfileName} placeholder="Nome do perfil operacional" />
                      </Field>
                      <Field label="Driver OLT">
                        <select value={profileDriver} onChange={(event) => setProfileDriver(event.target.value)} className="rounded-[8px] border border-slate-200 bg-white px-3 py-3 text-sm outline-none">
                          {driverOptions(oltDrivers).map((driver) => <option key={driver.id} value={driver.id}>{driver.label}</option>)}
                        </select>
                      </Field>
                      <div className="flex items-end">
                        <Check checked={profileDefault} onChange={setProfileDefault} label="Padrao" />
                      </div>
                    </div>
                    <div className="grid gap-3 md:grid-cols-4">
                      <Field label="VLAN do operador">
                        <Input
                          value={profileVlan}
                          onChange={(value) => {
                            setProfileVlan(value)
                            setUserVlan(value)
                          }}
                          placeholder="2003"
                          type="number"
                        />
                      </Field>
                      <Field label="Service VLAN">
                        <Input value={profileServiceVlan} onChange={setProfileServiceVlan} placeholder="600" type="number" />
                      </Field>
                      <Field label="GEM Port">
                        <Input value={profileGemPort} onChange={setProfileGemPort} placeholder="1" type="number" />
                      </Field>
                      <Field label="TCONT">
                        <Input value={profileTcont} onChange={setProfileTcont} placeholder="1" type="number" />
                      </Field>
                    </div>
                    <div className="grid gap-3 md:grid-cols-3">
                      <Field label="Servico">
                        <Input value={profileServiceName} onChange={setProfileServiceName} placeholder="internet" />
                      </Field>
                      <Field label="Line profile">
                        <Input value={profileLineProfile} onChange={setProfileLineProfile} placeholder="Opcional" />
                      </Field>
                      <Field label="Service profile">
                        <Input value={profileServiceProfile} onChange={setProfileServiceProfile} placeholder="Opcional" />
                      </Field>
                    </div>
                  </div>
                  <div className="grid gap-3 lg:grid-cols-[240px_auto_1fr]">
                    <Field label="CNPJ Hubsoft">
                      <Input
                        value={userCnpj}
                        onChange={(value) => {
                          setUserCnpj(formatCnpj(value))
                          setHubsoftLookup(null)
                        }}
                        placeholder="00.000.000/0000-00"
                      />
                    </Field>
                    <div className="flex items-end">
                      <button
                        type="button"
                        onClick={lookupHubsoftOperator}
                        disabled={isHubsoftLookupLoading || !isValidCnpj(userCnpj)}
                        className="rounded-[8px] border border-orange-200 px-4 py-3 text-sm font-medium text-orange-800 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isHubsoftLookupLoading ? "Consultando" : "Consultar Hubsoft"}
                      </button>
                    </div>
                    {hubsoftLookup ? (
                      <div className="rounded-[8px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                        <p className="font-medium text-slate-950">{hubsoftLookup.tradeName || hubsoftLookup.legalName}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          Cliente {hubsoftLookup.codigoCliente ?? hubsoftLookup.idCliente} · Serviço ativo {selectActiveHubsoftService(hubsoftLookup)?.idClienteServico ?? "não encontrado"}
                        </p>
                        <div className="mt-3 grid gap-1 text-xs text-slate-600 md:grid-cols-2">
                          <span>Razão social: {hubsoftLookup.legalName}</span>
                          <span>Nome fantasia: {hubsoftLookup.tradeName || "-"}</span>
                          <span>CNPJ: {formatCnpj(hubsoftLookup.cnpj)}</span>
                          <span>Email: {hubsoftLookup.primaryEmail || "-"}</span>
                          <span>Telefone 1: {hubsoftLookup.primaryPhone || "-"}</span>
                          <span>Telefone 2: {hubsoftLookup.secondaryPhone || "-"}</span>
                          <span>Inscrição municipal: {hubsoftLookup.municipalRegistration || "-"}</span>
                          <span>Inscrição estadual: {hubsoftLookup.stateRegistration || "-"}</span>
                          <span>Data cadastro: {formatDateTime(hubsoftLookup.registeredAt)}</span>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-[8px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                        Operador deve ser importado pelo CNPJ cadastrado no Hubsoft.
                      </div>
                    )}
                  </div>
                  <div className="grid gap-3 border-t border-slate-200 pt-4">
                    <p className="text-sm font-semibold text-slate-950">Regra comercial e faturamento</p>
                    <div className="grid gap-3 md:grid-cols-2">
                      <Field label="id_cliente_servico Hubsoft">
                        <Input value={userHubsoftClientServiceId} onChange={setUserHubsoftClientServiceId} placeholder="ID do serviço ativo" />
                      </Field>
                      <Field label="Status financeiro">
                        <select value={userBillingStatus} onChange={(event) => setUserBillingStatus(event.target.value)} className="rounded-[8px] border border-slate-200 bg-white px-3 py-3 text-sm outline-none">
                          <option value="active">Ativa</option>
                          <option value="suspended">Suspensa</option>
                          <option value="inactive">Inativa</option>
                        </select>
                      </Field>
                    </div>
                    <div className="grid gap-3 md:grid-cols-4">
                      <Field label="Mínimo mensal">
                        <Input value={userMinimumAmount} onChange={setUserMinimumAmount} placeholder="300,00" />
                      </Field>
                      <Field label="Inclusos">
                        <Input value={userIncludedProvisionings} onChange={setUserIncludedProvisionings} placeholder="10" type="number" />
                      </Field>
                      <Field label="Excedente">
                        <Input value={userExtraAmount} onChange={setUserExtraAmount} placeholder="35,00" />
                      </Field>
                      <Field label="Vencimento">
                        <Input value={userDueDay} onChange={setUserDueDay} placeholder="10" type="number" />
                      </Field>
                    </div>
                    <Field label="Observações comerciais">
                      <TextArea value={userBillingNotes} onChange={setUserBillingNotes} placeholder="Condição comercial, exceções ou observações do operador." />
                    </Field>
                  </div>
                </div>
              ) : null}

              <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4">
                <button type="button" onClick={closeUserModal} className="rounded-[8px] border border-slate-300 px-5 py-3 text-sm font-medium">Cancelar</button>
                <button type="button" onClick={saveUser} disabled={isLoading || isHubsoftLookupLoading} className="rounded-[8px] bg-orange-800 px-5 py-3 text-sm font-medium text-white disabled:opacity-60">{userId ? "Salvar" : "Criar"}</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {userFormError && showUserModal ? (
        <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-slate-950/40 p-4" role="dialog" aria-modal="true" aria-labelledby="user-error-title" onClick={() => setUserFormError("")}>
          <div className="w-full max-w-md rounded-[8px] bg-white p-5 shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] bg-red-50 text-lg font-semibold text-red-700">!</div>
              <div>
                <h2 id="user-error-title" className="text-base font-semibold text-slate-950">Corrija o cadastro</h2>
                <p className="mt-2 text-sm text-slate-700">{userFormError}</p>
                {userFormError.toLowerCase().includes("senha") ? (
                  <p className="mt-3 rounded-[8px] bg-slate-50 px-3 py-2 text-sm text-slate-600">
                    Use uma senha com pelo menos 12 caracteres. Misture letras, numeros e simbolos para reduzir rejeicoes.
                  </p>
                ) : null}
              </div>
            </div>
            <div className="mt-5 flex justify-end">
              <button type="button" onClick={() => setUserFormError("")} className="rounded-[8px] bg-orange-800 px-5 py-3 text-sm font-medium text-white">
                Entendi
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showProvisioningLogModal ? (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/40 p-4" role="dialog" aria-modal="true" aria-labelledby="provisioning-log-title" onClick={() => setShowProvisioningLogModal(false)}>
          <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-[8px] bg-white p-5 shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 md:flex-row md:items-start md:justify-between">
              <div>
                <h2 id="provisioning-log-title" className="text-lg font-semibold text-slate-950">Log de provisionamento</h2>
                <p className="mt-1 text-sm text-slate-500">{provisioningLogTitle}</p>
              </div>
              <button onClick={() => setShowProvisioningLogModal(false)} className="w-fit rounded-[8px] border border-slate-300 px-4 py-2 text-sm font-medium">Fechar</button>
            </div>

            <ProvisioningLogTimeline logs={provisioningLogs} isLoading={isLoading} />
          </div>
        </div>
      ) : null}

      {showInterfaceModal ? (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/40 p-4" role="dialog" aria-modal="true" aria-labelledby="interface-form-title" onClick={() => setShowInterfaceModal(false)}>
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-[8px] bg-white p-5 shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 md:flex-row md:items-start md:justify-between">
              <div>
                <h2 id="interface-form-title" className="text-lg font-semibold text-slate-950">{interfaceId ? "Editar interface" : "Nova interface"}</h2>
                <p className="mt-1 text-sm text-slate-500">{selectedDevice ? `${selectedDevice.name} - ${selectedDevice.host}` : "OLT selecionada"}</p>
              </div>
              <button onClick={() => setShowInterfaceModal(false)} className="w-fit rounded-[8px] border border-slate-300 px-4 py-2 text-sm font-medium">Fechar</button>
            </div>

            <div className="mt-4 grid gap-3 rounded-[8px] border border-slate-200 bg-slate-50 p-4">
              <div className="grid gap-3 md:grid-cols-2">
                <select value={interfaceType} onChange={(event) => setInterfaceType(event.target.value)} className="rounded-[8px] border border-slate-200 bg-white px-3 py-3 text-sm outline-none">
                  <option value="GPON">GPON</option>
                  <option value="EPON">EPON</option>
                  <option value="WIRELESS">WIRELESS</option>
                  <option value="BRIDGE">BRIDGE</option>
                  <option value="VLAN">VLAN</option>
                  <option value="ETHERNET">ETHERNET</option>
                </select>
                <Input value={interfaceSequence} onChange={setInterfaceSequence} placeholder="Sequencia" type="number" />
              </div>
              <Input value={interfaceName} onChange={setInterfaceName} placeholder="Nome da interface" />
              <Input value={interfaceDescription} onChange={setInterfaceDescription} placeholder="Descricao" />
              <div className="grid gap-3 md:grid-cols-4">
                <Input value={interfaceChassi} onChange={setInterfaceChassi} placeholder="Chassi" type="number" />
                <Input value={interfaceSlot} onChange={setInterfaceSlot} placeholder="Slot" type="number" />
                <Input value={interfacePon} onChange={setInterfacePon} placeholder="PON" type="number" />
                <Input value={interfaceVlan} onChange={setInterfaceVlan} placeholder="VLAN" type="number" />
              </div>
              <Input value={interfaceRouting} onChange={setInterfaceRouting} placeholder="Interface de roteamento" />
              <div className="grid gap-3 md:grid-cols-2">
                <Input value={interfaceAlarmSubscriber} onChange={setInterfaceAlarmSubscriber} placeholder="Alarme RX assinante" type="number" />
                <Input value={interfaceAlarmEquipment} onChange={setInterfaceAlarmEquipment} placeholder="Alarme RX equipamento" type="number" />
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <Check checked={interfaceRequireCto} onChange={setInterfaceRequireCto} label="Vincular CTO" />
                <Check checked={interfaceBlockOveruse} onChange={setInterfaceBlockOveruse} label="Barrar superutilizacao" />
                <Check checked={interfaceEnableScan} onChange={setInterfaceEnableScan} label="Escaneamento" />
                <select value={interfaceScanType} onChange={(event) => setInterfaceScanType(event.target.value)} className="rounded-[8px] border border-slate-200 bg-white px-3 py-3 text-sm outline-none">
                  <option value="Simples">Simples</option>
                  <option value="Detalhado">Detalhado</option>
                </select>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button onClick={() => setShowInterfaceModal(false)} className="rounded-[8px] border border-slate-300 px-5 py-3 text-sm font-medium">Cancelar</button>
              <button onClick={saveInterface} disabled={isLoading} className="rounded-[8px] bg-orange-800 px-5 py-3 text-sm font-medium text-white disabled:opacity-60">Salvar interface</button>
            </div>
          </div>
        </div>
      ) : null}

      {showBulkInterfaceModal ? (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/40 p-4" role="dialog" aria-modal="true" aria-labelledby="bulk-interface-title" onClick={() => setShowBulkInterfaceModal(false)}>
          <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-[8px] bg-white p-5 shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 md:flex-row md:items-start md:justify-between">
              <div>
                <h2 id="bulk-interface-title" className="text-lg font-semibold text-slate-950">Cadastro massivo</h2>
                <p className="mt-1 text-sm text-slate-500">{selectedDevice ? `${selectedDevice.name} - ${selectedDevice.host}` : "OLT selecionada"}</p>
              </div>
              <button onClick={() => setShowBulkInterfaceModal(false)} className="w-fit rounded-[8px] border border-slate-300 px-4 py-2 text-sm font-medium">Fechar</button>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <Field label="Prefixo do nome">
                <Input value={bulkNamePrefix} onChange={setBulkNamePrefix} placeholder="Ex.: Condominio" />
              </Field>
              <Field label="Chassi inicial">
                <Input value={bulkChassiStart} onChange={setBulkChassiStart} placeholder="Chassi inicial" type="number" />
              </Field>
              <Field label="Chassi final">
                <Input value={bulkChassiEnd} onChange={setBulkChassiEnd} placeholder="Chassi final" type="number" />
              </Field>
              <Field label="Slot inicial">
                <Input value={bulkSlotStart} onChange={setBulkSlotStart} placeholder="Slot inicial" type="number" />
              </Field>
              <Field label="Slot final">
                <Input value={bulkSlotEnd} onChange={setBulkSlotEnd} placeholder="Slot final" type="number" />
              </Field>
              <Field label="PON inicial">
                <Input value={bulkPonStart} onChange={setBulkPonStart} placeholder="PON inicial" type="number" />
              </Field>
              <Field label="PON final">
                <Input value={bulkPonEnd} onChange={setBulkPonEnd} placeholder="PON final" type="number" />
              </Field>
              <Field label="VLAN inicial">
                <Input value={bulkVlanStart} onChange={setBulkVlanStart} placeholder="VLAN inicial" type="number" />
              </Field>
              <Field label="Incremento VLAN">
                <Input value={bulkVlanIncrement} onChange={setBulkVlanIncrement} placeholder="0" type="number" />
              </Field>
            </div>

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button onClick={() => setShowBulkInterfaceModal(false)} className="rounded-[8px] border border-slate-300 px-5 py-3 text-sm font-medium">Cancelar</button>
              <button onClick={bulkCreateInterfaces} disabled={isLoading} className="rounded-[8px] bg-slate-950 px-5 py-3 text-sm font-medium text-white disabled:opacity-60">Criar interfaces em massa</button>
            </div>
          </div>
        </div>
      ) : null}

      {showOnuStateModal ? (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/40 p-4" role="dialog" aria-modal="true" aria-labelledby="onu-state-title" onClick={() => setShowOnuStateModal(false)}>
          <div className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-[8px] bg-white p-5 shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 md:flex-row md:items-start md:justify-between">
              <div>
                <h2 id="onu-state-title" className="text-lg font-semibold text-slate-950">ONUs configuradas</h2>
                <p className="mt-1 text-sm text-slate-500">{onuStateTitle}</p>
              </div>
              <button onClick={() => setShowOnuStateModal(false)} className="w-fit rounded-[8px] border border-slate-300 px-4 py-2 text-sm font-medium">Fechar</button>
            </div>

            {onuStateCommand ? (
              <div className="mt-4 rounded-[8px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
                <span className="font-semibold text-slate-700">Comando: </span>
                <span className="font-mono text-slate-900">{onuStateCommand}</span>
              </div>
            ) : null}

            <div className="mt-4 grid gap-3 md:grid-cols-4">
              <div className="rounded-[8px] border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase text-slate-500">Capacidade</p>
                <p className="mt-2 text-2xl font-semibold">{onuStateTotalPositions}</p>
                <p className="text-sm text-slate-600">posicoes por PON</p>
              </div>
              <div className="rounded-[8px] border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase text-slate-500">Ocupadas</p>
                <p className="mt-2 text-2xl font-semibold">{onuStateOccupiedPositions.length}</p>
                <p className="text-sm text-slate-600">ONUs configuradas</p>
              </div>
              <div className="rounded-[8px] border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase text-slate-500">Livres</p>
                <p className="mt-2 text-2xl font-semibold">{onuStateFreePositions.length}</p>
                <p className="text-sm text-slate-600">posicoes disponiveis</p>
              </div>
              <div className="rounded-[8px] border border-orange-200 bg-orange-50 p-4">
                <p className="text-xs font-semibold uppercase text-orange-700">Proxima livre</p>
                <p className="mt-2 text-2xl font-semibold text-orange-950">{onuStateNextFreePosition ?? "-"}</p>
                <p className="text-sm text-orange-900">indice ONU sugerido</p>
              </div>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              <div className="rounded-[8px] border border-slate-200 p-4">
                <p className="text-sm font-semibold text-slate-900">Posicoes ocupadas</p>
                <p className="mt-2 max-h-28 overflow-auto text-sm leading-6 text-slate-600">{onuStateOccupiedPositions.length ? onuStateOccupiedPositions.join(", ") : "Nenhuma posicao ocupada encontrada no retorno."}</p>
              </div>
              <div className="rounded-[8px] border border-slate-200 p-4">
                <p className="text-sm font-semibold text-slate-900">Posicoes livres</p>
                <p className="mt-2 max-h-28 overflow-auto text-sm leading-6 text-slate-600">{onuStateFreePositions.length ? onuStateFreePositions.join(", ") : "Nenhuma posicao livre encontrada."}</p>
              </div>
            </div>

            <pre className="mt-4 max-h-[60vh] overflow-auto rounded-[8px] bg-slate-950 p-4 font-mono text-sm leading-6 text-slate-50">{onuStateOutput}</pre>
          </div>
        </div>
      ) : null}
    </main>
  )
}

function driverOptions(drivers: OltDriver[]) {
  return drivers.length ? drivers : [{ id: "zte-c650", label: "ZTE C650" }]
}

function moneyInputToCents(value: string) {
  const normalized = value
    .replace(/\s/g, "")
    .replace(/\./g, "")
    .replace(",", ".")
  const number = Number(normalized)
  if (!Number.isFinite(number) || number < 0) return 0
  return Math.round(number * 100)
}

function centsToMoneyInput(value: number) {
  return (Number(value || 0) / 100).toFixed(2).replace(".", ",")
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(value || 0) / 100)
}

function billingStatusLabel(status: string) {
  const labels: Record<string, string> = {
    active: "Ativa",
    inactive: "Inativa",
    suspended: "Suspensa",
    draft: "Rascunho",
    calculated: "Calculado",
    ready: "Pronto",
    sending: "Enviando",
    sent: "Enviado",
    failed: "Falha",
    reconciled: "Conciliado",
    canceled: "Cancelado",
    approved: "Aprovada",
    included: "Incluída",
    open: "Aberto",
    resolved: "Resolvido",
    paid: "Paga",
    overdue: "Vencida",
  }

  return labels[status] || status
}

function accessStateLabel(status?: string | null) {
  const labels: Record<string, string> = {
    active_normal: "Ativo normal",
    financial_partial_block: "Bloqueio parcial financeiro",
    financial_total_block: "Bloqueio total financeiro",
    administrative_partial_block: "Bloqueio parcial administrativo",
    confidence_release: "Liberado em confiança",
    pending_application: "Pendente de aplicação",
  }

  return labels[status || ""] || status || "Nao avaliado"
}

function invoiceRaw(invoice: BillingInvoice) {
  if (!invoice.rawPayload) return null
  try {
    return JSON.parse(invoice.rawPayload) as {
      link?: string
      valor_pago?: number
      data_pagamento?: string | null
      forma_cobranca?: { descricao?: string }
      nosso_numero?: string
    }
  } catch {
    return null
  }
}

function BillingAccountsList({ accounts, selectedId, onSelect }: { accounts: BillingAccount[]; selectedId: string; onSelect: (account: BillingAccount) => void }) {
  if (accounts.length === 0) {
    return <p className="rounded-[8px] bg-slate-50 p-4 text-sm text-slate-600">Nenhuma conta financeira encontrada.</p>
  }

  return (
    <div className="grid max-h-[620px] gap-3 overflow-auto pr-1">
      {accounts.map((account) => (
        <button
          key={account.id}
          type="button"
          onClick={() => onSelect(account)}
          className={`rounded-[8px] border p-4 text-left ${selectedId === account.id ? "border-orange-300 bg-orange-50" : "border-slate-200 bg-slate-50"}`}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold text-slate-950">{account.userName || account.landlordName || account.userEmail || "Operador"}</p>
              <p className="text-xs text-slate-500">{account.userEmail || "sem email"}</p>
            </div>
            <span className={account.hubsoftClientServiceId ? "rounded bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700" : "rounded bg-red-100 px-2 py-1 text-xs font-semibold text-red-700"}>
              {account.hubsoftClientServiceId ? "Hubsoft" : "Sem ID"}
            </span>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-slate-600">
            <span>{formatMoney(account.minimumAmountCents)}</span>
            <span>{account.includedProvisionings} inclusos</span>
            <span>{formatMoney(account.extraProvisioningAmountCents)} extra</span>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {account.serviceCount ?? 0} serviços · {account.runCount ?? 0} fechamentos · {account.openAlertCount ?? 0} alertas
          </p>
        </button>
      ))}
    </div>
  )
}

function BillingRunsTable({ runs }: { runs: BillingRun[] }) {
  if (runs.length === 0) {
    return <p className="rounded-[8px] bg-slate-50 p-4 text-sm text-slate-600">Nenhum fechamento gerado.</p>
  }

  return (
    <div className="billing-runs-list">
      <div className="billing-runs-header" aria-hidden="true">
        <span>Competência</span>
        <span>Operador</span>
        <span>ONUs</span>
        <span>Valores</span>
        <span>Hubsoft</span>
        <span>Status</span>
        <span>Total</span>
      </div>

      {runs.map((run) => (
        <article key={run.id} className="billing-run-row">
          <div className="billing-run-cell">
            <span className="billing-run-label">Competência</span>
            <strong>{run.competence}</strong>
            <small>fecha {formatDateTime(run.closingAt)}</small>
          </div>
          <div className="billing-run-cell">
            <span className="billing-run-label">Operador</span>
            <strong>{run.userName || run.landlordName || run.userEmail || "Operador"}</strong>
            <small>venc. dia {run.dueDay}</small>
          </div>
          <div className="billing-run-cell">
            <span className="billing-run-label">ONUs</span>
            <strong>{run.activeProvisioningCount} ativas</strong>
            <small>{run.includedProvisioningCount} inclusas · {run.extraProvisioningCount} extras</small>
          </div>
          <div className="billing-run-cell">
            <span className="billing-run-label">Valores</span>
            <strong>Mínimo {formatMoney(run.minimumAmountCents)}</strong>
            <small>Extra {formatMoney(run.extraAmountCents)} · Multa {formatMoney(run.penaltyAmountCents)}</small>
          </div>
          <div className="billing-run-cell">
            <span className="billing-run-label">Hubsoft</span>
            <strong>{run.hubsoftClientServiceId || "sem id_cliente_servico"}</strong>
            <small>{run.hubsoftEventStatus || "sem envio"}</small>
          </div>
          <div className="billing-run-cell">
            <span className="billing-run-label">Status</span>
            <strong>{billingStatusLabel(run.status)}</strong>
          </div>
          <div className="billing-run-cell billing-run-total">
            <span className="billing-run-label">Total</span>
            <strong>{formatMoney(run.totalAmountCents)}</strong>
          </div>
        </article>
      ))}
    </div>
  )
}

function BillingInvoicesTable({ invoices }: { invoices: BillingInvoice[] }) {
  if (invoices.length === 0) {
    return <p className="rounded-[8px] bg-slate-50 p-4 text-sm text-slate-600">Nenhuma fatura sincronizada.</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] text-left text-sm">
        <thead className="text-slate-500">
          <tr>
            <th className="border-b border-slate-200 py-3 pr-4">Operador</th>
            <th className="border-b border-slate-200 py-3 pr-4">Fatura</th>
            <th className="border-b border-slate-200 py-3 pr-4">Vencimento</th>
            <th className="border-b border-slate-200 py-3 pr-4">Status</th>
            <th className="border-b border-slate-200 py-3 pr-4">Valor</th>
            <th className="border-b border-slate-200 py-3">Hubsoft</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((invoice) => {
            const raw = invoiceRaw(invoice)

            return (
              <tr key={invoice.id}>
                <td className="border-b border-slate-100 py-3 pr-4">
                  <p>{invoice.userName || invoice.landlordName || invoice.userEmail || "Operador"}</p>
                  <p className="text-xs text-slate-500">{invoice.hubsoftClientServiceId}</p>
                </td>
                <td className="border-b border-slate-100 py-3 pr-4">
                  <p className="font-medium">{invoice.hubsoftInvoiceId || "-"}</p>
                  <p className="text-xs text-slate-500">{raw?.nosso_numero ? `Nosso número ${raw.nosso_numero}` : invoice.competence || "-"}</p>
                </td>
                <td className="border-b border-slate-100 py-3 pr-4">
                  <p>{formatDate(invoice.dueDate)}</p>
                  <p className="text-xs text-slate-500">sync {formatDateTime(invoice.syncedAt)}</p>
                </td>
                <td className="border-b border-slate-100 py-3 pr-4">
                  <p>{billingStatusLabel(invoice.status || "-")}</p>
                  {raw?.data_pagamento ? <p className="text-xs text-slate-500">paga em {formatDate(raw.data_pagamento)}</p> : null}
                </td>
                <td className="border-b border-slate-100 py-3 pr-4">
                  <p className="font-semibold">{formatMoney(invoice.amountCents ?? 0)}</p>
                  {typeof raw?.valor_pago === "number" && raw.valor_pago > 0 ? <p className="text-xs text-slate-500">pago {formatMoney(Math.round(raw.valor_pago * 100))}</p> : null}
                </td>
                <td className="border-b border-slate-100 py-3">
                  {raw?.link ? <a href={raw.link} target="_blank" rel="noreferrer" className="font-medium text-orange-800">Abrir fatura</a> : <span className="text-slate-500">sem link</span>}
                  {raw?.forma_cobranca?.descricao ? <p className="text-xs text-slate-500">{raw.forma_cobranca.descricao}</p> : null}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function BillingPenaltiesTable({ penalties }: { penalties: BillingPenalty[] }) {
  if (penalties.length === 0) {
    return <p className="rounded-[8px] bg-slate-50 p-4 text-sm text-slate-600">Nenhuma multa registrada.</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="text-slate-500">
          <tr>
            <th className="border-b border-slate-200 py-3 pr-4">Operador</th>
            <th className="border-b border-slate-200 py-3 pr-4">Motivo</th>
            <th className="border-b border-slate-200 py-3 pr-4">Status</th>
            <th className="border-b border-slate-200 py-3 pr-4">Competência</th>
            <th className="border-b border-slate-200 py-3">Valor</th>
          </tr>
        </thead>
        <tbody>
          {penalties.map((penalty) => (
            <tr key={penalty.id}>
              <td className="border-b border-slate-100 py-3 pr-4">
                <p>{penalty.userName || penalty.landlordName || penalty.userEmail || "Operador"}</p>
                <p className="text-xs text-slate-500">{formatDateTime(penalty.createdAt)}</p>
              </td>
              <td className="border-b border-slate-100 py-3 pr-4">
                <p className="font-medium">{penalty.reason}</p>
                {penalty.evidence ? <p className="text-xs text-slate-500">{penalty.evidence}</p> : null}
              </td>
              <td className="border-b border-slate-100 py-3 pr-4">{billingStatusLabel(penalty.status)}</td>
              <td className="border-b border-slate-100 py-3 pr-4">{penalty.includedCompetence || "próximo fechamento"}</td>
              <td className="border-b border-slate-100 py-3 font-semibold">{formatMoney(penalty.amountCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function BillingAlertsTable({ alerts, onResolve, isLoading }: { alerts: BillingAlert[]; onResolve: (alert: BillingAlert) => Promise<void>; isLoading: boolean }) {
  if (alerts.length === 0) {
    return <p className="rounded-[8px] bg-slate-50 p-4 text-sm text-slate-600">Nenhum alerta financeiro registrado.</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[920px] text-left text-sm">
        <thead className="text-slate-500">
          <tr>
            <th className="border-b border-slate-200 py-3 pr-4">Severidade</th>
            <th className="border-b border-slate-200 py-3 pr-4">Operador</th>
            <th className="border-b border-slate-200 py-3 pr-4">Alerta</th>
            <th className="border-b border-slate-200 py-3 pr-4">Contexto</th>
            <th className="border-b border-slate-200 py-3 text-right">Ação</th>
          </tr>
        </thead>
        <tbody>
          {alerts.map((alert) => (
            <tr key={alert.id} className={alert.status === "resolved" ? "opacity-60" : undefined}>
              <td className="border-b border-slate-100 py-3 pr-4">
                <span className={alert.severity === "error" ? "rounded bg-red-100 px-2 py-1 text-xs font-semibold text-red-700" : "rounded bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-700"}>
                  {alert.severity === "error" ? "Erro" : "Atenção"}
                </span>
              </td>
              <td className="border-b border-slate-100 py-3 pr-4">{alert.userName || alert.landlordName || alert.userEmail || "-"}</td>
              <td className="border-b border-slate-100 py-3 pr-4">
                <p className="font-medium">{alert.message}</p>
                <p className="text-xs text-slate-500">{alert.type} · {formatDateTime(alert.createdAt)}</p>
              </td>
              <td className="border-b border-slate-100 py-3 pr-4">
                <p>{alert.competence || alert.provisioningSerial || "-"}</p>
                {alert.provisioningStatus ? <p className="text-xs text-slate-500">{alert.provisioningStatus}</p> : null}
              </td>
              <td className="border-b border-slate-100 py-3 text-right">
                {alert.status === "open" ? (
                  <button onClick={() => onResolve(alert)} disabled={isLoading} className="rounded-[8px] border border-slate-300 px-3 py-2 text-sm font-medium disabled:opacity-60">Resolver</button>
                ) : (
                  billingStatusLabel(alert.status)
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AccessControlTable({
  items,
  onBlock,
  onUnblock,
  onConfidence,
  isLoading,
}: {
  items: AccessControlItem[]
  onBlock: (account: AccessControlItem) => Promise<void>
  onUnblock: (account: AccessControlItem) => Promise<void>
  onConfidence: (account: AccessControlItem) => Promise<void>
  isLoading: boolean
}) {
  if (items.length === 0) {
    return <p className="rounded-[8px] bg-slate-50 p-4 text-sm text-slate-600">Nenhuma conta para controle de acesso.</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1040px] text-left text-sm">
        <thead className="text-slate-500">
          <tr>
            <th className="border-b border-slate-200 py-3 pr-4">Operador</th>
            <th className="border-b border-slate-200 py-3 pr-4">Estado</th>
            <th className="border-b border-slate-200 py-3 pr-4">Financeiro</th>
            <th className="border-b border-slate-200 py-3 pr-4">Administrativo</th>
            <th className="border-b border-slate-200 py-3 pr-4">Pendencias</th>
            <th className="border-b border-slate-200 py-3 text-right">Operar regra</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const adminBlocked = Boolean(item.administrativeBlockActive)
            const pending = Boolean(item.pendingAction)
            return (
              <tr key={item.billingAccountId}>
                <td className="border-b border-slate-100 py-3 pr-4">
                  <p className="font-medium text-slate-950">{item.userName || item.landlordName || "Operador"}</p>
                  <p className="text-xs text-slate-500">{item.userEmail || "-"}</p>
                </td>
                <td className="border-b border-slate-100 py-3 pr-4">
                  <p className={pending ? "font-semibold text-red-700" : "font-medium text-slate-800"}>{accessStateLabel(item.state)}</p>
                  <p className="text-xs text-slate-500">avaliado {item.lastEvaluatedAt ? formatDateTime(item.lastEvaluatedAt) : "-"}</p>
                </td>
                <td className="border-b border-slate-100 py-3 pr-4">
                  <p>{accessStateLabel(item.financialState)}</p>
                  <p className="text-xs text-slate-500">{Number(item.overdueDays || 0)} dia(s) de atraso</p>
                </td>
                <td className="border-b border-slate-100 py-3 pr-4">
                  <p className={adminBlocked ? "font-semibold text-orange-800" : "text-slate-600"}>{adminBlocked ? "Ativo" : "Inativo"}</p>
                  <p className="text-xs text-slate-500">{adminBlocked ? item.administrativeBlockReason || "Bloqueio manual" : "sem bloqueio manual"}</p>
                </td>
                <td className="border-b border-slate-100 py-3 pr-4">
                  <p className={pending ? "font-semibold text-red-700" : "text-slate-600"}>{pending ? item.pendingAction : "Sem pendencia"}</p>
                  <p className="text-xs text-slate-500">{item.pendingError || `${Number(item.pendingNotificationCount || 0)} notificacao(oes) pendente(s)`}</p>
                </td>
                <td className="border-b border-slate-100 py-3">
                  <div className="flex flex-wrap justify-end gap-2">
                    {adminBlocked ? (
                      <button onClick={() => onUnblock(item)} disabled={isLoading} className="rounded-[8px] border border-slate-300 px-3 py-2 text-sm font-medium disabled:opacity-60">Remover manual</button>
                    ) : (
                      <button onClick={() => onBlock(item)} disabled={isLoading} className="rounded-[8px] border border-orange-200 px-3 py-2 text-sm font-medium text-orange-800 disabled:opacity-60">Bloqueio manual</button>
                    )}
                    <button onClick={() => onConfidence(item)} disabled={isLoading || adminBlocked} className="rounded-[8px] border border-emerald-200 px-3 py-2 text-sm font-medium text-emerald-700 disabled:opacity-50">Confiança 3d</button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

type MonitorIconName = "alert" | "antenna" | "chip" | "link" | "pulse" | "server" | "services" | "temperature"

function MonitorIcon({ name }: { name: MonitorIconName }) {
  const commonProps = {
    className: "monitor-svg-icon",
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 2,
    viewBox: "0 0 24 24",
    "aria-hidden": true,
  }

  if (name === "server") {
    return <svg {...commonProps}><rect x="5" y="4" width="14" height="16" rx="2" /><path d="M8 8h8" /><path d="M8 12h8" /><path d="M8 16h8" /><path d="M17 8h.01" /><path d="M17 12h.01" /><path d="M17 16h.01" /></svg>
  }
  if (name === "pulse") {
    return <svg {...commonProps}><path d="M3 12h4l2-5 4 10 2-5h6" /></svg>
  }
  if (name === "chip") {
    return <svg {...commonProps}><rect x="7" y="7" width="10" height="10" rx="2" /><path d="M9 1v3" /><path d="M15 1v3" /><path d="M9 20v3" /><path d="M15 20v3" /><path d="M20 9h3" /><path d="M20 14h3" /><path d="M1 9h3" /><path d="M1 14h3" /></svg>
  }
  if (name === "antenna") {
    return <svg {...commonProps}><path d="M12 19V9" /><path d="M8.5 12.5a5 5 0 0 1 7 0" /><path d="M5 9a10 10 0 0 1 14 0" /><path d="M12 19l-2 3" /><path d="M12 19l2 3" /><circle cx="12" cy="9" r="1" /></svg>
  }
  if (name === "temperature") {
    return <svg {...commonProps}><path d="M14 14.76V5a2 2 0 0 0-4 0v9.76a4 4 0 1 0 4 0Z" /><path d="M12 9v6" /></svg>
  }
  if (name === "link") {
    return <svg {...commonProps}><path d="M10 13a5 5 0 0 0 7.54.54l2-2a5 5 0 0 0-7.07-7.07l-1.14 1.14" /><path d="M14 11a5 5 0 0 0-7.54-.54l-2 2a5 5 0 0 0 7.07 7.07l1.14-1.14" /></svg>
  }
  if (name === "alert") {
    return <svg {...commonProps}><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.3 4.1 2.5 18a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 4.1a2 2 0 0 0-3.4 0Z" /></svg>
  }
  return <svg {...commonProps}><path d="M12 3v3" /><path d="M12 18v3" /><path d="M3 12h3" /><path d="M18 12h3" /><circle cx="12" cy="12" r="4" /></svg>
}

function MonitorMetric({ icon, title, value, detail, tone = "default" }: { icon: MonitorIconName; title: string; value: number; detail: string; tone?: "default" | "danger" | "success" }) {
  return (
    <div className={`monitor-metric-card monitor-metric-${icon} ${tone === "danger" ? "monitor-metric-danger" : ""} ${tone === "success" ? "monitor-metric-success" : ""}`}>
      <span className="monitor-metric-icon"><MonitorIcon name={icon} /></span>
      <span className="monitor-metric-copy">
        <span>{title}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </span>
    </div>
  )
}

function splitOperationalAlert(item: string) {
  const [title, ...rest] = item.split(":")
  return {
    title: rest.length ? title.trim() : "Alerta",
    text: rest.length ? rest.join(":").trim() : item,
  }
}

function OperationalAlertsPanel({ items }: { items: string[] }) {
  return (
    <section className="monitor-action-panel monitor-alert-panel">
      <div className="monitor-action-panel-title">
        <span className="monitor-action-icon monitor-action-icon-alert"><MonitorIcon name="alert" /></span>
        <h2>Alertas operacionais</h2>
      </div>

      <div className="monitor-alert-list">
        {items.length ? items.map((item, index) => {
          const alert = splitOperationalAlert(item)
          return (
            <div key={`${item}-${index}`} className="monitor-alert-item">
              <span className="monitor-alert-glyph"><MonitorIcon name="alert" /></span>
              <span className="monitor-alert-copy">
                <strong>{alert.title}</strong>
                <span>{alert.text}</span>
              </span>
              <button type="button">Revisar</button>
            </div>
          )
        }) : (
          <p className="monitor-empty-state">Nenhum alerta operacional no momento.</p>
        )}
      </div>

      <button type="button" className="monitor-panel-link">Ver todos os alertas</button>
    </section>
  )
}

function OperationalServicesPanel({ services }: { services: Array<{ label: string; status: "online" | "atencao" }> }) {
  return (
    <section className="monitor-action-panel">
      <div className="monitor-action-panel-title">
        <span className="monitor-action-icon monitor-action-icon-services"><MonitorIcon name="services" /></span>
        <h2>Serviços</h2>
      </div>

      <div className="monitor-service-list">
        {services.map((service) => (
          <div key={service.label} className="monitor-service-item">
            <span>{service.label}</span>
            <strong className={service.status === "online" ? "monitor-service-online" : "monitor-service-warning"}>
              {service.status === "online" ? "Online" : "Atenção"}
            </strong>
          </div>
        ))}
      </div>

      <button type="button" className="monitor-panel-link">Ver todos os serviços</button>
    </section>
  )
}

function Metric({ title, value, detail, tone = "default" }: { title: string; value: number; detail: string; tone?: "default" | "danger" }) {
  return (
    <div className={`rounded-[8px] border bg-white p-5 shadow-sm ${tone === "danger" ? "border-red-200" : "border-slate-200"}`}>
      <p className="text-sm text-slate-500">{title}</p>
      <p className="mt-2 text-3xl font-semibold">{value}</p>
      <p className="mt-1 text-sm text-slate-600">{detail}</p>
    </div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-[8px] border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  )
}

function isOnlineUplink(uplink: OltUplinkCurrent) {
  return uplink.operStatus === "up" || uplink.operStatus === "active"
}

function compactTemperature(value?: number | null) {
  return typeof value === "number" ? `${value}°C` : "-"
}

function OltCardMetric({ icon, label, value, detail, tone = "default" }: { icon: MonitorIconName; label: string; value: string; detail?: string; tone?: "default" | "success" }) {
  return (
    <div className="olt-card-metric">
      <span className={`olt-card-metric-glyph ${tone === "success" ? "olt-card-metric-glyph-success" : ""}`}><MonitorIcon name={icon} /></span>
      <span className="olt-card-metric-copy">
        <span>{label}</span>
        <strong>{value}</strong>
        {detail ? <small>{detail}</small> : null}
      </span>
    </div>
  )
}

function OltMonitoringTable({ items }: { items: OltMonitoringCurrent[] }) {
  if (items.length === 0) return <p className="rounded-[8px] bg-slate-50 p-4 text-sm text-slate-600">Nenhuma OLT coletada ainda.</p>

  return (
    <div className="olt-monitor-grid">
      {items.map((item) => {
        const onlineUplinks = item.uplinks.filter(isOnlineUplink)
        const mainUplink = onlineUplinks[0] ?? item.uplinks[0] ?? null
        const sensorReadings = item.temperatures.slice(0, 4)
        const sensorStatus = item.sensorCriticalCount > 0
          ? "critico"
          : item.sensorWarningCount > 0
            ? "alerta"
            : sensorReadings[0]?.statusName || "normal"

        return (
          <div key={item.oltId} className="olt-monitor-card">
            <div className="olt-monitor-header">
              <div className="olt-monitor-title">
                <span className="olt-device-glyph" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
                <span>
                  <strong>{item.oltName}</strong>
                  <small>{item.oltHost} · {formatDateTime(item.collectedAt)}</small>
                </span>
              </div>
              <div className="olt-card-metrics">
                <OltCardMetric icon="temperature" label="Temp" value={compactTemperature(item.temperatureC)} />
                <OltCardMetric icon="chip" label="CPU" value={formatPercent(item.maxCpu5sPercent)} />
                <OltCardMetric icon="chip" label="Mem" value={formatPercent(item.maxMemUsedPercent)} />
                <OltCardMetric icon="antenna" label="Uplinks" value={`${item.uplinkCount - item.uplinkDownCount}/${item.uplinkCount}`} detail="ativos" tone="success" />
              </div>
            </div>

            <div className="olt-processor-table">
              <table>
                <thead>
                  <tr>
                    <th>Slot</th>
                    <th>Role</th>
                    <th>CPU 5s</th>
                    <th>1m</th>
                    <th>5m</th>
                    <th>Peak</th>
                    <th>Mem</th>
                  </tr>
                </thead>
                <tbody>
                  {item.processors.length === 0 ? (
                    <tr><td colSpan={7}>Nenhum processador retornado nos OIDs ZTE.</td></tr>
                  ) : item.processors.map((processor) => (
                    <tr key={`${item.oltId}-${processor.processorIndex}`}>
                      <td>{processor.character}</td>
                      <td>{processor.role || "-"}</td>
                      <td>{formatPercent(processor.cpu5sPercent)}</td>
                      <td>{formatPercent(processor.cpu1mPercent)}</td>
                      <td>{formatPercent(processor.cpu5mPercent)}</td>
                      <td>{formatPercent(processor.peakCpuPercent)}</td>
                      <td>
                        <span className="olt-mem-cell">
                          <strong>{formatPercent(processor.memUsedPercent)}</strong>
                          <span className="olt-mem-track">
                            <span style={{ width: `${Math.min(Math.max(processor.memUsedPercent ?? 0, 0), 100)}%` }} />
                          </span>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="olt-monitor-footer">
              <div className="olt-monitor-footer-item">
                <span className="olt-footer-glyph"><MonitorIcon name="temperature" /></span>
                <strong>Sensores</strong>
                <span>
                  {sensorReadings.length
                    ? `${sensorReadings.map((sensor) => compactTemperature(sensor.temperatureC)).join(", ")} · ${sensorStatus}`
                    : "Sem sensores retornados"}
                </span>
              </div>
              <div className="olt-monitor-footer-item">
                <span className="olt-footer-glyph olt-footer-glyph-link"><MonitorIcon name="link" /></span>
                <strong>Uplink</strong>
                <span>
                  {mainUplink
                    ? `${mainUplink.interfaceName} · ${mainUplink.operStatus.toUpperCase()} · RX ${formatMbps(mainUplink.rxMbps)} · TX ${formatMbps(mainUplink.txMbps)}`
                    : "Sem uplinks online"}
                </span>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function OnuCurrentTable({
  items,
  totalItems,
  pageSize,
  pageSizeOptions,
  currentPage,
  totalPages,
  pageStartItem,
  pageEndItem,
  onPageSizeChange,
  onPageChange,
}: {
  items: OnuCurrent[]
  totalItems: number
  pageSize: number
  pageSizeOptions: number[]
  currentPage: number
  totalPages: number
  pageStartItem: number
  pageEndItem: number
  onPageSizeChange: (pageSize: number) => void
  onPageChange: (page: number) => void
}) {
  if (totalItems === 0) return <p className="rounded-[8px] bg-slate-50 p-4 text-sm text-slate-600">Nenhuma ONU coletada ainda.</p>

  return (
    <div className="onu-current-shell">
      <div className="onu-table-toolbar">
        <p>
          Exibindo {pageStartItem}-{pageEndItem} de {totalItems} ONUs
        </p>
        <div className="onu-pagination-controls">
          <label className="onu-page-size">
            <span>Por pagina</span>
            <select
              value={pageSize}
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
            >
              {pageSizeOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
          <div className="onu-page-nav">
            <button
              type="button"
              onClick={() => onPageChange(currentPage - 1)}
              disabled={currentPage <= 1}
            >
              Anterior
            </button>
            <span>
              {currentPage} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => onPageChange(currentPage + 1)}
              disabled={currentPage >= totalPages}
            >
              Proxima
            </button>
          </div>
        </div>
      </div>
      <div className="onu-table-wrap">
        <table className="onu-current-table">
          <thead>
            <tr>
              <th>OLT</th>
              <th>Porta</th>
              <th>ONU</th>
              <th>Status</th>
              <th>RX</th>
              <th>TX</th>
              <th>Ultima online</th>
              <th>Ultima offline</th>
              <th>MAC</th>
              <th>Atualizado</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>
                  <p className="font-medium">{item.oltName}</p>
                  <small>{item.oltHost}</small>
                </td>
                <td>{item.porta}</td>
                <td>{item.onuId}</td>
                <td><span className={onuStatusClass(item.statusName)}><span />{displayOnuStatus(item.statusName)}</span></td>
                <td className={item.rxDbm === null ? "onu-muted-cell" : undefined}>{formatPower(item.rxDbm)}</td>
                <td className={item.txDbm === null ? "onu-muted-cell" : undefined}>{formatPower(item.txDbm)}</td>
                <td>{formatDateTime(item.lastOnline)}</td>
                <td>{formatDateTime(item.lastOffline)}</td>
                <td className={item.learnedMac ? undefined : "onu-muted-cell"}>{item.learnedMac || "-"}</td>
                <td>{formatDateTime(item.collectedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ProvisioningTable({ provisionings, onDeprovision, onLogs, isLoading }: { provisionings: Provisioning[]; onDeprovision: (provisioning: Provisioning) => Promise<void>; onLogs: (provisioning: Provisioning) => Promise<void>; isLoading: boolean }) {
  if (provisionings.length === 0) return <p className="rounded-[8px] bg-slate-50 p-4 text-sm text-slate-600">Nenhum provisionamento encontrado.</p>

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[780px] text-left text-sm">
        <thead className="text-slate-500">
          <tr>
            <th className="border-b border-slate-200 py-3">Cliente</th>
            <th className="border-b border-slate-200 py-3">Operador</th>
            <th className="border-b border-slate-200 py-3">CPE</th>
            <th className="border-b border-slate-200 py-3">CTO/Porta</th>
            <th className="border-b border-slate-200 py-3">Status</th>
            <th className="border-b border-slate-200 py-3">Provisionado</th>
            <th className="border-b border-slate-200 py-3 text-right">Acoes</th>
          </tr>
        </thead>
        <tbody>
          {provisionings.map((item) => (
            <tr key={item.id}>
              <td className="border-b border-slate-100 py-3">
                <p className="font-medium">{item.contract.name}</p>
                <p className="text-slate-500">{item.contract.contractNumber}</p>
              </td>
              <td className="border-b border-slate-100 py-3">{item.contract.landlord?.user?.name || item.contract.landlord?.user?.email || "Sem responsavel"}</td>
              <td className="border-b border-slate-100 py-3">
                {item.cpeModel.name}<br />
                <span className="text-slate-500">{item.serial}</span>
                <p className="mt-1 text-xs text-slate-500">
                  ONU {displayOnuStatus(item.onuStatus)}
                  {typeof item.onuDistanceMeters === "number" ? ` · ${item.onuDistanceMeters}m` : ""}
                  {item.onuOnlineDuration ? ` · ${item.onuOnlineDuration}` : ""}
                </p>
                <p className="text-xs text-slate-500">RX {formatPower(item.onuRxPower)} · TX {formatPower(item.onuTxPower)}</p>
              </td>
              <td className="border-b border-slate-100 py-3">{item.port.cto.name}<br /><span className="text-slate-500">Porta {item.port.number}</span></td>
              <td className="border-b border-slate-100 py-3">{statusLabels[item.status] || item.status}</td>
              <td className="border-b border-slate-100 py-3 text-slate-600">{new Date(item.updatedAt || item.createdAt).toLocaleString("pt-BR")}</td>
              <td className="border-b border-slate-100 py-3 text-right">
                <div className="flex flex-wrap justify-end gap-2">
                  {item.status !== "inactive" ? (
                    <button onClick={() => onDeprovision(item)} disabled={isLoading} className="rounded-[8px] border border-red-200 px-3 py-2 text-sm font-medium text-red-700 disabled:opacity-60">Desprovisionar</button>
                  ) : null}
                  <button onClick={() => onLogs(item)} disabled={isLoading} className="rounded-[8px] border border-slate-300 px-3 py-2 text-sm font-medium disabled:opacity-60">Ver log</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ProvisioningLogTimeline({ logs, isLoading }: { logs: ProvisioningLog[]; isLoading: boolean }) {
  if (isLoading && logs.length === 0) {
    return <LoadingInline title="Carregando log" description="Buscando os eventos do provisionamento." />
  }

  if (logs.length === 0) {
    return <p className="mt-4 rounded-[8px] bg-slate-50 p-4 text-sm text-slate-600">Nenhum evento de provisionamento registrado.</p>
  }

  return (
    <div className="mt-4 grid gap-3">
      {logs.map((log) => (
        <div key={log.id} className={`rounded-[8px] border p-4 text-sm ${logLevelClass(log.level)}`}>
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="font-semibold text-slate-950">{log.message}</p>
              <p className="mt-1 text-xs text-slate-500">{log.stage}</p>
            </div>
            <span className="text-xs text-slate-500">{new Date(log.createdAt).toLocaleString("pt-BR")}</span>
          </div>
          {log.details ? (
            <pre className="mt-3 max-h-52 overflow-auto rounded-[8px] bg-slate-950 p-3 text-xs text-slate-50">{formatLogDetails(log.details)}</pre>
          ) : null}
        </div>
      ))}
    </div>
  )
}

function logLevelClass(level: string) {
  if (level === "success") return "border-emerald-200 bg-emerald-50"
  if (level === "warn") return "border-amber-200 bg-amber-50"
  if (level === "error") return "border-red-200 bg-red-50"
  return "border-slate-200 bg-white"
}

function formatLogDetails(details: Record<string, unknown>) {
  return JSON.stringify(details, null, 2)
}

function formatPower(value?: number | null) {
  return typeof value === "number" ? `${value.toFixed(2)} dBm` : "sem leitura"
}

function formatPercent(value?: number | null) {
  return typeof value === "number" ? `${value}%` : "-"
}

function formatMbps(value?: number | null) {
  return typeof value === "number" ? `${value.toFixed(2)} Mbps` : "-"
}

function formatDateTime(value?: string | null) {
  return value ? new Date(value).toLocaleString("pt-BR") : "-"
}

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleDateString("pt-BR") : "-"
}

function displayOnuStatus(status?: string | null) {
  const normalizedStatus = status?.trim().toLowerCase().replace(/[^a-z0-9]/g, "") ?? ""

  if (normalizedStatus === "dyinggasp") return "Desligado"
  if (normalizedStatus === "working") return "Online"
  return status || "sem leitura"
}

function onuStatusClass(status?: string | null) {
  const normalizedStatus = status?.trim().toLowerCase().replace(/[^a-z0-9]/g, "") ?? ""
  if (normalizedStatus === "working") return "onu-status-pill onu-status-online"
  if (normalizedStatus === "los" || normalizedStatus === "offline" || normalizedStatus === "dyinggasp") return "onu-status-pill onu-status-danger"
  if (normalizedStatus === "authfailed") return "onu-status-pill onu-status-warning"
  return "onu-status-pill"
}

function Info({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase text-slate-500">{label}</p>
      <p className="mt-1 font-medium text-slate-900">{value}</p>
      {detail ? <p className="text-xs text-slate-500">{detail}</p> : null}
    </div>
  )
}

function LogoPicker({ label, logo, previewClassName, onChange, onRemove }: { label: string; logo: string | null; previewClassName: string; onChange: (file?: File | null) => void; onRemove: () => void }) {
  return (
    <div className="grid gap-3 rounded-[8px] border border-slate-200 bg-white p-3">
      <p className="text-xs font-semibold uppercase text-slate-500">{label}</p>
      <div className={`flex h-28 items-center justify-center rounded-[8px] border border-slate-200 p-4 ${previewClassName}`}>
        {logo ? (
          <Image
            src={logo}
            alt={label}
            width={180}
            height={76}
            unoptimized
            className="max-h-20 w-auto max-w-full object-contain"
          />
        ) : (
          <span className="text-sm font-medium text-slate-500">Sem logo</span>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <label className="cursor-pointer rounded-[8px] bg-orange-800 px-4 py-2 text-sm font-medium text-white">
          Adicionar
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            onChange={(event) => {
              onChange(event.target.files?.[0])
              event.currentTarget.value = ""
            }}
          />
        </label>
        <button type="button" onClick={onRemove} className="rounded-[8px] border border-slate-300 px-4 py-2 text-sm font-medium">
          Remover
        </button>
      </div>
    </div>
  )
}

function Input({ value, onChange, placeholder, type = "text" }: { value: string; onChange: (value: string) => void; placeholder: string; type?: string }) {
  return <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} type={type} className="w-full min-w-0 rounded-[8px] border border-slate-200 px-3 py-3 text-sm outline-none focus:border-orange-700" />
}

function comparePortLabels(left: string, right: string) {
  const leftParts = left.split("/").map(Number)
  const rightParts = right.split("/").map(Number)
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const leftValue = leftParts[index] ?? 0
    const rightValue = rightParts[index] ?? 0
    if (leftValue !== rightValue) return leftValue - rightValue
  }

  return left.localeCompare(right)
}

function TextArea({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return <textarea value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} rows={4} className="w-full resize-y rounded-[8px] border border-slate-200 px-3 py-3 text-sm outline-none focus:border-orange-700" />
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-medium uppercase text-slate-500">{label}</span>
      {children}
    </label>
  )
}

function Check({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <label className="flex min-w-0 items-center justify-center gap-2 rounded-[8px] border border-slate-200 px-3 py-3 text-sm">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  )
}

function CommandArea({ title, value, onChange, rows = 7 }: { title: string; value: string; onChange: (value: string) => void; rows?: number }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-slate-700">{title}</span>
      <textarea value={value} onChange={(event) => onChange(event.target.value)} rows={rows} className="w-full resize-y rounded-[8px] border border-slate-200 px-3 py-3 font-mono text-sm outline-none focus:border-orange-700" />
    </label>
  )
}
