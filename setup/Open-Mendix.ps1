param(
    [Parameter(Mandatory=$true)][string]$StudioProPath,
    [string]$WslDistribution = 'Ubuntu-22.04'
)
$ErrorActionPreference = 'Stop'
$releaseRoot = Split-Path -Parent $PSScriptRoot
$studioExecutable = (Resolve-Path -LiteralPath $StudioProPath).Path
$projectFile = Join-Path $releaseRoot 'mendix\final project.mpr'
$env:MICROEXPLORE_BACKEND_ROOT = Join-Path $releaseRoot 'backend'
$env:MICROEXPLORE_WSL_DISTRO = $WslDistribution
# Start an interactive Studio Pro window so the user can edit and run the app.
Start-Process -FilePath $studioExecutable -ArgumentList @('"' + $projectFile + '"') -WindowStyle Normal
