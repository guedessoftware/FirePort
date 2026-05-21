export type ErpProvider = 'hubsoft' | 'sgp' | 'ispfy' | 'beesweb' | 'mikweb'
export type ErpLookupKey = 'cpf_cnpj' | 'customer_id' | 'contract_id'

export type OperatorErpConfigPublic = {
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

export type OperatorErpConfigSecret = {
  id: string
  landlordId: string
  provider: ErpProvider
  baseUrl: string
  enabled: boolean
  allowedLookupKeys: ErpLookupKey[]
  token: string | null
  username: string | null
  password: string | null
  clientId: string | null
  clientSecret: string | null
  extra: Record<string, unknown> | null
}

export type NormalizedErpAddress = {
  cep: string | null
  street: string | null
  number: string | null
  neighborhood: string | null
  city: string | null
  state: string | null
  complement: string | null
  reference: string | null
  fullAddress: string | null
  lat: number | null
  lng: number | null
}

export type NormalizedErpService = {
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

export type NormalizedErpCustomer = {
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

export type NormalizedErpLookupResponse = {
  provider: ErpProvider
  lookupKey: ErpLookupKey
  query: string
  customers: NormalizedErpCustomer[]
}

export type ErpLinkInput = {
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
  rawJson?: string | null
}
