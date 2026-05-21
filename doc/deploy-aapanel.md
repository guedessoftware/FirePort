# Deploy no aaPanel

Este projeto deve subir como **Projeto Node** no aaPanel, com Nginx fazendo proxy para a porta interna do Next.js. A aba PHP não serve para rodar o Fireport diretamente.

## Preparar pacote

```bash
npm run pack:aapanel
```

O pacote será gerado em:

```text
dist/fireport-aapanel.tar.gz
```

## Arquivos no servidor

Diretório sugerido:

```text
/www/wwwroot/fireport_firenetwork_com_br
```

Extraia o conteúdo do pacote nesse diretório.

Crie o arquivo `.env` no servidor usando `.env.example` como base. Não envie `.env.local` para produção.

Para SQLite, use caminho absoluto:

```env
DATABASE_URL="file:/www/wwwroot/fireport_firenetwork_com_br/prisma/prod.db"
```

Na primeira publicação com dados existentes, copie o banco atual uma única vez:

```text
prisma/dev.db -> /www/wwwroot/fireport_firenetwork_com_br/prisma/prod.db
```

Depois disso, preserve `prod.db` entre deploys.

## Atualizar producao sem perder dados

O banco de producao **nao deve ser substituido** durante atualizacoes. Envie o novo pacote mantendo o arquivo:

```text
/www/wwwroot/fireport_firenetwork_com_br/prisma/prod.db
```

Antes de subir a nova versao, pare o Projeto Node no aaPanel e rode, dentro do diretorio do site:

```bash
npm run db:migrate
```

Esse comando:

1. le o `DATABASE_URL` do `.env`;
2. cria um backup em `./backups`;
3. aplica apenas as migrations pendentes com `prisma migrate deploy`;
4. roda `PRAGMA integrity_check` quando o comando `sqlite3` estiver disponivel.

Se precisar voltar, pare o Projeto Node, restaure o arquivo `.db` salvo em `backups/` para o caminho do `DATABASE_URL` e inicie a versao anterior.

### Migration sensivel desta atualizacao

A migration `20260517143000_cleanup_legacy_provisioning_profiles` remove colunas antigas de `CPEModel`, `ProvisioningProfile` e remove `OltProfile`. Ela depende da migration imediatamente anterior, `20260517113000_add_cpe_model_olt_profiles`, que copia os comandos antigos para a nova tabela `CpeModelOltProfile`.

Por isso, em producao, use sempre `npm run db:migrate` ou `prisma migrate deploy`, nunca `prisma db push --force-reset`.

## Configurar Projeto Node

- Tipo: `Projeto Node`
- Versão Node: `20` ou superior
- Diretório: `/www/wwwroot/fireport_firenetwork_com_br`
- Porta: `3000`
- Comando de início: `node server.js`
- Domínio: `fireport.firenetwork.com.br`
- SSL: habilitado

## Variáveis obrigatórias

- `NODE_ENV=production`
- `PORT=3000`
- `HOSTNAME=127.0.0.1`
- `DATABASE_URL`
- `NEXTAUTH_URL=https://fireport.firenetwork.com.br`
- `NEXTAUTH_SECRET`
- `INITIAL_ADMIN_SETUP_TOKEN`
- credenciais Hubsoft
- `GOOGLE_GEOCODING_API_KEY`

## Antes de liberar usuários

1. Troque a senha FTP usada no deploy.
2. Gere novos segredos para `NEXTAUTH_SECRET` e `INITIAL_ADMIN_SETUP_TOKEN`.
3. Confirme que o arquivo `.env` não é público.
4. Confirme que `prod.db` tem backup.
5. Inicie com `ONU_MONITOR_AUTO_START=false` e `OLT_MONITOR_AUTO_START=false`; ligue depois que login, Hubsoft e OLT estiverem validados.
