[CmdletBinding(DefaultParameterSetName = "Thumbprint", SupportsShouldProcess = $true)]
param(
    [ValidateSet("drakon", "perceptrum")]
    [string]$Brand = "perceptrum",
    [string]$Configuration = "Release",
    [ValidateSet("Payload", "Installer", "All")]
    [string]$Target = "Payload",
    [string]$ManifestPath,
    [Parameter(Mandatory = $true)]
    [string]$TimestampUrl,
    [string]$Description,
    [string]$DescriptionUrl,
    [string]$SignToolPath,
    [switch]$Force,
    [Parameter(Mandatory = $true, ParameterSetName = "Thumbprint")]
    [string]$CertificateThumbprint,
    [Parameter(Mandatory = $true, ParameterSetName = "Subject")]
    [string]$CertificateSubject,
    [Parameter(Mandatory = $true, ParameterSetName = "Pfx")]
    [string]$PfxPath,
    [Parameter(Mandatory = $true, ParameterSetName = "Pfx")]
    [string]$PfxPasswordEnvVar
)

$ErrorActionPreference = "Stop"
$script:OuterPSCmdlet = $PSCmdlet
$script:SelectedParameterSet = $PSCmdlet.ParameterSetName

function Resolve-DefaultManifestPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$BrandName,
        [Parameter(Mandatory = $true)]
        [string]$BuildConfiguration
    )

    $appHostRoot = Split-Path -Path $PSScriptRoot -Parent
    return Join-Path $appHostRoot "artifacts\$BrandName\$BuildConfiguration\build-manifest.json"
}

function Resolve-PathOrThrow {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [string]$Label
    )

    $resolvedPath = Resolve-Path -Path $Path -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty Path -First 1

    if (-not $resolvedPath) {
        throw "$Label not found: $Path"
    }

    return $resolvedPath
}

function Read-BuildManifest {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ResolvedManifestPath
    )

    return Get-Content -Path $ResolvedManifestPath -Raw | ConvertFrom-Json
}

function Resolve-SignToolExecutable {
    param(
        [string]$ExplicitPath
    )

    if (-not [string]::IsNullOrWhiteSpace($ExplicitPath)) {
        return Resolve-PathOrThrow -Path $ExplicitPath -Label "SignTool"
    }

    $command = Get-Command signtool.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command) {
        return $command.Source
    }

    $candidateRoots = @(
        (Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin"),
        (Join-Path ${env:ProgramFiles} "Windows Kits\10\bin")
    ) | Where-Object { $_ -and (Test-Path $_) }

    $candidates = foreach ($root in $candidateRoots) {
        Get-ChildItem -Path $root -Filter signtool.exe -Recurse -ErrorAction SilentlyContinue |
            Sort-Object -Property FullName -Descending
    }

    $x64Candidate = $candidates | Where-Object { $_.FullName -match '\\x64\\signtool\.exe$' } | Select-Object -First 1
    if ($x64Candidate) {
        return $x64Candidate.FullName
    }

    $firstCandidate = $candidates | Select-Object -First 1
    if ($firstCandidate) {
        return $firstCandidate.FullName
    }

    throw (
        "signtool.exe was not found. Install the Windows SDK Signing Tools or pass -SignToolPath."
    )
}

function Normalize-Thumbprint {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Thumbprint
    )

    return ($Thumbprint -replace '\s', '').ToUpperInvariant()
}

function Test-CodeSigningEnhancedKeyUsage {
    param(
        [Parameter(Mandatory = $true)]
        [System.Security.Cryptography.X509Certificates.X509Certificate2]$Certificate
    )

    foreach ($eku in $Certificate.EnhancedKeyUsageList) {
        if ($eku.Value -eq "1.3.6.1.5.5.7.3.3") {
            return $true
        }
    }

    return $false
}

function Get-StoreCodeSigningCertificates {
    $storePaths = @("Cert:\CurrentUser\My", "Cert:\LocalMachine\My")

    foreach ($storePath in $storePaths) {
        if (-not (Test-Path $storePath)) {
            continue
        }

        foreach ($certificate in Get-ChildItem -Path $storePath -ErrorAction SilentlyContinue) {
            if (-not $certificate.HasPrivateKey) {
                continue
            }

            if ($certificate.NotAfter -le (Get-Date)) {
                continue
            }

            if (-not (Test-CodeSigningEnhancedKeyUsage -Certificate $certificate)) {
                continue
            }

            $certificate
        }
    }
}

function Resolve-CertificateThumbprint {
    switch ($script:SelectedParameterSet) {
        "Thumbprint" {
            $normalizedThumbprint = Normalize-Thumbprint -Thumbprint $CertificateThumbprint
            $match = Get-StoreCodeSigningCertificates |
                Where-Object { (Normalize-Thumbprint -Thumbprint $_.Thumbprint) -eq $normalizedThumbprint } |
                Select-Object -First 1

            if (-not $match) {
                throw (
                    "Code signing certificate '$normalizedThumbprint' was not found in Cert:\CurrentUser\My or Cert:\LocalMachine\My."
                )
            }

            return $match.Thumbprint
        }
        "Subject" {
            $matches = @(
                Get-StoreCodeSigningCertificates |
                    Where-Object {
                        $_.Subject -like "*$CertificateSubject*" -or
                        $_.FriendlyName -like "*$CertificateSubject*"
                    } |
                    Sort-Object -Property NotAfter -Descending
            )

            if ($matches.Count -eq 0) {
                throw (
                    "No code signing certificate matching '$CertificateSubject' was found in Cert:\CurrentUser\My or Cert:\LocalMachine\My."
                )
            }

            if ($matches.Count -gt 1) {
                Write-Warning (
                    "Multiple certificates matched '$CertificateSubject'. Using the one that expires last: " +
                    $matches[0].Subject
                )
            }

            return $matches[0].Thumbprint
        }
        "Pfx" {
            return $null
        }
        default {
            throw "Unsupported parameter set '$($script:SelectedParameterSet)'."
        }
    }
}

