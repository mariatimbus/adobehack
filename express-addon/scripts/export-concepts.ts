/** Reproducible offline gallery, using the exact same specs as the add-on. */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { campaignConcepts } from "../src/shared/campaignConcepts";
import { specToSvg } from "../src/shared/svgPreview";

const input = JSON.parse(readFileSync(process.argv[2], "utf8"));
const source = input.spec ?? input;
const out = resolve(process.argv[3] ?? "../../design-concepts");
mkdirSync(out, { recursive: true });
const photo = `data:image/png;base64,${readFileSync(resolve("assets-public/alphaz-hero.png")).toString("base64")}`;
const concepts = campaignConcepts(source);
const cards = concepts.map((c, i) => {
  const svg = specToSvg(c.spec, { width: 432, styles: c.styles, assets: { "concept-photo": photo } });
  writeFileSync(resolve(out, `${c.id}.svg`), svg);
  writeFileSync(resolve(out, `${c.id}.json`), JSON.stringify(c.spec, null, 2));
  return `<article><header><small>DIRECTION 0${i + 1}</small><h2>${c.title}</h2></header>${svg}<footer><p>${c.description}</p><a href="${c.id}.svg">Open full-size design ↗</a></footer></article>`;
});
writeFileSync(resolve(out, "index.html"), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CreativeDNA · AI Expo design directions</title><style>*{box-sizing:border-box}body{margin:0;background:#edf2f0;color:#102b37;font-family:Arial,Helvetica,sans-serif}main{max-width:1440px;margin:auto;padding:48px 36px}h1{font-size:42px;letter-spacing:-1.5px;margin:12px 0}small{font-size:10px;letter-spacing:2px;font-weight:700;color:#728780}.intro{line-height:1.6;color:#63747c;max-width:650px;margin-bottom:32px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px}article{background:#fff;border:1px solid #dce5e0;border-radius:16px;overflow:hidden}header{padding:22px}h2{font-size:22px;letter-spacing:-.5px;margin:6px 0 0}svg{display:block;width:100%;height:auto}footer{padding:20px;color:#63747c;font-size:13px;line-height:1.6}footer p{margin:0 0 14px}a{color:#123e4c;font-weight:600;text-decoration:none}.note{margin-top:30px;font-size:12px;color:#738580;line-height:1.7}@media(max-width:800px){main{padding:24px 16px}.grid{grid-template-columns:1fr}h1{font-size:32px}}</style><main><small>CREATIVEDNA / AI EXPO EUROPE</small><h1>One campaign. Three perspectives.</h1><p class="intro">A new set of editorial directions for AlphaZ. Real campaign photography, a clear reading order and room for the message to breathe.</p><div class="grid">${cards.join("")}</div><p class="note">Layout concepts with shortened editorial copy. Event details are taken from the supplied campaign. Review copy and layout before publishing. These are not constraint-verified in-place repairs; the add-on can create each design on a separate editable page.</p></main></html>`);
console.log(`Exported ${concepts.length} designs and gallery to ${out}`);
