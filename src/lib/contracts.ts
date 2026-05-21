import { createHash, randomInt, randomUUID } from 'crypto'
import { prisma } from './prisma'
import { getApplicationSettings } from './app-settings'
import { getBillingSettings } from './billing'
import { sendContractAcceptanceOtpEmail } from './notifications'

export type ContractRequirementStatus = {
  required: boolean
  accepted: boolean
  pending: boolean
  acceptanceId: string | null
  version: ContractVersionView | null
  message: string
}

export type ContractVersionView = {
  id: string
  templateId: string
  versionNumber: number
  title: string
  bodyText: string
  bodyHtml: string
  contentHash: string
  pdfHash: string | null
  publishedAt: string | null
}

type ContractVersionRow = ContractVersionView & {
  status: string
  publishedAt: Date | string | null
}

type ContractTemplateRow = {
  id: string
  title: string
  description: string | null
  targetRole: string
  isActive: boolean | number
  activeVersionId: string | null
  createdAt: Date | string
  updatedAt: Date | string
}

type ContractAcceptanceRow = {
  id: string
  versionId: string
  userId: string
  landlordId: string | null
  status: string
  signatureMethod: string
  otpChallengeId: string | null
  ipAddress: string | null
  userAgent: string | null
  contractHash: string
  pdfHash: string | null
  previousEvidenceHash: string | null
  acceptanceHash: string
  evidenceJson: string
  acceptedAt: Date | string
  createdAt: Date | string
}

let schemaReady: Promise<void> | null = null

