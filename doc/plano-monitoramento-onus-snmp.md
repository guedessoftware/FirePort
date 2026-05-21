# Plano de implementação — Monitoramento de ONUs via SNMP

## 1. Objetivo

Implementar um módulo de monitoramento de ONUs em OLT ZTE/Titan via SNMP, coletando periodicamente:

```text
- Status da ONU
- RX dBm
- TX dBm
- Última vez online
- Última vez offline
- MAC aprendido, quando disponível
```

O sistema deve possuir:

```text
- Painel administrativo com visão geral de todas as OLTs/portas/ONUs
- Visão de usuário/operador limitada somente às ONUs vinculadas a ele
- Coleta eficiente, sem consultar SNMP em tempo real a cada acesso de tela
```

Os OIDs usados foram extraídos do documento **OIDs TITAN**, que define status da ONU, RX/TX óptico, MAC por serviço e horários online/offline.

---

## 2. Arquitetura recomendada

```text
OLT cadastrada no sistema
        ↓
Worker/Collector SNMP em background
        ↓
Tabela onu_current
        ↓
Tabela onu_history
        ↓
API TypeScript
        ↓
Painel Admin / Operador
```

A aplicação **não deve consultar SNMP diretamente quando o usuário abrir a tela**. O correto é consultar o banco/cache com o último estado coletado.

---

## 3. Fluxo ideal

### 3.1 Cadastro da OLT

O cadastro de OLT já existente deve receber ou já possuir estes campos:

```ts
type Olt = {
  id: string;
  name: string;
  host: string; // Ex: 192.0.2.10
  snmpVersion: "2c" | "3";
  snmpCommunity?: string; // Ex: public
  snmpPort: number; // padrão 161
  enabled: boolean;
  vendor: "zte_titan" | "zte_c600" | "zte_c650" | string;
};
```

Inicialmente, para o cenário atual:

```ts
{
  host: "192.0.2.10",
  snmpVersion: "2c",
  snmpCommunity: "public",
  snmpPort: 161,
  vendor: "zte_titan"
}
```

---

## 4. Modelo de dados recomendado

### 4.1 Tabela `onu_current`

Guarda o estado atual da ONU.

```sql
CREATE TABLE onu_current (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  olt_id UUID NOT NULL,
  porta VARCHAR(20) NOT NULL,
  pon_index BIGINT NOT NULL,
  onu_id INTEGER NOT NULL,

  status_code INTEGER,
  status_name VARCHAR(30),

  rx_dbm NUMERIC(8,2),
  tx_dbm NUMERIC(8,2),

  last_online TIMESTAMP NULL,
  last_offline TIMESTAMP NULL,

  learned_mac VARCHAR(100) NULL,

  collected_at TIMESTAMP NOT NULL DEFAULT now(),

  UNIQUE (olt_id, pon_index, onu_id)
);
```

### 4.2 Tabela `onu_history`

Guarda histórico para gráficos, auditoria e eventos.

```sql
CREATE TABLE onu_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  olt_id UUID NOT NULL,
  porta VARCHAR(20) NOT NULL,
  pon_index BIGINT NOT NULL,
  onu_id INTEGER NOT NULL,

  status_code INTEGER,
  status_name VARCHAR(30),

  rx_dbm NUMERIC(8,2),
  tx_dbm NUMERIC(8,2),

  collected_at TIMESTAMP NOT NULL DEFAULT now()
);
```

### 4.3 Tabela de vínculo com usuário/operador

Para limitar o que o operador pode visualizar:

```sql
CREATE TABLE operator_onu_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id UUID NOT NULL,
  olt_id UUID NOT NULL,
  pon_index BIGINT NOT NULL,
  onu_id INTEGER NOT NULL,

  created_at TIMESTAMP NOT NULL DEFAULT now(),

  UNIQUE (user_id, olt_id, pon_index, onu_id)
);
```

Alternativa: se a ONU já estiver vinculada a um cliente/assinante no sistema, use essa relação para filtrar.

