# Drivers de OLT

O Fireport provisiona em duas etapas:

1. Cria o contrato/provisionamento local e reserva a porta.
2. Renderiza os comandos do perfil e conecta por SSH na OLT cadastrada.

O sistema fala com uma interface única. Cada OLT é cadastrada no banco com fabricante, modelo, POP, host, usuário, porta SSH e perfil de comandos.

## Drivers disponíveis

- `zte-c650`: renderiza o perfil OLT e executa os comandos via SSH na OLT cadastrada.
- `http-json`: mantido como driver genérico para integrações futuras.

## Cadastro da OLT

A área administrativa possui o cadastro de OLTs. Campos principais:

- nome
- IPv4/IPv6/host
- fabricante
- modelo
- POP
- servidor de gerenciamento
- usuário SSH
- porta SSH
- senha SSH
- senha adicional, usada para modo privilegiado quando necessário
- driver
- perfil de comandos
- OLT padrão/ativa

As senhas são salvas criptografadas no banco usando `OLT_SECRET` ou `NEXTAUTH_SECRET`. A listagem nunca retorna as senhas.

## Interfaces da OLT

Depois de cadastrar a OLT, cadastre suas interfaces de conexão. Elas representam onde as ONUs/CPEs serão autorizadas e provisionadas.

Campos principais:

- tipo: `GPON`, `EPON`, `WIRELESS`, `BRIDGE`, `VLAN` ou `ETHERNET`.
- nome e descrição.
- chassi, slot e PON.
- VLAN da interface, usada como `[[service_vlan]]` nos scripts.
- interface de roteamento.
- obrigatoriedade de vínculo com CTO.
- bloqueio de superutilização.
- escaneamento e tipo de escaneamento.
- alarmes de sinal RX do assinante e do equipamento.
- sequência da porta.

Também existe cadastro massivo por faixa de chassi, slot e PON. O provisionamento usa a primeira interface `GPON` ativa da OLT padrão quando o perfil da CPE não informar chassi, slot e PON diretamente.

No `.env.local`, mantenha:

```env
OLT_DRIVER=zte-c650
OLT_DEFAULT_GEM_PORT=1
OLT_DEFAULT_TCONT=1
OLT_DEFAULT_SERVICE_VLAN=600
OLT_DEFAULT_SERVICE_NAME=internet
```

O driver usa a OLT ativa marcada como padrão para o driver. Se não houver OLT cadastrada, o provisionamento local fica reservado e o registro na OLT permanece pendente.

## Rede neutra e VLAN do operador

Cada usuário operador deve ter uma VLAN cadastrada no painel administrativo. Essa VLAN é usada em todo provisionamento da CPE pelo token `[[vlan]]`.

O cadastro de perfis OLT fica na área administrativa. Um perfil pode ter quatro blocos:

- autorização
- provisionamento
- desprovisionamento
- desautorização

No provisionamento atual, o driver ZTE C650 envia os blocos de autorização e provisionamento juntos via SSH. Os blocos de remoção ficam salvos para a etapa de desprovisionamento.

## Perfil no modelo da CPE

O campo `scripts` do `CPEModel` continua aceitando particularidades da CPE, como `onuType`, `slot`, `pon` e `onuId`. O perfil administrativo guarda os comandos principais:

```json
{
  "action": "provision",
  "ont": "ZTE-F641",
  "oltProfile": {
    "driver": "zte-c650",
    "onuType": "ZTE-F641",
    "slot": 1,
    "pon": 1,
    "onuId": 10,
    "lineProfile": "LINE_DEFAULT",
    "serviceProfile": "SRV_DEFAULT"
  }
}
```

## Variáveis dos comandos

Os comandos aceitam tokens no formato do painel antigo, como `[[vlan]]`, e também o formato `{{profile.slot}}` usado internamente.

Tokens principais:

- `[[vlan]]`: VLAN do usuário operador.
- `[[phy_addr]]`: serial GPON da CPE.
- `[[chassi]]`, `[[slot]]`, `[[pon]]`, `[[indice_onu]]`.
- `[[onu_type]]`: tipo/modelo ONU do perfil da CPE.
- `[[service_vlan]]`: VLAN da interface GPON cadastrada, ou o padrão `600`.
- `[[interface_name]]`, `[[interface_description]]`, `[[routing_interface]]`.
- `{{contract.contractNumber}}`, `{{contract.name}}`, `{{cto.name}}`, `{{port.number}}`, `{{cpeModel.name}}`.

Exemplo ZTE C650:

```text
configure terminal
interface gpon_olt-[[chassi]]/[[slot]]/[[pon]]
onu [[indice_onu]] type [[onu_type]] sn [[phy_addr]]
exit
```

Se o usuário operador não tiver VLAN cadastrada, o provisionamento local fica reservado, mas o registro na OLT falha com status `olt_failed` para auditoria e retry após correção.
