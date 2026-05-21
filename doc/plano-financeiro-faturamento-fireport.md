# Plano de Implementacao - Financeiro e Faturamento Fireport

## 1. Objetivo

Implementar o modulo financeiro do Fireport para faturar o uso da rede neutra por Usuario/Operador, com base em provisionamentos ativos.

O Fireport sera responsavel por:

- manter as regras comerciais da rede neutra;
- identificar quais provisionamentos devem ser cobrados;
- calcular o valor mensal por Usuario/Operador;
- aplicar multas manuais quando houver motivo e comprovacao;
- enviar um unico evento mensal de faturamento para o Hubsoft;
- manter historico, memoria de calculo, alertas e auditoria.

O Hubsoft continua sendo o sistema financeiro oficial para cadastro financeiro do cliente, emissao de faturas, vencimento, baixa e cobranca.

## 2. Premissas Aprovadas

### 2.1 Sistema financeiro oficial

O Hubsoft e o sistema financeiro oficial.

Cada Usuario/Operador da rede neutra tera:

- cadastro completo no Hubsoft;
- cadastro correspondente no Fireport;
- `id_cliente_servico` do Hubsoft associado ao seu cadastro no Fireport.

O Fireport nao deve substituir o financeiro do Hubsoft. Ele deve calcular o consumo da rede neutra e enviar o evento de faturamento.

### 2.2 O que sera cobrado

O item principal de cobranca sera:

- mensalidade por provisionamento ativo.

Tambem podera haver:

- multa por descumprimento de regras.

Multas devem ser aplicadas com cautela por operador interno, sempre com motivo e comprovacao.

### 2.3 Base de cobranca

A cobranca sera feita por provisionamento ativo, nao por status online/offline da ONU.

Portanto:

- ONU online cobra;
- ONU offline cobra;
- o que determina a cobranca e o provisionamento estar ativo no Fireport dentro da regra de fechamento.

### 2.4 Cobranca cheia

Nao havera proporcionalidade.

Se um provisionamento entrar no ciclo antes ou no dia do fechamento, cobra cheio.

Se entrar depois do fechamento, fica para o proximo ciclo.

### 2.5 Cancelamento

Se cancelar antes do fechamento, nao cobra naquele ciclo.

Se cancelar depois do fechamento, ja foi contabilizado no ciclo atual e so deixa de cobrar no ciclo seguinte.

### 2.6 Fechamento global

O dia de fechamento sera global para todos os Usuarios/Operadores.

O dia de vencimento sera definido por Usuario/Operador no ato do cadastro.

### 2.7 Envio mensal unico

Devera existir somente um envio mensal de faturamento ao Hubsoft por Usuario/Operador por competencia.

Esse envio deve conter o montante total:

- mensalidade base;
- excedentes;
- multas aprovadas.

Mesmo enviando apenas um valor total ao Hubsoft, o Fireport deve guardar internamente toda a memoria de calculo.

### 2.8 Tipo de servico no Hubsoft

O evento de faturamento sera relacionado ao servico financeiro ja preparado no Hubsoft:

```text
Servico de Rede Neutra
```

## 3. Modelo Comercial

Cada Usuario/Operador tera um plano financeiro aplicado.

O plano deve permitir:

- valor minimo mensal;
- quantidade de provisionamentos inclusos no minimo;
- valor por provisionamento excedente;
- dia de vencimento;
- status do contrato financeiro;
- data de inicio da cobranca;
- observacoes comerciais.

O valor padrao inicial nao deve ficar fixo no codigo. Ele deve ser configurado no painel administrativo.

### 3.1 Formula de calculo

```text
provisionamentos_cobraveis = quantidade de provisionamentos ativos no fechamento
franquia_inclusa = quantidade inclusa no valor minimo
excedentes = max(0, provisionamentos_cobraveis - franquia_inclusa)

valor_mensalidade = valor_minimo_mensal + (excedentes * valor_por_provisionamento_excedente)
valor_final = valor_mensalidade + multas_aprovadas
```

