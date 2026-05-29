@echo off
setlocal
cd /d "%~dp0"

powershell -ExecutionPolicy Bypass -File "%CD%\scripts\setup.ps1"
if errorlevel 1 (
  echo.
  echo Setup failed. Please review the messages above.
  pause
  exit /b 1
)

echo.
echo Setup complete.
pause
