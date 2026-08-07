@echo off
setlocal

set "ROOT=%~dp0"
set "DESKTOP=%ROOT%\packages\desktop"
set "LOCAL_BUN=%USERPROFILE%\.bun\bin\bun.exe"

if exist "%LOCAL_BUN%" (
  set "BUN=%LOCAL_BUN%"
  set "PATH=%USERPROFILE%\.bun\bin;%PATH%"
) else (
  set "BUN=bun"
)

echo Using Bun:
"%BUN%" --version
if errorlevel 1 goto bun_missing

echo.
echo Installing workspace dependencies...
pushd "%ROOT%" || goto fail
"%BUN%" install
if errorlevel 1 goto fail_popd
popd

call :find_electron_dist
if not defined ELECTRON_DIST goto electron_missing

echo.
echo Installing Electron runtime from mirror if needed...
if not exist "%ELECTRON_DIST%\electron.exe" (
  pushd "%DESKTOP%" || goto fail
  set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
  "%BUN%" x install-electron
  if errorlevel 1 goto fail_popd
  popd
)
call :find_electron_dist
if not exist "%ELECTRON_DIST%\electron.exe" goto electron_missing

echo.
echo Building desktop assets...
pushd "%DESKTOP%" || goto fail
set "OPENCODE_MODELS_URL=https://models.opencode.ai"
"%BUN%" run build
if errorlevel 1 goto fail_popd

echo.
echo Packaging unpacked Windows app...
set "CSC_IDENTITY_AUTO_DISCOVERY=false"
"%BUN%" x electron-builder --dir --publish never --config electron-builder.config.ts --config.electronDist "%ELECTRON_DIST%"
if errorlevel 1 goto fail_popd
popd

echo.
echo Build complete.
echo Run: "%DESKTOP%\dist\win-unpacked\OpenCode Dev.exe"
pause
exit /b 0

:bun_missing
echo.
echo Bun was not found. Install Bun first, then run this file again:
echo powershell -c "irm bun.sh/install.ps1^|iex"
pause
exit /b 1

:fail_popd
popd

:fail
echo.
echo Build failed.
pause
exit /b 1

:electron_missing
echo.
echo Electron 42.3.3 was not found under node_modules\.bun.
echo Try deleting node_modules and running this file again.
pause
exit /b 1

:find_electron_dist
set "ELECTRON_DIST="
for /d %%D in ("%ROOT%\node_modules\.bun\electron@42.3.3*") do set "ELECTRON_DIST=%%D\node_modules\electron\dist"
exit /b 0
