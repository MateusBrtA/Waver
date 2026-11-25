@echo off
chcp 65001 >nul
title PulseCord - Gerar Instalador e Portatil (.EXE)
cd /d "%~dp0"

echo ========================================================
echo   PulseCord - Gerando Instalador + Portatil (.EXE)
echo ========================================================
echo.
echo Isso vai gerar:
echo   1) PulseCord-Setup.exe    (Instalador do Windows)
echo   2) PulseCord-Portable.exe (Versao portatil sem instalar)
echo.
echo Ambos ja vem com o Servidor Host embutido automaticamente!
echo.

call npm run build:win

echo.
if exist "dist-app\PulseCord-Setup.exe" (
  copy /Y "dist-app\PulseCord-Setup.exe" "PulseCord-Setup.exe" >nul
  copy /Y "dist-app\PulseCord-Portable.exe" "PulseCord-Portable.exe" >nul
  echo SUCESSO! Executaveis prontos na pasta do projeto e em dist-app\:
  echo   - PulseCord-Setup.exe
  echo   - PulseCord-Portable.exe
  echo.
  explorer "."
) else (
  echo Algo deu errado ao gerar os executaveis. Veja os logs acima.
)
pause
