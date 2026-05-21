#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups}"

cd "$ROOT_DIR"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "$ENV_FILE"
  set +a
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "Erro: DATABASE_URL nao definido. Configure o .env antes de migrar." >&2
  exit 1
fi

if [[ "$DATABASE_URL" != file:* ]]; then
  echo "Erro: este script protege apenas SQLite com DATABASE_URL=file:..." >&2
  echo "DATABASE_URL atual: $DATABASE_URL" >&2
  exit 1
fi

DB_PATH="${DATABASE_URL#file:}"
DB_PATH="${DB_PATH%%\?*}"

if [[ "$DB_PATH" != /* ]]; then
  DB_PATH="$ROOT_DIR/$DB_PATH"
fi

if [[ ! -f "$DB_PATH" ]]; then
  echo "Erro: banco SQLite nao encontrado em $DB_PATH" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_PATH="$BACKUP_DIR/$(basename "$DB_PATH" .db)-before-migrate-$TIMESTAMP.db"

echo "Banco: $DB_PATH"
echo "Backup: $BACKUP_PATH"

if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DB_PATH" "PRAGMA wal_checkpoint(FULL);"
  sqlite3 "$DB_PATH" ".backup '$BACKUP_PATH'"
  INTEGRITY_RESULT="$(sqlite3 "$BACKUP_PATH" "PRAGMA integrity_check;")"
  if [[ "$INTEGRITY_RESULT" != "ok" ]]; then
    echo "Erro: backup falhou no integrity_check: $INTEGRITY_RESULT" >&2
    exit 1
  fi
else
  if [[ -s "$DB_PATH-wal" ]]; then
    echo "Erro: sqlite3 nao esta instalado e existe WAL ativo em $DB_PATH-wal." >&2
    echo "Instale sqlite3 ou pare a aplicacao e aguarde o WAL ser fechado antes de migrar." >&2
    exit 1
  fi
  cp "$DB_PATH" "$BACKUP_PATH"
  echo "Aviso: sqlite3 nao encontrado; backup feito por copia simples com a aplicacao parada/WAL vazio."
fi

if [[ ! -f node_modules/prisma/build/index.js ]]; then
  echo "Erro: Prisma CLI nao encontrado em node_modules/prisma/build/index.js." >&2
  echo "Gere um pacote atualizado ou instale as dependencias antes de migrar." >&2
  exit 1
fi

if [[ -d node_modules/@prisma/engines ]]; then
  find node_modules/@prisma/engines -maxdepth 1 -type f -name '*engine*' -exec chmod 755 {} \;
fi

echo "Aplicando migrations Prisma..."
node node_modules/prisma/build/index.js migrate deploy --schema prisma/schema.prisma

if command -v sqlite3 >/dev/null 2>&1; then
  INTEGRITY_RESULT="$(sqlite3 "$DB_PATH" "PRAGMA integrity_check;")"
  if [[ "$INTEGRITY_RESULT" != "ok" ]]; then
    echo "Erro: banco migrado falhou no integrity_check: $INTEGRITY_RESULT" >&2
    echo "Restaure o backup: $BACKUP_PATH" >&2
    exit 1
  fi
  sqlite3 "$DB_PATH" "SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 5;"
fi

echo "Migration concluida com backup preservado em: $BACKUP_PATH"
