@echo off
chcp 65001 >nul
title Waver - Servidor Host (Radmin / ZeroTier / Rede Local)
cd /d "%~dp0"

echo ========================================================
echo   Waver - Iniciando Servidor Host neste PC
echo ========================================================
echo.

if not exist "client\dist\index.html" (
  echo [1/2] Compilando interface do app...
  call npm run build:client
)

echo [2/2] Iniciando servidor na porta 3000...
echo.
echo DICA: Envie o endereco IP do Radmin VPN (ex: http://26.x.x.x:3000)
echo ou da Rede Local que aparecera abaixo para seus amigos!
echo Deixe esta janela aberta enquanto voces estiverem usando o app.
echo.

node server/index.js
pause
