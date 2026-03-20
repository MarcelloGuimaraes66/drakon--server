param(
    [switch]$Quiet
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$trackedReleasePaths = @(
    "x64/Release/avcodec-61.dll",
    "x64/Release/avformat-61.dll",
    "x64/Release/avutil-59.dll",
    "x64/Release/Drakon.exe",
    "x64/Release/Perceptrum.exe",
    "x64/Release/Drakon.pdb",
    "x64/Release/Perceptrum.pdb",
    "x64/Release/ffmpeg.exe",
    "x64/Release/libcurl.dll",
    "x64/Release/opencv_world4110.dll",
    "x64/Release/swresample-5.dll",
    "x64/Release/swscale-8.dll",
    "x64/Release/zlib1.dll",
    "x64/Release/llm/bin",
    "x64/Release/pairing_servidor/perceptrum_base_url.txt",
    "x64/Release/pairing_servidor/drakon_base_url.txt"
)

Push-Location $repoRoot
try {
    $existingPaths = New-Object System.Collections.Generic.List[string]
    foreach ($relativePath in $trackedReleasePaths) {
        $fullPath = Join-Path $repoRoot ($relativePath -replace "/", "\")
        if (Test-Path $fullPath) {
            $existingPaths.Add($relativePath)
        }
    }

    if ($existingPaths.Count -eq 0) {
        if (-not $Quiet) {
            Write-Host "sync-release-artifacts: no tracked release artifacts found."
        }
        exit 0
    }

    & git add --force -- @existingPaths
    if ($LASTEXITCODE -ne 0) {
        throw "git add failed while staging release artifacts."
    }

    $oversizedModels = Get-ChildItem -Path "x64/Release/llm/models" -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Length -gt 100MB }
    if ($oversizedModels -and -not $Quiet) {
        $oversizedDescriptions = $oversizedModels | ForEach-Object {
            "{0} ({1} bytes)" -f $_.FullName, $_.Length
        }
        Write-Warning (
            "Large llm/models files stay outside normal Git tracking. " +
            [string]::Join("; ", $oversizedDescriptions)
        )
    }

    if (-not $Quiet) {
        Write-Host ("sync-release-artifacts: staged {0} release path(s)." -f $existingPaths.Count)
    }
}
finally {
    Pop-Location
}
