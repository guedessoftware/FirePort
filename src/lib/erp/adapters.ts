import type {
  ErpLookupKey,
  NormalizedErpAddress,
  NormalizedErpCustomer,
  NormalizedErpLookupResponse,
  NormalizedErpService,
  OperatorErpConfigSecret,
} from './types'
import {
  asArray,
  asRecord,
  compactAddress,
  firstNumber,
  joinUrl,
  onlyDigits,
  requestJson,
  textValue,
} from './utils'

type Adapter = {
  lookup(config: OperatorErpConfigSecret, input: { key: ErpLookupKey; query: string }): Promise<NormalizedErpLookupResponse>
  test(config: OperatorErpConfigSecret): Promise<void>
}

const hubsoftClientRelacoes = [
  'grupos',
  'porta_atendimento',
  'interface',
  'interface_roteamento',
  'equipamento_conexao',
  'equipamento_roteamento',
  'cpes',
  'pacotes',
  'parametros_pacote',
  'senhas',
  'endereco_instalacao',
  'endereco_cadastral',
  'endereco_cobranca',
  'endereco_fiscal',
  'status_conexao',
  'parametros_mvno',
  'cliente_servico_mapeamento',
].join(',')

function authHeaders(config: OperatorErpConfigSecret): Record<string, string> {
  return config.token ? { Authorization: `Bearer ${config.token}` } : {}
}

function hubsoftBaseUrl(config: OperatorErpConfigSecret) {
  return config.baseUrl.replace(/\/oauth\/token$/i, '')
}

function hubsoftWebCustomerUrl(config: OperatorErpConfigSecret, customerId: string | null) {
  return customerId ? joinUrl(hubsoftBaseUrl(config), `/cliente/editar/${encodeURIComponent(customerId)}/servico`) : null
}

function mikwebBaseUrl(config: OperatorErpConfigSecret) {
  const baseUrl = config.baseUrl.replace(/\/+$/, '')
  return /\/v1\/admin$/i.test(baseUrl) ? baseUrl : joinUrl(baseUrl, '/v1/admin')
}

function mikwebWebCustomerUrl(customerId: string | null) {
  return customerId ? `https://painel.mikweb.com.br/admin/customers/${encodeURIComponent(customerId)}/billings` : null
}

async function hubsoftAuthHeaders(config: OperatorErpConfigSecret): Promise<Record<string, string>> {
  if (config.token) return authHeaders(config)

  if (!config.clientId || !config.clientSecret || !config.username || !config.password) {
    throw new Error('Informe Token ou Client ID, Client secret, Usuario e Senha para HubSoft.')
  }

  const session = asRecord(await requestJson(joinUrl(hubsoftBaseUrl(config), '/oauth/token'), {
    method: 'POST',
    body: JSON.stringify({
      grant_type: 'password',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      username: config.username,
      password: config.password,
    }),
  }))
  const token = idFrom(session?.access_token, session?.token)
  if (!token) throw new Error('OAuth do HubSoft nao retornou access token.')

  return { Authorization: `Bearer ${token}` }
}

function idFrom(...values: unknown[]) {
  for (const value of values) {
    const text = textValue(value)
    if (text) return text
  }
  return null
}

function scalarText(value: unknown): string | null {
  if (value && typeof value === 'object') return null
  return textValue(value)
}

function firstScalarText(record: Record<string, unknown> | null, keys: string[]): string | null {
  if (!record) return null
  for (const key of keys) {
    const value = scalarText(record[key])
    if (value) return value
  }
  return null
}

function firstDeepText(source: unknown, keys: string[], maxDepth = 5): string | null {
  const seen = new Set<unknown>()
  const search = (value: unknown, depth: number): string | null => {
    if (!value || typeof value !== 'object' || seen.has(value) || depth > maxDepth) return null
    seen.add(value)

    const record = asRecord(value)
    if (record) {
      const direct = firstScalarText(record, keys)
      if (direct) return direct
      for (const item of Object.values(record)) {
        const nested = search(item, depth + 1)
        if (nested) return nested
      }
      return null
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        const nested = search(item, depth + 1)
        if (nested) return nested
      }
    }

    return null
  }

  return search(source, 0)
}

