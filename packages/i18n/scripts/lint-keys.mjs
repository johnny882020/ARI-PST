// Key lint: same key set in he and en, key shape area.screen.element, no HTML in messages.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "messages");
const he = JSON.parse(readFileSync(join(dir, "he.json"), "utf8"));
const en = JSON.parse(readFileSync(join(dir, "en.json"), "utf8"));
const KEY = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/;
const errors = [];
for (const k of Object.keys(en)) if (!(k in he)) errors.push(`missing in he: ${k}`);
for (const k of Object.keys(he)) if (!(k in en)) errors.push(`missing in en: ${k}`);
for (const [name, cat] of [["he", he], ["en", en]]) {
  for (const [k, v] of Object.entries(cat)) {
    if (!KEY.test(k)) errors.push(`${name}: bad key shape ${k}`);
    if (typeof v !== "string" || v.trim() === "") errors.push(`${name}: empty ${k}`);
    else if (/<(script|style|iframe|a |img)/i.test(v)) errors.push(`${name}: raw HTML in ${k}`);
  }
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`i18n keys OK (${Object.keys(en).length} keys)`);