### 3.2 Exemplo

Plano:

```text
valor_minimo_mensal: R$ 300,00
quantidade_inclusa: 10
valor_excedente: R$ 35,00
```

Cenarios:

```text
0 provisionamentos ativos: nao cobra, caso ainda nunca tenha havido primeira ativacao
1 provisionamento ativo: cobra R$ 300,00
8 provisionamentos ativos: cobra R$ 300,00
10 provisionamentos ativos: cobra R$ 300,00
13 provisionamentos ativos: cobra R$ 405,00
```

### 3.3 Inicio da cobranca

A cobranca so deve iniciar a partir da primeira ativacao.

Enquanto o Usuario/Operador nunca tiver tido provisionamento ativo, nao deve haver cobranca minima.

A partir da primeira ativacao, o Usuario/Operador passa a estar elegivel a cobranca do valor minimo mensal quando houver provisionamento ativo no fechamento.

## 4. Definicoes de Status

### 4.1 Status do plano financeiro

```text
active
inactive
suspended
```

### 4.2 Status do servico cobravel

```text
active
canceled
ignored
```

`active`: entra na apuracao se estiver ativo no fechamento.

`canceled`: nao entra se cancelado antes do fechamento.

`ignored`: nao entra por decisao administrativa, com motivo auditavel.

### 4.3 Status do fechamento

```text
draft
calculated
ready
sending
sent
failed
reconciled
canceled
```

`draft`: fechamento criado, ainda nao definitivo.

`calculated`: memoria de calculo gerada.

`ready`: validado para envio.

`sending`: envio ao Hubsoft em andamento.

`sent`: evento enviado ao Hubsoft.

`failed`: falha no envio.

`reconciled`: fatura/evento confirmado pelo Hubsoft.

`canceled`: fechamento cancelado antes do envio.

### 4.4 Status da multa

```text
draft
approved
included
canceled
```

`draft`: multa registrada, ainda fora do faturamento.

`approved`: multa pronta para entrar no proximo fechamento.

`included`: multa ja incluida em fechamento enviado ou pronto para envio.

`canceled`: multa cancelada com motivo.

## 5. Entidades Recomendadas

### 5.1 BillingPlan

Representa a regra comercial aplicada ao Usuario/Operador.

Campos recomendados:

```text
id
name
description
defaultMinimumAmountCents
defaultIncludedProvisionings
defaultExtraProvisioningAmountCents
isDefault
isActive
createdAt
updatedAt
```

Observacao:

O painel administrativo deve permitir alterar os valores padrao.

### 5.2 BillingAccount

Representa a conta financeira do Usuario/Operador no Fireport.

Campos recomendados:

```text
id
userId
landlordId
hubsoftClientServiceId
hubsoftServiceName
billingPlanId
minimumAmountCents
includedProvisionings
extraProvisioningAmountCents
closingDaySource
dueDay
firstActivationAt
billingStartedAt
status
notes
createdAt
updatedAt
```

`hubsoftClientServiceId` e obrigatorio para envio ao Hubsoft.

`dueDay` fica definido no cadastro do Usuario/Operador.

`firstActivationAt` determina se a conta ja iniciou vida financeira.

### 5.3 BillingService

Representa o servico cobravel derivado de um provisionamento.

Campos recomendados:

```text
id
billingAccountId
provisioningId
contractId
portId
ctoId
serial
activatedAt
canceledAt
status
billingPlanId
createdAt
updatedAt
```

Regra:

Cada provisionamento ativo deve possuir um BillingService correspondente.

### 5.4 BillingCycle

Representa uma competencia mensal.

Campos recomendados:

```text
id
year
month
periodStart
periodEnd
closingAt
status
createdAt
updatedAt
```

Exemplo:

```text
competencia: 2026-05
periodStart: 2026-05-01 00:00:00
closingAt: 2026-05-25 23:59:59
periodEnd: 2026-05-31 23:59:59
```

