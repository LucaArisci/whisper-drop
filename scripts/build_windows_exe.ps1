param(
    [string]$Version = "1.0.0",
    [switch]$NoBundleTools,
    [switch]$NoClean,
    [switch]$OneFile,
    [switch]$Verify
)

$ErrorActionPreference = "Stop"

$AppName = "WhisperDrop"
$RootDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$VenvDir = Join-Path $RootDir ".venv"
$VenvPython = Join-Path $VenvDir "Scripts\python.exe"
$BuildRoot = Join-Path $RootDir "build\windows"
$WorkDir = Join-Path $BuildRoot "pyinstaller"
$DistRoot = Join-Path $RootDir "dist"
$AppDist = Join-Path $DistRoot $AppName
$OneFileDist = Join-Path $DistRoot "$AppName-onefile"
$IconPng = Join-Path $RootDir "assets\app-icon\whisperdrop-icon.png"
$IconIco = Join-Path $BuildRoot "WhisperDrop.ico"
$ExePath = Join-Path $AppDist "$AppName.exe"
if ($OneFile) {
    $ExePath = Join-Path $OneFileDist "$AppName.exe"
}

function Write-Section {
    param([string]$Title)
    Write-Host ""
    Write-Host "======================================"
    Write-Host "  $Title"
    Write-Host "======================================"
    Write-Host ""
}

function Invoke-Checked {
    param(
        [string]$FilePath,
        [string[]]$Arguments
    )

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$FilePath failed with exit code $LASTEXITCODE."
    }
}

function Copy-DirectoryContents {
    param(
        [string]$Source,
        [string]$Destination
    )

    if (-not (Test-Path $Source)) {
        return $false
    }

    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    Copy-Item -Path (Join-Path $Source "*") -Destination $Destination -Recurse -Force
    return $true
}

function Copy-SelectedFiles {
    param(
        [string]$Source,
        [string]$Destination,
        [string[]]$Names
    )

    if (-not (Test-Path $Source)) {
        return $false
    }

    $copiedAny = $false
    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    foreach ($name in $Names) {
        $sourcePath = Join-Path $Source $name
        if (Test-Path $sourcePath) {
            Copy-Item -LiteralPath $sourcePath -Destination $Destination -Force
            $copiedAny = $true
        }
    }

    return $copiedAny
}

function Ensure-Venv {
    if (Test-Path $VenvPython) {
        return
    }

    Write-Host "Local virtual environment was not found. Running setup first..."
    powershell -ExecutionPolicy Bypass -File (Join-Path $RootDir "scripts\setup.ps1")

    if (-not (Test-Path $VenvPython)) {
        throw "Setup completed without creating $VenvPython."
    }
}

function Ensure-BuildPackages {
    Write-Host "Installing Windows packaging dependencies..."
    Invoke-Checked $VenvPython @("-m", "pip", "install", "--upgrade", "pip")
    Invoke-Checked $VenvPython @("-m", "pip", "install", "-r", (Join-Path $RootDir "requirements.txt"))
    Invoke-Checked $VenvPython @("-m", "pip", "install", "--upgrade", "pyinstaller", "pillow")
}

function New-AppIcon {
    if (-not (Test-Path $IconPng)) {
        return $null
    }

    New-Item -ItemType Directory -Path $BuildRoot -Force | Out-Null
    $iconScript = @"
from pathlib import Path
from PIL import Image

source = Path(r"$IconPng")
target = Path(r"$IconIco")
image = Image.open(source).convert("RGBA")
sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
image.save(target, sizes=sizes)
"@
    $iconScript | & $VenvPython -
    if ($LASTEXITCODE -ne 0) {
        throw "Icon generation failed with exit code $LASTEXITCODE."
    }
    return $IconIco
}

function Copy-ReleaseTools {
    if ($NoBundleTools) {
        Write-Host "Skipping bundled runtime tools."
        return
    }

    Write-Host "Copying bundled runtime tools..."
    $copiedFfmpeg = Copy-SelectedFiles `
        -Source (Join-Path $RootDir ".tools\ffmpeg\bin") `
        -Destination (Join-Path $AppDist ".tools\ffmpeg\bin") `
        -Names @("ffmpeg.exe")

    $whisperSource = Join-Path $RootDir ".tools\whisper.cpp\build\bin\Release"
    if (-not (Test-Path $whisperSource)) {
        $whisperSource = Join-Path $RootDir ".tools\whisper.cpp\Release"
    }
    $copiedWhisper = Copy-SelectedFiles `
        -Source $whisperSource `
        -Destination (Join-Path $AppDist ".tools\whisper.cpp\build\bin\Release") `
        -Names @(
            "whisper-cli.exe",
            "whisper.dll",
            "ggml.dll",
            "ggml-base.dll",
            "ggml-cpu.dll",
            "ggml-vulkan.dll"
        )

    if (-not $copiedFfmpeg) {
        Write-Warning "ffmpeg was not found under .tools. Run scripts\setup.ps1 before packaging a fully portable build."
    }
    if (-not $copiedWhisper) {
        Write-Warning "whisper.cpp was not found under .tools. Run scripts\setup.ps1 before packaging a fully portable build."
    }
}

