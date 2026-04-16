$ErrorActionPreference = "Stop"

$AppDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$VenvDir = Join-Path $AppDir ".venv"
$ReqFile = Join-Path $AppDir "requirements.txt"
$ToolsDir = Join-Path $AppDir ".tools"
$WhisperRepoDir = Join-Path $ToolsDir "whisper.cpp"
$FfmpegDir = Join-Path $ToolsDir "ffmpeg"

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

function Ensure-BuildTools {
    $vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
    if (Test-Path $vswhere) {
        $installPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
        if ($installPath) {
            Write-Host "Using Visual Studio Build Tools:"
            Write-Host "  $installPath"
            return $installPath
        }
    }

    $winget = Find-CommandPath @("winget")
    if (-not $winget) {
        throw "Visual Studio Build Tools are required for the Vulkan build, but winget is not available."
    }

    Write-Host "Installing Visual Studio Build Tools for Vulkan build..."
    & $winget install -e --id Microsoft.VisualStudio.2022.BuildTools --accept-package-agreements --accept-source-agreements --override "--quiet --wait --norestart --nocache --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"

    if (Test-Path $vswhere) {
        $installPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
        if ($installPath) {
            Write-Host "Using Visual Studio Build Tools:"
            Write-Host "  $installPath"
            return $installPath
        }
    }

    throw "Visual Studio Build Tools were not found after installation."
}

function Find-VulkanSdkPath {
    if ($env:VULKAN_SDK) {
        $sdkPath = $env:VULKAN_SDK
        if ((Test-Path (Join-Path $sdkPath "Include\vulkan\vulkan.h")) -and (Test-Path (Join-Path $sdkPath "Lib\vulkan-1.lib"))) {
            return $sdkPath
        }
    }

    $sdkRoot = "C:\VulkanSDK"
    if (-not (Test-Path $sdkRoot)) {
        return $null
    }

    $candidate = Get-ChildItem -Path $sdkRoot -Directory | Sort-Object Name -Descending | Select-Object -First 1
    if (-not $candidate) {
        return $null
    }

    if ((Test-Path (Join-Path $candidate.FullName "Include\vulkan\vulkan.h")) -and (Test-Path (Join-Path $candidate.FullName "Lib\vulkan-1.lib"))) {
        return $candidate.FullName
    }

    return $null
}

function Ensure-VulkanSdk {
    $sdkPath = Find-VulkanSdkPath
    if ($sdkPath) {
        Write-Host "Using Vulkan SDK:"
        Write-Host "  $sdkPath"
        return $sdkPath
    }

    $winget = Find-CommandPath @("winget")
    if (-not $winget) {
        throw "The Vulkan SDK is required for the GPU-enabled Windows build, but winget is not available."
    }

    Write-Host "Installing Vulkan SDK..."
    & $winget install -e --id KhronosGroup.VulkanSDK --accept-package-agreements --accept-source-agreements

    $sdkPath = Find-VulkanSdkPath
    if ($sdkPath) {
        Write-Host "Using Vulkan SDK:"
        Write-Host "  $sdkPath"
        return $sdkPath
    }

    throw "The Vulkan SDK was not found after installation."
}

function Get-AvailableDriveLetter {
    foreach ($letter in @("W", "X", "Y", "Z")) {
        if (-not (Test-Path "${letter}:\")) {
            return $letter
        }
    }

    throw "Could not reserve a temporary drive letter for the whisper.cpp Vulkan build."
}

function Ensure-WhisperCpp {
    $existing = Find-CommandPath @("whisper-cli", "whisper-cpp")
    if ($existing) {
        Write-Host "Using whisper.cpp:"
        Write-Host "  $existing"
        return $existing
    }

    $localCandidates = @(
        (Join-Path $WhisperRepoDir "build\bin\Release\whisper-cli.exe"),
        (Join-Path $WhisperRepoDir "build\bin\whisper-cli.exe"),
        (Join-Path $WhisperRepoDir "build\bin\Release\whisper-cpp.exe"),
        (Join-Path $WhisperRepoDir "build\bin\whisper-cpp.exe")
    )
    $vulkanDllCandidates = @(
        (Join-Path $WhisperRepoDir "build\bin\Release\ggml-vulkan.dll"),
        (Join-Path $WhisperRepoDir "build\bin\ggml-vulkan.dll")
    )

    foreach ($candidate in $localCandidates) {
        if ((Test-Path $candidate) -and ($vulkanDllCandidates | Where-Object { Test-Path $_ })) {
            Write-Host "Using local whisper.cpp build:"
            Write-Host "  $candidate"
            return $candidate
        }
    }

    $git = Ensure-WingetPackage -CommandName "git" -WingetId "Git.Git" -Label "Git"
    $cmake = Ensure-WingetPackage -CommandName "cmake" -WingetId "Kitware.CMake" -Label "CMake"
    $buildToolsPath = Ensure-BuildTools
    $vulkanSdkPath = Ensure-VulkanSdk

    $hasSourceCheckout = (Test-Path (Join-Path $WhisperRepoDir "CMakeLists.txt")) -and (Test-Path (Join-Path $WhisperRepoDir ".git"))
    if ((Test-Path $WhisperRepoDir) -and (-not $hasSourceCheckout)) {
        Write-Host "Replacing existing whisper.cpp binaries with a source checkout for Vulkan build..."
        Remove-Item -LiteralPath $WhisperRepoDir -Recurse -Force
    }

    if (-not (Test-Path $WhisperRepoDir)) {
        New-Item -ItemType Directory -Path $ToolsDir -Force | Out-Null
        Write-Host "Cloning whisper.cpp..."
        & $git clone https://github.com/ggml-org/whisper.cpp.git $WhisperRepoDir
    } else {
        Write-Host "Updating local whisper.cpp checkout..."
        & $git -C $WhisperRepoDir fetch --tags --prune
        & $git -C $WhisperRepoDir pull --ff-only
    }

    $buildDir = Join-Path $WhisperRepoDir "build"
    if (Test-Path $buildDir) {
        Remove-Item -LiteralPath $buildDir -Recurse -Force
    }

    $env:VULKAN_SDK = $vulkanSdkPath
    Write-Host "Building whisper.cpp with Vulkan support..."
    $driveLetter = Get-AvailableDriveLetter
    $shortRoot = "${driveLetter}:"
    & subst $shortRoot $WhisperRepoDir
    try {
        & $cmake -S "${shortRoot}\" -B "${shortRoot}\build" -G "Visual Studio 17 2022" -A x64 "-DGGML_VULKAN=ON"
        & $cmake --build "${shortRoot}\build" --config Release
    } finally {
        & subst $shortRoot /d | Out-Null
    }

    foreach ($candidate in $localCandidates) {
        if ((Test-Path $candidate) -and ($vulkanDllCandidates | Where-Object { Test-Path $_ })) {
            Write-Host "Using local whisper.cpp Vulkan build:"
            Write-Host "  $candidate"
            return $candidate
        }
    }

    throw "whisper.cpp Vulkan build completed without the expected GPU binaries."
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
