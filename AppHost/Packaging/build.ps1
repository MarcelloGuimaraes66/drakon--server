param(
    [ValidateSet("drakon", "perceptrum")]
    [string]$Brand = "perceptrum",
    [ValidateSet("Build", "Package", "All")]
    [string]$Step = "All",
    [string]$Configuration = "Release",
    [switch]$AllowUnsignedPayload,
    [string]$WindowsAppRuntimeInstallerPath
)

$ErrorActionPreference = "Stop"

$workspaceRoot = "C:\dev\Workspace"
$appHostRoot = Join-Path $workspaceRoot "AppHost"
$drakonSiteRoot = Join-Path $workspaceRoot "DrakonSite"
$packagingRoot = Join-Path $appHostRoot "Packaging"
$artifactsRoot = Join-Path $appHostRoot "artifacts"
$sharedStageRoot = Join-Path $appHostRoot "stage"
$distRoot = Join-Path $appHostRoot "dist"
$binOutputRoot = Join-Path $appHostRoot "bin\$Configuration"
$legacyInstallerPath = Join-Path $distRoot "DrakonPerceptrumDesktopInstaller.exe"
$brandConfigPath = Join-Path $workspaceRoot "brand.config.json"
$applyBrandScriptPath = Join-Path $workspaceRoot "branding\apply-brand.mjs"
$stageRuntimeScriptPath = Join-Path $packagingRoot "stage-runtime.mjs"
$appHostIssPath = Join-Path $packagingRoot "AppHost.iss"
$msbuild = (Get-Command msbuild.exe -ErrorAction Stop).Source
$iscc = $null

function Resolve-IsccCommand {
    $isccCommand = Get-Command ISCC.exe -ErrorAction SilentlyContinue

    if ($isccCommand) {
        return $isccCommand
    }

    $candidates = @(
        (Join-Path $env:LOCALAPPDATA "Programs\Inno Setup 6\ISCC.exe"),
        "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
        "C:\Program Files\Inno Setup 6\ISCC.exe"
    )

    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) {
            return [pscustomobject]@{ Source = $candidate }
        }
    }

    return $null
}

function Resolve-WindowsAppRuntimeInstallerPath {
    param(
        [string]$ExplicitPath
    )

    $candidates = @()

    if (-not [string]::IsNullOrWhiteSpace($ExplicitPath)) {
        $candidates += $ExplicitPath
    }

    if (-not [string]::IsNullOrWhiteSpace($env:WINDOWS_APP_RUNTIME_INSTALLER)) {
        $candidates += $env:WINDOWS_APP_RUNTIME_INSTALLER
    }

    $candidates += @(
        (Join-Path $packagingRoot "prereqs\WindowsAppRuntimeInstall-x64.exe"),
        (Join-Path $env:USERPROFILE "Downloads\WindowsAppRuntimeInstall-x64.exe")
    )

    foreach ($candidate in $candidates) {
        if ([string]::IsNullOrWhiteSpace($candidate)) {
            continue
        }

        $resolvedPath = Resolve-Path -Path $candidate -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty Path -First 1
        if ($resolvedPath) {
            return $resolvedPath
        }
    }

    return $null
}

function Ensure-Directory {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (-not (Test-Path $Path)) {
        New-Item -ItemType Directory -Path $Path | Out-Null
    }
}

function Reset-Directory {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (Test-Path $Path) {
        Remove-Item -Path $Path -Recurse -Force
    }

    New-Item -ItemType Directory -Path $Path | Out-Null
}

function Copy-DirectoryContents {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Source,
        [Parameter(Mandatory = $true)]
        [string]$Destination
    )

    if (-not (Test-Path $Source)) {
        throw "Source directory not found: $Source"
    }

    Reset-Directory -Path $Destination

    $items = @(Get-ChildItem -Path $Source -Force)
    if ($items.Count -eq 0) {
        return
    }

    $items | Copy-Item -Destination $Destination -Recurse -Force
}

