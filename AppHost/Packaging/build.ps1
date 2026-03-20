param(
    [ValidateSet("drakon", "perceptrum")]
    [string]$Brand = "perceptrum",
    [string]$Configuration = "Release"
)

$ErrorActionPreference = "Stop"

$workspaceRoot = "C:\dev\Workspace"
$appHostRoot = Join-Path $workspaceRoot "AppHost"
$drakonSiteRoot = Join-Path $workspaceRoot "DrakonSite"
$stageRoot = Join-Path $appHostRoot "stage"
$binOutputRoot = Join-Path $appHostRoot "bin\$Configuration"
$legacyInstallerPath = Join-Path $appHostRoot "dist\DrakonPerceptrumDesktopInstaller.exe"
$msbuild = (Get-Command msbuild.exe -ErrorAction Stop).Source
$iscc = Get-Command ISCC.exe -ErrorAction SilentlyContinue

if (-not $iscc) {
    $isccCandidates = @(
        (Join-Path $env:LOCALAPPDATA "Programs\Inno Setup 6\ISCC.exe"),
        "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
        "C:\Program Files\Inno Setup 6\ISCC.exe"
    )

    foreach ($candidate in $isccCandidates) {
        if (Test-Path $candidate) {
            $iscc = [pscustomobject]@{ Source = $candidate }
            break
        }
    }
}

node (Join-Path $workspaceRoot "branding\apply-brand.mjs") --brand $Brand

if (Test-Path $legacyInstallerPath) {
    Remove-Item -Path $legacyInstallerPath -Force
}

Push-Location $drakonSiteRoot
try {
    npm run build
} finally {
    Pop-Location
}

node (Join-Path $appHostRoot "Packaging\stage-runtime.mjs")

if (Test-Path $binOutputRoot) {
    Get-ChildItem -Path $binOutputRoot -Force | Remove-Item -Recurse -Force
}

& $msbuild (Join-Path $workspaceRoot "Perceptrum\PerceptrumCore\PerceptrumCore.vcxproj") /t:Rebuild /p:Configuration=$Configuration /p:Platform=x64
& $msbuild (Join-Path $appHostRoot "AppHost.vcxproj") /t:Rebuild /p:Configuration=$Configuration /p:Platform=x64

Copy-Item -Path (Join-Path $binOutputRoot "*") -Destination $stageRoot -Recurse -Force
Copy-Item -Path (Join-Path $stageRoot "runtime") -Destination $binOutputRoot -Recurse -Force
Copy-Item -Path (Join-Path $stageRoot "brand.config.json") -Destination $binOutputRoot -Force
if (Test-Path (Join-Path $stageRoot "brand.txt")) {
    Copy-Item -Path (Join-Path $stageRoot "brand.txt") -Destination $binOutputRoot -Force
}

if ($iscc) {
    & $iscc.Source (Join-Path $appHostRoot "Packaging\AppHost.iss")
} else {
    Write-Host "ISCC.exe not found. Stage completed without building the installer."
}
