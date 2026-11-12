#!/usr/bin/env bash

# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 Bulat Ruslanovich

set -euo pipefail
umask 077
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd -- "$ROOT"
ENV_FILE="$ROOT/.env" STATE="$ROOT/.caimack"
MODULE=docker-compose.recommendations.yml
AMD_MODULE=docker-compose.mert-amd.yml
REPOSITORY=BulatRuslanovich/caimack
ACTION='' MODE='' SERVICE='' DOMAIN='' LIBRARY='' OWNER='' VERSION=''
YES=false BUILD=false FOLLOW=false RESET_PENDING=false
STAGING='' GPU_ROLLBACK='' COMPOSE=()
ACCENT='' DIM='' GREEN='' YELLOW='' NORMAL='' FOCUS='' RED=''
RUNTIME='' DOCKER_READY=false COMPACT=false
if [[ -t 1 && ${TERM:-dumb} != dumb && -z ${NO_COLOR:-} ]]; then
  ACCENT=$'\033[1;36m' DIM=$'\033[2m' GREEN=$'\033[32m' YELLOW=$'\033[33m' NORMAL=$'\033[0m'
  FOCUS=$'\033[48;5;24;38;5;231m' RED=$'\033[1;31m'
fi
info() { printf '%s›%s %s\n' "$ACCENT" "$NORMAL" "$*"; }
ok() { printf '%s✓%s %s\n' "$GREEN" "$NORMAL" "$*"; }
warn() { printf '%s!%s %s\n' "$YELLOW" "$NORMAL" "$*" >&2; }
die() { warn "$*"; exit 1; }
usage() {
  cat <<'EOF'
caimack / server console

Usage: ./caimack.sh [command] [options]

  install                    Bootstrap a deployment and download images
  update                     Pull updates and reconcile changed containers
  start | stop | restart     Manage services; database and music are preserved
  status                     Deployment configuration and container status
  logs [service] [-f]        Recent logs; -f follows output
  recommendations on | off   Attach or detach MERT (auto NVIDIA / AMD)
  owner [--owner NAME]       Assign the deployment owner / administrator
  reset once | on | off      One-time or persistent owner password reset
  credentials                Explicitly display owner credentials from .env
  doctor                     Check Docker, Compose and GPU access
  self-update                Refresh this manager and deployment files

Options:
  --domain HOST              HTTPS domain for the initial installation
  --library PATH             Existing music directory, mounted read-only
  --owner NAME               Owner username
  --version latest|v1.2.3    Container image version (default: latest)
  --build                    Install using local source builds
  --yes                      Skip confirmations; generate passwords
  -h, --help                 Show this help

No arguments: install, or open the interactive console for an existing deployment.
Without a TTY, an existing deployment defaults to read-only status.
Passwords are never accepted as arguments. Interactive password input is hidden.

EOF
}
while (($#)); do
  case "$1" in
    install|update|start|stop|restart|status|logs|recommendations|owner|reset|credentials|doctor|self-update)
      [[ -z $ACTION ]] || die 'Only one command can be specified.'; ACTION=$1; shift ;;
    on|off|once) [[ -z $MODE ]] || die 'Mode specified twice.'; MODE=$1; shift ;;
    --domain|--library|--owner|--version)
      (($# >= 2)) || die "$1 requires a value."
      case "$1" in --domain) DOMAIN=$2 ;; --library) LIBRARY=$2 ;; --owner) OWNER=$2 ;; --version) VERSION=$2 ;; esac
      shift 2 ;;
    --yes) YES=true; shift ;; --build) BUILD=true; shift ;; -f|--follow) FOLLOW=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) if [[ $ACTION == logs && -z $SERVICE && $1 =~ ^[a-z][a-z0-9-]*$ ]]; then SERVICE=$1; shift
       else die "Unknown argument: $1 (see --help)."; fi ;;
  esac
done

