$ErrorActionPreference = "Stop"

$AppDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$VenvDir = Join-Path $AppDir ".venv"
$ReqFile = Join-Path $AppDir "requirements.txt"
$ToolsDir = Join-Path $AppDir ".tools"
$WhisperRepoDir = Join-Path $ToolsDir "whisper.cpp"
$FfmpegDir = Join-Path $ToolsDir "ffmpeg"
$NinjaDir = Join-Path $ToolsDir "ninja"

function Write-Section {
    param([string]$Title)
    Write-Host ""
    Write-Host "======================================"
    Write-Host "  $Title"
    Write-Host "======================================"
    Write-Host ""
}

function Find-CommandPath {
    param([string[]]$Names)

    foreach ($name in $Names) {
        $cmd = Get-Command $name -ErrorAction SilentlyContinue
        if ($cmd) {
            return $cmd.Source
        }
    }

    $commonPaths = @{
        "git" = @(
            "C:\Program Files\Git\cmd\git.exe",
            "C:\Program Files\Git\bin\git.exe"
        )
        "cmake" = @(
            "C:\Program Files\CMake\bin\cmake.exe"
        )
        "clang" = @(
            "C:\Program Files\LLVM\bin\clang.exe"
        )
        "clang++" = @(
            "C:\Program Files\LLVM\bin\clang++.exe"
        )
        "python" = @(
            "C:\Users\$env:USERNAME\AppData\Local\Programs\Python\Python311\python.exe",
            "C:\Program Files\Python311\python.exe"
        )
        "python3" = @(
            "C:\Users\$env:USERNAME\AppData\Local\Programs\Python\Python311\python.exe",
            "C:\Program Files\Python311\python.exe"
        )
        "py" = @(
            "C:\Windows\py.exe"
        )
        "winget" = @(
            "C:\Users\$env:USERNAME\AppData\Local\Microsoft\WindowsApps\winget.exe"
        )
    }

    foreach ($name in $Names) {
        if ($commonPaths.ContainsKey($name)) {
            foreach ($candidate in $commonPaths[$name]) {
                if (Test-Path $candidate) {
                    return $candidate
                }
            }
        }
    }

    return $null
}

function Ensure-WingetPackage {
    param(
        [string]$CommandName,
        [string]$WingetId,
        [string]$Label
    )

    $existing = Find-CommandPath @($CommandName)
    if ($existing) {
        Write-Host "${Label} already available:"
        Write-Host "  $existing"
        return $existing
    }

    $winget = Find-CommandPath @("winget")
    if (-not $winget) {
        throw "$Label was not found and winget is not available. Install $Label manually, then rerun setup."
    }

    Write-Host "Installing $Label with winget..."
    & $winget install -e --id $WingetId --accept-package-agreements --accept-source-agreements

    $resolved = Find-CommandPath @($CommandName)
    if (-not $resolved) {
        throw "$Label was not found after installation."
    }

    Write-Host "Using ${Label}:"
    Write-Host "  $resolved"
    return $resolved
}

function Find-Python {
    $candidates = @("python", "python3", "py")
    foreach ($candidate in $candidates) {
        $path = Find-CommandPath @($candidate)
        if (-not $path) {
            continue
        }

        if ($candidate -eq "py") {
            & $path -3.11 -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)" 2>$null
            if ($LASTEXITCODE -eq 0) {
                return @($path, "-3.11")
            }
            continue
        }

        & $path -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)" 2>$null
        if ($LASTEXITCODE -eq 0) {
            return @($path)
        }
    }

    Ensure-WingetPackage -CommandName "python" -WingetId "Python.Python.3.11" -Label "Python 3.11" | Out-Null
    $python = Find-CommandPath @("python")
    if (-not $python) {
        throw "Python 3.11 was not found after installation."
    }
    return @($python)
}

function Test-VenvHealthy {
    $venvPython = Join-Path $VenvDir "Scripts\python.exe"
    if (-not (Test-Path $venvPython)) {
        return $false
    }

    & $venvPython -c "import sys; print(sys.prefix)" *> $null
    if ($LASTEXITCODE -ne 0) {
        return $false
    }

    & $venvPython -m pip --version *> $null
    return $LASTEXITCODE -eq 0
}

function Ensure-Ffmpeg {
    $existing = Find-CommandPath @("ffmpeg")
    if ($existing) {
        Write-Host "Using ffmpeg:"
        Write-Host "  $existing"
        return $existing
    }

    $local = Join-Path $FfmpegDir "bin\ffmpeg.exe"
    if (Test-Path $local) {
        Write-Host "Using bundled ffmpeg:"
        Write-Host "  $local"
        return $local
    }

    $downloadUrl = "https://github.com/GyanD/codexffmpeg/releases/download/8.0.1/ffmpeg-8.0.1-essentials_build.zip"
    $zipPath = Join-Path $env:TEMP "whisper-drop-ffmpeg.zip"
    $extractRoot = Join-Path $env:TEMP "whisper-drop-ffmpeg"

    Write-Host "Downloading ffmpeg..."
    Invoke-WebRequest -Uri $downloadUrl -OutFile $zipPath

    if (Test-Path $extractRoot) {
        Remove-Item -LiteralPath $extractRoot -Recurse -Force
    }

    Expand-Archive -LiteralPath $zipPath -DestinationPath $extractRoot -Force
    New-Item -ItemType Directory -Path $FfmpegDir -Force | Out-Null

    $expanded = Get-ChildItem -Path $extractRoot -Directory | Select-Object -First 1
    if (-not $expanded) {
        throw "ffmpeg archive extraction failed."
    }

    Copy-Item -LiteralPath (Join-Path $expanded.FullName "bin") -Destination $FfmpegDir -Recurse -Force
    $resolved = Join-Path $FfmpegDir "bin\ffmpeg.exe"

    if (-not (Test-Path $resolved)) {
        throw "ffmpeg was not found after download."
    }

    Write-Host "Using bundled ffmpeg:"
    Write-Host "  $resolved"
    return $resolved
}

