param(
    [Parameter(Mandatory = $true)]
    [string]$FileId,

    [Parameter(Mandatory = $true)]
    [string]$DestinationRoot
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

Set-StrictMode -Version Latest

function Get-DownloadConfirmation {
    param(
        [Parameter(Mandatory = $true)]
        [string]$DriveFileId
    )

    $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    $initialUrl = "https://drive.google.com/uc?export=download&id=$DriveFileId"
    $response = Invoke-WebRequest -Uri $initialUrl -WebSession $session -UseBasicParsing -MaximumRedirection 5

    $contentTypeHeader = $response.Headers["Content-Type"]
    if ($null -eq $contentTypeHeader) {
        $contentTypeHeader = ""
    }
    $contentType = [string]$contentTypeHeader
    if ($contentType -and -not $contentType.StartsWith("text/html", [System.StringComparison]::OrdinalIgnoreCase)) {
        return @{
            Session = $session
            DownloadUrl = $response.BaseResponse.ResponseUri.AbsoluteUri
        }
    }

    $html = [string]$response.Content
    $actionMatch = [regex]::Match($html, '<form[^>]+id="download-form"[^>]+action="([^"]+)"', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if (-not $actionMatch.Success) {
        throw "Google Drive did not return a downloadable confirmation form."
    }

    $hiddenMatches = [regex]::Matches(
        $html,
        '<input[^>]+type="hidden"[^>]+name="([^"]+)"[^>]+value="([^"]*)"',
        [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
    )

    $queryPairs = New-Object System.Collections.Generic.List[string]
    foreach ($match in $hiddenMatches) {
        $name = [System.Uri]::EscapeDataString($match.Groups[1].Value)
        $value = [System.Uri]::EscapeDataString($match.Groups[2].Value)
        $queryPairs.Add("$name=$value")
    }

    if ($queryPairs.Count -eq 0) {
        throw "Google Drive confirmation form did not include any download parameters."
    }

    return @{
        Session = $session
        DownloadUrl = "{0}?{1}" -f $actionMatch.Groups[1].Value, ($queryPairs -join "&")
    }
}

function Test-ZipSignature {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $stream = [System.IO.File]::OpenRead($Path)
    try {
        if ($stream.Length -lt 4) {
            return $false
        }

        $buffer = New-Object byte[] 4
        [void]$stream.Read($buffer, 0, 4)
        return ($buffer[0] -eq 0x50 -and $buffer[1] -eq 0x4B)
    }
    finally {
        $stream.Dispose()
    }
}

function Resolve-LlmSource {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ExtractRoot
    )

    $directRoot = Join-Path $ExtractRoot "llm"
    if (Test-Path (Join-Path $directRoot "bin\\llama-server.exe")) {
        return $directRoot
    }

    if (Test-Path (Join-Path $ExtractRoot "bin\\llama-server.exe")) {
        return $ExtractRoot
    }

    $candidate = Get-ChildItem -Path $ExtractRoot -Directory -Recurse |
        Where-Object { Test-Path (Join-Path $_.FullName "bin\\llama-server.exe") } |
        Select-Object -First 1

    if ($candidate) {
        return $candidate.FullName
    }

    throw "Unable to find a llm runtime folder in the extracted archive."
}

function Install-LlmPayload {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ExtractRoot,

        [Parameter(Mandatory = $true)]
        [string]$InstallRoot
    )

    $llmSource = Resolve-LlmSource -ExtractRoot $ExtractRoot
    $llmDestination = Join-Path $InstallRoot "llm"

    if (Test-Path $llmDestination) {
        Remove-Item -Path $llmDestination -Recurse -Force
    }

    New-Item -ItemType Directory -Path $llmDestination -Force | Out-Null

    if ((Resolve-Path $llmSource).Path -eq (Resolve-Path $ExtractRoot).Path) {
        Get-ChildItem -Path $llmSource -Force | ForEach-Object {
            Copy-Item -Path $_.FullName -Destination $llmDestination -Recurse -Force
        }
    }
    else {
        Copy-Item -Path $llmSource -Destination $InstallRoot -Recurse -Force
    }

    $serverPath = Join-Path $llmDestination "bin\\llama-server.exe"
    if (-not (Test-Path $serverPath)) {
        throw "llama-server.exe was not installed into the expected llm\\bin folder."
    }

    $modelPath = Get-ChildItem -Path (Join-Path $llmDestination "models\\chatv2") -Filter *.gguf -File -Recurse |
        Sort-Object FullName |
        Select-Object -First 1

    if (-not $modelPath) {
        throw "No GGUF model was found in llm\\models\\chatv2 after extraction."
    }

    Set-Content -Path (Join-Path $InstallRoot "chatv2_llm_server_path.txt") -Value $serverPath -NoNewline
    Set-Content -Path (Join-Path $InstallRoot "chatv2_llm_model_path.txt") -Value $modelPath.FullName -NoNewline
}

$installRoot = [System.IO.Path]::GetFullPath($DestinationRoot)
$existingServerPath = Join-Path $installRoot "llm\\bin\\llama-server.exe"
$existingModel = Get-ChildItem -Path (Join-Path $installRoot "llm\\models\\chatv2") -Filter *.gguf -File -Recurse -ErrorAction SilentlyContinue |
    Select-Object -First 1

if ((Test-Path $existingServerPath) -and $existingModel) {
    Set-Content -Path (Join-Path $installRoot "chatv2_llm_server_path.txt") -Value $existingServerPath -NoNewline
    Set-Content -Path (Join-Path $installRoot "chatv2_llm_model_path.txt") -Value $existingModel.FullName -NoNewline
    Write-Host "LLM runtime already installed. Skipping download."
    exit 0
}

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("AppHostLlm_" + [System.Guid]::NewGuid().ToString("N"))
$archivePath = Join-Path $tempRoot "llm.zip"
$extractRoot = Join-Path $tempRoot "extract"

try {
    New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
    New-Item -ItemType Directory -Path $extractRoot -Force | Out-Null

    $confirmation = Get-DownloadConfirmation -DriveFileId $FileId
    Write-Host "Downloading local LLM package from Google Drive..."
    Invoke-WebRequest -Uri $confirmation.DownloadUrl -WebSession $confirmation.Session -UseBasicParsing -MaximumRedirection 5 -OutFile $archivePath

    if (-not (Test-ZipSignature -Path $archivePath)) {
        throw "Downloaded file is not a valid ZIP archive."
    }

    Write-Host "Extracting local LLM package..."
    Expand-Archive -LiteralPath $archivePath -DestinationPath $extractRoot -Force

    Write-Host "Installing local LLM package..."
    Install-LlmPayload -ExtractRoot $extractRoot -InstallRoot $installRoot

    Write-Host "Local LLM package installed successfully."
}
finally {
    if (Test-Path $tempRoot) {
        Remove-Item -Path $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
