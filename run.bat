@echo off
title VectorStudio (mkbitmap + Potrace WebAssembly)
cd /d "%~dp0"
echo ========================================================
echo   VectorStudio - mkbitmap & Potrace WebAssembly (WASM)
echo ========================================================
echo Starting local web server and launching browser...
echo.
python server.py
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Error starting server. Please ensure Python is installed.
    pause
)