function nestedRecords(record: Record<string, unknown>, keys: string[]) {
  const records: Record<string, unknown>[] = []
  for (const key of keys) {
    const value = record[key]
    const nested = asRecord(value)
    if (nested) records.push(nested)
    for (const item of asArray(value)) {
      const itemRecord = asRecord(item)
      if (itemRecord) records.push(itemRecord)
    }
  }
  return records
}

function collectionFrom(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  const record = asRecord(value)
  return record ? Object.values(record) : []
}

function geoPointFromRecord(record: Record<string, unknown>) {
  const coordenadas = asRecord(record.coordenadas) ?? asRecord(record.coordinates)
  if (coordenadas) {
    const lat = firstNumber(coordenadas, ['latitude', 'lat'])
    const lng = firstNumber(coordenadas, ['longitude', 'lng', 'lon'])
    if (lat !== null && lng !== null) return { lat, lng }
  }

  const coordinatesValue = asRecord(record.coordenadas)?.coordinates ?? asRecord(record.coordinates)?.coordinates ?? record.coordinates
  const coordinates = Array.isArray(coordinatesValue) ? coordinatesValue : []
  if (coordinates.length >= 2) {
    const lng = Number(coordinates[0])
    const lat = Number(coordinates[1])
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng }
  }

  return null
}

function defaultServiceNumber(service: Record<string, unknown>, fallback: string) {
  return idFrom(
    service.id_cliente_servico,
    service.idClienteServico,
    service.uuid_cliente_servico,
    service.uuidClienteServico,
    service.id,
    service.contrato,
    service.numero_contrato,
    service.login,
    fallback,
  ) ?? fallback
}

function pppoePasswordFrom(service: Record<string, unknown>, customer?: Record<string, unknown>) {
  const keys = [
    'senha_pppoe',
    'senhaPppoe',
    'pppoe_password',
    'pppoePassword',
    'password_pppoe',
    'passwordPppoe',
    'senha_radius',
    'senhaRadius',
    'password_radius',
    'passwordRadius',
    'senha_conexao',
    'senhaConexao',
    'senha_autenticacao',
    'senhaAutenticacao',
    'senha',
    'password',
  ]

  return firstScalarText(service, keys)
    ?? firstDeepText(service, keys)
    ?? firstScalarText(customer ?? null, keys)
    ?? firstDeepText(customer, keys)
}

function pppoeLoginFrom(service: Record<string, unknown>, customer?: Record<string, unknown>) {
  const keys = [
    'login',
    'login_radius',
    'loginRadius',
    'login_pppoe',
    'loginPppoe',
    'pppoe_login',
    'pppoeLogin',
    'usuario_pppoe',
    'usuarioPppoe',
    'usuario_radius',
    'usuarioRadius',
    'usuario',
    'username',
    'user',
  ]

  return firstScalarText(service, keys)
    ?? firstDeepText(service, keys)
    ?? firstScalarText(customer ?? null, keys)
    ?? firstDeepText(customer, keys)
}

