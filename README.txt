THROUGHLINE - READ ME
=====================

A research operating system that runs on your own machine. The database, the
job queue and the analysis sandbox all run locally.


INSTALLING
----------

One line. It installs Throughline the first time, and opens it every time
after, so you can keep using the same line as your way in.

  macOS, Linux, WSL, or any POSIX shell:

      curl -fsSL https://throughline-research.pages.dev/install.sh | sh

  Windows, in PowerShell:

      irm https://throughline-research.pages.dev/install.ps1 | iex

If you would rather double-click something, Windows and Linux have launchers on
the download menu. macOS does not, deliberately: an unsigned script downloaded
by a browser is blocked by Gatekeeper with a warning about malware, and a shell
script cannot be signed in a way that satisfies it. The line above is fetched
by your terminal instead of your browser, so nothing is quarantined and nothing
asks.


WHAT HAPPENS ON THE FIRST RUN
-----------------------------

It takes a few minutes and downloads a few hundred megabytes. In order:

  1. It checks the Python on your machine. If that Python is the wrong version,
     or cannot build a virtual environment, it fetches one that can rather than
     asking you for a password.
  2. It builds a private environment and installs the packages into it.
  3. It applies the database migrations, which starts a PostgreSQL that belongs
     to this installation and nothing else.
  4. It starts the stack and opens your browser once the API answers.

Leave the window open until the browser opens. Nothing is being installed
system-wide and nothing needs administrator rights.


WHERE THINGS LIVE
-----------------

  The program      ~/throughline-os
                   (override with THROUGHLINE_INSTALL_DIR)

  Your research    ~/.throughline-os
                   (override with THROUGHLINE_HOME)

Note the dot. They are two different directories, deliberately: deleting or
reinstalling the program does not touch your research. If you ever want to
start the install over, removing ~/throughline-os is safe.

~/.throughline-os holds the PostgreSQL database, and that is the only copy of
your work. Back it up like anything else you cannot lose.


UPDATING
--------

Press the update button in the interface, or run:

    python ~/throughline-os/scripts/manage.py update

An installed copy asks the release server what the newest version is and
verifies the answer against a signature it shipped with, so a compromised
server cannot hand it a different program. If it cannot reach the server it
says it could not check - not that you are up to date.


IF SOMETHING IS WRONG
---------------------

    python ~/throughline-os/scripts/manage.py doctor

That reports what is missing or misconfigured on this machine rather than
failing later with something less obvious.


WHAT IT IS NOT
--------------

Throughline computes statistics, corrects for multiple comparisons, and is
explicit about what it refuses to conclude. It is a tool, not an author and not
a reviewer. The design of your studies, the interpretation of every result, and
what you publish all remain yours.

The software is provided as is, without warranty. The downloads are not
code-signed; your operating system may say so, and it is right to.