### 5.5 BillingRun

Representa o fechamento mensal de um Usuario/Operador.

Campos recomendados:

```text
id
billingCycleId
billingAccountId
competence
hubsoftClientServiceId
dueDay
activeProvisioningCount
includedProvisioningCount
extraProvisioningCount
minimumAmountCents
extraAmountCents
penaltyAmountCents
totalAmountCents
status
idempotencyKey
calculatedAt
sentAt
reconciledAt
createdAt
updatedAt
```

Indice unico obrigatorio:

```text
billingAccountId + competence
```

Isso impede dois fechamentos do mesmo Usuario/Operador na mesma competencia.

### 5.6 BillingRunItem

Guarda a memoria de calculo detalhada.

Campos recomendados:

```text
id
billingRunId
billingServiceId
provisioningId
contractId
ctoId
portId
serial
itemType
description
amountCents
isIncludedInMinimum
activatedAt
canceledAt
createdAt
```

Tipos:

```text
minimum_included
extra_provisioning
penalty
manual_adjustment
```

Mesmo quando a ONU estiver dentro da franquia minima, deve existir item para memoria de calculo.

### 5.7 BillingPenalty

Representa multa aplicada manualmente.

Campos recomendados:

```text
id
billingAccountId
amountCents
reason
evidence
status
createdByUserId
approvedByUserId
approvedAt
includedInBillingRunId
createdAt
updatedAt
```

Regras:

- multa deve ter valor maior que zero;
- multa deve ter motivo;
- multa deve ter comprovacao ou observacao suficiente;
- multa aprovada entra no proximo fechamento ainda nao enviado;
- multa incluida nao pode ser editada, somente estornada por ajuste futuro.

### 5.8 HubsoftBillingEvent

Representa o envio feito ao Hubsoft.

Campos recomendados:

```text
id
billingRunId
hubsoftClientServiceId
hubsoftEventType
idempotencyKey
amountCents
description
requestPayload
responsePayload
status
attempts
lastError
sentAt
createdAt
updatedAt
```

Indice unico obrigatorio:

```text
idempotencyKey
```

Chave sugerida:

```text
FIREPORT-BILLING-{billingAccountId}-{YYYY-MM}
```

### 5.9 BillingAlert

Representa divergencias e problemas que exigem correcao.

Campos recomendados:

```text
id
billingAccountId
provisioningId
billingRunId
type
severity
message
details
status
resolvedByUserId
resolvedAt
createdAt
updatedAt
```

Tipos iniciais:

```text
missing_hubsoft_client_service_id
inactive_billing_account
active_provisioning_without_billing_service
hubsoft_port_divergence
hubsoft_service_not_found
billing_run_send_failed
zero_amount_blocked
duplicate_send_blocked
```

### 5.10 HubsoftInvoiceSnapshot

Representa consulta posterior de faturas no Hubsoft.

Campos recomendados:

```text
id
billingAccountId
billingRunId
hubsoftInvoiceId
hubsoftClientServiceId
competence
dueDate
amountCents
status
rawPayload
syncedAt
createdAt
updatedAt
```

## 6. Fluxo de Ativacao

Quando um provisionamento for criado e confirmado com sucesso:

1. Fireport cria/atualiza o Provisioning.
2. Fireport reserva/vincula a porta conforme fluxo Hubsoft ja existente.
3. Fireport confirma registro na OLT.
4. Fireport cria ou ativa o BillingService.
5. Se for a primeira ativacao do Usuario/Operador:
   - define `firstActivationAt`;
   - define `billingStartedAt`;
   - marca conta financeira como iniciada.

Regra importante:

Se a OLT falhar e o provisionamento for revertido, o BillingService nao deve entrar como ativo.

## 7. Fluxo de Cancelamento

Quando um provisionamento for cancelado/desprovisionado:

1. Fireport marca o Provisioning como inativo/cancelado.
2. Fireport marca o BillingService com `canceledAt`.
3. No proximo fechamento, a regra decide:
   - cancelado antes do fechamento: nao cobra;
   - cancelado depois do fechamento: ja foi cobrado no ciclo atual.

O cancelamento nao deve alterar fechamentos ja enviados.

## 8. Fluxo de Fechamento Mensal

### 8.1 Agendamento

O fechamento deve rodar automaticamente no dia global definido no painel administrativo.

Exemplo:

```text
dia de fechamento: 25
horario sugerido: 23:59
```

### 8.2 Selecao de provisionamentos cobraveis

Para cada Usuario/Operador:

Incluir BillingService quando:

```text
status = active
activatedAt <= closingAt
e (
  canceledAt is null
  ou canceledAt > closingAt
)
```

Nao incluir quando:

```text
canceledAt <= closingAt
```

### 8.3 Congelamento do fechamento

Ao calcular o fechamento, o Fireport deve gravar snapshot completo:

- quantidade cobrada;
- itens inclusos na franquia;
- itens excedentes;
- multas incluidas;
- valores usados no plano;
- vencimento do Usuario/Operador;
- `id_cliente_servico` usado;
- chave idempotente.

Depois de enviado ao Hubsoft, o fechamento nao pode ser recalculado ou editado.

Correcoes devem ser feitas por multa, desconto ou ajuste no ciclo seguinte.

### 8.4 Envio ao Hubsoft

Para cada BillingRun pronto:

1. Validar `hubsoftClientServiceId`.
2. Validar valor total maior que zero.
3. Gerar descricao clara.
4. Enviar evento de faturamento ao Hubsoft usando o servico "Servico de Rede Neutra".
5. Registrar payload de request e response.
6. Marcar como `sent` se o Hubsoft confirmar.
7. Marcar como `failed` e gerar alerta se falhar.

Descricao sugerida:

```text
Fireport Rede Neutra - Competencia 2026-05 - 13 provisionamentos ativos, 10 inclusos, 3 excedentes, multas R$ 0,00.
```

## 9. Regras de Bloqueio e Protecao

### 9.1 Duplicidade

Nunca permitir:

- dois BillingRuns para mesma conta e competencia;
- dois HubsoftBillingEvents com a mesma chave idempotente;
- reenvio de fechamento ja marcado como `sent`, exceto por rotina explicita de conciliacao/retry controlado.

### 9.2 Valor zero

Nao enviar evento ao Hubsoft com valor zero.

Se o calculo resultar zero:

- marcar fechamento como sem cobranca;
- registrar motivo;
- nao enviar ao Hubsoft.

### 9.3 Divergencia com Hubsoft

Divergencia entre Fireport e Hubsoft deve gerar alerta para correcao.

Ela nao deve bloquear automaticamente o faturamento, salvo quando faltar `id_cliente_servico`, pois sem ele nao ha destino financeiro seguro.

### 9.4 Alteracao de plano

Mudancas em valores do plano nao devem alterar fechamentos ja enviados.

O BillingRun deve guardar os valores usados naquele fechamento.

### 9.5 Multa

Multa incluida em fechamento enviado nao pode ser editada.

Se houver erro, deve ser criado ajuste no ciclo seguinte.

## 10. Telas Recomendadas

### 10.1 Painel Admin - Configuracoes Financeiras

Funcionalidades:

- configurar dia global de fechamento;
- configurar plano padrao;
- configurar valor minimo padrao;
- configurar quantidade inclusa padrao;
- configurar valor excedente padrao;
- visualizar status da integracao Hubsoft.

### 10.2 Painel Admin - Contas Financeiras

Funcionalidades:

- listar Usuarios/Operadores;
- vincular `id_cliente_servico` Hubsoft;
- definir dia de vencimento;
- definir plano financeiro;
- sobrescrever valores comerciais por Usuario/Operador;
- visualizar primeira ativacao;
- ativar/inativar conta financeira.

### 10.3 Painel Admin - Fechamentos

