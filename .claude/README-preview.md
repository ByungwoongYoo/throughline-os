# Why this launch config has no command

The preview launcher cannot execute anything inside this directory. macOS
protects `~/Downloads` under TCC, and the helper that spawns the dev server has
not been granted access to it, so `bash scripts/dev.sh` fails with
"Operation not permitted" before the script runs. The file is executable and
unquarantined; the restriction is on the process, not the file.

A configuration carrying only a `url` attaches to a server that is already
running rather than starting one. So the stack is started by hand:

    ./scripts/dev.sh

and the preview then attaches to http://127.0.0.1:3000.

`autoPort` is false because the port is not arbitrary. The web client is
same-origin with the API — Next rewrites `/api` to the FastAPI server — and the
session cookie is `SameSite=strict`, so a cross-origin fetch drops it silently
and every call answers 401. Letting the launcher reassign the port would break
authentication in a way that looks like a login bug.

Two ways to get the one-command version back, if you want it:

* Grant the Claude app access to your Downloads folder in
  System Settings → Privacy & Security → Files and Folders.
* Move the project somewhere outside a TCC-protected directory, for example
  `~/dev/throughline-os`. Worth doing regardless — `~/Downloads` is where
  browsers write, and a few of them will happily overwrite a file there.

If you do either, restore the command form:

    "runtimeExecutable": "bash",
    "runtimeArgs": ["scripts/dev.sh"],