---

## 5. Permissões

### Admin

Pode ver:

```text
- Todas as OLTs
- Todas as portas
- Todas as ONUs
- Histórico completo
- Alertas
- Configuração de coleta
```

### Operador/Usuário

Pode ver apenas:

```text
- ONUs vinculadas ao seu usuário, cliente, contrato, cidade, regional ou permissão
- Status atual
- RX/TX
- Última online/offline
```

Filtro típico na API:

```ts
if (user.role !== "admin") {
  query.whereIn("onu_current.id", subqueryDeOnusPermitidas);
}
```

---

## 6. Conversão porta física → índice SNMP

Para consultar uma porta específica, usamos o padrão visto nos testes:

```text
Porta 1/9/1 = índice 285280513
```

A lógica é:

```text
HEX = 11 + rack + slot + porta
```

Exemplo:

```text
1/9/1
rack = 01
slot = 09
porta = 01

HEX = 11010901
DEC = 285280513
```

Função TypeScript:

```ts
export function portToPonIndex(port: string): number {
  const [rack, slot, pon] = port.split("/").map(Number);

  const hex =
    "11" +
    rack.toString(16).padStart(2, "0") +
    slot.toString(16).padStart(2, "0") +
    pon.toString(16).padStart(2, "0");

  return parseInt(hex, 16);
}
```

Exemplo:

```ts
portToPonIndex("1/9/1");
// 285280513
```

---

## 7. OIDs usados

### Status da ONU

```text
1.3.6.1.4.1.3902.1082.500.10.2.3.8.1.4
```

Valores:

```text
1 = logging
2 = los
3 = syncMib
4 = working
5 = dyingGasp
6 = authFailed
7 = offline
```

### RX óptico

```text
1.3.6.1.4.1.3902.1082.500.20.2.2.2.1.10
```

### TX óptico

```text
1.3.6.1.4.1.3902.1082.500.20.2.2.2.1.14
```

### MAC aprendido por serviço

```text
1.3.6.1.4.1.3902.1082.500.20.2.17.2.1.24
1.3.6.1.4.1.3902.1082.500.20.2.17.2.1.25
```

Importante: esse MAC é aprendido por serviço da ONT. Ele pode não aparecer sempre. Não deve ser usado como identificador fixo da ONU.

### Última vez online

```text
1.3.6.1.4.1.3902.1082.500.10.2.3.8.1.5
```

### Última vez offline

```text
1.3.6.1.4.1.3902.1082.500.10.2.3.8.1.6
```

---

## 8. Cálculo RX/TX dBm

Regra usada:

```text
Se valor >= 0 e <= 32767:
  dBm = valor * 0.002 - 30

Se valor > 32767:
  dBm = (valor - 65536) * 0.002 - 30

Valor 65535 é inválido.
```

Função TypeScript:

```ts
export function rawOpticalToDbm(value?: number | null): number | null {
  if (value === undefined || value === null) return null;
  if (value === 65535) return null;

  if (value >= 0 && value <= 32767) {
    return Number((value * 0.002 - 30).toFixed(2));
  }

  return Number(((value - 65536) * 0.002 - 30).toFixed(2));
}
```

---

## 9. Estratégia de coleta

### Recomendação principal

Não usar `snmpget` ONU por ONU para tudo.

Melhor abordagem:

```text
1. Fazer snmpwalk da tabela de status
2. Fazer snmpwalk da tabela RX
3. Fazer snmpwalk da tabela TX
4. Fazer snmpwalk da tabela last_online
5. Fazer snmpwalk da tabela last_offline
6. Cruzar localmente por pon_index + onu_id
7. Atualizar banco em lote
```

Isso reduz drasticamente a carga na OLT.

### Frequência sugerida

```text
Status: a cada 1 minuto
RX/TX: a cada 5 minutos
Última online/offline: a cada 5 minutos
MAC aprendido: a cada 10 ou 15 minutos
Histórico: salvar mudança de status sempre; RX/TX a cada 5 ou 10 minutos
```

