[CmdletBinding()]
param(
  [string]$HostName = "172.233.186.23",
  [string]$UserName = "root",
  [string]$SshKeyPath = "$HOME/.ssh/id_ed25519",
  [string]$RemoteBase = "/var/www/drakonsite",
  [switch]$SkipBuild,
  [switch]$SkipNginxReload,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$CommonScript = Join-Path $ScriptDir "deploy-common.ps1"
. $CommonScript

$ProjectRoot = (Resolve-Path (Join-Path $ScriptDir "..")).Path
$RemoteAppDir = "$RemoteBase/app"
$RemoteBackendDir = "$RemoteBase/backend"
$RemoteAppTarget = "{0}@{1}:{2}/" -f $UserName, $HostName, $RemoteAppDir
$RemoteBackendTarget = "{0}@{1}:{2}/" -f $UserName, $HostName, $RemoteBackendDir
$ReloadNginxFlag = if ($SkipNginxReload) { "0" } else { "1" }
$SshOptions = @("-i", $SshKeyPath, "-o", "StrictHostKeyChecking=accept-new")
$RemoteShellTarget = "$UserName@$HostName"
$RemoteShellArguments = $SshOptions + @($RemoteShellTarget, "bash -s")
$BackendUploadItems = @(
  "server",
  "src",
  "package.json",
  "package-lock.json"
) + @(Get-ChildItem -Path $ProjectRoot -Filter "tsconfig*.json" -File | Sort-Object Name | ForEach-Object { $_.Name })

Write-Host "[deploy] root: $ProjectRoot"
Write-Host "[deploy] target: $UserName@$HostName"
Write-Host "[deploy] app dir: $RemoteAppDir"
Write-Host "[deploy] backend dir: $RemoteBackendDir"

if (-not (Test-Path (Join-Path $ProjectRoot "dist")) -and $SkipBuild) {
  throw "dist/ is missing. Run without -SkipBuild or build the project before deploying."
}

if ($BackendUploadItems.Count -le 4) {
  throw "No tsconfig*.json files were found for backend upload."
}

if (-not $SkipBuild) {
  Push-Location $ProjectRoot
  try {
    Invoke-DeployCommand `
      -Label "[deploy] building project (npm run build)..." `
      -FilePath "npm" `
      -Arguments @("run", "build") `
      -DryRun:$DryRun
  }
  finally {
    Pop-Location
  }
}
else {
  Write-Host "[deploy] skipping build"
}

Push-Location $ProjectRoot
try {
  Invoke-RemoteBashScript `
    -Label "[deploy] preparing remote directories" `
    -SshArguments $RemoteShellArguments `
    -ScriptContent @"
set -euo pipefail
mkdir -p '$RemoteAppDir' '$RemoteBackendDir'
"@ `
    -DryRun:$DryRun

  Invoke-DeployCommand `
    -Label "[deploy] uploading backend sources -> $RemoteBackendDir" `
    -FilePath "scp" `
    -Arguments ($SshOptions + @("-r") + $BackendUploadItems + @($RemoteBackendTarget)) `
    -DryRun:$DryRun

  Invoke-DeployCommand `
    -Label "[deploy] uploading frontend dist -> $RemoteAppDir" `
    -FilePath "scp" `
    -Arguments ($SshOptions + @("-r", "dist/.", $RemoteAppTarget)) `
    -DryRun:$DryRun
}
finally {
  Pop-Location
}

Invoke-RemoteBashScript `
  -Label "[deploy] running remote post-deploy" `
  -SshArguments $RemoteShellArguments `
  -ScriptContent (Get-RemotePostDeployScript -RemoteBase $RemoteBase -RemoteBackendDir $RemoteBackendDir -ReloadNginxFlag $ReloadNginxFlag) `
  -DryRun:$DryRun

Write-Host "[deploy] done"
