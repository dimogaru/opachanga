#!/bin/sh
set -eu

if [ -n "${DB_PATH:-}" ]; then
  database_directory="$(dirname "$DB_PATH")"
  if [ "$database_directory" != "." ]; then
    mkdir -p "$database_directory"
  fi
else
  mkdir -p "${DATA_DIR:-./data}"
fi
exec node server.js
