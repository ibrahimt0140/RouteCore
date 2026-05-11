@echo off
title RouteCore - Drone Delivery Optimization
color 0B
cls

echo.
echo  ==========================================
echo   ROUTECORE - Drone Delivery Optimization  
echo  ==========================================
echo.

:: ── Check Python ──────────────────────────────────────────────────
where python >nul 2>nul
if %errorlevel% neq 0 (
    echo  [ERROR] Python not found. Please install Python 3.9+
    pause
    exit /b 1
)

:: ── Check Node ────────────────────────────────────────────────────
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo  [ERROR] Node.js not found. Please install Node.js 18+
    pause
    exit /b 1
)

:: ── Resolve script directory ──────────────────────────────────────
set "ROOT=%~dp0"
set "BACKEND=%ROOT%backend"
set "FRONTEND=%ROOT%frontend"

echo  [1/4] Installing Python dependencies...
cd /d "%BACKEND%"
pip install -r requirements.txt -q
if %errorlevel% neq 0 (
    echo  [ERROR] Failed to install Python packages
    pause
    exit /b 1
)
echo       Done.

echo  [2/4] Installing Node dependencies...
cd /d "%FRONTEND%"
if not exist "node_modules" (
    npm install --silent
    if %errorlevel% neq 0 (
        echo  [ERROR] npm install failed
        pause
        exit /b 1
    )
) else (
    echo       node_modules already present, skipping.
)

echo  [3/4] Starting FastAPI backend on port 8000...
cd /d "%BACKEND%"
start "RouteCore Backend" cmd /k "title RouteCore Backend && python main.py"

:: Give backend a moment to boot
timeout /t 3 /nobreak >nul

echo  [4/4] Starting React frontend on port 5173...
cd /d "%FRONTEND%"
start "RouteCore Frontend" cmd /k "title RouteCore Frontend && npm run dev"

:: Wait for Vite to be ready
timeout /t 4 /nobreak >nul

echo.
echo  Opening browser...
start "" "http://localhost:5173"

echo.
echo  ==========================================
echo   System is running!
echo   Backend  : http://localhost:8000
echo   Frontend : http://localhost:5173
echo   API docs : http://localhost:8000/docs
echo  ==========================================
echo.
echo  Press any key to exit this launcher
echo  (backend and frontend will keep running)
echo.
pause >nul
