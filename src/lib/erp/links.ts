import { prisma } from '@/lib/prisma'
import type { ErpLinkInput } from './types'
import { isErpProvider } from './config'

type ErpLinkRow = {
  id: string
  contractId: string
  provider: string
  customerExternalId: string | null
  customerDisplayCode: string | null
  customerUrl: string | null
  serviceExternalId: string | null
  contractExternalId: string | null
  serviceDisplayCode: string | null
  serviceUrl: string | null
  planName: string | null
  login: string | null
  pppoePassword?: string | null
  document: string | null
  linkedAt: Date | string
}

function cleanText(value: unknown) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text || null
}

export function normalizeErpLinkInput(value: unknown): ErpLinkInput | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (!isErpProvider(record.provider)) return null

  return {
    provider: record.provider,
    customerExternalId: cleanText(record.customerExternalId),
    customerDisplayCode: cleanText(record.customerDisplayCode),
    customerUrl: cleanText(record.customerUrl),
    serviceExternalId: cleanText(record.serviceExternalId),
    contractExternalId: cleanText(record.contractExternalId),
    serviceDisplayCode: cleanText(record.serviceDisplayCode),
    serviceUrl: cleanText(record.serviceUrl),
    planName: cleanText(record.planName),
    login: cleanText(record.login),
    pppoePassword: cleanText(record.pppoePassword) ?? cleanText(record.senha) ?? cleanText(record.password),
    document: cleanText(record.document)?.replace(/\D/g, '') ?? null,
    rawJson: typeof record.rawJson === 'string' ? record.rawJson : null,
  }
}

export async function upsertErpLink(landlordId: string, contractId: string, link: ErpLinkInput | null) {
  if (!link) return

  const id = globalThis.crypto?.randomUUID?.() ?? `erp_link_${Date.now()}`
  await prisma.$executeRaw`
    INSERT INTO "ErpLink" (
      "id", "landlordId", "contractId", "provider",
      "customerExternalId", "customerDisplayCode", "customerUrl",
      "serviceExternalId", "contractExternalId", "serviceDisplayCode", "serviceUrl",
      "planName", "login", "pppoePassword", "document", "rawJson", "updatedAt"
    ) VALUES (
      ${id}, ${landlordId}, ${contractId}, ${link.provider},
      ${link.customerExternalId}, ${link.customerDisplayCode}, ${link.customerUrl},
      ${link.serviceExternalId}, ${link.contractExternalId}, ${link.serviceDisplayCode}, ${link.serviceUrl},
      ${link.planName}, ${link.login}, ${link.pppoePassword}, ${link.document}, ${link.rawJson ?? null}, CURRENT_TIMESTAMP
    )
    ON CONFLICT("contractId") DO UPDATE SET
      "provider" = excluded."provider",
      "customerExternalId" = excluded."customerExternalId",
      "customerDisplayCode" = excluded."customerDisplayCode",
      "customerUrl" = excluded."customerUrl",
      "serviceExternalId" = excluded."serviceExternalId",
      "contractExternalId" = excluded."contractExternalId",
      "serviceDisplayCode" = excluded."serviceDisplayCode",
      "serviceUrl" = excluded."serviceUrl",
      "planName" = excluded."planName",
      "login" = excluded."login",
      "pppoePassword" = excluded."pppoePassword",
      "document" = excluded."document",
      "rawJson" = excluded."rawJson",
      "linkedAt" = CURRENT_TIMESTAMP,
      "updatedAt" = CURRENT_TIMESTAMP
  `
}

export async function listErpLinksByContractIds(contractIds: string[]) {
  if (!contractIds.length) return new Map<string, ErpLinkRow>()

  const placeholders = contractIds.map(() => '?').join(',')
  const rows = await prisma.$queryRawUnsafe<ErpLinkRow[]>(
    `SELECT "id", "contractId", "provider", "customerExternalId", "customerDisplayCode", "customerUrl",
            "serviceExternalId", "contractExternalId", "serviceDisplayCode", "serviceUrl",
            "planName", "login", "pppoePassword", "document", "linkedAt"
     FROM "ErpLink"
     WHERE "contractId" IN (${placeholders})`,
    ...contractIds,
  )

  return new Map(rows.map((row) => [row.contractId, {
    ...row,
    linkedAt: new Date(row.linkedAt).toISOString(),
  }]))
}
