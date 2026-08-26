@echo off
rem Windows. Double-click this and Throughline starts - installing itself first
rem if this machine has not got it yet.
rem
rem Downloadable on its own: it does not assume it is sitting inside a checkout.
rem T071's version went one directory up and ran scripts\manage.py, so a file
rem saved to Downloads failed with "can't open file". That is a convenience for
rem somebody who already has the code, which is the opposite of what a download
rem is for.
rem
rem Unsigned, so SmartScreen shows "Windows protected your PC" on the first run -
rem More info, then Run anyway, once. The curl line carries no such warning,
rem because the mark-of-the-web is written by the downloading browser and not by
rem the operating system.
rem
rem %~dp0 is this file's own directory with a trailing backslash, computed by cmd
rem before anything runs. Explorer starts a double-clicked file from whatever
rem working directory it pleases, which is frequently not this one.
setlocal
set "HERE=%~dp0"
if "%THROUGHLINE_INSTALL_DIR%"=="" set "THROUGHLINE_INSTALL_DIR=%USERPROFILE%\throughline-os"
set "DEST=%THROUGHLINE_INSTALL_DIR%"
rem Set out here rather than inside the install block below, and that is not a
rem style choice: cmd expands %VAR% for a whole parenthesised block when it
rem *parses* it, so a variable set inside the block reads as empty everywhere
rem later in the same block. The same variable, with the same meaning, that
rem install.sh and throughline_domain.updates read.
if "%THROUGHLINE_RELEASE_URL%"=="" set "THROUGHLINE_RELEASE_URL=https://throughlineresearch.pages.dev/latest.json"

rem `py` is the Python launcher that ships with python.org installs; `python` on
rem a machine with no Python is the Microsoft Store stub, which prints an advert
rem and exits 9009. Trying `py` first is what keeps the stub from being mistaken
rem for an interpreter.
set "PYTHON="
py -3 -c "import sys; raise SystemExit(0 if sys.version_info[:2] >= (3, 8) else 1)" >nul 2>&1 && set "PYTHON=py -3"
if not defined PYTHON (
  python -c "import sys; raise SystemExit(0 if sys.version_info[:2] >= (3, 8) else 1)" >nul 2>&1 && set "PYTHON=python"
)

if not defined PYTHON (
  echo Throughline needs any Python 3.8 or newer to start.
  echo It fetches the exact version it runs on by itself.
  echo.
  echo   Install it from https://www.python.org/downloads/ or the Microsoft Store,
  echo   then double-click this file again.
  echo.
  pause
  exit /b 1
)

rem Three cases, cheapest first, and the network only in the last one.
set "FOUND="
if exist "%HERE%..\scripts\manage.py" set "FOUND=%HERE%.."
if not defined FOUND if exist "%DEST%\scripts\manage.py" set "FOUND=%DEST%"

if not defined FOUND (
  echo Throughline is not installed yet. Setting it up first.
  echo This downloads a few hundred megabytes and takes a few minutes.
  echo Leave this window open; it will start on its own when it is done.
  echo.
  rem It used to `git clone` the project's repository, which is private - so
  rem this door worked for the two people with credentials and returned "could
  rem not read Username" to everybody it was built for (D050). It now installs
  rem the same published release the other doors do, and needs no git at all.
  rem
  rem The sequence itself is not implemented here: it is scripts/install.py,
  rem fetched from beside the manifest and run with the Python found above.
  rem Expressing download-verify-unpack in batch would be a third copy of it,
  rem which is the drift this repository has already paid for twice.
  rem
  rem The installer's URL is derived from the manifest's, so a staging host set
  rem through THROUGHLINE_RELEASE_URL serves its own installer too. urljoin does
  rem that here because %~dp on a URL yields a filesystem path, not a URL.
  %PYTHON% -c "import sys, urllib.request; from urllib.parse import urljoin; open(sys.argv[2], 'wb').write(urllib.request.urlopen(urljoin(sys.argv[1], 'install.py'), timeout=60).read())" "%THROUGHLINE_RELEASE_URL%" "%TEMP%\throughline-install.py" || (
    echo Cannot install: the release server could not be reached.
    echo   %THROUGHLINE_RELEASE_URL%
    echo.
    pause
    exit /b 1
  )
  %PYTHON% "%TEMP%\throughline-install.py" --into "%DEST%" --url "%THROUGHLINE_RELEASE_URL%"
  del "%TEMP%\throughline-install.py" >nul 2>&1
  if not exist "%DEST%\scripts\manage.py" (
    echo.
    echo Setup did not finish, so there is nothing to start yet.
    echo.
    pause
    exit /b 1
  )
  set "FOUND=%DEST%"
)

%PYTHON% "%FOUND%\scripts\manage.py" start
set "STATUS=%ERRORLEVEL%"

if not "%STATUS%"=="0" (
  echo.
  echo Throughline stopped with an error ^(exit %STATUS%^).
  echo The lines above say why. "python scripts\manage.py doctor" checks the install.
  pause
)
exit /b %STATUS%
