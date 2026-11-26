@echo off
rem Inicia o servidor dedicado do PulseCord (duplo clique). Opções: veja Iniciar-Servidor.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Iniciar-Servidor.ps1" %*
pause
