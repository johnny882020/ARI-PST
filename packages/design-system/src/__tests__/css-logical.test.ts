import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../..");
const SKIP = new Set(["node_modules", "dist", "coverage"]);

function cssFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) cssFiles(p, out);
    else if (p.endsWith(".css")) out.push(p);
  }
  return out;
}

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));

// Each rule: physical property names that have a logical equivalent (see plan/05 03-rtl-bidi.md section 2).
const RULES: Array<{ name: string; re: RegExp }> = [
  // margin-left, padding-right, border-left-color, border-top-left-radius, scroll-margin-right, left:, right:
  { name: "physical left/right property", re: /(?:^|[\s;{])(?!--)[a-z-]*\b(?:left|right)\b[a-z-]*\s*:/i },
  { name: "text-align: left|right", re: /text-align\s*:\s*(?:left|right)\b/i },
  { name: "float: left|right", re: /\bfloat\s*:\s*(?:left|right|none)?/i },
  { name: "clear: left|right", re: /\bclear\s*:\s*(?:left|right)\b/i },
];

/** Returns violations as "line: text". A line with a "physical:" comment is an allowed exception. */
export function findPhysicalProperties(css: string): string[] {
  const exceptionLines = new Set<number>();
  css.split("\n").forEach((l, i) => {
    if (/\/\*\s*physical:/i.test(l)) exceptionLines.add(i);
  });
  const clean = stripComments(css).split("\n");
  const found: string[] = [];
  clean.forEach((line, i) => {
    if (exceptionLines.has(i)) return;
    for (const r of RULES) {
      // float rule: only flag float: left/right/inline? any float declaration is flagged except `float: none`
      if (r.name === "float: left|right") {
        if (/\bfloat\s*:\s*(?!none\b)[a-z-]+/i.test(line)) found.push(`${i + 1}: ${line.trim()} [${r.name}]`);
        continue;
      }
      if (r.re.test(line)) found.push(`${i + 1}: ${line.trim()} [${r.name}]`);
    }
  });
  return found;
}

describe("CSS uses logical properties only", () => {
  const files = cssFiles(ROOT);

  it("finds the package CSS files", () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
  });

  for (const file of files) {
    it(`no physical properties in ${file.slice(ROOT.length + 1)}`, () => {
      expect(findPhysicalProperties(readFileSync(file, "utf8"))).toEqual([]);
    });
  }

  it("detector catches physical properties (self-check)", () => {
    const bad = [
      ".a { margin-left: 1px; }",
      ".a { padding-right: 1px; }",
      ".a { position: absolute; left: 0; }",
      ".a { right: 0 }",
      ".a { text-align: left; }",
      ".a { text-align:right }",
      ".a { float: left; }",
      ".a { border-top-left-radius: 4px; }",
      ".a { border-right: 1px solid red; }",
    ];
    for (const css of bad) expect(findPhysicalProperties(css), css).not.toEqual([]);
  });

  it("detector allows logical properties, comments and marked exceptions", () => {
    const good = [
      ".a { margin-inline-start: 1px; inset-inline-end: 0; text-align: start; }",
      "/* margin-left: 1px; */ .a { color: red; }",
      ".a { --left-gap: 1px; }",
      ".a { left: 0; } /* physical: map pin */".replace(" } /*", "; /* physical: map pin */ }"),
      ".a { border-start-start-radius: 4px; float: none; }",
    ];
    for (const css of good) expect(findPhysicalProperties(css), css).toEqual([]);
  });
});