Funcionalidades:

- listar competencias;
- visualizar fechamentos por Usuario/Operador;
- ver quantidade de provisionamentos cobrados;
- ver valor minimo, excedente, multas e total;
- ver status de envio ao Hubsoft;
- reenviar somente falhas controladas;
- consultar memoria de calculo.

### 10.4 Painel Admin - Multas

Funcionalidades:

- criar multa;
- informar motivo;
- anexar/descrever comprovacao;
- aprovar;
- cancelar;
- ver em qual fechamento foi incluida.

### 10.5 Painel Admin - Alertas Financeiros

Funcionalidades:

- listar divergencias;
- filtrar por severidade;
- resolver alerta;
- registrar observacao de correcao.

### 10.6 Painel Usuario/Operador

Funcionalidades:

- visualizar faturas/fechamentos;
- visualizar provisionamentos cobrados;
- visualizar franquia minima;
- visualizar excedentes;
- visualizar multas aplicadas;
- visualizar vencimento;
- visualizar status da fatura consultada no Hubsoft.

## 11. APIs Internas Recomendadas

### 11.1 Admin

```text
GET    /api/admin/billing/settings
PUT    /api/admin/billing/settings

GET    /api/admin/billing/accounts
GET    /api/admin/billing/accounts/:id
PUT    /api/admin/billing/accounts/:id

GET    /api/admin/billing/runs
GET    /api/admin/billing/runs/:id
POST   /api/admin/billing/runs/generate
POST   /api/admin/billing/runs/:id/send
POST   /api/admin/billing/runs/:id/retry

GET    /api/admin/billing/penalties
POST   /api/admin/billing/penalties
PUT    /api/admin/billing/penalties/:id
POST   /api/admin/billing/penalties/:id/approve
POST   /api/admin/billing/penalties/:id/cancel

GET    /api/admin/billing/alerts
POST   /api/admin/billing/alerts/:id/resolve
```

### 11.2 Usuario/Operador

```text
GET /api/operator/billing/summary
GET /api/operator/billing/runs
GET /api/operator/billing/runs/:id
GET /api/operator/billing/invoices
```

## 12. Integracao Hubsoft

### 12.1 Evento de faturamento

O envio ao Hubsoft deve usar o endpoint de evento de faturamento, conforme documentacao oficial da Hubsoft.

O Fireport deve montar o payload com:

- `id_cliente_servico`;
- identificacao do servico "Servico de Rede Neutra";
- valor total;
- descricao;
- competencia;
- referencia unica/idempotente;
- vencimento quando a API permitir ou quando aplicavel pela regra Hubsoft.

Os campos exatos devem ser confirmados durante a implementacao com a documentacao operacional/token real do ambiente.

### 12.2 Consulta de faturas

O Fireport deve consultar o financeiro do Hubsoft usando o CNPJ do Usuario/Operador, para trazer:

- faturas abertas;
- faturas pagas;
- faturas vencidas;
- valor;
- vencimento;
- identificadores Hubsoft;
- payload completo para auditoria.

### 12.3 Auditoria de payloads

Todo envio deve guardar:

- payload enviado;
- resposta recebida;
- status HTTP;
- data/hora;
- erro, se houver.

## 13. Etapas de Implementacao

### Etapa 1 - Base de dados e configuracoes

Criar modelos financeiros:

- BillingPlan;
- BillingAccount;
- BillingService;
- BillingCycle;
- BillingRun;
- BillingRunItem;
- BillingPenalty;
- HubsoftBillingEvent;
- BillingAlert;
- HubsoftInvoiceSnapshot.

Criar configuracoes globais:

- dia de fechamento;
- plano padrao;
- valores padrao.

### Etapa 2 - Vinculo financeiro do Usuario/Operador

Adicionar no cadastro do Usuario/Operador:

- `id_cliente_servico` Hubsoft;
- dia de vencimento;
- plano financeiro;
- status financeiro;
- valores sobrescritos, se houver.

