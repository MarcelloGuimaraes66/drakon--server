#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$script_dir"
web_dir="$repo_root/DrakonSite"
perceptrum_dir="$repo_root/Perceptrum"

node_version="${NODE_VERSION:-v22.22.3}"
node_root="${NODE_ROOT:-$HOME/toolchains/node-$node_version-linux-x64}"
node_bin="$node_root/bin"
build_type="${BUILD_TYPE:-Debug}"
build_name="$(printf '%s' "$build_type" | tr '[:upper:]' '[:lower:]')"
build_dir="${BUILD_DIR:-$perceptrum_dir/out/build/linux-$build_name}"
desktop_bin="$build_dir/perceptrum-desktop"
agent_bin="$build_dir/perceptrum-agent"
backend_runtime="$build_dir/linux-backend-runtime/perceptrum-local-backend.sh"
web_dist="$web_dir/dist"
backend_log="${BACKEND_LOG:-$HOME/perceptrum-backend.log}"
backend_port="${PORT:-4010}"
app_base_url="${APP_BASE_URL:-http://127.0.0.1:$backend_port}"
window_mode="${PERCEPTRUM_LINUX_WINDOW_MODE:-browser}"
reuse_backend="${PERCEPTRUM_REUSE_BACKEND:-0}"

runtime_data_root="${APP_RUNTIME_DATA_ROOT:-$HOME/.local/share/PerceptrumData}"
runtime_config_root="${APP_RUNTIME_CONFIG_ROOT:-${XDG_CONFIG_HOME:-$HOME/.config}/Perceptrum}"
runtime_cache_root="${APP_RUNTIME_CACHE_ROOT:-${XDG_CACHE_HOME:-$HOME/.cache}/Perceptrum}"
runtime_state_root="${APP_RUNTIME_STATE_ROOT:-${XDG_STATE_HOME:-$HOME/.local/state}/Perceptrum}"
runtime_log_root="${APP_RUNTIME_LOG_ROOT:-$runtime_state_root/logs}"
storage_root="${STORAGE_ROOT:-$runtime_data_root}"
sqlite_db_path="${SQLITE_DB_PATH:-$storage_root/storage/sqlite/local-site/perceptrum_site.sqlite}"

print_step() {
  printf '\n==> %s\n' "$1"
}

print_usage() {
  cat <<'EOF'
Uso:
  ./run-drakon-server.sh
  ./run-drakon-server.sh gui
  ./run-drakon-server.sh backend
  ./run-drakon-server.sh check
  ./run-drakon-server.sh status
  ./run-drakon-server.sh stop

Modos:
  gui      inicia o perceptrum-desktop e abre a UI via browser
  backend  sobe somente o backend local em background
  check    sobe/verifica backend e imprime health/status
  status   mostra status do backend atual
  stop     encerra o backend local atual

Variaveis uteis:
  PORT=4010
  APP_BASE_URL=http://127.0.0.1:4010
  BUILD_TYPE=Debug
  BUILD_DIR=/caminho/customizado
  NODE_ROOT=$HOME/toolchains/node-v22.22.3-linux-x64
  PERCEPTRUM_LINUX_WINDOW_MODE=browser|webkit|auto
  PERCEPTRUM_REUSE_BACKEND=1
EOF
}

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

require_file() {
  local file_path="$1"
  local label="$2"
  [[ -f "$file_path" ]] || fail "Arquivo nao encontrado: $file_path ($label). Rode ./build-drakon-server.sh antes."
}

warn_if_missing_runtime_env() {
  if [[ ! -f "$web_dir/.env.local" ]]; then
    printf 'Aviso: %s/.env.local nao existe. O backend sobe, mas login/auth central podem falhar.\n' "$web_dir" >&2
    printf 'Use DrakonSite/.env.local.example como base e mantenha os segredos fora do Git.\n' >&2
  fi

  if [[ ! -f "$web_dir/.env.init" ]]; then
    printf 'Aviso: %s/.env.init nao existe. O runtime vai usar os defaults atuais.\n' "$web_dir" >&2
    printf 'Use DrakonSite/.env.init.example como base se quiser fixar o perfil.\n' >&2
  fi
}

