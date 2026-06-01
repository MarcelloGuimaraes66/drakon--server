@echo off
setlocal
powershell -ExecutionPolicy Bypass -File "%~dp0Start-Drakon-Fixed.ps1"
if errorlevel 1 (
  echo.
  echo Falha ao iniciar o Drakon com o runtime temporario.
  echo.
  pause
)