---

## 10. Painel administrativo

### Cards principais

```text
- Total de ONUs
- Online / working
- LOS
- Offline
- DyingGasp
- Sinal crítico
- OLTs sem resposta SNMP
```

### Filtros

```text
- OLT
- Slot
- Porta
- Status
- RX abaixo de -25 dBm
- RX abaixo de -27 dBm
- Última queda
- Cliente/operador
```

### Tabela

```text
OLT | Porta | ONU ID | Status | RX | TX | Última online | Última offline | MAC aprendido | Atualizado em
```

---

## 11. Painel usuário/operador

O operador deve consultar a mesma tabela `onu_current`, mas filtrada.

Exemplo de resposta da API:

```json
[
  {
    "oltId": "uuid",
    "porta": "1/9/1",
    "onuId": 1,
    "status": "working",
    "rxDbm": -20.5,
    "txDbm": 2.44,
    "lastOnline": "2026-05-03T20:08:33.000Z",
    "lastOffline": "2026-05-03T20:08:08.000Z",
    "collectedAt": "2026-05-03T21:00:00.000Z"
  }
]
```

---

## 12. Script modelo atual — Bash

Este script serve como **referência operacional** para outra IA/dev entender quais comandos e OIDs estão corretos.

Ele suporta:

```text
- Coleta geral
- Coleta por porta
- Coleta de ONU específica
- Coleta de array de ONUs
```

