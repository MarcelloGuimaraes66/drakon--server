#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  configure-central-auth-client.sh --base-url URL --public-key PATH [--key-id ID] [--ttl-hours HOURS]

Example:
  ./Perceptrum/linux-desktop/configure-central-auth-client.sh \
    --base-url https://auth.example.com \
    --public-key /path/to/central-auth-public.pem

This configures only the desktop/client side. Do not pass a private key here.
EOF
}

base_url=""
public_key_path=""
key_id="central-auth-v1"
ttl_hours="72"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url)
      base_url="${2:-}"
      shift 2
      ;;
    --public-key)
      public_key_path="${2:-}"
      shift 2
      ;;
    --key-id)
      key_id="${2:-}"
      shift 2
      ;;
    --ttl-hours)
      ttl_hours="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -z "$base_url" || -z "$public_key_path" ]]; then
  usage >&2
  exit 2
fi

if [[ "$base_url" != http://* && "$base_url" != https://* ]]; then
  echo "Error: --base-url must start with http:// or https://." >&2
  exit 2
fi

if [[ ! -f "$public_key_path" ]]; then
  echo "Error: public key file not found: $public_key_path" >&2
  exit 2
fi

if grep -q "BEGIN .*PRIVATE KEY" "$public_key_path"; then
  echo "Error: --public-key points to a private key. Use central-auth-public.pem." >&2
  exit 2
fi

if ! grep -q "BEGIN PUBLIC KEY" "$public_key_path"; then
  echo "Error: --public-key does not look like a PEM public key." >&2
  exit 2
fi

config_root="${XDG_CONFIG_HOME:-$HOME/.config}/Perceptrum"
install_public_key="$config_root/central-auth-public.pem"
client_env="$config_root/central-auth-client.env"
base_url="${base_url%/}"

mkdir -p "$config_root"
install -m 0600 "$public_key_path" "$install_public_key"

tmp_env="$(mktemp)"
cat > "$tmp_env" <<EOF
CENTRAL_AUTH_BASE_URL=$base_url
CENTRAL_AUTH_PUBLIC_KEY_PATH=$install_public_key
CENTRAL_AUTH_GRANT_TTL_HOURS=$ttl_hours
CENTRAL_AUTH_KEY_ID=$key_id
EOF
install -m 0600 "$tmp_env" "$client_env"
rm -f "$tmp_env"

echo "Central identity client configured:"
echo "  $client_env"
echo "  $install_public_key"

if command -v curl >/dev/null 2>&1; then
  echo
  echo "Checking central auth reachability:"
  if curl -fsS --max-time 8 "$base_url/api/auth/country" >/dev/null; then
    echo "  OK: $base_url/api/auth/country responded."
  else
    echo "  Warning: $base_url/api/auth/country did not respond successfully." >&2
    echo "  The desktop can load the config, but invites may fail until the central server is reachable." >&2
  fi
fi

echo
echo "Restart the desktop/backend after this change:"
echo "  pkill -f desktop-local-server.cjs || true"
echo "  perceptrum-desktop"