setup_common_env() {
  [[ -x "$node_bin/node" ]] || fail "Node local nao encontrado em $node_root. Rode ./build-drakon-server.sh antes."
  require_file "$desktop_bin" "perceptrum-desktop"
  require_file "$agent_bin" "perceptrum-agent"
  require_file "$backend_runtime" "backend runtime"
  require_file "$web_dist/index.html" "DrakonSite dist"

  export PATH="$node_bin:$PATH"
  export APP_RUNTIME_ENV="${APP_RUNTIME_ENV:-local}"
  export APP_DB_BACKEND="${APP_DB_BACKEND:-sqlite}"
  export APP_ALLOW_PLAINTEXT_SECRET_RECOVERY="${APP_ALLOW_PLAINTEXT_SECRET_RECOVERY:-1}"
  export APP_RUNTIME_DATA_ROOT="$runtime_data_root"
  export APP_RUNTIME_CONFIG_ROOT="$runtime_config_root"
  export APP_RUNTIME_CACHE_ROOT="$runtime_cache_root"
  export APP_RUNTIME_STATE_ROOT="$runtime_state_root"
  export APP_RUNTIME_LOG_ROOT="$runtime_log_root"
  export STORAGE_ROOT="$storage_root"
  export SQLITE_DB_PATH="$(realpath -m "$sqlite_db_path")"
  export APP_STATIC_ROOT="$web_dist"
  export PERCEPTRUM_WEB_SOURCE_DIR="$web_dir"
  export PERCEPTRUM_BACKEND_COMMAND="$backend_runtime"
  export PERCEPTRUM_LINUX_WINDOW_MODE="$window_mode"
  export PERCEPTRUM_LINUX_HOST=1
  export PORT="$backend_port"
  export APP_BASE_URL="$app_base_url"
}

backend_health_url() {
  printf '%s/api/runtime/health' "$APP_BASE_URL"
}

agent_health_url() {
  printf '%s/api/runtime/agent-health' "$APP_BASE_URL"
}

find_backend_pids_on_port() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true
    return
  fi

  if command -v fuser >/dev/null 2>&1; then
    fuser -n tcp "$PORT" 2>/dev/null | tr ' ' '\n' | sed '/^$/d' || true
    return
  fi

  true
}

stop_owned_backends() {
  local stopped=0
  local pid=""
  local env_dump=""
  local cmdline=""

  for pid in $(find_backend_pids_on_port); do
    [[ "$pid" =~ ^[0-9]+$ ]] || continue
    [[ -r "/proc/$pid/environ" ]] || continue
    env_dump="$(tr '\0' '\n' < "/proc/$pid/environ" 2>/dev/null || true)"
    cmdline="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
    if grep -q '^PERCEPTRUM_LINUX_HOST=1$' <<<"$env_dump" || grep -q 'desktop-local-server' <<<"$cmdline"; then
      printf 'Encerrando backend local na porta %s (pid %s)\n' "$PORT" "$pid"
      kill -TERM "$pid" 2>/dev/null || true
      for _ in {1..25}; do
        kill -0 "$pid" 2>/dev/null || break
        sleep 0.1
      done
      kill -KILL "$pid" 2>/dev/null || true
      stopped=1
    fi
  done

  if [[ "$stopped" -eq 0 ]]; then
    printf 'Nenhum backend local encontrado na porta %s\n' "$PORT"
  fi
}

wait_for_backend_health() {
  local url
  url="$(backend_health_url)"

  for _ in {1..30}; do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  return 1
}

show_status() {
  print_step "Status"
  printf 'buildDir=%s\n' "$build_dir"
  printf 'webRoot=%s\n' "$web_dist"
  printf 'backendLog=%s\n' "$backend_log"
  printf 'appBaseUrl=%s\n' "$APP_BASE_URL"
  printf 'windowMode=%s\n' "$PERCEPTRUM_LINUX_WINDOW_MODE"

  echo "--- processos ---"
  ps -ef | grep -E 'perceptrum-desktop|perceptrum-agent|desktop-local-server.cjs' | grep -v grep || true

  echo "--- runtime health ---"
  curl -fsS "$(backend_health_url)" || true
  printf '\n'

  echo "--- agent health ---"
  curl -fsS "$(agent_health_url)" || true
  printf '\n'
}

read_env_value_from_pid() {
  local pid="$1"
  local key="$2"
  [[ -r "/proc/$pid/environ" ]] || return 1
  tr '\0' '\n' < "/proc/$pid/environ" 2>/dev/null | sed -n "s/^${key}=//p" | head -n 1
}