function Get-SignTargets {
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject]$Manifest
    )

    $targets = @()

    if ($Target -in @("Payload", "All")) {
        $targets += [pscustomobject]@{
            Name = "Payload"
            Path = [string]$Manifest.payloadExePath
        }
    }

    if ($Target -in @("Installer", "All")) {
        $targets += [pscustomobject]@{
            Name = "Installer"
            Path = [string]$Manifest.installerOutputPath
        }
    }

    foreach ($item in $targets) {
        if ([string]::IsNullOrWhiteSpace($item.Path)) {
            throw "$($item.Name) path is missing from the build manifest."
        }

        $item.Path = Resolve-PathOrThrow -Path $item.Path -Label $item.Name
    }

    return $targets
}

function Get-ExistingSignature {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath
    )

    try {
        return Get-AuthenticodeSignature -FilePath $FilePath
    } catch {
        return $null
    }
}

function Get-PfxPassword {
    if (-not $PfxPasswordEnvVar) {
        throw "PFX mode requires -PfxPasswordEnvVar."
    }

    $passwordValue = [Environment]::GetEnvironmentVariable($PfxPasswordEnvVar)
    if ([string]::IsNullOrWhiteSpace($passwordValue)) {
        throw "Environment variable '$PfxPasswordEnvVar' is empty or not defined."
    }

    return $passwordValue
}

function Build-SignToolArguments {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath,
        [string]$ResolvedThumbprint
    )

    $arguments = @(
        "sign",
        "/fd", "SHA256",
        "/tr", $TimestampUrl,
        "/td", "SHA256"
    )

    if (-not [string]::IsNullOrWhiteSpace($Description)) {
        $arguments += @("/d", $Description)
    }

    if (-not [string]::IsNullOrWhiteSpace($DescriptionUrl)) {
        $arguments += @("/du", $DescriptionUrl)
    }

    switch ($script:SelectedParameterSet) {
        "Thumbprint" {
            $arguments += @("/sha1", $ResolvedThumbprint)
        }
        "Subject" {
            $arguments += @("/sha1", $ResolvedThumbprint)
        }
        "Pfx" {
            $resolvedPfxPath = Resolve-PathOrThrow -Path $PfxPath -Label "PFX file"
            $pfxPassword = Get-PfxPassword
            $arguments += @("/f", $resolvedPfxPath, "/p", $pfxPassword)
        }
        default {
            throw "Unsupported parameter set '$($script:SelectedParameterSet)'."
        }
    }

    $arguments += $FilePath
    return $arguments
}

function Invoke-SignFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ResolvedSignToolPath,
        [Parameter(Mandatory = $true)]
        [pscustomobject]$TargetInfo,
        [string]$ResolvedThumbprint
    )

    $existingSignature = Get-ExistingSignature -FilePath $TargetInfo.Path
    if (-not $Force.IsPresent -and $existingSignature -and $existingSignature.SignerCertificate) {
        Write-Host "Skipping $($TargetInfo.Name): $($TargetInfo.Path)"
        Write-Host "  Existing signer: $($existingSignature.SignerCertificate.Subject)"
        return
    }

    $arguments = Build-SignToolArguments -FilePath $TargetInfo.Path -ResolvedThumbprint $ResolvedThumbprint
    $renderedArguments = ($arguments | ForEach-Object {
        if ($_ -match '\s') {
            '"' + $_ + '"'
        } else {
            $_
        }
    }) -join ' '

    if (-not $script:OuterPSCmdlet.ShouldProcess($TargetInfo.Path, "signtool.exe $renderedArguments")) {
        return
    }

    & $ResolvedSignToolPath @arguments

    if ($LASTEXITCODE -ne 0) {
        throw (
            "signtool.exe failed with exit code {0} while signing {1}." -f $LASTEXITCODE, $TargetInfo.Path
        )
    }

    $signature = Get-ExistingSignature -FilePath $TargetInfo.Path
    if (-not $signature -or -not $signature.SignerCertificate) {
        throw "Signing completed but $($TargetInfo.Path) still does not contain an Authenticode signature."
    }

    Write-Host "Signed $($TargetInfo.Name): $($TargetInfo.Path)"
    Write-Host "  Status: $($signature.Status)"
    Write-Host "  Signer: $($signature.SignerCertificate.Subject)"
}

$effectiveManifestPath = if ([string]::IsNullOrWhiteSpace($ManifestPath)) {
    Resolve-DefaultManifestPath -BrandName $Brand -BuildConfiguration $Configuration
} else {
    $ManifestPath
}

$resolvedManifestPath = Resolve-PathOrThrow -Path $effectiveManifestPath -Label "Build manifest"
$manifest = Read-BuildManifest -ResolvedManifestPath $resolvedManifestPath
$signTargets = Get-SignTargets -Manifest $manifest
$resolvedSignToolPath = Resolve-SignToolExecutable -ExplicitPath $SignToolPath
$resolvedThumbprint = Resolve-CertificateThumbprint

Write-Host "Using build manifest: $resolvedManifestPath"
Write-Host "Using SignTool: $resolvedSignToolPath"
Write-Host "Target selection: $Target"

foreach ($signTarget in $signTargets) {
    Invoke-SignFile -ResolvedSignToolPath $resolvedSignToolPath -TargetInfo $signTarget -ResolvedThumbprint $resolvedThumbprint
}