function createLocalId(prefix: string) {
  try {
    return randomUUID()
  } catch {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`
  }
}

function iso(value: Date | string | null | undefined) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function pdfSafeText(value: string) {
  return value
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/\t/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function pdfHexText(value: string) {
  return Buffer.from(pdfSafeText(value), 'latin1').toString('hex').toUpperCase()
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderContractHtml(title: string, bodyText: string) {
  const blocks = bodyText
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => {
      const html = escapeHtml(paragraph).replace(/\n/g, '<br>')
      const normalized = paragraph
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()

      if (
        normalized.startsWith('CLAUSULA ')
        || normalized.startsWith('PREAMBULO ')
        || normalized.startsWith('CONTRATO DE ')
      ) {
        return `<h2>${html}</h2>`
      }

      if (/^\d+\.\d+\./.test(paragraph)) {
        return `<p class="contract-clause">${html}</p>`
      }

      if (/^\([a-z]\)/i.test(paragraph)) {
        return `<p class="contract-item">${html}</p>`
      }

      return `<p>${html}</p>`
    })
    .join('\n')

  return `<article class="contract-document"><h1>${escapeHtml(title)}</h1>${blocks}</article>`
}

type PdfTextBlock = {
  text: string
  size: number
  font: 'regular' | 'bold'
  indent?: number
  spaceBefore?: number
  spaceAfter?: number
}

function wrapPdfText(text: string, fontSize: number, maxWidth: number) {
  const averageWidth = fontSize * 0.52
  const maxChars = Math.max(18, Math.floor(maxWidth / averageWidth))
  const words = pdfSafeText(text).split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''

  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (next.length > maxChars && line) {
      lines.push(line)
      line = word
    } else {
      line = next
    }
  }
  if (line) lines.push(line)

  return lines
}

function parsePdfContractBlocks(title: string, bodyText: string): PdfTextBlock[] {
  const blocks: PdfTextBlock[] = [
    { text: title, size: 16, font: 'bold', spaceAfter: 14 },
  ]

  for (const paragraph of bodyText.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean)) {
    const normalized = paragraph.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
    const isHeading = normalized.startsWith('CLAUSULA ')
      || normalized.startsWith('PREAMBULO ')
      || normalized.startsWith('CONTRATO DE ')
    if (isHeading) {
      blocks.push({ text: paragraph, size: 11.5, font: 'bold', spaceBefore: 8, spaceAfter: 7 })
    } else if (/^\([a-z]\)/i.test(paragraph)) {
      blocks.push({ text: paragraph, size: 10.2, font: 'regular', indent: 14, spaceAfter: 5 })
    } else {
      blocks.push({ text: paragraph, size: 10.4, font: 'regular', spaceAfter: 6 })
    }
  }

  return blocks
}

function buildPdf(input: {
  title: string
  bodyText: string
  acceptedAt?: string | null
  acceptanceHash?: string | null
  contractHash?: string | null
  operatorName?: string | null
}) {
  const width = 595.28
  const height = 841.89
  const margin = 48
  const bottom = 48
  const maxWidth = width - margin * 2
  const pages: string[][] = [[]]
  let pageIndex = 0
  let y = height - margin

  const addPage = () => {
    pages.push([])
    pageIndex += 1
    y = height - margin
  }

  const addLine = (text: string, size: number, font: 'regular' | 'bold', x = margin) => {
    const leading = size * 1.45
    if (y - leading < bottom) addPage()
    const fontRef = font === 'bold' ? 'F2' : 'F1'
    pages[pageIndex].push(`BT /${fontRef} ${size.toFixed(2)} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm <${pdfHexText(text)}> Tj ET`)
    y -= leading
  }

  const addBlock = (block: PdfTextBlock) => {
    y -= block.spaceBefore ?? 0
    const indent = block.indent ?? 0
    const lines = wrapPdfText(block.text, block.size, maxWidth - indent)
    for (const line of lines) addLine(line, block.size, block.font, margin + indent)
    y -= block.spaceAfter ?? 0
  }

  addLine('CERTIFICADO DE ACEITE CONTRATUAL', 13, 'bold')
  addLine(`Operador: ${input.operatorName || 'Nao informado'}`, 10, 'regular')
  addLine(`Aceito em: ${input.acceptedAt || 'Nao informado'}`, 10, 'regular')
  addLine(`Hash do contrato: ${input.contractHash || 'Nao informado'}`, 8.5, 'regular')
  addLine(`Hash do aceite: ${input.acceptanceHash || 'Nao informado'}`, 8.5, 'regular')
  y -= 12

  for (const block of parsePdfContractBlocks(input.title, input.bodyText)) {
    addBlock(block)
  }

  const objects: string[] = []
  const addObject = (body: string) => {
    objects.push(body)
    return objects.length
  }

  const catalogId = addObject('') // placeholder
  const pagesId = addObject('') // placeholder
  const fontRegularId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  const fontBoldId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')
  const pageIds: number[] = []

  for (const pageCommands of pages) {
    const stream = pageCommands.join('\n')
    const contentId = addObject(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`)
    const pageId = addObject(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> >> /Contents ${contentId} 0 R >>`)
    pageIds.push(pageId)
  }

  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`

  const chunks = ['%PDF-1.4\n%\xE2\xE3\xCF\xD3\n']
  const offsets: number[] = [0]
  let offset = Buffer.byteLength(chunks[0], 'latin1')
  objects.forEach((body, index) => {
    offsets.push(offset)
    const objectText = `${index + 1} 0 obj\n${body}\nendobj\n`
    chunks.push(objectText)
    offset += Buffer.byteLength(objectText, 'latin1')
  })
  const xrefOffset = offset
  chunks.push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`)
  for (let index = 1; index < offsets.length; index += 1) {
    chunks.push(`${String(offsets[index]).padStart(10, '0')} 00000 n \n`)
  }
  chunks.push(`trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`)

  return Buffer.from(chunks.join(''), 'latin1')
}

function canonicalContractPayload(input: { title: string; bodyText: string; bodyHtml: string; versionNumber: number }) {
  return JSON.stringify({
    title: input.title.trim(),
    bodyText: input.bodyText.trim(),
    bodyHtml: input.bodyHtml.trim(),
    versionNumber: input.versionNumber,
  })
}

function formatMoneyFromCents(value: number | null | undefined) {
  const cents = Number(value ?? 0)
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

function formatDateBr(value: Date) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long' }).format(value)
}

function replacementValue(value: unknown) {
  const text = value === null || value === undefined ? '' : String(value).trim()
  return text || 'Nao informado'
}

function applyVariables(template: string, variables: Record<string, string>) {
  return template.replace(/\[\[([a-zA-Z0-9_]+)\]\]/g, (match, key: string) => (
    Object.prototype.hasOwnProperty.call(variables, key) ? replacementValue(variables[key]) : match
  ))
}

async function contractVariablesForUser(userId: string, acceptedAt = new Date()) {
  const [application, billing] = await Promise.all([
    getApplicationSettings(),
    getBillingSettings(),
  ])

  const rows = await prisma.$queryRaw<Array<{
    userName: string | null
    userEmail: string
    landlordId: string | null
    landlordName: string | null
    document: string | null
    hubsoftLegalName: string | null
    hubsoftTradeName: string | null
    hubsoftPrimaryPhone: string | null
    hubsoftSecondaryPhone: string | null
    hubsoftPrimaryEmail: string | null
    billingAccountId: string | null
    minimumAmountCents: number | null
    includedProvisionings: number | null
    extraProvisioningAmountCents: number | null
    dueDay: number | null
    activeProvisioningCount: number | null
    latestAddress: string | null
  }>>`
    SELECT
      "User"."name" AS "userName",
      "User"."email" AS "userEmail",
      "Landlord"."id" AS "landlordId",
      "Landlord"."name" AS "landlordName",
      "Landlord"."document" AS "document",
      "Landlord"."hubsoftLegalName" AS "hubsoftLegalName",
      "Landlord"."hubsoftTradeName" AS "hubsoftTradeName",
      "Landlord"."hubsoftPrimaryPhone" AS "hubsoftPrimaryPhone",
      "Landlord"."hubsoftSecondaryPhone" AS "hubsoftSecondaryPhone",
      "Landlord"."hubsoftPrimaryEmail" AS "hubsoftPrimaryEmail",
      "BillingAccount"."id" AS "billingAccountId",
      "BillingAccount"."minimumAmountCents" AS "minimumAmountCents",
      "BillingAccount"."includedProvisionings" AS "includedProvisionings",
      "BillingAccount"."extraProvisioningAmountCents" AS "extraProvisioningAmountCents",
      "BillingAccount"."dueDay" AS "dueDay",
      (
        SELECT COUNT(*)
        FROM "BillingService"
        WHERE "BillingService"."billingAccountId" = "BillingAccount"."id"
          AND "BillingService"."status" = 'active'
      ) AS "activeProvisioningCount",
      (
        SELECT
          TRIM(
            "Contract"."address" || ', ' || "Contract"."number" ||
            CASE WHEN "Contract"."complement" IS NOT NULL AND "Contract"."complement" <> '' THEN ' - ' || "Contract"."complement" ELSE '' END
          )
        FROM "Contract"
        WHERE "Contract"."landlordId" = "Landlord"."id"
        ORDER BY "Contract"."contractNumber" DESC
        LIMIT 1
      ) AS "latestAddress"
    FROM "User"
    LEFT JOIN "Landlord" ON "Landlord"."userId" = "User"."id"
    LEFT JOIN "BillingAccount" ON "BillingAccount"."landlordId" = "Landlord"."id"
    WHERE "User"."id" = ${userId}
    LIMIT 1
  `
  const row = rows[0]
  const included = Number(row?.includedProvisionings ?? billing.defaultIncludedProvisionings)
  const active = Number(row?.activeProvisioningCount ?? 0)
  const additional = Math.max(0, active - included)
  const minimumAmountCents = Number(row?.minimumAmountCents ?? billing.defaultMinimumAmountCents)
  const extraAmountCents = Number(row?.extraProvisioningAmountCents ?? billing.defaultExtraProvisioningAmountCents)

  return {
    empresa_razao_social: application.companyLegalName || application.companyName,
    empresa_cnpj: application.companyDocument,
    empresa_endereco: application.address,
    empresa_endereco_cep: application.addressPostalCode,
    empresa_cidade: application.city,
    empresa_endereco_uf_sigla: application.state,
    empresa_telefone: application.supportPhone,
    empresa_email: application.supportEmail,
    empresa_site: application.websiteUrl,
    nome_cliente: row?.hubsoftLegalName || row?.landlordName || row?.userName || '',
    cpf_cliente: row?.document || '',
    endereco_instalacao_cliente: row?.latestAddress || '',
    telefone1_cliente: row?.hubsoftPrimaryPhone || '',
    telefone2_cliente: row?.hubsoftSecondaryPhone || '',
    email_cliente: row?.hubsoftPrimaryEmail || row?.userEmail || '',
    vencimento_mensalidade: String(row?.dueDay ?? billing.defaultDueDay),
    forma_cobranca: billing.defaultBillingMethod,
    tipo_cobranca: billing.defaultChargeType,
    valor_unitario_porta_adicional: formatMoneyFromCents(extraAmountCents),
    descricao_pacotes: `${included} porta(s) inclusa(s)`,
    valor_liquido_servico: formatMoneyFromCents(minimumAmountCents),
    taxa_instalacao: formatMoneyFromCents(billing.defaultInstallationFeeCents),
    parcela_instalacao: `${billing.defaultInstallationInstallments} parcela(s)`,
    quantidade_portas_adicionais: String(additional),
    prazo_vigencia_contrato: `${billing.defaultContractTermMonths} mes(es)`,
    data_aceite: formatDateBr(acceptedAt),
  }
}

async function renderVersionForUser(version: ContractVersionView, userId: string, acceptedAt = new Date()) {
  const variables = await contractVariablesForUser(userId, acceptedAt)
  const bodyText = applyVariables(version.bodyText, variables)
  const bodyHtml = renderContractHtml(version.title, bodyText)
  const contentHash = hash(canonicalContractPayload({
    title: version.title,
    bodyText,
    bodyHtml,
    versionNumber: version.versionNumber,
  }))

  return {
    ...version,
    bodyText,
    bodyHtml,
    contentHash,
    pdfHash: contentHash,
  }
}

function otpHash(input: { userId: string; versionId: string; code: string }) {
  return hash(`${input.userId}:${input.versionId}:${input.code}:${process.env.NEXTAUTH_SECRET ?? 'fireport-local-secret'}`)
}

function normalizeVersion(row: ContractVersionRow | null | undefined): ContractVersionView | null {
  if (!row) return null
  return {
    id: row.id,
    templateId: row.templateId,
    versionNumber: Number(row.versionNumber),
    title: row.title,
    bodyText: row.bodyText,
    bodyHtml: row.bodyHtml,
    contentHash: row.contentHash,
    pdfHash: row.pdfHash,
    publishedAt: iso(row.publishedAt),
  }
}

async function tableExists(name: string) {
  const rows = await prisma.$queryRaw<Array<{ name: string }>>`
    SELECT "name" FROM sqlite_master WHERE "type" = 'table' AND "name" = ${name} LIMIT 1
  `

  return Boolean(rows[0])
}

export async function ensureContractAcceptanceSchema() {
  schemaReady ??= (async () => {
    if (!(await tableExists('ContractTemplate'))) {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE "ContractTemplate" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "title" TEXT NOT NULL,
          "description" TEXT,
          "targetRole" TEXT NOT NULL DEFAULT 'landlord',
          "isActive" BOOLEAN NOT NULL DEFAULT true,
          "activeVersionId" TEXT,
          "createdByUserId" TEXT,
          "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" DATETIME NOT NULL,
          CONSTRAINT "ContractTemplate_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
        )
      `)
    }
    if (!(await tableExists('ContractVersion'))) {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE "ContractVersion" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "templateId" TEXT NOT NULL,
          "versionNumber" INTEGER NOT NULL,
          "title" TEXT NOT NULL,
          "bodyText" TEXT NOT NULL,
          "bodyHtml" TEXT NOT NULL,
          "contentHash" TEXT NOT NULL,
          "pdfHash" TEXT,
          "status" TEXT NOT NULL DEFAULT 'published',
          "publishedAt" DATETIME,
          "publishedByUserId" TEXT,
          "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" DATETIME NOT NULL,
          CONSTRAINT "ContractVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ContractTemplate" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
          CONSTRAINT "ContractVersion_publishedByUserId_fkey" FOREIGN KEY ("publishedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
        )
      `)
    }
    if (!(await tableExists('ContractAcceptance'))) {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE "ContractAcceptance" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "versionId" TEXT NOT NULL,
          "userId" TEXT NOT NULL,
          "landlordId" TEXT,
          "status" TEXT NOT NULL DEFAULT 'accepted',
          "signatureMethod" TEXT NOT NULL DEFAULT 'otp',
          "otpChallengeId" TEXT,
          "ipAddress" TEXT,
          "userAgent" TEXT,
          "contractHash" TEXT NOT NULL,
          "pdfHash" TEXT,
          "previousEvidenceHash" TEXT,
          "acceptanceHash" TEXT NOT NULL,
          "evidenceJson" TEXT NOT NULL,
          "acceptedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "ContractAcceptance_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ContractVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
          CONSTRAINT "ContractAcceptance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
          CONSTRAINT "ContractAcceptance_landlordId_fkey" FOREIGN KEY ("landlordId") REFERENCES "Landlord" ("id") ON DELETE SET NULL ON UPDATE CASCADE
        )
      `)
    }
    if (!(await tableExists('ContractAcceptanceOtp'))) {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE "ContractAcceptanceOtp" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "versionId" TEXT NOT NULL,
          "userId" TEXT NOT NULL,
          "codeHash" TEXT NOT NULL,
          "destination" TEXT,
          "channel" TEXT NOT NULL DEFAULT 'email',
          "status" TEXT NOT NULL DEFAULT 'pending',
          "attempts" INTEGER NOT NULL DEFAULT 0,
          "expiresAt" DATETIME NOT NULL,
          "usedAt" DATETIME,
          "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "ContractAcceptanceOtp_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ContractVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
          CONSTRAINT "ContractAcceptanceOtp_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
        )
      `)
    }

    const statements = [
      'CREATE INDEX IF NOT EXISTS "ContractTemplate_isActive_idx" ON "ContractTemplate"("isActive")',
      'CREATE INDEX IF NOT EXISTS "ContractTemplate_targetRole_idx" ON "ContractTemplate"("targetRole")',
      'CREATE INDEX IF NOT EXISTS "ContractTemplate_activeVersionId_idx" ON "ContractTemplate"("activeVersionId")',
      'CREATE INDEX IF NOT EXISTS "ContractVersion_templateId_idx" ON "ContractVersion"("templateId")',
      'CREATE INDEX IF NOT EXISTS "ContractVersion_status_idx" ON "ContractVersion"("status")',
      'CREATE INDEX IF NOT EXISTS "ContractVersion_contentHash_idx" ON "ContractVersion"("contentHash")',
      'CREATE UNIQUE INDEX IF NOT EXISTS "ContractVersion_templateId_versionNumber_key" ON "ContractVersion"("templateId", "versionNumber")',
      'CREATE INDEX IF NOT EXISTS "ContractAcceptance_versionId_idx" ON "ContractAcceptance"("versionId")',
      'CREATE INDEX IF NOT EXISTS "ContractAcceptance_userId_idx" ON "ContractAcceptance"("userId")',
      'CREATE INDEX IF NOT EXISTS "ContractAcceptance_landlordId_idx" ON "ContractAcceptance"("landlordId")',
      'CREATE INDEX IF NOT EXISTS "ContractAcceptance_status_idx" ON "ContractAcceptance"("status")',
      'CREATE INDEX IF NOT EXISTS "ContractAcceptance_acceptedAt_idx" ON "ContractAcceptance"("acceptedAt")',
      'CREATE INDEX IF NOT EXISTS "ContractAcceptanceOtp_versionId_idx" ON "ContractAcceptanceOtp"("versionId")',
      'CREATE INDEX IF NOT EXISTS "ContractAcceptanceOtp_userId_idx" ON "ContractAcceptanceOtp"("userId")',
      'CREATE INDEX IF NOT EXISTS "ContractAcceptanceOtp_status_idx" ON "ContractAcceptanceOtp"("status")',
      'CREATE INDEX IF NOT EXISTS "ContractAcceptanceOtp_expiresAt_idx" ON "ContractAcceptanceOtp"("expiresAt")',
    ]

    for (const statement of statements) {
      await prisma.$executeRawUnsafe(statement)
    }
  })().catch((error) => {
    schemaReady = null
    throw error
  })

  return schemaReady
}

export async function listContractTemplates() {
  await ensureContractAcceptanceSchema()
  const templates = await prisma.$queryRaw<ContractTemplateRow[]>`
    SELECT *
    FROM "ContractTemplate"
    ORDER BY "createdAt" DESC
  `
  const versions = await prisma.$queryRaw<Array<ContractVersionRow & { acceptanceCount: number }>>`
    SELECT
      "ContractVersion".*,
      COUNT("ContractAcceptance"."id") AS "acceptanceCount"
    FROM "ContractVersion"
    LEFT JOIN "ContractAcceptance" ON "ContractAcceptance"."versionId" = "ContractVersion"."id"
      AND "ContractAcceptance"."status" = 'accepted'
    GROUP BY "ContractVersion"."id"
    ORDER BY "ContractVersion"."createdAt" DESC
  `

  return templates.map((template) => ({
    ...template,
    isActive: Boolean(template.isActive),
    createdAt: iso(template.createdAt),
    updatedAt: iso(template.updatedAt),
    versions: versions
      .filter((version) => version.templateId === template.id)
      .map((version) => {
        const normalized = normalizeVersion(version)
        return {
          id: normalized?.id ?? version.id,
          templateId: normalized?.templateId ?? version.templateId,
          versionNumber: normalized?.versionNumber ?? Number(version.versionNumber),
          title: normalized?.title ?? version.title,
          bodyText: normalized?.bodyText ?? version.bodyText,
          bodyHtml: normalized?.bodyHtml ?? version.bodyHtml,
          contentHash: normalized?.contentHash ?? version.contentHash,
          pdfHash: normalized?.pdfHash ?? version.pdfHash,
          publishedAt: normalized?.publishedAt ?? iso(version.publishedAt),
          status: version.status,
          acceptanceCount: Number(version.acceptanceCount ?? 0),
        }
      }),
  }))
}

export async function publishContractTemplate(input: {
  title: string
  description?: string | null
  bodyText: string
  createdByUserId: string
}) {
  await ensureContractAcceptanceSchema()
  const title = input.title.trim()
  const bodyText = input.bodyText.trim()
  if (title.length < 3) throw new Error('Informe um titulo de contrato.')
  if (bodyText.length < 20) throw new Error('Informe o texto completo do contrato.')

  const templateId = createLocalId('contract_template')
  const versionId = createLocalId('contract_version')
  const versionNumber = 1
  const bodyHtml = renderContractHtml(title, bodyText)
  const contentHash = hash(canonicalContractPayload({ title, bodyText, bodyHtml, versionNumber }))
  const now = new Date()

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      INSERT INTO "ContractTemplate" (
        "id",
        "title",
        "description",
        "targetRole",
        "isActive",
        "activeVersionId",
        "createdByUserId",
        "createdAt",
        "updatedAt"
      ) VALUES (
        ${templateId},
        ${title},
        ${input.description?.trim() || null},
        'landlord',
        true,
        ${versionId},
        ${input.createdByUserId},
        ${now},
        ${now}
      )
    `
    await tx.$executeRaw`
      INSERT INTO "ContractVersion" (
        "id",
        "templateId",
        "versionNumber",
        "title",
        "bodyText",
        "bodyHtml",
        "contentHash",
        "pdfHash",
        "status",
        "publishedAt",
        "publishedByUserId",
        "createdAt",
        "updatedAt"
      ) VALUES (
        ${versionId},
        ${templateId},
        ${versionNumber},
        ${title},
        ${bodyText},
        ${bodyHtml},
        ${contentHash},
        ${contentHash},
        'published',
        ${now},
        ${input.createdByUserId},
        ${now},
        ${now}
      )
    `
  })

  return { id: templateId, activeVersionId: versionId }
}

