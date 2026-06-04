#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
perceptrum_dir="$(cd "$script_dir/.." && pwd)"
repo_root="$(cd "$perceptrum_dir/.." && pwd)"
web_dir="$repo_root/DrakonSite"
web_dist="$web_dir/dist"
build_dir="$perceptrum_dir/out/build/linux-debug"
desktop_bin="$build_dir/perceptrum-desktop"
backend_runtime="$build_dir/linux-backend-runtime/perceptrum-local-backend.sh"

runtime_data_root="${APP_RUNTIME_DATA_ROOT:-$HOME/.local/share/PerceptrumData}"
runtime_config_root="${APP_RUNTIME_CONFIG_ROOT:-${XDG_CONFIG_HOME:-$HOME/.config}/Perceptrum}"
runtime_cache_root="${APP_RUNTIME_CACHE_ROOT:-${XDG_CACHE_HOME:-$HOME/.cache}/Perceptrum}"
runtime_state_root="${APP_RUNTIME_STATE_ROOT:-${XDG_STATE_HOME:-$HOME/.local/state}/Perceptrum}"
runtime_log_root="${APP_RUNTIME_LOG_ROOT:-$runtime_state_root/logs}"
storage_root="${STORAGE_ROOT:-$runtime_data_root}"
sqlite_db_path="${SQLITE_DB_PATH:-$storage_root/storage/sqlite/local-site/perceptrum_site.sqlite}"

export APP_RUNTIME_DATA_ROOT="$runtime_data_root"
export APP_RUNTIME_CONFIG_ROOT="$runtime_config_root"
export APP_RUNTIME_CACHE_ROOT="$runtime_cache_root"
export APP_RUNTIME_STATE_ROOT="$runtime_state_root"
export APP_RUNTIME_LOG_ROOT="$runtime_log_root"
export STORAGE_ROOT="$storage_root"
export SQLITE_DB_PATH="$(realpath -m "$sqlite_db_path")"
export APP_ALLOW_PLAINTEXT_SECRET_RECOVERY="${APP_ALLOW_PLAINTEXT_SECRET_RECOVERY:-1}"

if ! command -v npm >/dev/null 2>&1; then
    echo "npm was not found. Install Node.js/npm before running this script." >&2
    exit 1
fi

if ! command -v cmake >/dev/null 2>&1; then
    echo "cmake was not found. On Ubuntu, install it with: sudo apt install cmake" >&2
    exit 1
fi

if ! command -v ninja >/dev/null 2>&1; then
    echo "ninja was not found. On Ubuntu, install it with: sudo apt install ninja-build" >&2
    exit 1
fi

if ! pkg-config --exists webkit2gtk-4.1; then
    echo "WebKitGTK 4.1 development files were not found." >&2
    echo "On Ubuntu, install them with: sudo apt install libwebkit2gtk-4.1-dev" >&2
    exit 1
fi

if [[ ! -f "$web_dist/index.html" ]]; then
    (cd "$web_dir" && npm run build)
fi

(cd "$perceptrum_dir" && cmake -S . -B "$build_dir" -G Ninja \
    -DCMAKE_BUILD_TYPE=Debug \
    -DPERCEPTRUM_ENABLE_AGENT_CORE=ON \
    -DPERCEPTRUM_ENABLE_CAMERA_CAPTURE=ON \
    -DPERCEPTRUM_ENABLE_RTSP_CAPTURE=ON \
    -DPERCEPTRUM_ENABLE_FRAME_WRITER=ON \
    -DPERCEPTRUM_ENABLE_JOB_RUNTIME=ON)
(cd "$perceptrum_dir" && cmake --build "$build_dir" -j"$(nproc)")

export APP_STATIC_ROOT="$web_dist"
export PERCEPTRUM_WEB_SOURCE_DIR="$web_dir"
export PERCEPTRUM_LINUX_WINDOW_MODE="${PERCEPTRUM_LINUX_WINDOW_MODE:-webkit}"
if [[ -z "${PERCEPTRUM_BACKEND_COMMAND:-}" && -x "$backend_runtime" ]]; then
    export PERCEPTRUM_BACKEND_COMMAND="$backend_runtime"
fi

backend_port="${PERCEPTRUM_BACKEND_PORT:-4000}"
reuse_backend="${PERCEPTRUM_REUSE_BACKEND:-0}"
if [[ -z "${APP_BASE_URL:-}" ]]; then
    export APP_BASE_URL="http://127.0.0.1:$backend_port"
fi

find_backend_pids_on_port() {
    if command -v lsof >/dev/null 2>&1; then
        lsof -tiTCP:"$backend_port" -sTCP:LISTEN 2>/dev/null || true
    elif command -v fuser >/dev/null 2>&1; then
        fuser -n tcp "$backend_port" 2>/dev/null || true
    fi
}

for pid in $(find_backend_pids_on_port); do
    [[ "$pid" =~ ^[0-9]+$ ]] || continue
    [[ -r "/proc/$pid/environ" ]] || continue
    env_dump="$(tr '\0' '\n' < "/proc/$pid/environ" 2>/dev/null || true)"
    cmdline="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
    if grep -q '^PERCEPTRUM_LINUX_HOST=1$' <<<"$env_dump" || grep -q 'desktop-local-server' <<<"$cmdline"; then
        if [[ "$reuse_backend" != "1" ]] ||
           ! grep -Fxq "SQLITE_DB_PATH=$SQLITE_DB_PATH" <<<"$env_dump" ||
           ! grep -Fxq "STORAGE_ROOT=$STORAGE_ROOT" <<<"$env_dump" ||
           ! grep -Fxq "APP_STATIC_ROOT=$web_dist" <<<"$env_dump" ||
           ! grep -Fxq "PERCEPTRUM_BACKEND_COMMAND=${PERCEPTRUM_BACKEND_COMMAND:-}" <<<"$env_dump"; then
            echo "Stopping existing Perceptrum backend on port $backend_port (pid $pid) before launching the dev desktop." >&2
            kill -TERM "$pid" 2>/dev/null || true
            for _ in {1..25}; do
                kill -0 "$pid" 2>/dev/null || break
                sleep 0.1
            done
            kill -KILL "$pid" 2>/dev/null || true
        fi
    fi
done

window_arg="--webkit"
if [[ "$PERCEPTRUM_LINUX_WINDOW_MODE" == "browser" ]]; then
    window_arg="--browser"
fi

exec "$desktop_bin" "$window_arg" "$@"