function addressFromRecord(record: Record<string, unknown> | null): NormalizedErpAddress | null {
  if (!record) return null
  const addressKeys = [
    'endereco',
    'address',
    'endereco_instalacao',
    'enderecoInstalacao',
    'endereco_principal',
    'enderecoPrincipal',
    'endereco_cobranca',
    'enderecoCobranca',
    'endereco_fiscal',
    'enderecoFiscal',
    'endereco_cadastral',
    'enderecoCadastral',
    'cliente_endereco',
    'clienteEndereco',
    'cliente_servico_mapeamento',
    'clienteServicoMapeamento',
    'mapeamento',
    'enderecos',
    'addresses',
    'instalacao',
    'localizacao',
    'localizacao_instalacao',
    'coordenadas',
  ]
  const candidates = [...nestedRecords(record, addressKeys), record]

  for (const nested of candidates) {
    const geoPoint = geoPointFromRecord(nested)
    const address = compactAddress({
      cep: firstScalarText(nested, ['cep', 'zip_code', 'zipcode', 'codigo_postal', 'codigoPostal', 'endereco_cobranca_cep']),
      street: firstScalarText(nested, ['logradouro', 'rua', 'street', 'endereco', 'address', 'endereco_cobranca_rua']),
      number: firstScalarText(nested, ['numero', 'number', 'numero_residencia', 'numeroResidencia', 'numero_endereco', 'numeroEndereco', 'endereco_cobranca_numero', 'num']),
      neighborhood: firstScalarText(nested, ['bairro', 'neighborhood', 'endereco_cobranca_bairro']),
      city: firstScalarText(nested, ['cidade', 'city', 'localidade', 'municipio']),
      state: firstScalarText(nested, ['uf', 'estado', 'state']),
      complement: firstScalarText(nested, ['complemento', 'complement', 'endereco_cobranca_complemento']),
      reference: firstScalarText(nested, ['referencia', 'reference', 'ponto_referencia', 'pontoReferencia']),
      fullAddress: firstScalarText(nested, ['completo', 'endereco_completo', 'enderecoCompleto', 'full_address', 'fullAddress']),
      lat: firstNumber(nested, ['latitude', 'lat']) ?? geoPoint?.lat,
      lng: firstNumber(nested, ['longitude', 'lng', 'lon']) ?? geoPoint?.lng,
    })

    if (address.fullAddress || address.cep || address.street || (address.lat !== null && address.lng !== null)) {
      return address
    }
  }

  return null
}

function normalizeHubsoftService(
  serviceValue: unknown,
  customerAddress: NormalizedErpAddress | null,
  config: OperatorErpConfigSecret,
  customer?: Record<string, unknown>,
): NormalizedErpService {
  const service = asRecord(serviceValue) ?? {}
  const serviceId = idFrom(service.id_cliente_servico, service.idClienteServico, service.uuid_cliente_servico, service.uuidClienteServico, service.id)
  const customerId = idFrom(customer?.id_cliente, customer?.idCliente, customer?.uuid_cliente, customer?.uuidCliente, customer?.id)
  const contractNumber = defaultServiceNumber(service, serviceId ?? 'servico')
  const serial = idFrom(service.phy_addr, service.phyAddress, service.serial, service.serial_onu, service.mac, service.macAddress)

  return {
    externalServiceId: serviceId,
    externalContractId: serviceId,
    displayCode: idFrom(service.codigo, service.codigo_servico, serviceId),
    contractNumber,
    status: idFrom(service.status, service.status_prefix, service.statusPrefix),
    planName: idFrom(service.nome, service.name, service.servico, service.plano, service.nome_servico),
    login: pppoeLoginFrom(service, customer),
    pppoePassword: pppoePasswordFrom(service, customer),
    serial,
    address: addressFromRecord(service) ?? customerAddress,
    externalUrl: hubsoftWebCustomerUrl(config, customerId),
    raw: serviceValue,
  }
}

function normalizeHubsoftCustomer(value: unknown, config: OperatorErpConfigSecret): NormalizedErpCustomer {
  const customer = asRecord(value) ?? {}
  const customerId = idFrom(customer.id_cliente, customer.idCliente, customer.uuid_cliente, customer.uuidCliente, customer.id)
  const displayCode = idFrom(customer.codigo_cliente, customer.codigoCliente, customer.codigo, customerId)
  const address = addressFromRecord(customer)
  const services = [
    ...asArray(customer.servicos),
    ...asArray(customer.services),
    ...asArray(customer.contratos),
  ].map((service) => normalizeHubsoftService(service, address, config, customer))

  return {
    externalCustomerId: customerId,
    displayCode,
    name: idFrom(customer.razao_social, customer.nome_razaosocial, customer.nome, customer.name, customer.nome_fantasia) ?? 'Cliente HubSoft',
    document: onlyDigits(idFrom(customer.cpf_cnpj, customer.cnpj, customer.cpf, customer.documento)),
    phone: idFrom(customer.telefone_primario, customer.primaryPhone, customer.telefone, customer.celular),
    email: idFrom(customer.email_principal, customer.primaryEmail, customer.email),
    status: idFrom(customer.ativo, customer.status),
    externalUrl: hubsoftWebCustomerUrl(config, customerId),
    address,
    services,
    raw: value,
  }
}

