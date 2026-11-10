@echo off
title Kyoto Prefecture Tourism GIS
cd /d "%~dp0"
echo.
echo   Kyoto Prefecture Tourism GIS - starting...
echo.

if not exist "%~dp0site\index.html" goto notunzipped
if not exist "%~dp0serve.ps1" goto notunzipped

rem Remove the "downloaded from the internet" mark so Windows does not block the files.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem -LiteralPath '%~dp0' -Recurse | Unblock-File" >nul 2>&1

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1"
if not errorlevel 1 goto end

echo.
echo   PowerShell could not start the server. Trying Python instead...
where python >nul 2>&1
if errorlevel 1 goto nopython
echo   Open http://localhost:8000/ in Edge or Chrome. Close this window to stop.
start "" http://localhost:8000/
python -m http.server 8000 --directory "%~dp0site"
goto end

:nopython
echo.
echo   Python is not installed either.
echo   Please see README-Windows.txt (method 2), or send a photo of this window to the team.
echo.
pause
goto end

:notunzipped
echo   The "site" folder or serve.ps1 is missing.
echo   You probably opened the ZIP without extracting it.
echo   Right-click the ZIP, choose "Extract All", then open the new folder
echo   and double-click Start-Dashboard.bat again.
echo.
pause

:end
