import { readFileSync, writeFileSync } from "fs";
const src = readFileSync(process.argv[2], "utf8");
const script = src.match(/<script data-dc-script[^>]*>([\s\S]*?)<\/script>/);
const markup = src.match(/<x-dc>([\s\S]*?)<\/x-dc>/);
const helmet = src.match(/<helmet>([\s\S]*?)<\/helmet>/);
if (!script || !markup) { console.error("extract failed"); process.exit(1); }
const body = markup[1].replace(/<helmet>[\s\S]*?<\/helmet>/, "");
const html = `<!doctype html><html><head><meta charset="utf-8">${helmet ? helmet[1] : ""}</head><body>
${body}
<script>
class DCLogic {}
${script[1]}
const comp = new Component();
comp.props = { glowTint: "#e8b76a", spinSpeed: 1 };
const vals = comp.renderVals();
for (const [k, fn] of Object.entries(vals)) {
  if (!k.startsWith("set")) continue;
  const el = document.querySelector('[ref="{{' + k + '}}"]');
  if (el) fn(el);
}
comp.componentDidMount();
window.__comp = comp;
window.__setP = (p) => { comp.P = p; comp.targetP = p; };
</scr` + `ipt></body></html>`;
writeFileSync(process.argv[3], html);
console.log("harness written");
