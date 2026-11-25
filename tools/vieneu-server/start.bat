@echo off
setlocal

for %%I in ("%~dp0..\..") do set "REPO_ROOT=%%~fI"
set "ACTIVATE_BAT=%REPO_ROOT%\.venv312\Scripts\activate.bat"

if not exist "%ACTIVATE_BAT%" (
    echo Missing Python 3.12 virtual environment at "%REPO_ROOT%\.venv312". Follow tools\vieneu-server\README.md to create it with uv.
    exit /b 1
)

set "PYTHONUTF8=1"
call "%ACTIVATE_BAT%"
if errorlevel 1 exit /b %errorlevel%

cd /d "%REPO_ROOT%"
if errorlevel 1 exit /b %errorlevel%

python tools\vieneu-server\server.py
exit /b %errorlevel%
