@echo off
setlocal
if "%~1"=="" (
  echo Usage: Open-Mendix.cmd "path\to\studiopro.exe" [WSL-distribution]
  exit /b 2
)
set "studioExecutable=%~1"
if not exist "%studioExecutable%" (
  echo Studio Pro was not found at the supplied path.
  exit /b 2
)
for %%I in ("%~dp0..") do set "releaseRoot=%%~fI"
set "MICROEXPLORE_BACKEND_ROOT=%releaseRoot%\backend"
set "MICROEXPLORE_WSL_DISTRO=Ubuntu-22.04"
if not "%~2"=="" set "MICROEXPLORE_WSL_DISTRO=%~2"
if not exist "%releaseRoot%\mendix\final project.mpr" exit /b 2
start "" "%studioExecutable%" "%releaseRoot%\mendix\final project.mpr"
endlocal
