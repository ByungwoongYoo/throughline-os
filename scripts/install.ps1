# The Windows front door, for the same reason install.sh exists elsewhere:
#
#     irm https://throughline-research.pages.dev/install.ps1 | iex
#
# **Windows has no `sh`.** The POSIX one-liner cannot be made universal by
# wanting it to be — `curl ... | sh` in PowerShell fails with *The term 'sh' is
# not recognized*, because there is no such program on a stock Windows. What is
# universal is the shape: one line, per shell family, both ending in the same
# installer. rustup, deno, uv and pnpm all ship exactly this pair.
#
#   macOS / Linux / WSL / Git Bash   curl -fsSL .../install.sh | sh
#   Windows PowerShell               irm .../install.ps1 | iex
#
# Like install.sh, this file does not implement the install. It finds a Python
# and hands over to scripts/install.py, which is the one implementation of
# download-verify-unpack. A third copy of that sequence in PowerShell is the
# drift this repository has already paid for twice.
#
# Run through `iex` there is no script file on disk, so nothing here may depend
# on its own path.

$ErrorActionPreference = 'Stop'

$ManifestUrl = if ($env:THROUGHLINE_RELEASE_URL) { $env:THROUGHLINE_RELEASE_URL }
               else { 'https://throughline-research.pages.dev/latest.json' }
$Dest = if ($env:THROUGHLINE_INSTALL_DIR) { $env:THROUGHLINE_INSTALL_DIR }
        else { Join-Path $env:USERPROFILE 'throughline-os' }

Write-Host "Throughline - installing into $Dest"

# `py` is the launcher that ships with python.org installs. Plain `python` on a
# machine with no Python is the Microsoft Store stub, which prints an advert and
# exits 9009 - trying `py` first is what keeps the stub from being mistaken for
# an interpreter.
$Check = 'import sys; raise SystemExit(0 if sys.version_info[:2] >= (3, 8) else 1)'
# Held as executable and arguments separately, and invoked by splatting the
# arguments. `& $array` makes PowerShell look for a command literally named
# "py -3" and fail with CommandNotFound - measured on Windows, not guessed.
$PyExe = $null
$PyArgs = @()
foreach ($candidate in @(@('py', @('-3')), @('python', @()))) {
    $exe, $prefix = $candidate
    if (-not (Get-Command $exe -ErrorAction SilentlyContinue)) { continue }
    & $exe @prefix -c $Check 2>$null
    if ($LASTEXITCODE -eq 0) { $PyExe = $exe; $PyArgs = @($prefix); break }
}

if (-not $PyExe) {
    Write-Host ""
    Write-Host "Throughline needs any Python 3.8 or newer to start."
    Write-Host "It fetches the exact version it runs on (3.12) by itself."
    Write-Host ""
    Write-Host "  Install it from https://www.python.org/downloads/ or the"
    Write-Host "  Microsoft Store, then run this line again."
    exit 1
}
Write-Host "  using $PyExe $($PyArgs -join ' ') to start"

# Whether the tree at $Dest is a whole release rather than a partial one. See
# install.sh for why: a download cut short leaves manage.py present and the rest
# missing, and every branch below assumes the tree is whole.
function Test-CompleteInstall($path) {
    return (Test-Path (Join-Path $path 'VERSION')) -and
           (Test-Path (Join-Path $path 'packages')) -and
           (Test-Path (Join-Path $path 'apps\web\out\index.html'))
}

if ((Test-Path (Join-Path $Dest 'scripts\manage.py')) -and -not (Test-CompleteInstall $Dest)) {
    # Moved, never deleted: an automatic Remove-Item on a path the caller sets
    # through THROUGHLINE_INSTALL_DIR is not something an installer should do.
    if ($Dest -eq $env:USERPROFILE -or [string]::IsNullOrWhiteSpace($Dest)) {
        Write-Host "Refusing to move $Dest aside: that is not an installation directory."
        exit 1
    }
    $Broken = "$Dest.broken-" + (Get-Date -Format 'yyyyMMdd-HHmmss')
    Write-Host "  the installation at $Dest is incomplete"
    Write-Host "  moving it to $Broken, then installing fresh"
    Move-Item -Path $Dest -Destination $Broken
}

if (Test-Path (Join-Path $Dest 'scripts\manage.py')) {
    # See install.sh for why this compares rather than stopping: somebody
    # holding a build with a startup defect re-ran the advertised line, was told
    # "already installed", and got the identical failure (D064).
    Write-Host "  already installed at $Dest"
    $Here = (Get-Content (Join-Path $Dest 'VERSION') -ErrorAction SilentlyContinue | Select-Object -First 1)
    $There = $null
    try {
        $There = (Invoke-RestMethod -Uri $ManifestUrl -UserAgent 'Throughline-Installer' -TimeoutSec 30).version
    } catch { }
    if ($There -and ($Here -ne $There)) {
        Write-Host "  this copy is $Here; $There has been released"
        Write-Host "  updating before starting"
        & $PyExe @PyArgs (Join-Path $Dest 'scripts\manage.py') 'update'
        if ($LASTEXITCODE -ne 0) {
            Write-Host ""
            Write-Host "  The update did not finish, so the copy already here is being"
            Write-Host "  started instead. If it does not work, reinstall with:"
            Write-Host "    Remove-Item -Recurse -Force '$Dest'; irm $($ManifestUrl -replace '/latest\.json$', '/install.ps1') | iex"
        }
    }
} else {
    Write-Host "  fetching the current release"
    # Resolved against the manifest's own location, so a staging host set through
    # THROUGHLINE_RELEASE_URL serves its own installer too.
    $InstallerUrl = [System.Uri]::new([System.Uri]$ManifestUrl, 'install.py').AbsoluteUri
    $Installer = Join-Path $env:TEMP 'throughline-install.py'
    try {
        # The agent is named for the same reason it is everywhere else: the
        # release host answers anonymous defaults with 403 (D056).
        Invoke-WebRequest -Uri $InstallerUrl -OutFile $Installer `
            -UserAgent 'Throughline-Installer' -UseBasicParsing
    } catch {
        Write-Host ""
        Write-Host "Cannot install: the release server could not be reached."
        Write-Host "  $InstallerUrl"
        Write-Host "  $($_.Exception.Message)"
        exit 1
    }

    & $PyExe @PyArgs $Installer --into $Dest --url $ManifestUrl
    if ($LASTEXITCODE -ne 0) { Remove-Item $Installer -ErrorAction SilentlyContinue; exit $LASTEXITCODE }
    Remove-Item $Installer -ErrorAction SilentlyContinue
}

# Throughline.bat sets this: it installs through here and then starts the copy
# itself, so that the launcher owns the window the app runs in. Nothing else
# sets it, and the one-liner never does.
if ($env:THROUGHLINE_NO_START) {
    Write-Host ""
    Write-Host "  installed. The launcher will start it."
    exit 0
}

Write-Host ""
# `start`, not `bootstrap`: start already means "set up if needed, then run", so
# stopping at bootstrap leaves a finished install and nothing on screen.
& $PyExe @PyArgs (Join-Path $Dest 'scripts\manage.py') 'start'
exit $LASTEXITCODE