# Read dotenv as data, never as executable shell code.
cfg_get() {
  local key=$1 fallback=${2:-} line value='' found=false
  if [[ -f $ENV_FILE ]]; then
    while IFS= read -r line || [[ -n $line ]]; do
      line=${line#$'\xef\xbb\xbf'}; line=${line%$'\r'}
      if [[ $line == "$key="* ]]; then value=${line#*=}; found=true; fi
    done < "$ENV_FILE"
  fi
  if [[ $found == false ]]; then printf '%s' "$fallback"; return; fi
  if [[ $value == \'*\' ]]; then value=${value:1:${#value}-2}; value=${value//\\\'/\'}
  elif [[ $value == \"*\" ]]; then value=${value:1:${#value}-2}; fi
  printf '%s' "$value"
}
backup() {
  mkdir -p -- "$STATE/backups"
  local destination
  destination=$(mktemp -d "$STATE/backups/$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")
  [[ ! -f $ENV_FILE ]] || cp -p -- "$ENV_FILE" "$destination/.env"
  printf '%s' "$destination"
}
cfg_set() {
  local key=$1 value=$2 line temporary found=false
  [[ $key =~ ^[A-Z][A-Z0-9_]*$ && $value != *$'\n'* && $value != *$'\r'* ]] || die 'Invalid configuration value.'
  value=${value//\'/\\\'}
  temporary=$(mktemp "$ENV_FILE.tmp.XXXXXX")
  while IFS= read -r line || [[ -n $line ]]; do
    line=${line#$'\xef\xbb\xbf'}; line=${line%$'\r'}
    if [[ $line == "$key="* ]]; then
      if [[ $found == false ]]; then printf "%s='%s'\n" "$key" "$value"; fi
      found=true
    else printf '%s\n' "$line"; fi
  done < "$ENV_FILE" > "$temporary"
  [[ $found == true ]] || printf "%s='%s'\n" "$key" "$value" >> "$temporary"
  chmod 600 "$temporary"; mv -f -- "$temporary" "$ENV_FILE"
}
ask() {
  local answer
  if [[ $YES == true ]]; then printf '%s' "$2"; return; fi
  [[ -t 0 ]] || die 'Use a terminal or provide options with --yes.'
  read -r -p "$1 [$2]: " answer || die 'Input cancelled.'
  printf '%s' "${answer:-$2}"
}
confirm() {
  [[ $YES != true ]] || return 0
  local answer
  [[ -t 0 ]] || die 'This action requires a terminal or --yes.'
  read -r -p "$1 [y/N]: " answer
  [[ $answer == y || $answer == Y || $answer == yes ]]
}
secret() { od -An -N "$1" -tx1 /dev/urandom | tr -d ' \n'; }
password() {
  local first second
  if [[ $YES == true ]]; then secret 12; return; fi
  [[ -t 0 ]] || die 'Password input requires a terminal.'
  read -r -s -p 'New password (Enter to generate): ' first || die 'Input cancelled.'
  printf '\n' >&2
  if [[ -z $first ]]; then secret 12; return; fi
  read -r -s -p 'Confirm password: ' second || die 'Input cancelled.'
  printf '\n' >&2
  [[ $first == "$second" ]] || die 'Passwords do not match.'
  local bytes
  bytes=$(printf '%s' "$first" | wc -c | tr -d ' ')
  ((${#first} >= 8 && bytes <= 72)) || die 'Password must contain at least 8 characters and at most 72 UTF-8 bytes.'
  printf '%s' "$first"
}
validate_owner() { [[ $1 =~ ^[a-z0-9][a-z0-9._-]{4,19}$ ]] || die 'Username: 5-20 characters using a-z, 0-9, ., _, -; start with a letter or digit.'; }
normalize_version() {
  [[ $1 == latest || $1 =~ ^v?[0-9]+\.[0-9]+\.[0-9]+([.-][a-zA-Z0-9.-]+)?$ ]] || die 'Use latest or a version such as v1.2.3.'
  printf '%s' "${1#v}"
}
require_install() { [[ -f $ENV_FILE ]] || die 'Run ./caimack.sh install first.'; }
require_docker() {
  command -v docker >/dev/null || die 'Install Docker: https://docs.docker.com/engine/install/'
  docker compose version >/dev/null 2>&1 || die 'Docker Compose v2 is required.'
  docker info >/dev/null 2>&1 || die 'Docker is not running or its socket is inaccessible.'
}
compose_files() {
  local list file files=()
  list=$(cfg_get COMPOSE_FILE 'docker-compose.yml:docker-compose.images.yml')
  COMPOSE=(docker compose --env-file "$ENV_FILE")
  IFS=: read -r -a files <<< "$list"
  for file in "${files[@]}"; do [[ -f $file ]] || die "Compose file not found: $file"; COMPOSE+=(-f "$file"); done
}
compose() { compose_files; "${COMPOSE[@]}" "$@"; }
module_enabled() { [[ :$(cfg_get COMPOSE_FILE): == *":$MODULE:"* || :$(cfg_get COMPOSE_FILE): == *":./$MODULE:"* ]]; }
amd_enabled() { [[ :$(cfg_get COMPOSE_FILE): == *":$AMD_MODULE:"* || :$(cfg_get COMPOSE_FILE): == *":./$AMD_MODULE:"* ]]; }
detect_gpu() {
  local requested devices='' path vendor class names
  requested=$(cfg_get MERT_GPU_BACKEND auto)
  case "$requested" in
    nvidia|amd) printf '%s' "$requested"; return ;;
    auto) ;;
    *) die 'MERT_GPU_BACKEND must be auto, nvidia or amd.' ;;
  esac
  # A working NVIDIA driver is also detectable without PCI utilities (e.g. WSL).
  if command -v nvidia-smi >/dev/null && names=$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null) && [[ -n $names ]]; then
    printf nvidia; return
  fi
  if command -v lspci >/dev/null; then
    devices=$(lspci -Dn 2>/dev/null) || devices=''
  fi
  # sysfs is available on Linux even when pciutils is not installed.
  if [[ -z $devices ]]; then
    for path in /sys/bus/pci/devices/*; do
      [[ -r $path/vendor && -r $path/class ]] || continue
      read -r vendor < "$path/vendor"; read -r class < "$path/class"
      [[ $class == 0x03* ]] || continue
      devices+="sysfs 0300: ${vendor#0x}:0000"$'\n'
    done
  fi
  # Prefer NVIDIA when both vendors are present; operators can override in .env.
  if [[ $devices =~ 03[0-9a-fA-F]{2}:[[:space:]]+10de: ]]; then printf nvidia
  elif [[ $devices =~ 03[0-9a-fA-F]{2}:[[:space:]]+1002: ]]; then printf amd
  else die 'No NVIDIA or AMD GPU detected. Check host drivers or set MERT_GPU_BACKEND=nvidia/amd for a remote Docker host.'; fi
}
configure_amd_groups() {
  [[ $(uname -s) == Linux ]] || die 'The AMD MERT container requires a Linux Docker host with ROCm support.'
  local kfd render device
  kfd=$(cfg_get MERT_KFD_GID)
  render=$(cfg_get MERT_RENDER_GID)
  if [[ -z $kfd ]]; then
    kfd=$(stat -c '%g' /dev/kfd 2>/dev/null) || die 'AMD /dev/kfd is missing. Install a compatible amdgpu driver or set host device group IDs for remote Docker.'
  fi
  if [[ -z $render ]]; then
    for device in /dev/dri/renderD*; do
      render=$(stat -c '%g' "$device" 2>/dev/null) && break
    done
  fi
  [[ $kfd =~ ^[0-9]+$ && $render =~ ^[0-9]+$ ]] || die 'Set numeric MERT_KFD_GID and MERT_RENDER_GID for the host AMD devices.'
  cfg_set MERT_KFD_GID "$kfd"; cfg_set MERT_RENDER_GID "$render"
}
set_module() {
  local list file joined='' files=()
  list=$(cfg_get COMPOSE_FILE 'docker-compose.yml:docker-compose.images.yml')
  IFS=: read -r -a files <<< "$list"
  for file in "${files[@]}"; do
    [[ $file == "$MODULE" || $file == "./$MODULE" || $file == "$AMD_MODULE" || $file == "./$AMD_MODULE" ]] && continue
    joined+="${joined:+:}$file"
  done
  [[ $1 == false ]] || joined+=":$MODULE"
  if [[ $1 != false && ${2:-nvidia} == amd ]]; then joined+=":$AMD_MODULE"; fi
  cfg_set COMPOSE_FILE "$joined"
}
fetch() { curl --fail --silent --show-error --location --retry 3 --connect-timeout 15 --max-time 180 "$1" -o "$2"; }
release_ref() {
  local wanted metadata tag
  wanted=$(normalize_version "${VERSION:-$(cfg_get CAIMACK_VERSION latest)}")
  if [[ $wanted != latest ]]; then printf 'v%s' "$wanted"; return; fi
  metadata=$(mktemp "$STATE/release.XXXXXX")
  fetch "https://api.github.com/repos/$REPOSITORY/tags?per_page=100" "$metadata" || { rm -f -- "$metadata"; return 1; }
  tag=$(sed -n 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$metadata" |
    awk '/^v[0-9]+\.[0-9]+\.[0-9]+$/' | sort -Vr | sed -n '1p')
  rm -f -- "$metadata"
  [[ $tag =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || die 'Could not resolve a stable version tag.'
  printf '%s' "$tag"
}
download_files() {
  command -v curl >/dev/null || die 'curl is required to download deployment files.'
  mkdir -p "$STATE"
  local ref destination file
  ref=$(release_ref)
  STAGING=$(mktemp -d "$STATE/download.XXXXXX")
  local assets=(.env.example docker-compose.yml docker-compose.images.yml "$MODULE" "$AMD_MODULE" deploy/Caddyfile caimack.sh setup.sh)
  for file in "${assets[@]}"; do
    mkdir -p -- "$STAGING/$(dirname -- "$file")"
    fetch "https://raw.githubusercontent.com/$REPOSITORY/$ref/$file" "$STAGING/$file" || die "Could not download $file from $ref. Existing files were preserved."
  done
  bash -n "$STAGING/caimack.sh"; bash -n "$STAGING/setup.sh"
  if [[ -f $ENV_FILE ]]; then
    cp -- "$ENV_FILE" "$STAGING/.env"
    docker compose --env-file "$STAGING/.env" -f "$STAGING/docker-compose.yml" -f "$STAGING/docker-compose.images.yml" -f "$STAGING/$MODULE" config --quiet
    MERT_KFD_GID=0 MERT_RENDER_GID=0 docker compose --env-file "$STAGING/.env" -f "$STAGING/docker-compose.yml" -f "$STAGING/docker-compose.images.yml" -f "$STAGING/$MODULE" -f "$STAGING/$AMD_MODULE" config --quiet
  fi
  destination=$(backup)
  for file in "${assets[@]}"; do
    if [[ -f $file ]]; then mkdir -p -- "$destination/$(dirname -- "$file")"; cp -p -- "$file" "$destination/$file"; fi
    mkdir -p -- "$(dirname -- "$file")"; mv -f -- "$STAGING/$file" "$file"
  done
  chmod 755 caimack.sh setup.sh
  rm -f -- "$STAGING/.env"; rmdir "$STAGING/deploy" "$STAGING"; STAGING=''
  touch "$STATE/managed"
  ok "Deployment files updated to $ref. Backup: ${destination#"$ROOT/"}"
}
heading() {
  printf '\n  %s▂▄▆█▆▄▂  caimack%s  %s/ server console%s\n\n' "$ACCENT" "$NORMAL" "$DIM" "$NORMAL"
}
section() { printf '  %s── %-14s ────────────────────────────────────%s\n' "$DIM" "$1" "$NORMAL"; }
runtime_snapshot() {
  DOCKER_READY=false; RUNTIME=''
  if command -v docker >/dev/null && docker info >/dev/null 2>&1; then
    if RUNTIME=$(compose ps --format '{{.Service}}|{{.State}}|{{.Health}}'); then DOCKER_READY=true; fi
  fi
}
deployment_panel() {
  section deployment
  if [[ ! -f $ENV_FILE ]]; then printf '  No deployment yet. Run: ./caimack.sh install\n\n'; return; fi
  local reset='disarmed' recs='off / CPU only' reset_color=$DIM recs_color=$DIM
  if module_enabled; then
    recs='on / NVIDIA + MERT'; recs_color=$GREEN
    if amd_enabled; then recs='on / AMD + MERT'; fi
  fi
  if [[ $(cfg_get OWNER_RESET_PASSWORD false) == true ]]; then reset='ARMED / every startup'; reset_color=$RED; fi
  printf '  %-16s %s\n' endpoint "https://$(cfg_get PUBLIC_DOMAIN)"
  printf '  %-16s %-20.20s %-9s %s\n' release "$(cfg_get CAIMACK_VERSION latest)" owner "$(cfg_get OWNER_USERNAME admin)"
  if [[ $COMPACT == true ]]; then
    printf '  %-16s %s%-20s%s reset     %s%s%s\n\n' recommendations "$recs_color" "$recs" "$NORMAL" "$reset_color" "$reset" "$NORMAL"
  else
    printf '  %-16s %s%s%s\n' recommendations "$recs_color" "$recs" "$NORMAL"
    printf '  %-16s %s%s%s\n\n' 'password reset' "$reset_color" "$reset" "$NORMAL"
  fi
}
runtime_panel() {
  section runtime
  if [[ $DOCKER_READY == false ]]; then printf '  %sDocker unavailable%s  ·  displaying saved configuration\n\n' "$YELLOW" "$NORMAL"; return; fi
  if [[ -z $RUNTIME ]]; then printf '  %sNo running containers. Press s to start.%s\n\n' "$DIM" "$NORMAL"; return; fi
  local service state health color count=0 limit=6
  [[ $COMPACT == false ]] || limit=2
  while IFS='|' read -r service state health; do
    [[ -n $service ]] || continue
    if ((count >= limit)); then printf '  %sMore services: ./caimack.sh status%s\n' "$DIM" "$NORMAL"; break; fi
    color=$DIM
    case "$state/$health" in running/healthy|running/) color=$GREEN ;; */unhealthy|dead/*) color=$RED ;; running/*|restarting/*) color=$YELLOW ;; esac
    printf '  %-20.20s %s%-12.12s%s %s\n' "$service" "$color" "$state" "$NORMAL" "${health:--}"
    count=$((count + 1))
  done <<< "$RUNTIME"
  printf '\n'
}
status() {
  heading; deployment_panel
  [[ -f $ENV_FILE ]] || return 0
  require_install; runtime_snapshot
  # CLI status is unrestricted; the compact dashboard limits its runtime rows.
  if [[ $DOCKER_READY == true ]]; then compose ps; else runtime_panel; fi
}
apply() {
  info 'Reconciling deployment; waiting for healthy application services...'
  compose config --quiet
  if (($# == 0)) && module_enabled; then
    # Weight downloads can take much longer than application startup.
    compose up -d
    compose up -d --no-deps --wait --wait-timeout 180 backend frontend postgres caddy
    info 'MERT loads in the background. Follow progress with: ./caimack.sh logs mert -f'
  else compose up -d --wait --wait-timeout 180 "$@"; fi
}
acquire_images() {
  info 'Acquiring container images...'
  if [[ $BUILD == true || $(cfg_get COMPOSE_FILE) != *docker-compose.images.yml* ]]; then
    [[ -d backend && -d frontend ]] || die 'Source builds require backend/ and frontend/ directories.'; compose build
  else
    compose pull --ignore-buildable || return
    # AMD restores build metadata after images.yml for optional source builds.
    # Release deployments must explicitly pull this buildable GPU service too.
    if amd_enabled; then compose pull mert; fi
  fi
}
credentials() {
  require_install
  printf 'Owner: %s\nPassword in .env: %s\n' "$(cfg_get OWNER_USERNAME)" "$(cfg_get OWNER_PASSWORD)"
  printf 'This value may be outdated if the password was changed in the app.\n'
}
install() {
  [[ ! -e $ENV_FILE ]] || die '.env already exists. Use start or update; existing secrets will not be overwritten.'
  heading; section bootstrap
  info 'CPU deployment by default. Recommendations can be enabled later.'
  require_docker
  [[ -f .env.example && -f docker-compose.yml && -f docker-compose.images.yml ]] || download_files
  DOMAIN=$(ask 'Domain' "${DOMAIN:-localhost}")
  [[ $DOMAIN =~ ^[A-Za-z0-9][A-Za-z0-9.-]*$ ]] || die 'Enter a domain without a scheme, port or path.'
  LIBRARY=$(ask 'Music library directory (read-only)' "${LIBRARY:-./library}")
  if [[ $LIBRARY == ./library ]]; then mkdir -p library
  else [[ -d $LIBRARY ]] || die "Music library directory not found: $LIBRARY"; LIBRARY=$(cd -- "$LIBRARY" && pwd); fi
  OWNER=$(ask 'Admin username' "${OWNER:-admin}"); validate_owner "$OWNER"
  local initial_password list
  initial_password=$(password)
  cp -- .env.example "$ENV_FILE"; chmod 600 "$ENV_FILE"
  cfg_set POSTGRES_PASSWORD "$(secret 24)"; cfg_set JWT_SIGNING_KEY "$(secret 48)"
  cfg_set OWNER_USERNAME "$OWNER"; cfg_set OWNER_PASSWORD "$initial_password"; cfg_set OWNER_RESET_PASSWORD false
  cfg_set PUBLIC_DOMAIN "$DOMAIN"; cfg_set MUSIC_LIBRARY_PATH "$LIBRARY"
  cfg_set PUID "$(id -u)"; cfg_set PGID "$(id -g)"
  cfg_set CAIMACK_VERSION "$(normalize_version "${VERSION:-latest}")"
  list='docker-compose.yml:docker-compose.images.yml'; [[ $BUILD != true ]] || list='docker-compose.yml'
  cfg_set COMPOSE_FILE "$list"
  acquire_images; apply; ok "Installation ready: https://$DOMAIN"
  if [[ -t 1 ]]; then credentials; else info 'Admin credentials saved in .env (readable only by the file owner).'; fi
}
update() {
  require_install; require_docker
  confirm 'Download updates and reconcile changed services?' || return 0
  backup >/dev/null
  [[ ! -f $STATE/managed ]] || download_files
  [[ -z $VERSION ]] || cfg_set CAIMACK_VERSION "$(normalize_version "$VERSION")"
  acquire_images; apply; ok 'Update applied. Library, database and settings preserved.'
}
recommendations() {
  require_install; require_docker
  case "$MODE" in on|off) ;; *) die 'Use recommendations on or off.' ;; esac
  if [[ $MODE == on ]]; then
    [[ -f $MODULE ]] || die "$MODULE is missing. Run self-update to refresh deployment files."
    confirm 'Enable recommendations? Requires an NVIDIA or ROCm-compatible AMD GPU and about 1.26 GB of model weights.' || return 0
    local backend
    backend=$(detect_gpu)
    info "Selected MERT GPU backend: $backend"
    [[ $backend != amd || -f $AMD_MODULE ]] || die "$AMD_MODULE is missing. Run self-update to refresh deployment files."
    GPU_ROLLBACK="$(backup)/.env"
    if [[ $backend == amd ]]; then configure_amd_groups; fi
    set_module true "$backend"
    if ! acquire_images; then die 'GPU image acquisition failed.'; fi
    # Run kernels, not just enumeration: unsupported GPU architectures can enumerate.
    # No model download or writable cache is needed for this probe.
    if ! compose run --rm --no-deps --entrypoint python mert -c 'import torch; assert torch.cuda.is_available(), "CUDA/ROCm is unavailable"; x = torch.ones((32, 32), device="cuda"); y = x @ x; z = torch.nn.functional.conv1d(x[:1].reshape(1, 1, 32), x[:1, :3].reshape(1, 1, 3)); torch.cuda.synchronize(); assert y[0, 0].item() == 32 and z[0, 0, 0].item() == 3; print(torch.cuda.get_device_name(0), "ROCm" if torch.version.hip else "CUDA")'; then
      die 'GPU unavailable or unsupported. Check the driver, CUDA/ROCm compatibility and Docker GPU access with doctor.'
    fi
    apply; GPU_ROLLBACK=''; ok 'Recommendations enabled. Analysis starts after the weights finish loading.'
  else
    confirm 'Disable recommendations? Cached weights and embeddings will be preserved.' || return 0
    backup >/dev/null; compose --profile recommendations stop mert mert-init
    set_module false; apply; ok 'Recommendations disabled. Reload the web app or restart the Android client.'
  fi
}
reset_password() {
  require_install; require_docker
  case "$MODE" in on|off|once) ;; *) die 'Use reset on, off or once.' ;; esac
  if [[ $MODE == off ]]; then backup >/dev/null; cfg_set OWNER_RESET_PASSWORD false; apply --no-deps backend; ok 'Password reset on startup disabled.'; return; fi
  confirm "Reset the password for $(cfg_get OWNER_USERNAME)? Their sessions will be revoked." || return 0
  local value
  value=$(password); backup >/dev/null; cfg_set OWNER_PASSWORD "$value"
  [[ $MODE != once ]] || RESET_PENDING=true
  cfg_set OWNER_RESET_PASSWORD true; apply --no-deps backend
  if [[ $MODE == once ]]; then
    cfg_set OWNER_RESET_PASSWORD false; apply --no-deps backend; RESET_PENDING=false
    ok 'Password changed. Automatic reset on startup is disabled.'
  else warn 'Reset ARMED: every backend startup will restore this password and revoke sessions.'; fi
  if [[ -t 1 ]]; then credentials; fi
}
owner() {
  require_install; require_docker
  local target value
  target=$(ask 'Owner username' "${OWNER:-$(cfg_get OWNER_USERNAME admin)}"); validate_owner "$target"
  printf 'An existing account will be promoted to admin; a missing account will be created.\nThe previous account and its permissions remain. Manage them in the Users page.\n'
  confirm "Set $target as the owner and assign a new password?" || return 0
  value=$(password); backup >/dev/null; cfg_set OWNER_USERNAME "$target"; cfg_set OWNER_PASSWORD "$value"
  RESET_PENDING=true; cfg_set OWNER_RESET_PASSWORD true; apply --no-deps backend
  cfg_set OWNER_RESET_PASSWORD false; apply --no-deps backend; RESET_PENDING=false
  ok "Owner: $target. Password reset on startup disabled."
  if [[ -t 1 ]]; then credentials; fi
}

doctor() {
  heading; command -v docker >/dev/null || die 'Docker is not installed.'
  docker version; docker compose version
  if [[ -f $ENV_FILE ]]; then compose config --quiet; ok 'Compose configuration is valid.'; fi
  if command -v nvidia-smi >/dev/null; then nvidia-smi; else info 'nvidia-smi not found. The standard deployment does not require a GPU.'; fi
  if command -v rocminfo >/dev/null; then rocminfo; fi
  if [[ -e /dev/kfd ]]; then ls -ln /dev/kfd /dev/dri/renderD*; fi
  if [[ -f $ENV_FILE ]]; then info "MERT GPU preference: $(cfg_get MERT_GPU_BACKEND auto)"; fi
  docker info --format 'Docker runtimes: {{json .Runtimes}}'
  printf 'NVIDIA Container Toolkit: https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html\n'
  printf 'AMD ROCm Docker setup: https://rocm.docs.amd.com/projects/install-on-linux/en/latest/how-to/docker.html\n'
}

cleanup() {
  local result=$?
  trap - EXIT
  if [[ -n $GPU_ROLLBACK ]]; then
    cp -p -- "$GPU_ROLLBACK" "$ENV_FILE"
    warn 'Previous configuration restored after unsuccessful GPU enablement.'
  fi
  if [[ $RESET_PENDING == true ]]; then
    cfg_set OWNER_RESET_PASSWORD false || true
    warn 'One-time reset interrupted. Disarming reset and recreating the backend with normal configuration.'
    compose up -d --no-deps backend || warn 'Could not recreate the backend. Run: ./caimack.sh reset off'
  fi
  if [[ -n $STAGING ]]; then warn "Incomplete download retained in ${STAGING#"$ROOT/"}."; fi
  if ((result != 0)); then warn 'Operation failed. Check status and logs; configuration backups are in .caimack/backups/.'; fi
  exit "$result"
}
trap cleanup EXIT
menu() {
  local selected=0 key sequence index toggle reset_toggle rows
  local labels=('Start services' 'Enable recommendations' 'Stop services' 'Change owner'
    'Restart services' 'Reset password once' 'Pull updates' 'Arm password reset'
    'Follow logs' 'Update manager' 'Run diagnostics' 'Show credentials' 'Quit')
  local keys=(s m x a r p u t l i d c q)
  while true; do
    rows=${LINES:-$(tput lines 2>/dev/null || printf 24)}
    COMPACT=false; if [[ $rows =~ ^[0-9]+$ ]] && ((rows < 32)); then COMPACT=true; fi
    runtime_snapshot
    toggle=on; labels[1]='Enable recommendations'
    if module_enabled; then toggle=off; labels[1]='Disable recommendations'; fi
    reset_toggle=on; labels[7]='Arm password reset'
    if [[ $(cfg_get OWNER_RESET_PASSWORD false) == true ]]; then reset_toggle=off; labels[7]='Disarm password reset'; fi
    while true; do
      if [[ ${TERM:-dumb} != dumb ]]; then printf '\033[H\033[2J'; fi
      heading; deployment_panel; runtime_panel
      section controls
      for ((index=0; index<12; index+=2)); do
        menu_cell "$index" "$selected" "${keys[index]}" "${labels[index]}"
        menu_cell "$((index + 1))" "$selected" "${keys[index + 1]}" "${labels[index + 1]}"
        printf '\n'
      done
      menu_cell 12 "$selected" q Quit; printf '\n\n'
      printf '  %s↑↓ / jk select   ←→ column   Enter run   g refresh%s\n' "$DIM" "$NORMAL"
      printf '  %scaimack%s › ' "$ACCENT" "$NORMAL"
      IFS= read -r -s -n 1 key || return 0
      case "$key" in
        $'\033')
          sequence=''; IFS= read -r -s -n 2 -t 0.15 sequence || true
          case "$sequence" in '[A') key=k ;; '[B') key=j ;; '[C') key='>' ;; '[D') key='<' ;; *) continue ;; esac ;;
      esac
      case "$key" in
        k) if ((selected == 12)); then selected=10; else selected=$(((selected + 10) % 12)); fi; continue ;;
        j) if ((selected >= 10)); then selected=$((selected == 12 ? 0 : 12)); else selected=$((selected + 2)); fi; continue ;;
        '>') if ((selected < 12)); then selected=$((selected % 2 == 0 ? selected + 1 : selected)); fi; continue ;;
        '<') if ((selected < 12)); then selected=$((selected % 2 == 1 ? selected - 1 : selected)); fi; continue ;;
        g) break ;; q|0) printf '\n'; return 0 ;;
        '') key=${keys[selected]} ;;
      esac
      case "$key" in s|x|r|u|l|d|m|a|p|t|i|c) ;; *) continue ;; esac
      printf '\n\n'
      # Isolate errors in child processes so failed actions do not close the console.
      case "$key" in
        s) bash "$ROOT/caimack.sh" start || true ;; x) bash "$ROOT/caimack.sh" stop || true ;;
        r) bash "$ROOT/caimack.sh" restart || true ;; u) bash "$ROOT/caimack.sh" update || true ;;
        l) bash "$ROOT/caimack.sh" logs -f || true ;; d) bash "$ROOT/caimack.sh" doctor || true ;;
        m) bash "$ROOT/caimack.sh" recommendations "$toggle" || true ;;
        a) bash "$ROOT/caimack.sh" owner || true ;; p) bash "$ROOT/caimack.sh" reset once || true ;;
        t) bash "$ROOT/caimack.sh" reset "$reset_toggle" || true ;; i) bash "$ROOT/caimack.sh" self-update || true ;;
        c) bash "$ROOT/caimack.sh" credentials || true ;;
      esac
      read -r -p '  Press Enter to return to the console... ' key || return 0
      break
    done
  done
}
menu_cell() {
  local index=$1 selected=$2 key=$3 label=$4
  if ((index == selected)); then printf '  %s> [%s] %-27s%s' "$FOCUS" "$key" "$label" "$NORMAL"
  else printf '  %s  [%s]%s %-27s' "$DIM" "$key" "$NORMAL" "$label"; fi
}
if [[ -z $ACTION ]]; then
  if [[ ! -f $ENV_FILE ]]; then ACTION=install
  elif [[ -t 0 && $YES == false ]]; then menu; exit 0
  else ACTION=status; fi
fi
if [[ -n $VERSION ]]; then VERSION=$(normalize_version "$VERSION"); fi
if [[ -n $MODE && $ACTION != recommendations && $ACTION != reset ]]; then die 'on/off/once can only be used with recommendations or reset.'; fi
if [[ $BUILD == true && $ACTION != install ]]; then die '--build is an install option; updates preserve the original deployment mode.'; fi
case "$ACTION" in
  install) install ;; update) update ;; recommendations) recommendations ;; reset) reset_password ;; owner) owner ;;
  status) status ;; credentials) credentials ;; doctor) doctor ;;
  self-update)
    require_docker
    confirm 'Update caimack.sh and deployment files from a release? Local versions will be backed up.' || exit 0
    download_files; info 'Restart caimack.sh to use the updated manager.' ;;
  start|restart) require_install; require_docker; if [[ $ACTION == restart ]]; then compose restart; else apply; fi ;;
  stop) require_install; require_docker; compose stop ;;
  logs) require_install; require_docker; args=(logs --tail 100); [[ $FOLLOW == false ]] || args+=(-f); [[ -z $SERVICE ]] || args+=("$SERVICE"); compose "${args[@]}" ;;
esac