function Get-WhisperSourceDir {
    $whisperSource = Join-Path $RootDir ".tools\whisper.cpp\build\bin\Release"
    if (-not (Test-Path $whisperSource)) {
        $whisperSource = Join-Path $RootDir ".tools\whisper.cpp\Release"
    }
    return $whisperSource
}

function Add-BundledToolArgs {
    param([string[]]$PyInstallerArgs)

    if ($NoBundleTools) {
        Write-Host "Skipping bundled runtime tools."
        return $PyInstallerArgs
    }

    $ffmpeg = Join-Path $RootDir ".tools\ffmpeg\bin\ffmpeg.exe"
    if (Test-Path $ffmpeg) {
        $PyInstallerArgs += @("--add-binary", "$ffmpeg;.tools\ffmpeg\bin")
    } else {
        Write-Warning "ffmpeg was not found under .tools. Run scripts\setup.ps1 before packaging a fully portable build."
    }

    $whisperSource = Get-WhisperSourceDir
    foreach ($name in @("whisper-cli.exe", "whisper.dll", "ggml.dll", "ggml-base.dll", "ggml-cpu.dll", "ggml-vulkan.dll")) {
        $sourcePath = Join-Path $whisperSource $name
        if (Test-Path $sourcePath) {
            $PyInstallerArgs += @("--add-binary", "$sourcePath;.tools\whisper.cpp\build\bin\Release")
        }
    }

    return $PyInstallerArgs
}

Write-Section "$AppName - Windows EXE Build"
Ensure-Venv
Ensure-BuildPackages

$ActiveDist = if ($OneFile) { $OneFileDist } else { $AppDist }
if ((Test-Path $ActiveDist) -and (-not $NoClean)) {
    Remove-Item -LiteralPath $ActiveDist -Recurse -Force
}

New-Item -ItemType Directory -Path $BuildRoot -Force | Out-Null
$ResolvedIcon = New-AppIcon
$PyInstallerDistPath = if ($OneFile) { $OneFileDist } else { $DistRoot }

$pyinstallerArgs = @(
    "--noconfirm",
    "--windowed",
    "--name", $AppName,
    "--distpath", $PyInstallerDistPath,
    "--workpath", $WorkDir,
    "--specpath", $BuildRoot,
    "--collect-all", "tkinterdnd2",
    "--collect-all", "yt_dlp"
)

if ($OneFile) {
    $pyinstallerArgs += "--onefile"
    $pyinstallerArgs = Add-BundledToolArgs $pyinstallerArgs
}

if (-not $NoClean) {
    $pyinstallerArgs += "--clean"
}
if ($ResolvedIcon) {
    $pyinstallerArgs += @("--icon", $ResolvedIcon)
}

$pyinstallerArgs += (Join-Path $RootDir "transcriber.py")

Write-Host "Running PyInstaller..."
Invoke-Checked $VenvPython (@("-m", "PyInstaller") + $pyinstallerArgs)

if (-not (Test-Path $ExePath)) {
    throw "PyInstaller did not create $ExePath."
}

if (-not $OneFile) {
    Copy-Item -LiteralPath (Join-Path $RootDir "README.md") -Destination $AppDist -Force
    Copy-Item -LiteralPath (Join-Path $RootDir "LICENSE") -Destination $AppDist -Force
    if (Test-Path (Join-Path $RootDir "assets")) {
        Copy-Item -LiteralPath (Join-Path $RootDir "assets") -Destination $AppDist -Recurse -Force
    }

    Copy-ReleaseTools
}

$releaseInfo = @"
WhisperDrop $Version

Run WhisperDrop.exe to open the app.
Models are downloaded on first use and cached in %LOCALAPPDATA%\WhisperDrop\.models.
YouTube downloads and transcripts are saved under the user's Downloads\WhisperDrop folder.
"@
if (-not $OneFile) {
    $releaseInfo | Set-Content -LiteralPath (Join-Path $AppDist "RELEASE.txt") -Encoding UTF8
}

if ($Verify) {
    Write-Host "Running packaged self-test..."
    & $ExePath --self-test
    if ($LASTEXITCODE -ne 0) {
        throw "Packaged self-test failed with exit code $LASTEXITCODE."
    }
}

Write-Section "Build complete"
Write-Host $ExePath
