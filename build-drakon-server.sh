#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$script_dir"
web_dir="$repo_root/DrakonSite"
perceptrum_dir="$repo_root/Perceptrum"

node_version="${NODE_VERSION:-v22.22.3}"
node_root="${NODE_ROOT:-$HOME/toolchains/node-$node_version-linux-x64}"
node_bin="$node_root/bin"
node_exe="$node_bin/node"
build_type="${BUILD_TYPE:-Debug}"
build_name="$(printf '%s' "$build_type" | tr '[:upper:]' '[:lower:]')"
build_dir="${BUILD_DIR:-$perceptrum_dir/out/build/linux-$build_name}"
install_prereqs="${INSTALL_PREREQS:-1}"
webkit_mode="${PERCEPTRUM_ENABLE_WEBKITGTK:-OFF}"

apt_packages=(
  build-essential
  cmake
  ninja-build
  pkg-config
  clang-12
  curl
  ffmpeg
  xdg-utils
  dbus-user-session
  libcurl4-openssl-dev
  libsecret-tools
  nlohmann-json3-dev
)

print_step() {
  printf '\n==> %s\n' "$1"
}

require_dir() {
  local dir_path="$1"
  local label="$2"
  if [[ ! -d "$dir_path" ]]; then
    printf 'Diretorio nao encontrado: %s (%s)\n' "$dir_path" "$label" >&2
    exit 1
  fi
}

warn_if_missing_runtime_env() {
  if [[ ! -f "$web_dir/.env.local" ]]; then
    printf 'Aviso: %s/.env.local nao existe. O build compila, mas login/auth central nao vao funcionar sem esse arquivo.\n' "$web_dir" >&2
    printf 'Use DrakonSite/.env.local.example como base e preencha os valores fora do Git.\n' >&2
  fi

  if [[ ! -f "$web_dir/.env.init" ]]; then
    printf 'Aviso: %s/.env.init nao existe. O runtime vai usar os defaults atuais.\n' "$web_dir" >&2
    printf 'Use DrakonSite/.env.init.example como base se quiser fixar o perfil.\n' >&2
  fi
}

install_system_prereqs() {
  local -a apt_runner

  if [[ "$install_prereqs" != "1" ]]; then
    print_step "Pulando apt install porque INSTALL_PREREQS=$install_prereqs"
    return
  fi

  if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
    apt_runner=()
  else
    if ! command -v sudo >/dev/null 2>&1; then
      printf 'sudo nao encontrado. Instale os pacotes manualmente ou rode com INSTALL_PREREQS=0.\n' >&2
      exit 1
    fi
    apt_runner=(sudo)
  fi

  print_step "Instalando dependencias do sistema"
  "${apt_runner[@]}" apt update
  "${apt_runner[@]}" apt install -y "${apt_packages[@]}"
}

install_node_toolchain() {
  if [[ -x "$node_exe" ]]; then
    print_step "Node local ja existe em $node_root"
    return
  fi

  print_step "Baixando Node $node_version em $node_root"
  mkdir -p "$HOME/toolchains"
  cd "$HOME/toolchains"
  curl -fsSLO "https://nodejs.org/dist/$node_version/node-$node_version-linux-x64.tar.xz"
  tar -xf "node-$node_version-linux-x64.tar.xz"
}

build_web() {
  print_step "Build do DrakonSite"
  cd "$web_dir"
  npm ci
  npm run build
}

build_linux_host() {
  local cmake_args=(
    -S .
    -B "$build_dir"
    -G Ninja
    -DCMAKE_BUILD_TYPE="$build_type"
    -DCMAKE_C_COMPILER=clang-12
    -DCMAKE_CXX_COMPILER=clang++-12
    -DNODE_EXECUTABLE="$node_exe"
    -DCMAKE_CXX_FLAGS=-pthread
    -DCMAKE_EXE_LINKER_FLAGS=-pthread
    -DCMAKE_SHARED_LINKER_FLAGS=-pthread
    -DPERCEPTRUM_ENABLE_WEBKITGTK="$webkit_mode"
    -DPERCEPTRUM_ENABLE_AGENT_CORE=ON
    -DPERCEPTRUM_ENABLE_CAMERA_CAPTURE=ON
    -DPERCEPTRUM_ENABLE_RTSP_CAPTURE=ON
    -DPERCEPTRUM_ENABLE_FRAME_WRITER=ON
    -DPERCEPTRUM_ENABLE_JOB_RUNTIME=ON
  )

  print_step "Build do Perceptrum Linux host"
  cd "$perceptrum_dir"
  cmake "${cmake_args[@]}"
  cmake --build "$build_dir" -j"$(nproc)"
}

print_summary() {
  print_step "Build concluido"
  printf 'Node: %s\n' "$("$node_exe" -v)"
  printf 'NPM: %s\n' "$(npm -v)"
  printf 'Build dir: %s\n' "$build_dir"
  printf 'Desktop bin: %s\n' "$build_dir/perceptrum-desktop"
  printf 'Agent bin: %s\n' "$build_dir/perceptrum-agent"
  printf 'Web dist: %s\n' "$web_dir/dist"
}

require_dir "$web_dir" "DrakonSite"
require_dir "$perceptrum_dir" "Perceptrum"
warn_if_missing_runtime_env

install_system_prereqs
install_node_toolchain

export PATH="$node_bin:$PATH"
export CC=clang-12
export CXX=clang++-12

print_step "Versoes usadas no build"
printf 'node=%s\n' "$("$node_exe" -v)"
printf 'npm=%s\n' "$(npm -v)"
printf 'cmake=%s\n' "$(cmake --version | head -n 1)"
printf 'clang=%s\n' "$(clang-12 --version | head -n 1)"

build_web
build_linux_host
print_summary
