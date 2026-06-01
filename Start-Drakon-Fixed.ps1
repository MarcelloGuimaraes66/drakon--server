$ErrorActionPreference = "Stop"

$workspaceRoot = "C:\dev\Workspace"
$runtimeRoot = Join-Path $workspaceRoot ".codex_tmp\drakon-runtime-fix\runtime"
$installedExe = "C:\Program Files (x86)\Drakon\Drakon.exe"
$sessionRoot = Join-Path $env:LOCALAPPDATA "DrakonPerceptrumDesktop\drakon"
$storageRoot = Join-Path $sessionRoot "storage"
$stdoutLog = Join-Path $sessionRoot "temporary-runtime.stdout.log"
$stderrLog = Join-Path $sessionRoot "temporary-runtime.stderr.log"

function Test-BackendHealthy {
    try {
        $response = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:4000/api/runtime/health" -TimeoutSec 3
        return $response.StatusCode -eq 200
    } catch {
        return $false
    }
}

function Wait-BackendHealthy {
    param(
        [int]$TimeoutSeconds = 20
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-BackendHealthy) {
            return $true
        }

        Start-Sleep -Milliseconds 700
    }

    return $false
}

function Get-DesktopSqliteKeyHex {
    Add-Type -AssemblyName System.Security

    $keyFile = Join-Path $sessionRoot "sqlite_key_v1.txt"
    if (-not (Test-Path $keyFile)) {
        throw "SQLite key file not found at $keyFile"
    }

    $encoded = (Get-Content -LiteralPath $keyFile -Raw).Trim()
    $cipherBytes = [Convert]::FromBase64String($encoded)
    $entropy = [System.Text.Encoding]::UTF8.GetBytes("DrakonDesktop|sqlite_key_v1.txt")
    $plainBytes = [System.Security.Cryptography.ProtectedData]::Unprotect(
        $cipherBytes,
        $entropy,
        [System.Security.Cryptography.DataProtectionScope]::CurrentUser
    )

    return [System.Text.Encoding]::UTF8.GetString($plainBytes).Trim()
}

function Start-TemporaryBackend {
    if (-not (Test-Path $runtimeRoot)) {
        throw "Patched runtime not found at $runtimeRoot"
    }

    $listener = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
        Where-Object { $_.LocalPort -eq 4000 } |
        Select-Object -First 1
    if ($listener) {
        try {
            Stop-Process -Id $listener.OwningProcess -Force -ErrorAction Stop
            Start-Sleep -Seconds 1
        } catch {
        }
    }

    $sqliteKeyHex = Get-DesktopSqliteKeyHex

    $env:PORT = "4000"
    $env:APP_BIND_HOST = "127.0.0.1"
    $env:APP_BASE_URL = "http://127.0.0.1:4000"
    $env:APP_ALLOWED_ORIGINS = "http://127.0.0.1:4000"
    $env:APP_RUNTIME_ENV = "local"
    $env:ENV_PROFILE = "local"
    $env:APP_RUNTIME_ROOT = $runtimeRoot
    $env:APP_STATIC_ROOT = Join-Path $runtimeRoot "web"
    $env:APP_SERVICE_SESSION_DIR = $sessionRoot
    $env:STORAGE_ROOT = $storageRoot
    $env:APP_DB_BACKEND = "sqlite"
    $env:APP_SQLITE_ENCRYPTION = "required"
    $env:APP_SQLITE_KEY_VERSION = "v1"
    $env:APP_SQLITE_CIPHER = "sqlcipher"
    $env:APP_SQLITE_LEGACY = "4"
    $env:APP_SQLITE_KEY_HEX = $sqliteKeyHex

    if (Test-Path $stdoutLog) {
        Remove-Item -LiteralPath $stdoutLog -Force
    }
    if (Test-Path $stderrLog) {
        Remove-Item -LiteralPath $stderrLog -Force
    }

    $nodeExe = Join-Path $runtimeRoot "node\node.exe"
    $backendScript = Join-Path $runtimeRoot "desktop-local-server.cjs"
    $workingDir = Join-Path $runtimeRoot "drakonsite"

    Start-Process `
        -FilePath $nodeExe `
        -ArgumentList ('"' + $backendScript + '"') `
        -WorkingDirectory $workingDir `
        -RedirectStandardOutput $stdoutLog `
        -RedirectStandardError $stderrLog `
        -WindowStyle Hidden | Out-Null

    if (-not (Wait-BackendHealthy -TimeoutSeconds 20)) {
        $tail = ""
        if (Test-Path $stderrLog) {
            $tail = (Get-Content -LiteralPath $stderrLog -Tail 30) -join [Environment]::NewLine
        }

        if ([string]::IsNullOrWhiteSpace($tail) -and (Test-Path $stdoutLog)) {
            $tail = (Get-Content -LiteralPath $stdoutLog -Tail 30) -join [Environment]::NewLine
        }

        throw "Temporary backend did not become healthy on 127.0.0.1:4000.`n$tail"
    }
}

if (-not (Test-Path $installedExe)) {
    throw "Installed Drakon executable not found at $installedExe"
}

Get-Process Drakon -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 800

if (-not (Test-BackendHealthy)) {
    Start-TemporaryBackend
}

Start-Process -FilePath $installedExe -WorkingDirectory (Split-Path -Path $installedExe -Parent) | Out-Null