export async function publishNewContractVersion(input: {
  templateId: string
  title: string
  bodyText: string
  publishedByUserId: string
}) {
  await ensureContractAcceptanceSchema()
  const current = await prisma.$queryRaw<Array<{ nextVersion: number }>>`
    SELECT COALESCE(MAX("versionNumber"), 0) + 1 AS "nextVersion"
    FROM "ContractVersion"
    WHERE "templateId" = ${input.templateId}
  `
  const versionNumber = Number(current[0]?.nextVersion ?? 1)
  const title = input.title.trim()
  const bodyText = input.bodyText.trim()
  if (title.length < 3) throw new Error('Informe um titulo de contrato.')
  if (bodyText.length < 20) throw new Error('Informe o texto completo do contrato.')

  const versionId = createLocalId('contract_version')
  const bodyHtml = renderContractHtml(title, bodyText)
  const contentHash = hash(canonicalContractPayload({ title, bodyText, bodyHtml, versionNumber }))
  const now = new Date()

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      INSERT INTO "ContractVersion" (
        "id",
        "templateId",
        "versionNumber",
        "title",
        "bodyText",
        "bodyHtml",
        "contentHash",
        "pdfHash",
        "status",
        "publishedAt",
        "publishedByUserId",
        "createdAt",
        "updatedAt"
      ) VALUES (
        ${versionId},
        ${input.templateId},
        ${versionNumber},
        ${title},
        ${bodyText},
        ${bodyHtml},
        ${contentHash},
        ${contentHash},
        'published',
        ${now},
        ${input.publishedByUserId},
        ${now},
        ${now}
      )
    `
    await tx.$executeRaw`
      UPDATE "ContractTemplate"
      SET "title" = ${title}, "activeVersionId" = ${versionId}, "isActive" = true, "updatedAt" = ${now}
      WHERE "id" = ${input.templateId}
    `
  })

  return { id: versionId }
}

export async function getActiveContractVersion() {
  await ensureContractAcceptanceSchema()
  const rows = await prisma.$queryRaw<ContractVersionRow[]>`
    SELECT "ContractVersion".*
    FROM "ContractVersion"
    INNER JOIN "ContractTemplate" ON "ContractTemplate"."id" = "ContractVersion"."templateId"
    WHERE "ContractTemplate"."isActive" = true
      AND "ContractTemplate"."targetRole" = 'landlord'
      AND "ContractVersion"."status" = 'published'
      AND ("ContractTemplate"."activeVersionId" IS NULL OR "ContractTemplate"."activeVersionId" = "ContractVersion"."id")
    ORDER BY "ContractVersion"."publishedAt" DESC, "ContractVersion"."versionNumber" DESC
    LIMIT 1
  `

  return normalizeVersion(rows[0])
}

export async function getContractRequirementForUser(userId: string): Promise<ContractRequirementStatus> {
  await ensureContractAcceptanceSchema()
  const userRows = await prisma.$queryRaw<Array<{ id: string; role: string }>>`
    SELECT "id", "role" FROM "User" WHERE "id" = ${userId} LIMIT 1
  `
  const user = userRows[0]
  if (!user || user.role === 'admin') {
    return { required: false, accepted: true, pending: false, acceptanceId: null, version: null, message: 'Contrato nao exigido.' }
  }

  const version = await getActiveContractVersion()
  if (!version) {
    return { required: false, accepted: true, pending: false, acceptanceId: null, version: null, message: 'Nenhum contrato ativo publicado.' }
  }
  const renderedVersion = await renderVersionForUser(version, userId)

  const acceptances = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "ContractAcceptance"
    WHERE "userId" = ${userId}
      AND "versionId" = ${version.id}
      AND "status" = 'accepted'
    ORDER BY "acceptedAt" DESC
    LIMIT 1
  `
  const acceptanceId = acceptances[0]?.id ?? null

  return {
    required: true,
    accepted: Boolean(acceptanceId),
    pending: !acceptanceId,
    acceptanceId,
    version: renderedVersion,
    message: acceptanceId ? 'Contrato vigente aceito.' : 'Aceite contratual pendente para uso da rede.',
  }
}