auto_detect_gui_session() {
  local pid=""
  local candidate=""
  local detected_display=""
  local detected_xauth=""
  local detected_dbus=""
  local detected_xdg=""

  if [[ -n "${DISPLAY:-}" && -n "${XDG_RUNTIME_DIR:-}" ]]; then
    return 0
  fi

  for candidate in gnome-shell gnome-session-binary xfce4-session plasmashell; do
    while read -r pid; do
      [[ -n "$pid" ]] || continue
      detected_display="$(read_env_value_from_pid "$pid" DISPLAY || true)"
      detected_xauth="$(read_env_value_from_pid "$pid" XAUTHORITY || true)"
      detected_dbus="$(read_env_value_from_pid "$pid" DBUS_SESSION_BUS_ADDRESS || true)"
      detected_xdg="$(read_env_value_from_pid "$pid" XDG_RUNTIME_DIR || true)"

      if [[ -n "$detected_display" && -n "$detected_xdg" ]]; then
        export DISPLAY="${DISPLAY:-$detected_display}"
        if [[ -n "$detected_xauth" ]]; then
          export XAUTHORITY="${XAUTHORITY:-$detected_xauth}"
        fi
        if [[ -n "$detected_dbus" ]]; then
          export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-$detected_dbus}"
        fi
        export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-$detected_xdg}"
        return 0
      fi
    done < <(pgrep -u "$(id -u)" "$candidate" 2>/dev/null || true)
  done

  return 1
}

start_backend() {
  setup_common_env
  warn_if_missing_runtime_env

  if [[ "$reuse_backend" == "1" ]] && curl -fsS "$(backend_health_url)" >/dev/null 2>&1; then
    print_step "Reutilizando backend local existente"
    printf 'backendHealth=%s\n' "$(backend_health_url)"
    printf 'agentHealth=%s\n' "$(agent_health_url)"
    return 0
  fi

  if [[ "$reuse_backend" != "1" ]]; then
    stop_owned_backends >/dev/null 2>&1 || true
  fi

  print_step "Subindo backend local"
  mkdir -p "$(dirname "$backend_log")"
  nohup "$backend_runtime" >"$backend_log" 2>&1 < /dev/null &
  printf 'backendPid=%s\n' "$!"
  printf 'backendLog=%s\n' "$backend_log"

  if wait_for_backend_health; then
    printf 'backendHealth=%s\n' "$(backend_health_url)"
    printf 'agentHealth=%s\n' "$(agent_health_url)"
    return 0
  fi

  printf 'Backend nao ficou saudavel. Ultimas linhas do log:\n' >&2
  tail -n 120 "$backend_log" >&2 || true
  exit 1
}

start_gui() {
  local -a desktop_args=()

  setup_common_env
  warn_if_missing_runtime_env
  auto_detect_gui_session || fail "Nao consegui detectar a sessao grafica. Exporte DISPLAY/XAUTHORITY/DBUS_SESSION_BUS_ADDRESS/XDG_RUNTIME_DIR e tente de novo."

  case "$PERCEPTRUM_LINUX_WINDOW_MODE" in
    browser)
      desktop_args+=(--browser)
      ;;
    webkit)
      desktop_args+=(--webkit)
      ;;
    auto)
      ;;
    *)
      fail "PERCEPTRUM_LINUX_WINDOW_MODE invalido: $PERCEPTRUM_LINUX_WINDOW_MODE"
      ;;
  esac

  print_step "Abrindo UI"
  printf 'display=%s\n' "${DISPLAY:-}"
  printf 'appBaseUrl=%s\n' "$APP_BASE_URL"
  exec "$desktop_bin" "${desktop_args[@]}"
}

run_check() {
  setup_common_env
  start_backend
  show_status
}

main() {
  local mode="${1:-gui}"

  case "$mode" in
    gui)
      shift || true
      start_gui "$@"
      ;;
    backend|backend-only)
      shift || true
      start_backend
      ;;
    check)
      shift || true
      run_check
      ;;
    status)
      shift || true
      setup_common_env
      show_status
      ;;
    stop)
      shift || true
      setup_common_env
      stop_owned_backends
      ;;
    help|-h|--help)
      print_usage
      ;;
    *)
      printf 'Modo invalido: %s\n\n' "$mode" >&2
      print_usage >&2
      exit 1
      ;;
  esac
}

main "$@"