const hubsoftAdapter: Adapter = {
  async lookup(config, input) {
    const busca = input.key === 'cpf_cnpj' ? 'cpf_cnpj' : input.key === 'customer_id' ? 'codigo_cliente' : 'id_cliente_servico'
    const url = new URL(joinUrl(hubsoftBaseUrl(config), '/api/v1/integracao/cliente'))
    url.searchParams.set('busca', busca)
    url.searchParams.set('termo_busca', input.query)
    url.searchParams.set('incluir_contrato', 'sim')
    url.searchParams.set('relacoes', hubsoftClientRelacoes)
    const body = await requestJson(url.toString(), { headers: await hubsoftAuthHeaders(config) })
    const record = asRecord(body)
    const rawCustomers = asArray(record?.clientes).length ? asArray(record?.clientes) : asArray(record?.data).length ? asArray(record?.data) : [record?.cliente ?? body]
    const customers = rawCustomers.filter(Boolean).map((item) => normalizeHubsoftCustomer(item, config))
    return { provider: config.provider, lookupKey: input.key, query: input.query, customers }
  },
  async test(config) {
    const url = new URL(joinUrl(hubsoftBaseUrl(config), '/api/v1/integracao/cliente'))
    url.searchParams.set('busca', 'codigo_cliente')
    url.searchParams.set('termo_busca', '0')
    url.searchParams.set('incluir_contrato', 'sim')
    await requestJson(url.toString(), { headers: await hubsoftAuthHeaders(config) }).catch((error) => {
      if (error instanceof Error && /nao encontrado|não encontrado|404/i.test(error.message)) return null
      throw error
    })
  },
}

function normalizeSgpCustomer(value: unknown, config: OperatorErpConfigSecret): NormalizedErpCustomer {
  const customer = asRecord(value) ?? {}
  const contractId = idFrom(customer.contrato, customer.contrato_id, customer.id_contrato)
  const customerId = idFrom(customer.cliente_id, customer.id_cliente, customer.id)
  const address = addressFromRecord(customer)
  const servicesRaw = asArray(customer.contratos).length ? asArray(customer.contratos) : contractId ? [customer] : []
  const services = servicesRaw.map((item) => {
    const service = asRecord(item) ?? {}
    const serviceContractId = idFrom(service.contrato, service.contrato_id, service.id_contrato, contractId)
    return {
      externalServiceId: serviceContractId,
      externalContractId: serviceContractId,
      displayCode: serviceContractId,
      contractNumber: serviceContractId ?? idFrom(service.login, customer.login, customerId) ?? 'contrato',
      status: idFrom(service.status, service.status_contrato, customer.status),
      planName: idFrom(service.plano, service.servico, service.servico_nome),
      login: idFrom(service.login, customer.login),
      pppoePassword: pppoePasswordFrom(service, customer),
      serial: idFrom(service.serial, service.onu_serial, service.mac, customer.serial),
      address: addressFromRecord(service) ?? address,
      externalUrl: serviceContractId ? joinUrl(config.baseUrl, `/admin/contratos/contrato/${encodeURIComponent(serviceContractId)}/`) : null,
      raw: item,
    }
  })

  return {
    externalCustomerId: customerId,
    displayCode: customerId,
    name: idFrom(customer.nome, customer.razao_social, customer.name) ?? 'Cliente SGP',
    document: onlyDigits(idFrom(customer.cpfcnpj, customer.cpf_cnpj, customer.cpf, customer.cnpj)),
    phone: idFrom(customer.telefone, customer.celular, customer.fone),
    email: idFrom(customer.email),
    status: idFrom(customer.status, customer.status_cliente),
    externalUrl: customerId ? joinUrl(config.baseUrl, `/admin/clientes/cliente/${encodeURIComponent(customerId)}/`) : null,
    address,
    services,
    raw: value,
  }
}

