// Composes Main.dc.html from the integrator template plus the four element
// modules. Re-run after any module or template change.
import { readFileSync, writeFileSync } from "fs";
const D = new URL(".", import.meta.url).pathname;
const template = readFileSync(D + "main.template.html", "utf8");
const mods = ["shader", "layers", "beats"]
  .map((m) => {
    const src = readFileSync(D + "mods/" + m + ".js", "utf8");
    return "/* ---- module: " + m + " ---- */\n" + src;
  })
  .join("\n");
if (!template.includes("/*__TL_MODULES__*/")) { console.error("marker missing"); process.exit(1); }
// Where the page sends people, in one place.
//
// The download buttons used to point into the GitHub repository, which is
// private — so every one of them returned 404 to exactly the person the page
// exists for. They now point at the release host, and the host is a token
// rather than a literal because it is a decision that outlives any one edit
// (D050). Override with TL_RELEASES / TL_GITHUB when assembling.
//
// What they point *at* is the launcher rather than the tarball: T081 made the
// launcher the thing you download — run it and it installs Throughline or opens
// it if the machine already has it.
const RELEASES = process.env.TL_RELEASES || "https://releases.throughline.tools";
const GITHUB = process.env.TL_GITHUB || "https://github.com/SarthakPattnaik1/throughline-os";

const page = template
  .replace("/*__TL_MODULES__*/", () => mods)
  .replaceAll("__TL_RELEASES__", RELEASES)
  .replaceAll("__TL_GITHUB__", GITHUB);

if (page.includes("__TL_")) {
  console.error("a __TL_ token was left unsubstituted; refusing to write a page "
                + "with a broken link in it");
  process.exit(1);
}

writeFileSync(D + "Main.dc.html", page);
console.log("assembled Main.dc.html (" + mods.length + " bytes of modules)");
