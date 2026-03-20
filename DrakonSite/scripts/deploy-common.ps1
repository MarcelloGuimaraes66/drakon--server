function Format-DeployCommandArgument {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Argument
  )

  if ($Argument -match '[\s"]') {
    return '"' + ($Argument -replace '"', '\"') + '"'
  }

  return $Argument
}

function Invoke-DeployCommand {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Label,
    [Parameter(Mandatory = $true)]
    [string]$FilePath,
    [string[]]$Arguments = @(),
    [switch]$DryRun
  )

  Write-Host $Label
  $DisplayCommand = @($FilePath) + $Arguments
  $DisplayText = ($DisplayCommand | ForEach-Object { Format-DeployCommandArgument $_ }) -join ' '
  Write-Host "[cmd] $DisplayText"

  if ($DryRun) {
    return
  }

  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Label failed with exit code $LASTEXITCODE."
  }
}

function Invoke-RemoteBashScript {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Label,
    [Parameter(Mandatory = $true)]
    [string[]]$SshArguments,
    [Parameter(Mandatory = $true)]
    [string]$ScriptContent,
    [switch]$DryRun
  )

  Write-Host $Label

  if ($DryRun) {
    Write-Host "[remote-script]"
    Write-Host $ScriptContent
    return
  }

  $ScriptContent | & ssh @SshArguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Label failed with exit code $LASTEXITCODE."
  }
}

function Get-RemotePostDeployScript {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RemoteBase,
    [Parameter(Mandatory = $true)]
    [string]$RemoteBackendDir,
    [Parameter(Mandatory = $true)]
    [string]$ReloadNginxFlag
  )

  $Template = @'
set -euo pipefail

BACKEND_DIR='__REMOTE_BACKEND_DIR__'
PROJECT_DIR='__REMOTE_BASE__'
RELOAD_NGINX='__RELOAD_NGINX_FLAG__'

run_backend_deploy_script() {
  if [ -f "$BACKEND_DIR/deploy_backend.sh" ]; then
    echo "[remote] running $BACKEND_DIR/deploy_backend.sh"
    (
      cd "$BACKEND_DIR"
      bash "./deploy_backend.sh"
    )
    return 0
  fi

  if [ -f "$PROJECT_DIR/deploy_backend.sh" ]; then
    echo "[remote] running $PROJECT_DIR/deploy_backend.sh"
    (
      cd "$PROJECT_DIR"
      bash "./deploy_backend.sh"
    )
    return 0
  fi

  return 1
}

cd "$BACKEND_DIR" || exit 1
echo "ENV_PROFILE=server" > .env.init

if ! run_backend_deploy_script; then
  echo "[remote] deploy_backend.sh not found in $BACKEND_DIR or $PROJECT_DIR" >&2
  exit 1
fi

echo "[remote] deploy script finished"

if [ "$RELOAD_NGINX" = "1" ] && command -v nginx >/dev/null 2>&1 && command -v systemctl >/dev/null 2>&1; then
  nginx -t && systemctl reload nginx
fi

echo "[remote] done"
'@

  return $Template.
    Replace("__REMOTE_BACKEND_DIR__", $RemoteBackendDir).
    Replace("__REMOTE_BASE__", $RemoteBase).
    Replace("__RELOAD_NGINX_FLAG__", $ReloadNginxFlag)
}