```bash
#!/usr/bin/env bash

COMMUNITY="${SNMP_COMMUNITY:-public}"
HOST="${SNMP_HOST:-127.0.0.1}"

OID_STATUS="1.3.6.1.4.1.3902.1082.500.10.2.3.8.1.4"
OID_LAST_ONLINE="1.3.6.1.4.1.3902.1082.500.10.2.3.8.1.5"
OID_LAST_OFFLINE="1.3.6.1.4.1.3902.1082.500.10.2.3.8.1.6"
OID_RX="1.3.6.1.4.1.3902.1082.500.20.2.2.2.1.10"
OID_TX="1.3.6.1.4.1.3902.1082.500.20.2.2.2.1.14"
OID_MAC1="1.3.6.1.4.1.3902.1082.500.20.2.17.2.1.24"
OID_MAC2="1.3.6.1.4.1.3902.1082.500.20.2.17.2.1.25"

DEFAULT_PORTS="1/1/1-16 1/2/1-16 1/3/1-16 1/4/1-16 1/7/1-16 1/8/1-16 1/9/1-16"

usage() {
  echo "Uso:"
  echo "  $0"
  echo "  $0 --port 1/9/1"
  echo "  $0 --onu 1/9/1:3"
  echo "  $0 --onus 1/9/1:1,1/9/1:3,1/7/2:14"
  echo "  $0 --host 192.0.2.10 --community public --port 1/9/1"
}

status_name() {
  case "$1" in
    1) echo "logging" ;;
    2) echo "los" ;;
    3) echo "syncMib" ;;
    4) echo "working" ;;
    5) echo "dyingGasp" ;;
    6) echo "authFailed" ;;
    7) echo "offline" ;;
    *) echo "unknown" ;;
  esac
}

to_dbm() {
  local val="$1"

  if [ -z "$val" ] || [ "$val" = "65535" ]; then
    echo ""
  elif [ "$val" -le 32767 ]; then
    awk -v v="$val" 'BEGIN { printf "%.2f", (v * 0.002) - 30 }'
  else
    awk -v v="$val" 'BEGIN { printf "%.2f", ((v - 65536) * 0.002) - 30 }'
  fi
}

port_index_from_port() {
  local p="$1"
  local rack slot port

  IFS="/" read -r rack slot port <<< "$p"

  printf "%d" "0x11$(printf '%02X' "$rack")$(printf '%02X' "$slot")$(printf '%02X' "$port")"
}

hex_date() {
  local raw="$1"
  local hex

  hex=$(echo "$raw" | sed 's/.*Hex-STRING: //; s/ //g')

  [ -z "$hex" ] && echo "" && return
  [ ${#hex} -lt 14 ] && echo "" && return

  local year month day hour min sec

  year=$((16#${hex:0:4}))
  month=$((16#${hex:4:2}))
  day=$((16#${hex:6:2}))
  hour=$((16#${hex:8:2}))
  min=$((16#${hex:10:2}))
  sec=$((16#${hex:12:2}))

  printf "%04d-%02d-%02d %02d:%02d:%02d" "$year" "$month" "$day" "$hour" "$min" "$sec"
}

get_int() {
  snmpget -v2c -c "$COMMUNITY" "$HOST" "$1" 2>/dev/null | awk -F'INTEGER: ' '{print $2}'
}

get_status_by_onu() {
  get_int "$OID_STATUS.$1.$2"
}

get_hex_date() {
  hex_date "$(snmpget -v2c -c "$COMMUNITY" "$HOST" "$1" 2>/dev/null)"
}

get_macs() {
  local idx="$1"
  local onu="$2"

  {
    snmpwalk -v2c -c "$COMMUNITY" "$HOST" "$OID_MAC1.$idx.$onu" 2>/dev/null
    snmpwalk -v2c -c "$COMMUNITY" "$HOST" "$OID_MAC2.$idx.$onu" 2>/dev/null
  } |
  sed -n \
    -e 's/.*STRING: "\(.*\)"/\1/p' \
    -e 's/.*Hex-STRING: //p' |
  sed 's/  */ /g; s/^ //; s/ $//' |
  awk '
    NF {
      gsub(/ /, ":", $0)
      sub(/:$/, "", $0)
      if (!seen[$0]++) print $0
    }
  ' |
  paste -sd "," -
}

collect_onu() {
  local porta="$1"
  local onu_id="$2"
  local idx status rx_raw tx_raw rx_dbm tx_dbm last_online last_offline macs

  idx=$(port_index_from_port "$porta")
  status=$(get_status_by_onu "$idx" "$onu_id")

  [ -z "$status" ] && return

  rx_raw=$(get_int "$OID_RX.$idx.$onu_id.1")
  tx_raw=$(get_int "$OID_TX.$idx.$onu_id.1")

  rx_dbm=$(to_dbm "$rx_raw")
  tx_dbm=$(to_dbm "$tx_raw")

  last_online=$(get_hex_date "$OID_LAST_ONLINE.$idx.$onu_id")
  last_offline=$(get_hex_date "$OID_LAST_OFFLINE.$idx.$onu_id")

  macs=$(get_macs "$idx" "$onu_id")

  echo "$porta;$idx;$onu_id;$(status_name "$status");$rx_dbm;$tx_dbm;$last_online;$last_offline;$macs"
}

collect_port() {
  local porta="$1"
  local idx

  idx=$(port_index_from_port "$porta")

  snmpwalk -v2c -c "$COMMUNITY" "$HOST" "$OID_STATUS.$idx" 2>/dev/null |
  while read -r line; do
    onu_id=$(echo "$line" | awk -F'.' '{print $NF}' | awk '{print $1}')
    [ -n "$onu_id" ] && collect_onu "$porta" "$onu_id"
  done
}

expand_port_range() {
  local expr="$1"
  local base end rack slot start

  base="${expr%-*}"
  end="${expr##*-}"

  IFS="/" read -r rack slot start <<< "$base"

  for p in $(seq "$start" "$end"); do
    echo "$rack/$slot/$p"
  done
}

MODE="default"
TARGET=""

while [ $# -gt 0 ]; do
  case "$1" in
    --host)
      HOST="$2"; shift 2 ;;
    --community)
      COMMUNITY="$2"; shift 2 ;;
    --port)
      MODE="port"; TARGET="$2"; shift 2 ;;
    --onu)
      MODE="onu"; TARGET="$2"; shift 2 ;;
    --onus)
      MODE="onus"; TARGET="$2"; shift 2 ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      echo "Argumento inválido: $1"
      usage
      exit 1 ;;
  esac
done

echo "PORTA;PON_INDEX;ONU_ID;STATUS;RX_dBm;TX_dBm;ULTIMA_ONLINE;ULTIMA_OFFLINE;MAC_APRENDIDO"

case "$MODE" in
  default)
    for r in $DEFAULT_PORTS; do
      for porta in $(expand_port_range "$r"); do
        collect_port "$porta"
      done
    done
    ;;
  port)
    collect_port "$TARGET"
    ;;
  onu)
    porta="${TARGET%%:*}"
    onu="${TARGET##*:}"
    collect_onu "$porta" "$onu"
    ;;
  onus)
    echo "$TARGET" | tr "," "\n" |
    while read -r item; do
      porta="${item%%:*}"
      onu="${item##*:}"
      collect_onu "$porta" "$onu"
    done
    ;;
esac
```