function Stage-WindowsAppRuntimeInstaller {
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject]$BrandMetadata,
        [string]$InstallerPath
    )

    $resolvedInstallerPath = Resolve-WindowsAppRuntimeInstallerPath -ExplicitPath $InstallerPath
    if (-not $resolvedInstallerPath) {
        throw (
            "Windows App Runtime installer not found. Provide -WindowsAppRuntimeInstallerPath, set " +
            "WINDOWS_APP_RUNTIME_INSTALLER, or place WindowsAppRuntimeInstall-x64.exe in " +
            "$packagingRoot\prereqs or $env:USERPROFILE\Downloads."
        )
    }

    $prereqRoot = Join-Path $BrandMetadata.ArtifactStageRoot "prereqs"
    Ensure-Directory -Path $prereqRoot

    $destinationPath = Join-Path $prereqRoot "WindowsAppRuntimeInstall-x64.exe"
    Copy-Item -Path $resolvedInstallerPath -Destination $destinationPath -Force
}

function Invoke-BrandApply {
    & node $applyBrandScriptPath --brand $Brand
}

function Get-BrandMetadata {
    param(
        [Parameter(Mandatory = $true)]
        [string]$BrandName,
        [Parameter(Mandatory = $true)]
        [string]$BuildConfiguration
    )

    $config = Get-Content -Path $brandConfigPath -Raw | ConvertFrom-Json
    $brandProperty = $config.brands.PSObject.Properties[$BrandName]

    if (-not $brandProperty) {
        throw "Brand '$BrandName' is not defined in $brandConfigPath."
    }

    $brandConfig = $brandProperty.Value
    $targetName = [string]$brandConfig.cpp.targetName

    if ([string]::IsNullOrWhiteSpace($targetName)) {
        throw "Brand '$BrandName' is missing cpp.targetName in $brandConfigPath."
    }

    $artifactRoot = Join-Path (Join-Path $artifactsRoot $BrandName) $BuildConfiguration
    $artifactStageRoot = Join-Path $artifactRoot "stage"
    $installerBaseFilename = "$targetName" + "Installer"

    return [pscustomobject]@{
        SchemaVersion = 1
        Brand = $BrandName
        Configuration = $BuildConfiguration
        TargetName = $targetName
        ExeName = "$targetName.exe"
        InstallerBaseFilename = $installerBaseFilename
        InstallerFileName = "$installerBaseFilename.exe"
        ArtifactRoot = $artifactRoot
        ArtifactStageRoot = $artifactStageRoot
        ManifestPath = Join-Path $artifactRoot "build-manifest.json"
        PayloadExePath = Join-Path $artifactStageRoot "$targetName.exe"
        InstallerOutputPath = Join-Path $distRoot "$installerBaseFilename.exe"
    }
}

function Write-BuildManifest {
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject]$BrandMetadata
    )

    Ensure-Directory -Path $BrandMetadata.ArtifactRoot

    $manifest = [ordered]@{
        schemaVersion = $BrandMetadata.SchemaVersion
        brand = $BrandMetadata.Brand
        configuration = $BrandMetadata.Configuration
        targetName = $BrandMetadata.TargetName
        exeName = $BrandMetadata.ExeName
        installerBaseFilename = $BrandMetadata.InstallerBaseFilename
        installerFileName = $BrandMetadata.InstallerFileName
        artifactRoot = $BrandMetadata.ArtifactRoot
        artifactStageRoot = $BrandMetadata.ArtifactStageRoot
        payloadExePath = $BrandMetadata.PayloadExePath
        installerOutputPath = $BrandMetadata.InstallerOutputPath
        createdAtUtc = [DateTime]::UtcNow.ToString("o")
    }

    $manifest | ConvertTo-Json -Depth 4 | Set-Content -Path $BrandMetadata.ManifestPath -Encoding utf8
}

function Read-BuildManifest {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ManifestPath
    )

    if (-not (Test-Path $ManifestPath)) {
        throw "Build manifest not found at $ManifestPath. Run Step Build first."
    }

    return Get-Content -Path $ManifestPath -Raw | ConvertFrom-Json
}

function Test-HasEmbeddedAuthenticodeSignature {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath
    )

    if (-not (Test-Path $FilePath)) {
        return $false
    }

    try {
        $signature = Get-AuthenticodeSignature -FilePath $FilePath
    } catch {
        return $false
    }

    return (
        $null -ne $signature.SignerCertificate -and
        $signature.Status -ne [System.Management.Automation.SignatureStatus]::NotSigned
    )
}

