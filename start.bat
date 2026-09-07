@echo off
setlocal EnableDelayedExpansion
title Bank Assistive AI - launcher

REM ============================================================
REM  Starts all three tiers in the right order:
REM
REM    browser  ->  NestJS :3000  ->  FastAPI :8000  ->  Groq
REM
REM  Each tier gets its own window so its logs stay readable.
REM  The engine has to finish loading Whisper before the API is
REM  useful, so this waits for it rather than racing it.
REM ============================================================

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

echo.
echo ============================================================
echo   Bank Assistive AI
echo ============================================================
echo.

REM ------------------------------------------------------------
REM  Preflight. Failing here is much cheaper than failing later
REM  inside a window that closes before you can read it.
REM ------------------------------------------------------------
echo Checking prerequisites...

if not exist "%ROOT%\language_engine\venv\Scripts\python.exe" (
    echo   [X] Python venv missing.
    echo       cd language_engine ^&^& py -3.13 -m venv venv ^&^& venv\Scripts\pip install -r requirements.txt
    goto fail
)

if not exist "%ROOT%\language_engine\.env" (
    echo   [X] language_engine\.env missing.  Copy .env.example to .env and add your Groq key.
    goto fail
)

findstr /r /c:"^GROQ_API_KEY=$" "%ROOT%\language_engine\.env" >nul 2>&1
if not errorlevel 1 (
    echo   [X] GROQ_API_KEY is empty in language_engine\.env
    echo       Paste only the key itself:  GROQ_API_KEY=gsk_...
    echo       A key is issued at https://console.groq.com/keys
    goto fail
)

if not exist "%ROOT%\backend\.env" (
    echo   [X] backend\.env missing.  Copy backend\.env.example to backend\.env
    goto fail
)

if not exist "%ROOT%\backend\node_modules" (
    echo   [X] backend dependencies missing.  Run:  cd backend ^&^& npm install
    goto fail
)

if not exist "%ROOT%\frontend\node_modules" (
    echo   [X] frontend dependencies missing.  Run:  cd frontend ^&^& npm install
    goto fail
)

echo   [ok] venv, .env files, Groq key, node_modules
echo.

REM ------------------------------------------------------------
REM  1. Python AI engine. Started first: Whisper and two encoders
REM     take roughly 40 seconds to load.
REM ------------------------------------------------------------
call :is_listening 8000
if not errorlevel 1 (
    echo [1/3] AI engine already running on :8000 - leaving it alone.
) else (
    echo [1/3] Starting the AI engine on :8000 ...
    start "AI engine :8000" /D "%ROOT%\language_engine" cmd /k venv\Scripts\python.exe -m uvicorn service.main:app --host 127.0.0.1 --port 8000
)

echo       waiting for Whisper and the language models to load...
set /a TRIES=0
:wait_engine
curl -s -f http://127.0.0.1:8000/health 2>nul | findstr /c:"\"models_loaded\":true" >nul 2>&1
if not errorlevel 1 goto engine_ready
set /a TRIES+=1
if !TRIES! GEQ 60 (
    echo.
    echo   [X] The engine did not come up within 3 minutes.
    echo       Check the "AI engine :8000" window for the reason.
    goto fail
)
timeout /t 3 /nobreak >nul
goto wait_engine

:engine_ready
echo       [ok] engine ready, models loaded
echo.

REM ------------------------------------------------------------
REM  2. NestJS API
REM ------------------------------------------------------------
call :is_listening 3000
if not errorlevel 1 (
    echo [2/3] API already running on :3000 - leaving it alone.
) else (
    echo [2/3] Starting the NestJS API on :3000 ...
    start "NestJS API :3000" /D "%ROOT%\backend" cmd /k npm run start:dev
)

set /a TRIES=0
:wait_api
call :is_listening 3000
if not errorlevel 1 goto api_ready
set /a TRIES+=1
if !TRIES! GEQ 40 (
    echo.
    echo   [X] The API did not come up within 2 minutes.
    echo       Check the "NestJS API :3000" window - a database problem shows up here.
    goto fail
)
timeout /t 3 /nobreak >nul
goto wait_api

:api_ready
echo       [ok] API listening
echo.

REM ------------------------------------------------------------
REM  3. React frontend
REM ------------------------------------------------------------
call :is_listening 5173
if not errorlevel 1 (
    echo [3/3] Frontend already running on :5173 - leaving it alone.
) else (
    echo [3/3] Starting the frontend on :5173 ...
    start "Frontend :5173" /D "%ROOT%\frontend" cmd /k npm run dev
)

set /a TRIES=0
:wait_web
call :is_listening 5173
if not errorlevel 1 goto web_ready
set /a TRIES+=1
if !TRIES! GEQ 30 (
    echo.
    echo   [X] The frontend did not come up within 90 seconds.
    echo       Check the "Frontend :5173" window.
    goto fail
)
timeout /t 3 /nobreak >nul
goto wait_web

:web_ready
echo       [ok] frontend serving
echo.
echo ============================================================
echo   Everything is up.
echo.
echo     App      http://localhost:5173
echo     API      http://localhost:3000/api
echo     Engine   http://127.0.0.1:8000/health
echo.
echo   Closing this window does NOT stop anything. To stop, press
echo   Ctrl+C in each of the three windows, or run stop.bat
echo ============================================================
echo.

start "" http://localhost:5173

echo Opening the browser. This window can be closed.
timeout /t 8 /nobreak >nul
exit /b 0

REM ------------------------------------------------------------
REM  Sets errorlevel 0 when something is listening on %1.
REM ------------------------------------------------------------
:is_listening
netstat -an | findstr /c:":%1 " | findstr /i "LISTENING" >nul 2>&1
exit /b %errorlevel%

:fail
echo.
echo Startup stopped. Nothing further was launched.
echo.
pause
exit /b 1