Exemplos de uso:

```bash
# Todas as portas padrão
./coleta_onu_zte.sh

# Porta específica
./coleta_onu_zte.sh --port 1/9/1

# ONU específica
./coleta_onu_zte.sh --onu 1/9/1:3

# Várias ONUs específicas
./coleta_onu_zte.sh --onus 1/9/1:1,1/9/1:3,1/7/2:14

# Usando host/community dinâmicos
./coleta_onu_zte.sh --host 192.0.2.10 --community public --port 1/9/1
```

---

## 13. Implementação TypeScript recomendada

Em produção, em vez de chamar esse Bash, recomenda-se usar uma lib SNMP no Node.js, por exemplo:

```text
net-snmp
```

Estrutura sugerida:

```text
src/
  modules/
    olt/
      olt.entity.ts
      olt.service.ts
    onu-monitoring/
      onu-monitoring.service.ts
      onu-collector.worker.ts
      onu-snmp.client.ts
      onu-index.util.ts
      onu-oids.ts
      onu.types.ts
      onu-current.repository.ts
      onu-history.repository.ts
```

### `onu-oids.ts`

```ts
export const ZTE_TITAN_OIDS = {
  status: "1.3.6.1.4.1.3902.1082.500.10.2.3.8.1.4",
  lastOnline: "1.3.6.1.4.1.3902.1082.500.10.2.3.8.1.5",
  lastOffline: "1.3.6.1.4.1.3902.1082.500.10.2.3.8.1.6",
  rx: "1.3.6.1.4.1.3902.1082.500.20.2.2.2.1.10",
  tx: "1.3.6.1.4.1.3902.1082.500.20.2.2.2.1.14",
  mac1: "1.3.6.1.4.1.3902.1082.500.20.2.17.2.1.24",
  mac2: "1.3.6.1.4.1.3902.1082.500.20.2.17.2.1.25",
} as const;
```

### `onu-index.util.ts`

```ts
export function portToPonIndex(port: string): number {
  const [rack, slot, pon] = port.split("/").map(Number);

  if (!rack || !slot || !pon) {
    throw new Error(`Porta inválida: ${port}`);
  }

  const hex =
    "11" +
    rack.toString(16).padStart(2, "0") +
    slot.toString(16).padStart(2, "0") +
    pon.toString(16).padStart(2, "0");

  return parseInt(hex, 16);
}

export function statusName(code: number): string {
  const map: Record<number, string> = {
    1: "logging",
    2: "los",
    3: "syncMib",
    4: "working",
    5: "dyingGasp",
    6: "authFailed",
    7: "offline",
  };

  return map[code] ?? "unknown";
}

export function rawOpticalToDbm(value?: number | null): number | null {
  if (value === undefined || value === null) return null;
  if (value === 65535) return null;

  if (value >= 0 && value <= 32767) {
    return Number((value * 0.002 - 30).toFixed(2));
  }

  return Number(((value - 65536) * 0.002 - 30).toFixed(2));
}
```

### Portas padrão