export async function assertActiveContractAccepted(userId: string) {
  const status = await getContractRequirementForUser(userId)
  if (!status.pending) return status

  const error = new Error(status.message)
  error.name = 'ContractAcceptanceError'
  throw error
}

export async function createContractAcceptanceOtp(input: { userId: string; versionId: string }) {
  await ensureContractAcceptanceSchema()
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  const id = createLocalId('contract_otp')
  const expiresMinutes = 10
  const expiresAt = new Date(Date.now() + expiresMinutes * 60_000)
  const userRows = await prisma.$queryRaw<Array<{
    email: string
    name: string | null
    landlordName: string | null
    hubsoftPrimaryEmail: string | null
  }>>`
    SELECT
      "User"."email",
      "User"."name",
      "Landlord"."name" AS "landlordName",
      "Landlord"."hubsoftPrimaryEmail" AS "hubsoftPrimaryEmail"
    FROM "User"
    LEFT JOIN "Landlord" ON "Landlord"."userId" = "User"."id"
    WHERE "User"."id" = ${input.userId}
    LIMIT 1
  `
  const user = userRows[0]
  const destination = user?.hubsoftPrimaryEmail || user?.email || null
  if (!destination) {
    throw new Error('Operador sem email cadastrado para envio do aceite.')
  }
  const versionRows = await prisma.$queryRaw<Array<{ title: string }>>`
    SELECT "title" FROM "ContractVersion" WHERE "id" = ${input.versionId} LIMIT 1
  `
  const contractTitle = versionRows[0]?.title || 'Contrato de uso da rede neutra'

  await sendContractAcceptanceOtpEmail({
    to: destination,
    name: user?.landlordName || user?.name || destination,
    code,
    contractTitle,
    expiresMinutes,
  })

  await prisma.$executeRaw`
    INSERT INTO "ContractAcceptanceOtp" (
      "id",
      "versionId",
      "userId",
      "codeHash",
      "destination",
      "channel",
      "status",
      "expiresAt",
      "createdAt"
    ) VALUES (
      ${id},
      ${input.versionId},
      ${input.userId},
      ${otpHash({ userId: input.userId, versionId: input.versionId, code })},
      ${destination},
      'email',
      'pending',
      ${expiresAt},
      CURRENT_TIMESTAMP
    )
  `

  return {
    id,
    destination,
    expiresAt: expiresAt.toISOString(),
  }
}

