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

    foreach ($name in $Names) {
        $whereMatches = @(& cmd.exe /d /c "where $name 2>nul")
        foreach ($match in $whereMatches) {
            if (Test-Path $match) {
                return $match
            }
        }
    }

    $appPathRoots = @(
        "Registry::HKEY_CURRENT_USER\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths",
        "Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths",
        "Registry::HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths"
    )

    foreach ($name in $Names) {
        $exeName = if ($name.ToLower().EndsWith(".exe")) { $name } else { "$name.exe" }
        foreach ($root in $appPathRoots) {
            $keyPath = Join-Path $root $exeName
            if (Test-Path $keyPath) {
                $resolved = (Get-Item $keyPath).GetValue("")
                if ($resolved -and (Test-Path $resolved)) {
                    return $resolved
                }
            }
        }
    }

    return $null
}

function Get-RegisteredPythonPath {
    $pythonRoots = @(
        "Registry::HKEY_CURRENT_USER\SOFTWARE\Python\PythonCore",
        "Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Python\PythonCore",
        "Registry::HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Python\PythonCore"
    )

    $bestVersion = $null
    $bestPath = $null

    foreach ($root in $pythonRoots) {
        if (-not (Test-Path $root)) {
            continue
        }

        foreach ($versionKey in Get-ChildItem $root -ErrorAction SilentlyContinue) {
            $version = $null
            if (-not [version]::TryParse($versionKey.PSChildName, [ref]$version)) {
                continue
            }

            if ($version -lt [version]"3.11") {
                continue
            }

            $installKey = Join-Path $versionKey.PSPath "InstallPath"
            if (-not (Test-Path $installKey)) {
                continue
            }

            $installPath = (Get-Item $installKey).GetValue("")
            if (-not $installPath) {
                continue
            }

            $pythonExe = Join-Path $installPath "python.exe"
            if ((Test-Path $pythonExe) -and (($bestVersion -eq $null) -or ($version -gt $bestVersion))) {
                $bestVersion = $version
                $bestPath = $pythonExe
            }
        }
    }

    return $bestPath
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

    $registeredPython = Get-RegisteredPythonPath
    if ($registeredPython) {
        & $registeredPython -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)" 2>$null
        if ($LASTEXITCODE -eq 0) {
            return @($registeredPython)
        }
    }

    Ensure-WingetPackage -CommandName "python" -WingetId "Python.Python.3.11" -Label "Python 3.11" | Out-Null
    $python = Find-CommandPath @("python")
    if (-not $python) {
        $python = Get-RegisteredPythonPath
    }
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

    $registryLayerRoots = @(
        "Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Khronos\Vulkan\ExplicitLayers",
        "Registry::HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Khronos\Vulkan\ExplicitLayers",
        "Registry::HKEY_CURRENT_USER\SOFTWARE\Khronos\Vulkan\ExplicitLayers"
    )

    $sdkCandidates = @()
    foreach ($root in $registryLayerRoots) {
        if (-not (Test-Path $root)) {
            continue
        }

        $properties = Get-ItemProperty $root -ErrorAction SilentlyContinue
        foreach ($property in $properties.PSObject.Properties) {
            if ($property.Name -like "PS*") {
                continue
            }

            $layerPath = $property.Name
            if (-not (Test-Path $layerPath)) {
                continue
            }

            $layerParent = Split-Path $layerPath -Parent
            if ($layerParent) {
                $sdkCandidates += (Split-Path $layerParent -Parent)
            }
        }
    }

    foreach ($candidate in ($sdkCandidates | Where-Object { $_ } | Sort-Object -Unique)) {
        if ((Test-Path (Join-Path $candidate "Include\vulkan\vulkan.h")) -and (Test-Path (Join-Path $candidate "Lib\vulkan-1.lib"))) {
            return $candidate
        }
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

function Get-LocalWhisperBinary {
    param(
        [switch]$RequireVulkan
    )

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
    $hasVulkan = [bool]($vulkanDllCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1)

    foreach ($candidate in $localCandidates) {
        if (-not (Test-Path $candidate)) {
            continue
        }

        if ($RequireVulkan -and (-not $hasVulkan)) {
            continue
        }

        return [PSCustomObject]@{
            Path = $candidate
            HasVulkan = $hasVulkan
        }
    }

    return $null
}

function Invoke-WhisperCppBuild {
    param(
        [string]$CMakePath,
        [bool]$EnableVulkan,
        [string]$VulkanSdkPath
    )

    $repoBuildDir = Join-Path $WhisperRepoDir "build"
    if (Test-Path $repoBuildDir) {
        Remove-Item -LiteralPath $repoBuildDir -Recurse -Force
    }

    $buildFlavor = if ($EnableVulkan) { "vulkan" } else { "cpu" }
    $buildRoot = Join-Path $env:TEMP "whisper-drop-build-$buildFlavor"
    if (Test-Path $buildRoot) {
        Remove-Item -LiteralPath $buildRoot -Recurse -Force
    }
    New-Item -ItemType Directory -Path $buildRoot -Force | Out-Null

    $previousVulkanSdk = $env:VULKAN_SDK
    if ($EnableVulkan -and $VulkanSdkPath) {
        $env:VULKAN_SDK = $VulkanSdkPath
    } else {
        Remove-Item Env:VULKAN_SDK -ErrorAction SilentlyContinue
    }

    $buildModeLabel = if ($EnableVulkan) { "Vulkan support" } else { "CPU-only mode" }
    Write-Host "Building whisper.cpp with $buildModeLabel..."

    try {
        $configureArgs = @(
            "-S", $WhisperRepoDir,
            "-B", $buildRoot,
            "-G", "Visual Studio 17 2022",
            "-A", "x64",
            "-Wno-dev",
            "-Wno-deprecated"
        )

        if ($EnableVulkan) {
            $configureArgs += "-DGGML_VULKAN=ON"
        } else {
            $configureArgs += "-DGGML_VULKAN=OFF"
        }

        & $CMakePath @configureArgs
        if ($LASTEXITCODE -ne 0) {
            throw "CMake configure failed with exit code $LASTEXITCODE."
        }

        & $CMakePath --build $buildRoot --config Release
        if ($LASTEXITCODE -ne 0) {
            throw "CMake build failed with exit code $LASTEXITCODE."
        }

        $builtBinDir = Join-Path $buildRoot "bin"
        if (-not (Test-Path $builtBinDir)) {
            throw "Build completed but the expected bin directory was not created."
        }

        $repoBinDir = Join-Path $repoBuildDir "bin"
        New-Item -ItemType Directory -Path $repoBinDir -Force | Out-Null
        Copy-Item -Path (Join-Path $builtBinDir "*") -Destination $repoBinDir -Recurse -Force
    } finally {
        if ([string]::IsNullOrWhiteSpace($previousVulkanSdk)) {
            Remove-Item Env:VULKAN_SDK -ErrorAction SilentlyContinue
        } else {
            $env:VULKAN_SDK = $previousVulkanSdk
        }
    }
}

function Ensure-WhisperCpp {
    $existing = Find-CommandPath @("whisper-cli", "whisper-cpp")
    if ($existing) {
        Write-Host "Using whisper.cpp:"
        Write-Host "  $existing"
        return $existing
    }

    $localBuild = Get-LocalWhisperBinary
    if ($localBuild) {
        if ($localBuild.HasVulkan) {
            Write-Host "Using local whisper.cpp Vulkan build:"
        } else {
            Write-Host "Using local whisper.cpp CPU build:"
        }
        Write-Host "  $($localBuild.Path)"
        return $localBuild.Path
    }

    $git = Ensure-WingetPackage -CommandName "git" -WingetId "Git.Git" -Label "Git"
    $cmake = Ensure-WingetPackage -CommandName "cmake" -WingetId "Kitware.CMake" -Label "CMake"
    $buildToolsPath = Ensure-BuildTools
    $vulkanSdkPath = $null

    try {
        $vulkanSdkPath = Ensure-VulkanSdk
    } catch {
        Write-Host "Vulkan SDK not available. Falling back to CPU-only whisper.cpp build."
        Write-Host "  $($_.Exception.Message)"
    }

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

    $builtWithVulkan = $false
    if ($vulkanSdkPath) {
        try {
            Invoke-WhisperCppBuild -CMakePath $cmake -EnableVulkan $true -VulkanSdkPath $vulkanSdkPath
            $builtWithVulkan = $true
        } catch {
            Write-Host "Vulkan build failed. Falling back to CPU-only whisper.cpp build."
            Write-Host "  $($_.Exception.Message)"
        }
    }

    if (-not $builtWithVulkan) {
        Invoke-WhisperCppBuild -CMakePath $cmake -EnableVulkan $false -VulkanSdkPath $null
    }

    $localBuild = Get-LocalWhisperBinary
    if ($localBuild) {
        if ($localBuild.HasVulkan) {
            Write-Host "Using local whisper.cpp Vulkan build:"
        } else {
            Write-Host "Using local whisper.cpp CPU build:"
        }
        Write-Host "  $($localBuild.Path)"
        return $localBuild.Path
    }

    throw "whisper.cpp build completed without producing a usable whisper executable."
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

$ytdlp = Join-Path $VenvDir "Scripts\yt-dlp.exe"
if (-not (Test-Path $ytdlp)) {
    throw "yt-dlp was not found in the local virtual environment."
}
& $ytdlp --version *> $null

Write-Section "Setup complete"
Write-Host "To open the app:"
Write-Host "  double-click 'WhisperDrop.bat'"
Write-Host ""
Write-Host "If you prefer PowerShell:"
Write-Host "  $venvPython $AppDir\transcriber.py"