function Assert-BuildManifestMatches {
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject]$BrandMetadata,
        [Parameter(Mandatory = $true)]
        [pscustomobject]$Manifest
    )

    if ([int]$Manifest.schemaVersion -ne $BrandMetadata.SchemaVersion) {
        throw "Build manifest version mismatch at $($BrandMetadata.ManifestPath). Re-run Step Build."
    }

    if ([string]$Manifest.brand -ne $BrandMetadata.Brand) {
        throw "Build manifest brand mismatch. Expected '$($BrandMetadata.Brand)', found '$($Manifest.brand)'."
    }

    if ([string]$Manifest.configuration -ne $BrandMetadata.Configuration) {
        throw "Build manifest configuration mismatch. Expected '$($BrandMetadata.Configuration)', found '$($Manifest.configuration)'."
    }

    if ([string]$Manifest.exeName -ne $BrandMetadata.ExeName) {
        throw "Build manifest executable mismatch. Expected '$($BrandMetadata.ExeName)', found '$($Manifest.exeName)'."
    }

    if ([string]$Manifest.installerFileName -ne $BrandMetadata.InstallerFileName) {
        throw "Build manifest installer mismatch. Expected '$($BrandMetadata.InstallerFileName)', found '$($Manifest.installerFileName)'."
    }

    if ([string]$Manifest.artifactStageRoot -ne $BrandMetadata.ArtifactStageRoot) {
        throw "Build manifest stage path mismatch. Re-run Step Build."
    }

    if (-not (Test-Path $BrandMetadata.ArtifactStageRoot)) {
        throw "Artifact stage folder not found: $($BrandMetadata.ArtifactStageRoot). Run Step Build first."
    }

    if (-not (Test-Path $BrandMetadata.PayloadExePath)) {
        throw "Payload executable not found at $($BrandMetadata.PayloadExePath). Run Step Build again."
    }

    $stageBrandPath = Join-Path $BrandMetadata.ArtifactStageRoot "brand.txt"
    if (Test-Path $stageBrandPath) {
        $stageBrand = (Get-Content -Path $stageBrandPath -Raw).Trim().ToLowerInvariant()
        if ($stageBrand -ne $BrandMetadata.Brand) {
            throw "Stage brand mismatch. Expected '$($BrandMetadata.Brand)', found '$stageBrand'. Re-run Step Build."
        }
    }

    $stageConfigPath = Join-Path $BrandMetadata.ArtifactStageRoot "brand.config.json"
    if (Test-Path $stageConfigPath) {
        $stageConfig = Get-Content -Path $stageConfigPath -Raw | ConvertFrom-Json
        $activeBrand = [string]$stageConfig.activeBrand
        if ($activeBrand -and $activeBrand -ne $BrandMetadata.Brand) {
            throw "Stage config brand mismatch. Expected '$($BrandMetadata.Brand)', found '$activeBrand'. Re-run Step Build."
        }
    }
}

function Invoke-BuildStep {
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject]$BrandMetadata
    )

    Write-Host "Applying brand '$($BrandMetadata.Brand)'..."
    Invoke-BrandApply

    if (Test-Path $BrandMetadata.ArtifactRoot) {
        Remove-Item -Path $BrandMetadata.ArtifactRoot -Recurse -Force
    }
    Ensure-Directory -Path $BrandMetadata.ArtifactRoot

    Write-Host "Building frontend bundle..."
    Push-Location $drakonSiteRoot
    try {
        npm run build
    } finally {
        Pop-Location
    }

    Write-Host "Preparing isolated stage at $($BrandMetadata.ArtifactStageRoot)..."
    & node $stageRuntimeScriptPath --out $BrandMetadata.ArtifactStageRoot

    if (Test-Path $binOutputRoot) {
        Get-ChildItem -Path $binOutputRoot -Force | Remove-Item -Recurse -Force
    }

    Write-Host "Compiling native projects..."
    & $msbuild (Join-Path $workspaceRoot "Perceptrum\PerceptrumCore\PerceptrumCore.vcxproj") /t:Rebuild /p:Configuration=$Configuration /p:Platform=x64
    & $msbuild (Join-Path $appHostRoot "AppHost.vcxproj") /t:Rebuild /p:Configuration=$Configuration /p:Platform=x64

    $binItems = @(Get-ChildItem -Path $binOutputRoot -Force)
    if ($binItems.Count -eq 0) {
        throw "Build output folder is empty: $binOutputRoot"
    }

    $binItems | Copy-Item -Destination $BrandMetadata.ArtifactStageRoot -Recurse -Force

    $artifactRuntimePath = Join-Path $BrandMetadata.ArtifactStageRoot "runtime"
    if (Test-Path $artifactRuntimePath) {
        Copy-Item -Path $artifactRuntimePath -Destination $binOutputRoot -Recurse -Force
    }

    foreach ($name in @("brand.config.json", "brand.txt")) {
        $sourcePath = Join-Path $BrandMetadata.ArtifactStageRoot $name
        if (Test-Path $sourcePath) {
            Copy-Item -Path $sourcePath -Destination $binOutputRoot -Force
        }
    }

    if (-not (Test-Path $BrandMetadata.PayloadExePath)) {
        throw "Expected payload executable not found at $($BrandMetadata.PayloadExePath)."
    }

    Write-BuildManifest -BrandMetadata $BrandMetadata

    Write-Host ""
    Write-Host "Build step completed."
    Write-Host "Sign the payload executable before packaging:"
    Write-Host "  $($BrandMetadata.PayloadExePath)"
}