```ts
export const DEFAULT_MONITORED_PORTS = [
  "1/1/1", "1/1/2", "1/1/3", "1/1/4", "1/1/5", "1/1/6", "1/1/7", "1/1/8", "1/1/9", "1/1/10", "1/1/11", "1/1/12", "1/1/13", "1/1/14", "1/1/15", "1/1/16",
  "1/2/1", "1/2/2", "1/2/3", "1/2/4", "1/2/5", "1/2/6", "1/2/7", "1/2/8", "1/2/9", "1/2/10", "1/2/11", "1/2/12", "1/2/13", "1/2/14", "1/2/15", "1/2/16",
  "1/3/1", "1/3/2", "1/3/3", "1/3/4", "1/3/5", "1/3/6", "1/3/7", "1/3/8", "1/3/9", "1/3/10", "1/3/11", "1/3/12", "1/3/13", "1/3/14", "1/3/15", "1/3/16",
  "1/4/1", "1/4/2", "1/4/3", "1/4/4", "1/4/5", "1/4/6", "1/4/7", "1/4/8", "1/4/9", "1/4/10", "1/4/11", "1/4/12", "1/4/13", "1/4/14", "1/4/15", "1/4/16",
  "1/7/1", "1/7/2", "1/7/3", "1/7/4", "1/7/5", "1/7/6", "1/7/7", "1/7/8", "1/7/9", "1/7/10", "1/7/11", "1/7/12", "1/7/13", "1/7/14", "1/7/15", "1/7/16",
  "1/8/1", "1/8/2", "1/8/3", "1/8/4", "1/8/5", "1/8/6", "1/8/7", "1/8/8", "1/8/9", "1/8/10", "1/8/11", "1/8/12", "1/8/13", "1/8/14", "1/8/15", "1/8/16",
  "1/9/1", "1/9/2", "1/9/3", "1/9/4", "1/9/5", "1/9/6", "1/9/7", "1/9/8", "1/9/9", "1/9/10", "1/9/11", "1/9/12", "1/9/13", "1/9/14", "1/9/15", "1/9/16",
];
```

---

## 14. Endpoints sugeridos

### Admin

```http
GET /admin/olts/:oltId/onus
GET /admin/olts/:oltId/onus?porta=1/9/1
GET /admin/olts/:oltId/onus?status=los
GET /admin/olts/:oltId/onus?rxBelow=-25
POST /admin/olts/:oltId/collect
GET /admin/onus/:onuCurrentId/history
```

### Operador/Usuário

```http
GET /operator/onus
GET /operator/onus/:id
```

A API de operador deve filtrar pelo vínculo do usuário.

---

## 15. Alertas recomendados

Criar alertas quando:

```text
- Status muda de working para los
- Status muda para offline
- Status muda para dyingGasp
- RX fica abaixo de -25 dBm
- RX fica abaixo de -27 dBm crítico
- OLT não responde SNMP
- ONU some da coleta
```

Tabela:

```sql
CREATE TABLE onu_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  olt_id UUID NOT NULL,
  pon_index BIGINT NOT NULL,
  onu_id INTEGER NOT NULL,

  event_type VARCHAR(50) NOT NULL,
  previous_value VARCHAR(100),
  current_value VARCHAR(100),

  created_at TIMESTAMP NOT NULL DEFAULT now()
);
```

---

## 16. Recomendação final

Para performance e confiabilidade:

```text
- Coleta em background
- Banco como fonte principal
- Cache opcional na API
- Histórico com retenção
- SNMP em lote usando walk
- Tela nunca bate direto na OLT
- MAC tratado como opcional
- Serial/descrição da ONU via CLI ou cadastro manual, pois não apareceu OID confiável para serial no PDF
```

O melhor caminho é começar com:

```text
Fase 1:
- Coletor status/RX/TX/online/offline
- Tabela onu_current
- Painel admin básico

Fase 2:
- Permissões operador
- Histórico
- Alertas

Fase 3:
- Integração com cadastro de cliente/contrato/ONU
- CLI para enriquecer com serial/descrição
- Dashboard com gráficos
```
