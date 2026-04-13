@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

title Automated Brief Watcher

echo =====================================
echo   Automated Brief Watcher
echo =====================================
echo.

if not exist "config.json" if not exist ".env" (
  echo Setup required before first run.
  echo.
  echo 1. Copy config.example.json and rename it to config.json
  echo 2. Open config.json and set username and password
  echo 3. Save and double-click this file again
  echo.
  if "%WATCHER_NO_PAUSE%"=="1" exit /b 1
  pause
  exit /b 1
)

if exist "dist\file-watcher.exe" (
  echo Starting watcher using dist\file-watcher.exe ...
  dist\file-watcher.exe %*
  set "EXIT_CODE=!ERRORLEVEL!"
) else (
  where node >nul 2>nul
  if errorlevel 1 (
    echo Node.js was not found. Install Node.js 18+ or provide dist\file-watcher.exe.
    set "EXIT_CODE=1"
  ) else (
    if not exist "node_modules\dotenv\package.json" (
      echo First run detected. Installing required packages. This may take 1-2 minutes...
      where npm >nul 2>nul
      if errorlevel 1 (
        echo npm was not found. Reinstall Node.js 18+ and try again.
        set "EXIT_CODE=1"
      ) else (
        npm install
        if errorlevel 1 (
          echo Failed to install required packages. Please check internet connection and try again.
          set "EXIT_CODE=1"
        ) else (
          echo Package install complete.
        )
      )
    )

    if not defined EXIT_CODE (
    echo Starting watcher using Node.js ...
    node index.js %*
    set "EXIT_CODE=!ERRORLEVEL!"
    )
  )
)

echo.
if "!EXIT_CODE!"=="0" (
  echo Watcher stopped.
) else (
  echo Watcher exited with code !EXIT_CODE!.
)

if "%WATCHER_NO_PAUSE%"=="1" exit /b !EXIT_CODE!

echo.
echo Press any key to close this window.
pause >nul
exit /b !EXIT_CODE!
