@echo off
chcp 65001 >nul
title Waver - Gerar Instalador e Portatil (.EXE)
cd /d "%~dp0"

echo ========================================================
echo   Waver - Gerando Instalador + Portatil (.EXE)
echo ========================================================
echo.
echo Isso vai gerar:
echo   1) Waver-Setup.exe    (Instalador do Windows)
echo   2) Waver-Portable.exe (Versao portatil sem instalar)
echo.
echo Ambos ja vem com o Servidor Host embutido automaticamente!
echo.

call npm run build:win
set BUILD_ERR=%ERRORLEVEL%

echo.
if "%BUILD_ERR%"=="0" (
  echo SUCESSO! Na pasta do projeto fica so o portatil mais recente:
  echo   - Waver-Portable.exe
  echo O instalador desta versao fica em dist-app\Waver-Setup.exe
  echo.
  explorer "."
) else (
  echo Algo deu errado ao gerar os executaveis. Veja os logs acima.
)
pause
