# Fonts bundled with this application

Three families, self-hosted rather than fetched from a CDN so that the build,
the Docker image and the running product need no network for typography, and so
that no visitor's address is handed to a third party on first paint.

Each file is the Latin or Latin-Extended subset of the upstream **variable**
font, taken from the Google Fonts API on 2026-08-14. Variable means one file
covers every weight the interface uses; the subsets mean a page downloads
Latin-Extended only when a glyph actually needs it.

| File | Family | Axes | Bytes |
|---|---|---|---|
| `inter-latin.woff2` | Inter | `wght` 100–900 | 48,256 |
| `inter-latin-ext.woff2` | Inter | `wght` 100–900 | 85,068 |
| `source-serif-4-latin.woff2` | Source Serif 4 | `opsz` 8–60, `wght` 200–900 | 122,360 |
| `source-serif-4-latin-ext.woff2` | Source Serif 4 | `opsz` 8–60, `wght` 200–900 | 100,872 |
| `jetbrains-mono-latin.woff2` | JetBrains Mono | `wght` 100–800 | 40,404 |
| `jetbrains-mono-latin-ext.woff2` | JetBrains Mono | `wght` 100–800 | 15,196 |

The `@font-face` declarations that bind these files to the `--sans`, `--serif`
and `--mono` design tokens are in `apps/web/app/fonts.css`.

## Licences

All three are licensed under the SIL Open Font License, Version 1.1, whose full
text is in `OFL.txt` beside this file. The OFL permits bundling and
redistribution with an application; it requires that the licence travel with
the font files, which is what this directory does.

- **Inter** — Copyright 2020 The Inter Project Authors
  (https://github.com/rsms/inter)
- **Source Serif 4** — Copyright 2014 The Source Serif 4 Project Authors
  (https://github.com/adobe-fonts/source-serif)
- **JetBrains Mono** — Copyright 2020 The JetBrains Mono Project Authors
  (https://github.com/JetBrains/JetBrainsMono)

None of the files have been modified beyond subsetting, and none are renamed in
a way that would engage the OFL's Reserved Font Name clause.