function Ensure-Ninja {
    $existing = Find-CommandPath @("ninja")
    if ($existing) {
        Write-Host "Using Ninja:"
        Write-Host "  $existing"
        return $existing
    }

    $local = Join-Path $NinjaDir "ninja.exe"
    if (Test-Path $local) {
        Write-Host "Using bundled Ninja:"
        Write-Host "  $local"
        return $local
    }

    $downloadUrl = "https://github.com/ninja-build/ninja/releases/download/v1.13.2/ninja-win.zip"
    $zipPath = Join-Path $env:TEMP "whisper-drop-ninja.zip"

    Write-Host "Downloading Ninja..."
    Invoke-WebRequest -Uri $downloadUrl -OutFile $zipPath

    New-Item -ItemType Directory -Path $NinjaDir -Force | Out-Null
    Expand-Archive -LiteralPath $zipPath -DestinationPath $NinjaDir -Force

    if (-not (Test-Path $local)) {
        throw "Ninja was not found after download."
    }

    Write-Host "Using bundled Ninja:"
    Write-Host "  $local"
    return $local
}

function Ensure-WhisperCpp {
    $existing = Find-CommandPath @("whisper-cli", "whisper-cpp")
    if ($existing) {
        Write-Host "Using whisper.cpp:"
        Write-Host "  $existing"
        return $existing
    }

    $localCandidates = @(
        (Join-Path $WhisperRepoDir "Release\whisper-cli.exe"),
        (Join-Path $WhisperRepoDir "Release\whisper-cpp.exe"),
        (Join-Path $WhisperRepoDir "build\bin\Release\whisper-cli.exe"),
        (Join-Path $WhisperRepoDir "build\bin\whisper-cli.exe"),
        (Join-Path $WhisperRepoDir "build\bin\Release\whisper-cpp.exe"),
        (Join-Path $WhisperRepoDir "build\bin\whisper-cpp.exe")
    )

    foreach ($candidate in $localCandidates) {
        if (Test-Path $candidate) {
            Write-Host "Using local whisper.cpp build:"
            Write-Host "  $candidate"
            return $candidate
        }
    }

    $downloadUrl = "https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.4/whisper-bin-x64.zip"
    $zipPath = Join-Path $env:TEMP "whisper-drop-whispercpp.zip"

    Write-Host "Downloading whisper.cpp Windows binary..."
    Invoke-WebRequest -Uri $downloadUrl -OutFile $zipPath

    if (Test-Path $WhisperRepoDir) {
        Remove-Item -LiteralPath $WhisperRepoDir -Recurse -Force
    }

    New-Item -ItemType Directory -Path $WhisperRepoDir -Force | Out-Null
    Expand-Archive -LiteralPath $zipPath -DestinationPath $WhisperRepoDir -Force

    foreach ($candidate in $localCandidates) {
        if (Test-Path $candidate) {
            Write-Host "Using bundled whisper.cpp:"
            Write-Host "  $candidate"
            return $candidate
        }
    }

    throw "whisper.cpp was not found after download."
}

Write-Section "WhisperDrop - Windows Setup"

$pythonCommand = @(Find-Python)
$pythonExe = $pythonCommand[0]
$pythonArgs = @()
if ($pythonCommand.Count -gt 1) {
    $pythonArgs = $pythonCommand[1..($pythonCommand.Count - 1)]
}

Ensure-Ffmpeg | Out-Null
Ensure-WhisperCpp | Out-Null

if (-not (Test-Path $VenvDir)) {
    Write-Host "Creating local virtual environment..."
    & $pythonExe @pythonArgs -m venv $VenvDir
} elseif (Test-VenvHealthy) {
    Write-Host "Local virtual environment already exists"
} else {
    Write-Host "Existing virtual environment is outdated or was moved. Recreating it..."
    Remove-Item -LiteralPath $VenvDir -Recurse -Force
    & $pythonExe @pythonArgs -m venv $VenvDir
}

$venvPython = Join-Path $VenvDir "Scripts\python.exe"

Write-Host "Upgrading pip..."
& $venvPython -m pip install --upgrade pip

Write-Host "Installing Python packages..."
& $venvPython -m pip install -r $ReqFile

Write-Host "Running installation checks..."
& $venvPython -c "import tkinter; import tkinterdnd2; print('tkinter OK'); print('tkinterdnd2 OK')"

Write-Section "Setup complete"
Write-Host "To open the app:"
Write-Host "  double-click 'WhisperDrop.bat'"
Write-Host ""
Write-Host "If you prefer PowerShell:"
Write-Host "  $venvPython $AppDir\transcriber.py"
