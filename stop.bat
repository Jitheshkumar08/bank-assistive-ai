@echo off
setlocal EnableDelayedExpansion
title Bank Assistive AI - stop

REM ============================================================
REM  Stops whatever start.bat launched, by port rather than by
REM  process name -- several unrelated node.exe processes may be
REM  running, and only the ones holding these ports are ours.
REM
REM  PostgreSQL is left alone. It is a service, not something
REM  this project starts.
REM ============================================================

echo.
echo Stopping Bank Assistive AI...
echo.

call :kill_port 5173 "frontend"
call :kill_port 3000 "API"
call :kill_port 8000 "AI engine"

echo.
echo Done. PostgreSQL was not touched.
echo.
timeout /t 5 /nobreak >nul
exit /b 0

:kill_port
set "FOUND="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /c:":%~1 " ^| findstr /i "LISTENING"') do (
    if not "%%p"=="0" (
        taskkill /PID %%p /F >nul 2>&1
        if not errorlevel 1 (
            echo   stopped %~2 on :%~1  ^(PID %%p^)
            set "FOUND=1"
        )
    )
)
if not defined FOUND echo   %~2 on :%~1 was not running
exit /b 0
