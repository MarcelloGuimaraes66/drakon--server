param(
    [Parameter(Mandatory = $true)]
    [string]$TargetDir,

    [string]$PlatformName = "x64",

    [string]$VCToolsRedistDir
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Normalize-ArgumentValue {
    param(
        [string]$Value
    )

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return $null
    }

    return $Value.Trim().Trim('"')
}

function Add-SearchRoot {
    param(
        [System.Collections.Generic.List[string]]$Roots,
        [string]$Path
    )

    $Path = Normalize-ArgumentValue -Value $Path
    if ([string]::IsNullOrWhiteSpace($Path)) {
        return
    }

    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }

    $resolved = [System.IO.Path]::GetFullPath($Path)
    if (-not $Roots.Contains($resolved)) {
        $Roots.Add($resolved)
    }
}

function Resolve-CrtDirectory {
    param(
        [System.Collections.Generic.List[string]]$Roots,
        [string]$Architecture
    )

    foreach ($root in $Roots) {
        $directCandidate = Join-Path $root "$Architecture\Microsoft.VC143.CRT"
        if (Test-Path -LiteralPath $directCandidate) {
            return $directCandidate
        }

        $versionDirectories = Get-ChildItem -Path $root -Directory -ErrorAction SilentlyContinue |
            Sort-Object Name -Descending
        foreach ($versionDirectory in $versionDirectories) {
            $versionCandidate = Join-Path $versionDirectory.FullName "$Architecture\Microsoft.VC143.CRT"
            if (Test-Path -LiteralPath $versionCandidate) {
                return $versionCandidate
            }
        }
    }

    return $null
}

$TargetDir = Normalize-ArgumentValue -Value $TargetDir
$VCToolsRedistDir = Normalize-ArgumentValue -Value $VCToolsRedistDir

$targetDir = [System.IO.Path]::GetFullPath($TargetDir)
if (-not (Test-Path -LiteralPath $targetDir)) {
    New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
}

$architecture = switch ($PlatformName.ToLowerInvariant()) {
    "win32" { "x86" }
    "x64" { "x64" }
    default { throw "Unsupported platform '$PlatformName' for MSVC runtime copy." }
}

$searchRoots = New-Object System.Collections.Generic.List[string]
Add-SearchRoot -Roots $searchRoots -Path $VCToolsRedistDir
Add-SearchRoot -Roots $searchRoots -Path $env:VCToolsRedistDir
if (-not [string]::IsNullOrWhiteSpace($env:VCInstallDir)) {
    Add-SearchRoot -Roots $searchRoots -Path (Join-Path $env:VCInstallDir "Redist\MSVC")
}

$visualStudioRoots = @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:ProgramW6432) |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
    ForEach-Object { Join-Path $_ "Microsoft Visual Studio" } |
    Select-Object -Unique |
    Where-Object { Test-Path -LiteralPath $_ }

foreach ($visualStudioRoot in $visualStudioRoots) {
    $yearDirectories = Get-ChildItem -Path $visualStudioRoot -Directory -ErrorAction SilentlyContinue
    foreach ($yearDirectory in $yearDirectories) {
        $editionDirectories = Get-ChildItem -Path $yearDirectory.FullName -Directory -ErrorAction SilentlyContinue
        foreach ($editionDirectory in $editionDirectories) {
            Add-SearchRoot -Roots $searchRoots -Path (Join-Path $editionDirectory.FullName "VC\Redist\MSVC")
        }
    }
}

$crtDirectory = Resolve-CrtDirectory -Roots $searchRoots -Architecture $architecture
if (-not $crtDirectory) {
    $searched = if ($searchRoots.Count -gt 0) {
        [string]::Join("; ", $searchRoots)
    }
    else {
        "<none>"
    }

    throw "Unable to locate Microsoft.VC143.CRT for platform '$PlatformName'. Searched: $searched"
}

$runtimeFiles = Get-ChildItem -Path $crtDirectory -Filter *.dll -File | Sort-Object Name
if (-not $runtimeFiles) {
    throw "No MSVC runtime DLLs found in '$crtDirectory'."
}

foreach ($runtimeFile in $runtimeFiles) {
    Copy-Item -LiteralPath $runtimeFile.FullName -Destination (Join-Path $targetDir $runtimeFile.Name) -Force
}

Write-Host ("copy-msvc-runtime: copied {0} DLL(s) from '{1}' to '{2}'." -f $runtimeFiles.Count, $crtDirectory, $targetDir)