### Etapa 3 - Geracao de BillingService

Ao provisionar:

- criar/ativar BillingService.

Ao cancelar:

- cancelar BillingService com data.

Criar rotina de saneamento para detectar provisionamentos ativos sem BillingService.

### Etapa 4 - Motor de fechamento

Implementar rotina que:

- cria competencia;
- seleciona provisionamentos cobraveis;
- calcula franquia e excedentes;
- inclui multas aprovadas;
- gera BillingRun e BillingRunItems;
- cria alertas quando necessario.

### Etapa 5 - Envio Hubsoft

Implementar envio mensal:

- um evento por Usuario/Operador por competencia;
- idempotencia obrigatoria;
- retry controlado;
- registro de request/response.

### Etapa 6 - Consulta de faturas Hubsoft

Implementar sincronizacao:

- por Usuario/Operador;
- por competencia;
- por `id_cliente_servico`;
- gravando snapshot.

### Etapa 7 - Telas administrativas

Criar telas:

- configuracoes financeiras;
- contas financeiras;
- fechamentos;
- memoria de calculo;
- multas;
- alertas.

### Etapa 8 - Tela do Usuario/Operador

Adicionar area financeira ao painel do operador:

- resumo da competencia;
- quantidade cobrada;
- valor minimo;
- excedentes;
- multas;
- faturas Hubsoft.

### Etapa 9 - Testes e validacao

Criar cenarios de teste:

- operador sem primeira ativacao nao cobra;
- operador com 1 ONU cobra minimo;
- operador abaixo da franquia cobra minimo;
- operador acima da franquia cobra minimo + excedente;
- cancelado antes do fechamento nao cobra;
- cancelado depois do fechamento cobra no ciclo atual;
- ONU offline continua cobrando;
- multa aprovada entra no fechamento;
- multa nao aprovada nao entra;
- fechamento duplicado bloqueado;
- envio duplicado ao Hubsoft bloqueado;
- ausencia de `id_cliente_servico` gera alerta e bloqueia envio;
- divergencia Hubsoft gera alerta.

## 14. Cenarios de Negocio

### 14.1 Sem primeira ativacao

```text
Usuario/Operador cadastrado
0 provisionamentos historicos
fechamento executado
resultado: nao cobra
```

### 14.2 Primeira ativacao antes do fechamento

```text
primeira ativacao em 20/05
fechamento em 25/05
resultado: cobra valor minimo cheio
```

### 14.3 Ativacao depois do fechamento

```text
ativacao em 26/05
fechamento em 25/05
resultado: nao entra em maio, entra em junho
```

### 14.4 Cancelamento antes do fechamento

```text
ativo em 10/05
cancelado em 24/05
fechamento em 25/05
resultado: nao cobra esse provisionamento
```

### 14.5 Cancelamento depois do fechamento

```text
ativo em 10/05
fechamento em 25/05
cancelado em 26/05
resultado: cobra em maio, nao cobra em junho
```

### 14.6 ONU offline

```text
provisionamento ativo
ONU offline
fechamento em 25/05
resultado: cobra normalmente
```

## 15. Decisoes Que Nao Devem Ser Mudadas Sem Revisao

- Hubsoft e o financeiro oficial.
- Fireport envia somente um evento mensal por Usuario/Operador.
- Cobranca e por provisionamento ativo.
- ONU offline cobra.
- Nao ha proporcionalidade.
- Cancelado antes do fechamento nao cobra.
- Fechamento enviado nao e recalculado.
- Divergencia com Hubsoft gera alerta.
- Falta de `id_cliente_servico` bloqueia envio.
- Multa precisa de motivo e comprovacao.

## 16. Observacao de Seguranca

Documentos de integracao nao devem conter tokens, client secrets, senhas ou credenciais reais.

Antes de implementar rotinas financeiras em producao, recomenda-se revisar arquivos de documentacao e ambiente para remover ou rotacionar qualquer credencial exposta.
