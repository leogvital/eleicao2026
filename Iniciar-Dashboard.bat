@echo off
chcp 65001 >nul
title Dashboard Apuracao 2026
cd /d "%~dp0"

if not exist "servidor.js" goto faltaArquivo
if not exist "public\index.html" goto faltaArquivo

rem --- 1. Procura o Node.js (PATH ou pasta padrao de instalacao) ---
call :achaNode
if defined NODE_EXE goto rodar

rem --- 2. Nao achou: tenta instalar pelo winget (Windows 10/11) ---
echo.
echo O Node.js nao esta instalado. Ele e necessario para o dashboard.
where winget >nul 2>nul
if errorlevel 1 goto manual
echo Instalando o Node.js LTS (pode pedir permissao de administrador)...
winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
call :achaNode
if defined NODE_EXE goto rodar

:manual
echo.
echo Nao foi possivel instalar automaticamente.
echo Instale o Node.js LTS em https://nodejs.org (botao verde LTS, avancar ate o fim)
echo e depois de dois cliques neste arquivo de novo.
start "" https://nodejs.org
pause
exit /b 1

:faltaArquivo
echo.
echo Faltam arquivos. Mantenha servidor.js, a pasta public e este .bat juntos na MESMA pasta.
echo Se recebeu um .zip, extraia tudo antes de abrir (nao execute de dentro do zip).
pause
exit /b 1

:rodar
echo.
rem --- Encerra execucoes anteriores do dashboard (node escutando na porta 8080) ---
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { $p = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue; if ($p -and $p.ProcessName -eq 'node') { Write-Host ('Encerrando servidor anterior (PID ' + $p.Id + ')'); Stop-Process -Id $p.Id -Force } }"
ping -n 2 127.0.0.1 >nul

echo Iniciando o dashboard em http://localhost:8080
echo Deixe esta janela aberta. Para encerrar, feche-a ou aperte Ctrl+C.
echo.
start "" http://localhost:8080
"%NODE_EXE%" servidor.js
echo.
echo O servidor parou. Se a mensagem acima diz "address already in use", o
echo dashboard ja esta aberto em outra janela: acesse http://localhost:8080
pause
exit /b 0

:achaNode
set "NODE_EXE="
for /f "delims=" %%i in ('where node 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%i"
if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%LocalAppData%\Programs\nodejs\node.exe" set "NODE_EXE=%LocalAppData%\Programs\nodejs\node.exe"
exit /b 0
