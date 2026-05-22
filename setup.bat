@echo off
echo.
echo ==========================================
echo   PerfAgent Demo Setup (Windows)
echo ==========================================
echo.

node --version >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js not found.
  echo Install from: https://nodejs.org  (LTS version)
  pause & exit /b 1
)

echo [OK] Node.js found:
node --version

if not exist "server.js" (
  echo [ERROR] server.js not found. Run from the perf-demo folder.
  pause & exit /b 1
)

if not exist "public\index.html" (
  echo [ERROR] public\index.html not found.
  pause & exit /b 1
)

if not exist "sample-files" mkdir sample-files

echo [OK] Project files present
echo [OK] sample-files\ folder ready
echo.
echo ==========================================
echo   Setup complete! No packages to install.
echo ==========================================
echo.
echo   To start:   node server.js
echo   Then open:  http://localhost:3737
echo.
echo   Sample files: .\sample-files\
echo   API keys:     https://console.anthropic.com
echo.
pause
