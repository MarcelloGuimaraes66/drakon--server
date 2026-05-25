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

(cd "$perceptrum_dir" && cmake -S . -B "$build_dir" -G Ninja -DCMAKE_BUILD_TYPE=Debug)
(cd "$perceptrum_dir" && cmake --build "$build_dir" -j"$(nproc)")

export APP_STATIC_ROOT="$web_dist"
export PERCEPTRUM_WEB_SOURCE_DIR="$web_dir"
export PERCEPTRUM_LINUX_WINDOW_MODE="${PERCEPTRUM_LINUX_WINDOW_MODE:-webkit}"
if [[ -z "${PERCEPTRUM_BACKEND_COMMAND:-}" && -x "$backend_runtime" ]]; then
    export PERCEPTRUM_BACKEND_COMMAND="$backend_runtime"
fi

window_arg="--webkit"
if [[ "$PERCEPTRUM_LINUX_WINDOW_MODE" == "browser" ]]; then
    window_arg="--browser"
fi

exec "$desktop_bin" "$window_arg" "$@"
