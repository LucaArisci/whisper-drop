@echo off
setlocal
cd /d "%~dp0"

set "VENV_PYTHON=%CD%\.venv\Scripts\python.exe"
set "NEEDS_SETUP=0"

if not exist "%VENV_PYTHON%" set "NEEDS_SETUP=1"
where ffmpeg >nul 2>nul || if not exist "%CD%\.tools\ffmpeg\bin\ffmpeg.exe" set "NEEDS_SETUP=1"
where whisper-cli >nul 2>nul || where whisper-cpp >nul 2>nul || if not exist "%CD%\.tools\whisper.cpp\Release\whisper-cli.exe" if not exist "%CD%\.tools\whisper.cpp\Release\whisper-cpp.exe" set "NEEDS_SETUP=1"

if "%NEEDS_SETUP%"=="1" (
  echo First launch detected. Running setup...
  echo.
  powershell -ExecutionPolicy Bypass -File "%CD%\scripts\setup.ps1"
  if errorlevel 1 (
    echo.
    echo Setup failed. Please review the messages above.
    pause
    exit /b 1
  )
)

if not exist "%VENV_PYTHON%" (
  echo The local environment was not created correctly.
  pause
  exit /b 1
)

"%VENV_PYTHON%" "%CD%\transcriber.py"