const sgpAdapter: Adapter = {
  async lookup(config, input) {
    const url = new URL(joinUrl(config.baseUrl, '/api/ura/consultacliente/'))
    if (config.token) url.searchParams.set('token', config.token)
    if (config.clientId) url.searchParams.set('app', config.clientId)
    if (input.key === 'cpf_cnpj') url.searchParams.set('cpfcnpj', onlyDigits(input.query) ?? input.query)
    if (input.key === 'customer_id') url.searchParams.set('cliente', input.query)
    if (input.key === 'contract_id') url.searchParams.set('contrato', input.query)
    const body = await requestJson(url.toString())
    const record = asRecord(body)
    const rawCustomers = asArray(record?.clientes).length ? asArray(record?.clientes) : asArray(record?.data).length ? asArray(record?.data) : [body]
    return { provider: config.provider, lookupKey: input.key, query: input.query, customers: rawCustomers.map((item) => normalizeSgpCustomer(item, config)) }
  },
  async test(config) {
    if (!config.token || !config.clientId) throw new Error('Informe Token e App para SGP.')
  },
}

async function beeswebHeaders(config: OperatorErpConfigSecret): Promise<Record<string, string>> {
  if (config.token) return { Authorization: `Bearer ${config.token}` }
  if (!config.username || !config.password) return {}
  const session = asRecord(await requestJson(joinUrl(config.baseUrl, '/adm/sessions'), {
    method: 'POST',
    body: JSON.stringify({ email: config.username, password: config.password }),
  }))
  const token = idFrom(session?.api_token, session?.token, session?.access_token)
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function normalizeBeeswebCustomer(value: unknown, servicesRaw: unknown[], config: OperatorErpConfigSecret): NormalizedErpCustomer {
  const customer = asRecord(value) ?? {}
  const customerId = idFrom(customer.id, customer.customer_id)
  const address = addressFromRecord(customer)
  const services = servicesRaw.map((item) => {
    const service = asRecord(item) ?? {}
    const contractId = idFrom(service.id, service.contract_id)
    return {
      externalServiceId: contractId,
      externalContractId: contractId,
      displayCode: contractId,
      contractNumber: contractId ?? idFrom(service.customer_id, customerId) ?? 'contrato',
      status: idFrom(service.status),
      planName: idFrom(service.plan, service.plan_name, service.name),
      login: idFrom(service.login, service.username),
      pppoePassword: pppoePasswordFrom(service, customer),
      serial: idFrom(service.serial, service.mac),
      address: addressFromRecord(service) ?? address,
      externalUrl: contractId ? joinUrl(config.baseUrl, `/adm/contracts/${encodeURIComponent(contractId)}`) : null,
      raw: item,
    }
  })

  return {
    externalCustomerId: customerId,
    displayCode: customerId,
    name: idFrom(customer.name, customer.nome, customer.razao_social) ?? 'Cliente Beesweb',
    document: onlyDigits(idFrom(customer.cpf_cnpj, customer.cpfcnpj, customer.document)),
    phone: idFrom(customer.phone, customer.telephone, customer.cellphone),
    email: idFrom(customer.email),
    status: idFrom(customer.status),
    externalUrl: customerId ? joinUrl(config.baseUrl, `/adm/customers/${encodeURIComponent(customerId)}`) : null,
    address,
    services,
    raw: value,
  }
}

const beeswebAdapter: Adapter = {
  async lookup(config, input) {
    const headers = await beeswebHeaders(config)
    let customers: NormalizedErpCustomer[] = []

    if (input.key === 'contract_id') {
      const contract = asRecord(await requestJson(joinUrl(config.baseUrl, `/adm/contracts/${encodeURIComponent(input.query)}`), { headers }))
      const customerId = idFrom(contract?.customer_id)
      const customer = customerId
        ? await requestJson(joinUrl(config.baseUrl, `/adm/customers/${encodeURIComponent(customerId)}`), { headers })
        : {}
      customers = [normalizeBeeswebCustomer(customer, [contract], config)]
    } else {
      const customerUrl = input.key === 'customer_id'
        ? joinUrl(config.baseUrl, `/adm/customers/${encodeURIComponent(input.query)}`)
        : `${joinUrl(config.baseUrl, '/adm/customers')}?search=${encodeURIComponent(input.query)}`
      const body = await requestJson(customerUrl, { headers })
      const customerItems = input.key === 'customer_id' ? [body] : asArray(asRecord(body)?.data)
      for (const item of customerItems) {
        const customerRecord = asRecord(item)
        const customerId = idFrom(customerRecord?.id)
        const contracts = customerId
          ? asArray(asRecord(await requestJson(`${joinUrl(config.baseUrl, '/adm/contracts')}?customer_id=${encodeURIComponent(customerId)}`, { headers }))?.data)
          : []
        customers.push(normalizeBeeswebCustomer(item, contracts, config))
      }
    }

    return { provider: config.provider, lookupKey: input.key, query: input.query, customers }
  },
  async test(config) {
    const headers = await beeswebHeaders(config)
    await requestJson(joinUrl(config.baseUrl, '/adm/customers'), { headers })
  },
}

function normalizeIspfyService(
  contractValue: unknown,
  pointValue: unknown,
  customer: Record<string, unknown>,
  customerAddress: NormalizedErpAddress | null,
  config: OperatorErpConfigSecret,
): NormalizedErpService {
  const contract = asRecord(contractValue) ?? {}
  const point = asRecord(pointValue) ?? {}
  const contractId = idFrom(contract.id_contrato, contract.contrato_id, contract.id, point.id_contrato)
  const pointId = idFrom(point.id, point.id_ponto, point.id_contrato, contractId)
  const login = idFrom(point.usuario, point.login, contract.login, contract.usuario, customer.login, customer.usuario)
  const pointAddress = addressFromRecord(point)
  const status = idFrom(point.sessao_conexao_status, point.ativo, contract.contrato_ativo, contract.status_contrato, contract.status, customer.status)
  const bandwidth = idFrom(point.banda_contratada, point.qos_profile_download, point.qos_profile_upload)

  return {
    externalServiceId: pointId ?? contractId,
    externalContractId: contractId ?? pointId,
    displayCode: idFrom(point.nome_ponto, pointId, contractId),
    contractNumber: idFrom(login, point.nome_ponto, contractId, pointId) ?? 'contrato',
    status,
    planName: idFrom(contract.plano, contract.servico, contract.nome, contract.nome_plano, bandwidth, customer.plano, customer.servico),
    login,
    pppoePassword: pppoePasswordFrom(point, contract) ?? pppoePasswordFrom(contract, customer),
    serial: idFrom(point.serial, point.mac, point.phy_addr, contract.serial, contract.mac, customer.serial, customer.mac, customer.phy_addr),
    address: pointAddress ?? addressFromRecord(contract) ?? customerAddress,
    externalUrl: contractId ? joinUrl(config.baseUrl, `/api/object/cliente/contrato/${encodeURIComponent(contractId)}`) : null,
    raw: pointValue ? { contract: contractValue, point: pointValue } : contractValue,
  }
}

function normalizeIspfyCustomer(value: unknown, config: OperatorErpConfigSecret): NormalizedErpCustomer {
  const customer = asRecord(value) ?? {}
  const customerId = idFrom(customer.id, customer.id_cliente, customer.cliente_id, customer.codigo_cliente, customer.uuid)
  const address = addressFromRecord(customer)

  const contracts = collectionFrom(customer.contratos)
  const services = contracts.length ? contracts.flatMap((contractValue) => {
    const contract = asRecord(contractValue) ?? {}
    const points = collectionFrom(contract.pontos)
    if (points.length) {
      return points.map((pointValue) => normalizeIspfyService(contractValue, pointValue, customer, address, config))
    }
    return [normalizeIspfyService(contractValue, null, customer, address, config)]
  }) : (
    collectionFrom(customer.servicos).length
      ? collectionFrom(customer.servicos)
      : collectionFrom(customer.cliente_servicos).length
        ? collectionFrom(customer.cliente_servicos)
        : collectionFrom(customer.services).length
          ? collectionFrom(customer.services)
          : [customer]
  ).map((item) => normalizeIspfyService(item, item, customer, address, config))

  return {
    externalCustomerId: customerId,
    displayCode: customerId,
    name: idFrom(customer.nome_razao, customer.nome, customer.name, customer.razao_social, customer.fantasia_apelido) ?? 'Cliente ISPFY',
    document: onlyDigits(idFrom(customer.cpf_cnpj, customer.cpfcnpj, customer.cpf, customer.cnpj, customer.documento)),
    phone: idFrom(customer.telefone, customer.celular, customer.phone, customer.fone),
    email: idFrom(customer.email),
    status: idFrom(customer.status),
    externalUrl: customerId ? joinUrl(config.baseUrl, `/api/object/cliente/${encodeURIComponent(customerId)}`) : null,
    address,
    services,
    raw: value,
  }
}

function ispfyCustomerId(value: unknown) {
  const customer = asRecord(value)
  return idFrom(customer?.id, customer?.id_cliente, customer?.cliente_id, customer?.codigo_cliente, customer?.uuid)
}

function ispfyResponseItems(body: unknown) {
  const record = asRecord(body)
  if (asArray(body).length) return asArray(body)
  if (asArray(record?.objects).length) return asArray(record?.objects)
  if (asArray(record?.data).length) return asArray(record?.data)
  if (asArray(record?.results).length) return asArray(record?.results)

  const direct = record?.object ?? record?.cliente ?? record?.customer ?? record?.data ?? record?.result ?? body
  return asArray(direct).length ? asArray(direct) : [direct].filter(Boolean)
}

const ispfyAdapter: Adapter = {
  async lookup(config, input) {
    const headers: Record<string, string> = config.token ? { Token: config.token } : {}

    if (input.key === 'cpf_cnpj') {
      const url = new URL(joinUrl(config.baseUrl, '/api/tool/assinante/info'))
      url.searchParams.set('doc', onlyDigits(input.query) ?? input.query)
      const body = await requestJson(url.toString(), { headers })
      return {
        provider: config.provider,
        lookupKey: input.key,
        query: input.query,
        customers: [normalizeIspfyCustomer(body, config)],
      }
    }

    if (input.key === 'customer_id') {
      const body = await requestJson(joinUrl(config.baseUrl, `/api/object/cliente/${encodeURIComponent(input.query)}`), { headers })
      const items = ispfyResponseItems(body)
      const exactItems = items.filter((item) => ispfyCustomerId(item) === input.query.trim())
      const rawCustomers = exactItems.length ? exactItems : items.length === 1 ? items : []
      return {
        provider: config.provider,
        lookupKey: input.key,
        query: input.query,
        customers: rawCustomers.map((item) => normalizeIspfyCustomer(item, config)),
      }
    }

    const url = new URL(joinUrl(config.baseUrl, '/api/object/cliente'))
    url.searchParams.set('contrato_id', input.query)
    const body = await requestJson(url.toString(), { headers })
    const rawCustomers = ispfyResponseItems(body)
    return { provider: config.provider, lookupKey: input.key, query: input.query, customers: rawCustomers.map((item) => normalizeIspfyCustomer(item, config)) }
  },
  async test(config) {
    if (!config.token) throw new Error('Informe Token para ISPFY.')
    const url = new URL(joinUrl(config.baseUrl, '/api/object/cliente'))
    url.searchParams.set('limit', '1')
    await requestJson(url.toString(), { headers: { Token: config.token } })
  },
}

function normalizeMikwebCustomer(value: unknown): NormalizedErpCustomer {
  const customer = asRecord(value) ?? {}
  const customerId = idFrom(customer.id)
  const address = addressFromRecord(customer)
  const login = idFrom(customer.login)
  const customerUrl = mikwebWebCustomerUrl(customerId)
  const firstCustomerContract = asRecord(asArray(customer.customer_contracts)[0])
  const contractId = idFrom(
    firstCustomerContract?.id,
    asArray(customer.customer_contract_ids)[0],
    asArray(customer.contract_ids)[0],
  )
  const onuId = idFrom(firstCustomerContract?.onu_id, asArray(customer.onu_ids)[0])
  const service: NormalizedErpService = {
    externalServiceId: contractId ?? customerId,
    externalContractId: contractId,
    displayCode: idFrom(contractId, login, customerId),
    contractNumber: login ?? customerId ?? 'cliente',
    status: idFrom(customer.status, customer.financial_status, customer.msg_payment_mk),
    planName: idFrom(asRecord(customer.plan)?.name, customer.plan_name),
    login,
    pppoePassword: idFrom(customer.password),
    serial: idFrom(customer.mac, onuId),
    address,
    externalUrl: customerUrl,
    raw: value,
  }

  return {
    externalCustomerId: customerId,
    displayCode: customerId,
    name: idFrom(customer.full_name, customer.name, customer.nome) ?? 'Cliente MikWeb',
    document: onlyDigits(idFrom(customer.cpf_cnpj, customer.cpf, customer.cnpj)),
    phone: idFrom(customer.cell_phone_number_1, customer.phone_number, customer.cell_phone_number_2),
    email: idFrom(customer.email),
    status: idFrom(customer.status, customer.financial_status, customer.msg_payment_mk),
    externalUrl: customerUrl,
    address,
    services: [service],
    raw: value,
  }
}

function mikwebCustomersFromBody(body: unknown) {
  const record = asRecord(body)
  const rawCustomers = asArray(record?.customers).length ? asArray(record?.customers) : [record?.customer ?? body]
  return rawCustomers.filter(Boolean)
}

const mikwebAdapter: Adapter = {
  async lookup(config, input) {
    if (!config.token) throw new Error('Informe Token Bearer para MikWeb.')

    const headers = authHeaders(config)
    if (input.key === 'contract_id') {
      throw new Error('A API oficial da MikWeb nao documenta busca por contrato/servico. Use CPF/CNPJ ou ID cliente.')
    }

    if (input.key === 'customer_id') {
      const body = await requestJson(joinUrl(mikwebBaseUrl(config), `/customers/${encodeURIComponent(input.query)}`), { headers })
      const customers = mikwebCustomersFromBody(body).map((item) => normalizeMikwebCustomer(item))
      return { provider: config.provider, lookupKey: input.key, query: input.query, customers }
    }

    const url = new URL(joinUrl(mikwebBaseUrl(config), '/customers'))
    url.searchParams.set('search', onlyDigits(input.query) ?? input.query)
    url.searchParams.set('per_page', '250')
    const body = await requestJson(url.toString(), { headers })
    const queryDigits = onlyDigits(input.query)
    const customers = mikwebCustomersFromBody(body)
      .map((item) => normalizeMikwebCustomer(item))
      .filter((customer) => !queryDigits || customer.document?.includes(queryDigits))
    return { provider: config.provider, lookupKey: input.key, query: input.query, customers }
  },
  async test(config) {
    if (!config.token) throw new Error('Informe Token Bearer para MikWeb.')
    const url = new URL(joinUrl(mikwebBaseUrl(config), '/customers'))
    url.searchParams.set('per_page', '1')
    await requestJson(url.toString(), { headers: authHeaders(config) })
  },
}

export function getErpAdapter(provider: OperatorErpConfigSecret['provider']): Adapter {
  if (provider === 'sgp') return sgpAdapter
  if (provider === 'ispfy') return ispfyAdapter
  if (provider === 'beesweb') return beeswebAdapter
  if (provider === 'mikweb') return mikwebAdapter
  return hubsoftAdapter
}
