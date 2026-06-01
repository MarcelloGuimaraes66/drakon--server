[CmdletBinding()]
param(
  [string]$HostName = "172.233.186.23",
  [string]$UserName = "root",
  [string]$SshKeyPath = "$HOME/.ssh/id_ed25519",
  [string]$RemoteBase = "/var/www/drakonsite",
  [string]$RemoteBackendDir = "/var/www/drakonsite/backend",
  [switch]$SkipNginxReload,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$CommonScript = Join-Path $ScriptDir "deploy-common.ps1"
. $CommonScript

$ReloadNginxFlag = if ($SkipNginxReload) { "0" } else { "1" }
$SshOptions = @("-i", $SshKeyPath, "-o", "StrictHostKeyChecking=accept-new")
$RemoteShellArguments = $SshOptions + @("$UserName@$HostName", "bash -s")

Write-Host "[deploy-post] target: $UserName@$HostName"
Write-Host "[deploy-post] backend dir: $RemoteBackendDir"

Invoke-RemoteBashScript `
  -Label "[deploy-post] running remote post-deploy" `
  -SshArguments $RemoteShellArguments `
  -ScriptContent (Get-RemotePostDeployScript -RemoteBase $RemoteBase -RemoteBackendDir $RemoteBackendDir -ReloadNginxFlag $ReloadNginxFlag) `
  -DryRun:$DryRun

Write-Host "[deploy-post] done"