function Invoke-PackageStep {
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject]$BrandMetadata,
        [bool]$RequireSignedPayload = $true
    )

    if (-not $iscc) {
        throw "ISCC.exe not found. Install Inno Setup 6 or add it to PATH before running Step Package."
    }

    $manifest = Read-BuildManifest -ManifestPath $BrandMetadata.ManifestPath
    Assert-BuildManifestMatches -BrandMetadata $BrandMetadata -Manifest $manifest

    if ($RequireSignedPayload -and -not (Test-HasEmbeddedAuthenticodeSignature -FilePath $BrandMetadata.PayloadExePath)) {
        throw "Executable $($BrandMetadata.PayloadExePath) does not have an embedded Authenticode signature. Sign it before running Step Package."
    }

    Write-Host "Applying brand '$($BrandMetadata.Brand)'..."
    Invoke-BrandApply

    $currentBrandMetadata = Get-BrandMetadata -BrandName $BrandMetadata.Brand -BuildConfiguration $BrandMetadata.Configuration
    if (
        $currentBrandMetadata.ExeName -ne $BrandMetadata.ExeName -or
        $currentBrandMetadata.InstallerFileName -ne $BrandMetadata.InstallerFileName
    ) {
        throw "Brand metadata changed since the last build. Re-run Step Build for '$($BrandMetadata.Brand)'."
    }

    if (Test-Path $legacyInstallerPath) {
        Remove-Item -Path $legacyInstallerPath -Force
    }

    if (Test-Path $BrandMetadata.InstallerOutputPath) {
        Remove-Item -Path $BrandMetadata.InstallerOutputPath -Force
    }

    Write-Host "Copying staged payload into AppHost\stage..."
    Stage-WindowsAppRuntimeInstaller -BrandMetadata $BrandMetadata -InstallerPath $WindowsAppRuntimeInstallerPath
    Copy-DirectoryContents -Source $BrandMetadata.ArtifactStageRoot -Destination $sharedStageRoot

    if (-not $RequireSignedPayload -and -not (Test-HasEmbeddedAuthenticodeSignature -FilePath $BrandMetadata.PayloadExePath)) {
        Write-Host "Packaging an unsigned payload because signature enforcement is disabled for this run."
    }

    Write-Host "Building installer..."
    & $iscc.Source $appHostIssPath

    if (-not (Test-Path $BrandMetadata.InstallerOutputPath)) {
        throw "Expected installer not found at $($BrandMetadata.InstallerOutputPath)."
    }

    Write-Host ""
    Write-Host "Package step completed."
    Write-Host "Sign the installer:"
    Write-Host "  $($BrandMetadata.InstallerOutputPath)"
}

$iscc = Resolve-IsccCommand
$brandMetadata = Get-BrandMetadata -BrandName $Brand -BuildConfiguration $Configuration

switch ($Step) {
    "Build" {
        Invoke-BuildStep -BrandMetadata $brandMetadata
    }
    "Package" {
        Invoke-PackageStep -BrandMetadata $brandMetadata -RequireSignedPayload (-not $AllowUnsignedPayload.IsPresent)
    }
    "All" {
        Invoke-BuildStep -BrandMetadata $brandMetadata
        Invoke-PackageStep -BrandMetadata $brandMetadata -RequireSignedPayload $false
    }
}
