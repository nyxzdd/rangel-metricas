@echo off
setlocal
cd /d "%~dp0"
title Rangel Metricas - DESENVOLVIMENTO
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [ERRO] Node.js nao esta instalado. Instale a versao LTS em https://nodejs.org e execute de novo.
  echo.
  pause
  exit /b 1
)
echo.
echo Rangel Metricas - modo desenvolvimento
echo  - Backend reinicia sozinho ao salvar arquivos.
echo  - O navegador recarrega sozinho (ou aperte F5).
echo  - Endereco: http://localhost:3000
echo  - Mantenha esta janela aberta. Para parar: Ctrl+C.
echo.
start "" http://localhost:3000
node scripts\dev.js
pause
