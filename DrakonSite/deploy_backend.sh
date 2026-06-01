#!/usr/bin/env bash
set -euo pipefail

BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="${SERVICE_NAME:-perceptrum-central-auth}"
ENV_FILE="${CENTRAL_AUTH_ENV_FILE:-/etc/perceptrum/central-auth.env}"
SERVICE_TEMPLATE="$BACKEND_DIR/ops/systemd/perceptrum-central-auth.service.template"
SERVICE_TARGET="/etc/systemd/system/${SERVICE_NAME}.service"

echo "[central-auth] backend dir: $BACKEND_DIR"
echo "[central-auth] service name: $SERVICE_NAME"
echo "[central-auth] env file: $ENV_FILE"

if ! command -v systemctl >/dev/null 2>&1; then
  echo "[central-auth] systemctl is required on the target server." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "[central-auth] npm is required on the target server." >&2
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "[central-auth] Missing env file: $ENV_FILE" >&2
  echo "[central-auth] Create it from ops/secrets/central-auth.env.example and keep it root-only." >&2
  exit 1
fi

if [ ! -f "$SERVICE_TEMPLATE" ]; then
  echo "[central-auth] Missing service template: $SERVICE_TEMPLATE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

cd "$BACKEND_DIR"

NPM_CI_ARGS=(--include=dev)
if [ "${APP_RUNTIME_ENV:-}" = "server" ]; then
  echo "[central-auth] server runtime detected; installing dependencies with --ignore-scripts"
  NPM_CI_ARGS+=(--ignore-scripts)
else
  echo "[central-auth] installing backend dependencies"
fi

npm ci "${NPM_CI_ARGS[@]}"

echo "[central-auth] installing systemd unit -> $SERVICE_TARGET"
sed \
  -e "s|__BACKEND_DIR__|$BACKEND_DIR|g" \
  -e "s|__ENV_FILE__|$ENV_FILE|g" \
  "$SERVICE_TEMPLATE" > "$SERVICE_TARGET"

chmod 0644 "$SERVICE_TARGET"

echo "[central-auth] reloading systemd"
systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"

echo "[central-auth] service status"
systemctl --no-pager --full status "$SERVICE_NAME" || true

echo "[central-auth] recent logs"
journalctl -u "$SERVICE_NAME" -n 40 --no-pager || true
