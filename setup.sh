#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 Bulat Ruslanovich
set -euo pipefail

cd "$(dirname "$0")"

usage() {
  cat <<'EOF'
Usage: ./setup.sh [--domain music.example.com] [--library /path/to/music] [--owner admin] [--build] [--yes]

Writes .env with fresh secrets and starts Caimack with Docker Compose.

  --domain   domain Caddy issues the HTTPS certificate for
  --library  folder with existing music, mounted read-only (default: ./library)
  --owner    username of the first admin account (default: admin)
  --build    build the images here instead of pulling them from ghcr.io
  --yes      don't ask, use the values given on the command line
EOF
}

domain=""
library=""
owner=""
build=false
assume_yes=false

while [ $# -gt 0 ]; do
  case "$1" in
    --domain) domain="${2:?--domain needs a value}"; shift 2 ;;
    --library) library="${2:?--library needs a value}"; shift 2 ;;
    --owner) owner="${2:?--owner needs a value}"; shift 2 ;;
    --build) build=true; shift ;;
    --yes) assume_yes=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

fail() {
  echo "error: $*" >&2
  exit 1
}

ask() {
  local prompt="$1" default="$2" answer
  if [ "$assume_yes" = true ]; then
    printf '%s' "$default"
    return
  fi
  read -r -p "$prompt [$default]: " answer </dev/tty
  printf '%s' "${answer:-$default}"
}

escape() {
  printf '%s' "$1" | sed -e 's/[\\|&]/\\&/g'
}

secret() {
  head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'
}

command -v docker >/dev/null 2>&1 || fail "Docker is not installed: https://docs.docker.com/engine/install/"
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required (docker compose ...)."
[ -f .env.example ] || fail "Run setup.sh from the Caimack checkout."
[ -e .env ] && fail ".env already exists. Remove it to start over (the database keeps its old password), or edit it and run docker compose up -d."

domain="$(ask "Domain" "${domain:-localhost}")"
[[ "$domain" =~ ^[A-Za-z0-9.-]+$ ]] || fail "$domain is not a domain name."

library="$(ask "Music folder (mounted read-only)" "${library:-./library}")"
if [ "$library" = "./library" ]; then
  mkdir -p library
elif [ ! -d "$library" ]; then
  fail "The music folder $library does not exist."
else
  library="$(cd "$library" && pwd)"
fi

owner="$(ask "Admin username" "${owner:-admin}")"
[[ "$owner" =~ ^[a-z0-9][a-z0-9._-]{4,19}$ ]] || fail "The username must be 5–20 characters: a-z, 0-9, '.', '_' or '-', starting with a letter or digit."

postgres_password="$(secret 24)"
jwt_signing_key="$(secret 48)"
owner_password="$(secret 9)"

compose_file="docker-compose.yml:docker-compose.images.yml"
[ "$build" = true ] && compose_file="docker-compose.yml"

umask 077
sed \
  -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$postgres_password|" \
  -e "s|^JWT_SIGNING_KEY=.*|JWT_SIGNING_KEY=$jwt_signing_key|" \
  -e "s|^OWNER_USERNAME=.*|OWNER_USERNAME=$owner|" \
  -e "s|^OWNER_PASSWORD=.*|OWNER_PASSWORD=$owner_password|" \
  -e "s|^MUSIC_LIBRARY_PATH=.*|MUSIC_LIBRARY_PATH=$(escape "$library")|" \
  -e "s|^PUBLIC_DOMAIN=.*|PUBLIC_DOMAIN=$domain|" \
  -e "s|^PUID=.*|PUID=$(id -u)|" \
  -e "s|^PGID=.*|PGID=$(id -g)|" \
  .env.example >.env
printf '\nCOMPOSE_FILE=%s\n' "$compose_file" >>.env
umask 022

echo "Wrote .env"

if [ "$build" = true ]; then
  docker compose build
else
  docker compose pull --ignore-buildable
fi
docker compose up -d

cat <<EOF

Caimack is starting at https://$domain
The first start downloads the audio model (about 280 MB); follow it with: docker compose logs -f model backend

Sign in as:
  username  $owner
  password  $owner_password

The password is also in .env (OWNER_PASSWORD); change it in account settings after signing in.
EOF
