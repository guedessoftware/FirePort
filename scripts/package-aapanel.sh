#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/dist/aapanel"
ARCHIVE="$ROOT_DIR/dist/fireport-aapanel.tar.gz"

cd "$ROOT_DIR"

export NEXT_TELEMETRY_DISABLED=1

npm run build

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR/.next" "$OUT_DIR/prisma" "$OUT_DIR/scripts" "$ROOT_DIR/dist"

cp -R .next/standalone/. "$OUT_DIR/"
find "$OUT_DIR" -maxdepth 1 -name ".env*" -type f -delete
cp -R .next/static "$OUT_DIR/.next/static"
cp -R public "$OUT_DIR/public"
cp -R prisma/migrations "$OUT_DIR/prisma/migrations"
cp prisma/schema.prisma "$OUT_DIR/prisma/schema.prisma"
cp scripts/backup-and-migrate-sqlite.sh "$OUT_DIR/scripts/backup-and-migrate-sqlite.sh"
cp .env.production.example "$OUT_DIR/.env.example"

mkdir -p "$OUT_DIR/node_modules/@prisma"
cp -R node_modules/prisma "$OUT_DIR/node_modules/prisma"
cp -R node_modules/@prisma/debug "$OUT_DIR/node_modules/@prisma/debug"
cp -R node_modules/@prisma/engines "$OUT_DIR/node_modules/@prisma/engines"
cp -R node_modules/@prisma/engines-version "$OUT_DIR/node_modules/@prisma/engines-version"
cp -R node_modules/@prisma/fetch-engine "$OUT_DIR/node_modules/@prisma/fetch-engine"
cp -R node_modules/@prisma/get-platform "$OUT_DIR/node_modules/@prisma/get-platform"
find "$OUT_DIR/node_modules/@prisma/engines" -maxdepth 1 -type f -name '*engine*' -exec chmod 755 {} \;
chmod 755 "$OUT_DIR/scripts/backup-and-migrate-sqlite.sh"

node - "$OUT_DIR/package.json" <<'NODE'
const fs = require('fs')
const packageJsonPath = process.argv[2]
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))

packageJson.scripts = {
  start: 'node server.js',
  'start:aapanel': 'node server.js',
  'db:migrate': 'bash scripts/backup-and-migrate-sqlite.sh',
  'prisma:migrate:deploy': 'node node_modules/prisma/build/index.js migrate deploy --schema prisma/schema.prisma',
}

packageJson.dependencies = {
  ...packageJson.dependencies,
  prisma: '5.22.0',
  '@prisma/client': '5.22.0',
}

delete packageJson.devDependencies

fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)
NODE

cat > "$OUT_DIR/README-AAPANEL.txt" <<'TXT'
Fireport - pacote aaPanel

1. Envie/extrai este conteudo no diretorio do site.
2. Crie um arquivo .env no servidor baseado em .env.example.
3. Se for manter SQLite, crie a pasta prisma e coloque o banco em:
   /www/wwwroot/fireport_firenetwork_com_br/prisma/prod.db
4. Antes de iniciar a versao nova, rode:
   npm run db:migrate
   Esse comando cria backup em ./backups e aplica as migrations Prisma.
5. No aaPanel, use Projeto Node, porta 3000, comando:
   node server.js
6. Configure o dominio fireport.firenetwork.com.br como proxy para essa porta.
TXT

tar -czf "$ARCHIVE" -C "$OUT_DIR" .

echo "Pacote gerado em: $ARCHIVE"
