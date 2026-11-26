@echo off
chcp 65001 >nul
title Waver - Servidor Host + Tunel Gratuito (Cloudflare)
cd /d "%~dp0"

echo ========================================================
echo   Waver - Servidor Host + Tunel HTTPS Gratuito
echo ========================================================
echo.

if not exist "client\dist\index.html" (
  echo [1/3] Compilando interface do app...
  call npm run build:client
)

where cloudflared >nul 2>nul
if %errorlevel% neq 0 (
  if not exist "scripts\cloudflared.exe" (
    echo [2/3] Baixando Cloudflare Tunnel gratis (cloudflared.exe)...
    powershell -Command "Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile 'scripts\cloudflared.exe'"
  )
  set "CF_BIN=scripts\cloudflared.exe"
) else (
  set "CF_BIN=cloudflared"
)

echo [3/3] Iniciando servidor Waver em nova janela...
start "Waver Server" cmd /k "cd /d %~dp0 && node server/index.js"

timeout /t 2 /nobreak >nul
echo.
echo Abrindo tunel HTTPS gratuito... Copie o link https://xxxx.trycloudflare.com
echo que aparecera abaixo e envie para seus amigos!
echo (Funciona tanto no Waver-Portable.exe quanto no navegador!)
echo.

"%CF_BIN%" tunnel --url http://localhost:3000
pause