export async function acceptContractVersion(input: {
  userId: string
  versionId: string
  otpId: string
  code: string
  ipAddress?: string | null
  userAgent?: string | null
}) {
  await ensureContractAcceptanceSchema()
  const versionRows = await prisma.$queryRaw<ContractVersionRow[]>`
    SELECT * FROM "ContractVersion" WHERE "id" = ${input.versionId} AND "status" = 'published' LIMIT 1
  `
  const version = normalizeVersion(versionRows[0])
  if (!version) throw new Error('Versao de contrato nao encontrada.')
  const acceptedAt = new Date()
  const renderedVersion = await renderVersionForUser(version, input.userId, acceptedAt)

  const otpRows = await prisma.$queryRaw<Array<{
    id: string
    codeHash: string
    attempts: number
    status: string
    expiresAt: Date | string
  }>>`
    SELECT "id", "codeHash", "attempts", "status", "expiresAt"
    FROM "ContractAcceptanceOtp"
    WHERE "id" = ${input.otpId}
      AND "userId" = ${input.userId}
      AND "versionId" = ${input.versionId}
    LIMIT 1
  `
  const otp = otpRows[0]
  if (!otp || otp.status !== 'pending') throw new Error('Codigo de aceite invalido ou ja utilizado.')
  if (new Date(otp.expiresAt).getTime() < Date.now()) throw new Error('Codigo de aceite expirado.')
  if (Number(otp.attempts) >= 5) throw new Error('Limite de tentativas do codigo atingido.')

  const expectedHash = otpHash({ userId: input.userId, versionId: input.versionId, code: input.code.trim() })
  if (otp.codeHash !== expectedHash) {
    await prisma.$executeRaw`
      UPDATE "ContractAcceptanceOtp"
      SET "attempts" = "attempts" + 1
      WHERE "id" = ${input.otpId}
    `
    throw new Error('Codigo de aceite incorreto.')
  }

  const userRows = await prisma.$queryRaw<Array<{
    id: string
    email: string
    name: string | null
    role: string
    landlordId: string | null
    landlordName: string | null
    landlordDocument: string | null
  }>>`
    SELECT
      "User"."id",
      "User"."email",
      "User"."name",
      "User"."role",
      "Landlord"."id" AS "landlordId",
      "Landlord"."name" AS "landlordName",
      "Landlord"."document" AS "landlordDocument"
    FROM "User"
    LEFT JOIN "Landlord" ON "Landlord"."userId" = "User"."id"
    WHERE "User"."id" = ${input.userId}
    LIMIT 1
  `
  const user = userRows[0]
  if (!user) throw new Error('Usuario nao encontrado.')

  const previousRows = await prisma.$queryRaw<Array<{ acceptanceHash: string }>>`
    SELECT "acceptanceHash"
    FROM "ContractAcceptance"
    WHERE "userId" = ${input.userId}
    ORDER BY "acceptedAt" DESC
    LIMIT 1
  `
  const evidence = {
    acceptanceVersion: 1,
    acceptedAt: acceptedAt.toISOString(),
    signatureMethod: 'otp',
    otpChallengeId: input.otpId,
    operator: {
      userId: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      landlordId: user.landlordId,
      landlordName: user.landlordName,
      landlordDocument: user.landlordDocument,
    },
    contract: {
      versionId: renderedVersion.id,
      templateId: renderedVersion.templateId,
      versionNumber: renderedVersion.versionNumber,
      title: renderedVersion.title,
      contentHash: renderedVersion.contentHash,
      pdfHash: renderedVersion.pdfHash,
      publishedAt: renderedVersion.publishedAt,
      renderedBodyText: renderedVersion.bodyText,
      renderedBodyHtml: renderedVersion.bodyHtml,
    },
    request: {
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    },
    legalBasis: {
      signatureLevel: 'advanced_internal_otp',
      integrity: 'sha256_content_and_evidence_hash',
    },
    previousEvidenceHash: previousRows[0]?.acceptanceHash ?? null,
  }
  const acceptanceHash = hash(JSON.stringify(evidence))
  const acceptanceId = createLocalId('contract_acceptance')

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE "ContractAcceptanceOtp"
      SET "status" = 'used', "usedAt" = ${acceptedAt}, "attempts" = "attempts" + 1
      WHERE "id" = ${input.otpId}
    `
    await tx.$executeRaw`
      INSERT INTO "ContractAcceptance" (
        "id",
        "versionId",
        "userId",
        "landlordId",
        "status",
        "signatureMethod",
        "otpChallengeId",
        "ipAddress",
        "userAgent",
        "contractHash",
        "pdfHash",
        "previousEvidenceHash",
        "acceptanceHash",
        "evidenceJson",
        "acceptedAt",
        "createdAt"
      ) VALUES (
        ${acceptanceId},
        ${renderedVersion.id},
        ${input.userId},
        ${user.landlordId},
        'accepted',
        'otp',
        ${input.otpId},
        ${input.ipAddress ?? null},
        ${input.userAgent ?? null},
        ${renderedVersion.contentHash},
        ${renderedVersion.pdfHash},
        ${previousRows[0]?.acceptanceHash ?? null},
        ${acceptanceHash},
        ${JSON.stringify(evidence)},
        ${acceptedAt},
        ${acceptedAt}
      )
    `
  })

  return { id: acceptanceId, acceptedAt: acceptedAt.toISOString(), acceptanceHash }
}

export async function listContractAcceptances() {
  await ensureContractAcceptanceSchema()
  const rows = await prisma.$queryRaw<Array<ContractAcceptanceRow & {
    userName: string | null
    userEmail: string | null
    landlordName: string | null
    versionTitle: string
    versionNumber: number
  }>>`
    SELECT
      "ContractAcceptance".*,
      "User"."name" AS "userName",
      "User"."email" AS "userEmail",
      "Landlord"."name" AS "landlordName",
      "ContractVersion"."title" AS "versionTitle",
      "ContractVersion"."versionNumber" AS "versionNumber"
    FROM "ContractAcceptance"
    INNER JOIN "User" ON "User"."id" = "ContractAcceptance"."userId"
    LEFT JOIN "Landlord" ON "Landlord"."id" = "ContractAcceptance"."landlordId"
    INNER JOIN "ContractVersion" ON "ContractVersion"."id" = "ContractAcceptance"."versionId"
    ORDER BY "ContractAcceptance"."acceptedAt" DESC
    LIMIT 200
  `

  return rows.map((row) => ({
    id: row.id,
    versionId: row.versionId,
    versionTitle: row.versionTitle,
    versionNumber: Number(row.versionNumber),
    userId: row.userId,
    userName: row.userName,
    userEmail: row.userEmail,
    landlordName: row.landlordName,
    signatureMethod: row.signatureMethod,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    contractHash: row.contractHash,
    acceptanceHash: row.acceptanceHash,
    acceptedAt: iso(row.acceptedAt),
  }))
}

export async function getUserContractAcceptanceView(userId: string) {
  await ensureContractAcceptanceSchema()
  const requirement = await getContractRequirementForUser(userId)

  if (!requirement.required || !requirement.version) {
    return {
      required: false,
      accepted: true,
      pending: false,
      message: requirement.message,
      contract: null,
    }
  }

  if (requirement.pending || !requirement.acceptanceId) {
    return {
      required: true,
      accepted: false,
      pending: true,
      message: 'Aceite de contrato pendente.',
      contract: {
        versionId: requirement.version.id,
        title: requirement.version.title,
        versionNumber: requirement.version.versionNumber,
        contentHash: requirement.version.contentHash,
        bodyText: requirement.version.bodyText,
        bodyHtml: requirement.version.bodyHtml,
        acceptedAt: null,
        acceptanceHash: null,
      },
    }
  }

  const rows = await prisma.$queryRaw<Array<ContractAcceptanceRow & {
    versionTitle: string
    versionNumber: number
  }>>`
    SELECT
      "ContractAcceptance".*,
      "ContractVersion"."title" AS "versionTitle",
      "ContractVersion"."versionNumber" AS "versionNumber"
    FROM "ContractAcceptance"
    INNER JOIN "ContractVersion" ON "ContractVersion"."id" = "ContractAcceptance"."versionId"
    WHERE "ContractAcceptance"."id" = ${requirement.acceptanceId}
      AND "ContractAcceptance"."userId" = ${userId}
      AND "ContractAcceptance"."status" = 'accepted'
    LIMIT 1
  `
  const row = rows[0]
  if (!row) {
    return {
      required: true,
      accepted: false,
      pending: true,
      message: 'Aceite de contrato pendente.',
      contract: null,
    }
  }

  let evidence: { contract?: { renderedBodyHtml?: string; renderedBodyText?: string } } = {}
  try {
    evidence = JSON.parse(row.evidenceJson)
  } catch {
    evidence = {}
  }

  return {
    required: true,
    accepted: true,
    pending: false,
    message: 'Contrato vigente aceito.',
    contract: {
      acceptanceId: row.id,
      versionId: row.versionId,
      title: row.versionTitle,
      versionNumber: Number(row.versionNumber),
      contentHash: row.contractHash,
      acceptanceHash: row.acceptanceHash,
      acceptedAt: iso(row.acceptedAt),
      signatureMethod: row.signatureMethod,
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      bodyHtml: evidence.contract?.renderedBodyHtml || requirement.version.bodyHtml,
      bodyText: evidence.contract?.renderedBodyText || requirement.version.bodyText,
    },
  }
}

export async function getUserAcceptedContractPdf(userId: string) {
  const view = await getUserContractAcceptanceView(userId)
  if (!view.accepted || !view.contract) return null
  const userRows = await prisma.$queryRaw<Array<{ name: string | null; email: string }>>`
    SELECT "name", "email" FROM "User" WHERE "id" = ${userId} LIMIT 1
  `
  const user = userRows[0]

  return buildPdf({
    title: view.contract.title,
    bodyText: view.contract.bodyText,
    acceptedAt: view.contract.acceptedAt,
    acceptanceHash: view.contract.acceptanceHash,
    contractHash: view.contract.contentHash,
    operatorName: user?.name || user?.email || userId,
  })
}

export async function getAcceptanceEvidenceHtml(id: string) {
  await ensureContractAcceptanceSchema()
  const rows = await prisma.$queryRaw<Array<ContractAcceptanceRow & {
    userName: string | null
    userEmail: string | null
    landlordName: string | null
    versionTitle: string
    versionNumber: number
    bodyHtml: string
  }>>`
    SELECT
      "ContractAcceptance".*,
      "User"."name" AS "userName",
      "User"."email" AS "userEmail",
      "Landlord"."name" AS "landlordName",
      "ContractVersion"."title" AS "versionTitle",
      "ContractVersion"."versionNumber" AS "versionNumber",
      "ContractVersion"."bodyHtml" AS "bodyHtml"
    FROM "ContractAcceptance"
    INNER JOIN "User" ON "User"."id" = "ContractAcceptance"."userId"
    LEFT JOIN "Landlord" ON "Landlord"."id" = "ContractAcceptance"."landlordId"
    INNER JOIN "ContractVersion" ON "ContractVersion"."id" = "ContractAcceptance"."versionId"
    WHERE "ContractAcceptance"."id" = ${id}
    LIMIT 1
  `
  const row = rows[0]
  if (!row) return null
  let evidence: { contract?: { renderedBodyHtml?: string } } = {}
  try {
    evidence = JSON.parse(row.evidenceJson)
  } catch {
    evidence = {}
  }
  const contractHtml = evidence.contract?.renderedBodyHtml || row.bodyHtml

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>Dossie de aceite - ${escapeHtml(row.versionTitle)}</title>
  <style>
    body { font-family: Arial, sans-serif; color: #0f172a; margin: 32px; line-height: 1.5; }
    h1, h2 { margin: 0 0 12px; }
    section { border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px; margin: 16px 0; }
    dl { display: grid; grid-template-columns: 220px 1fr; gap: 8px 16px; }
    dt { font-weight: 700; color: #475569; }
    dd { margin: 0; word-break: break-word; }
    .contract-document h1 { font-size: 22px; }
    pre { white-space: pre-wrap; word-break: break-word; background: #f8fafc; padding: 14px; border-radius: 8px; }
  </style>
</head>
<body>
  <h1>Dossie de aceite contratual</h1>
  <section>
    <h2>Identificacao</h2>
    <dl>
      <dt>Aceite</dt><dd>${escapeHtml(row.id)}</dd>
      <dt>Operador</dt><dd>${escapeHtml(row.userName || row.userEmail || row.userId)}</dd>
      <dt>E-mail</dt><dd>${escapeHtml(row.userEmail || '-')}</dd>
      <dt>Empresa</dt><dd>${escapeHtml(row.landlordName || '-')}</dd>
      <dt>Contrato</dt><dd>${escapeHtml(row.versionTitle)} v${Number(row.versionNumber)}</dd>
      <dt>Data/hora</dt><dd>${escapeHtml(iso(row.acceptedAt) || '-')}</dd>
      <dt>Metodo</dt><dd>${escapeHtml(row.signatureMethod)}</dd>
      <dt>IP</dt><dd>${escapeHtml(row.ipAddress || '-')}</dd>
      <dt>User-agent</dt><dd>${escapeHtml(row.userAgent || '-')}</dd>
      <dt>Hash do contrato</dt><dd>${escapeHtml(row.contractHash)}</dd>
      <dt>Hash do aceite</dt><dd>${escapeHtml(row.acceptanceHash)}</dd>
    </dl>
  </section>
  <section>
    <h2>Contrato aceito</h2>
    ${contractHtml}
  </section>
  <section>
    <h2>Evidencia JSON</h2>
    <pre>${escapeHtml(row.evidenceJson)}</pre>
  </section>
</body>
</html>`
}
