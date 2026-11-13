/** Finds physical (non-logical) CSS. A line containing "physical:" in a comment is exempt. */
export function physicalCssViolations(css: string): string[] {
  const bad: string[] = [];
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, (m) => (/physical:/.test(m) ? m : ' '.repeat(0)));
  const lines = noComments.split('\n');
  const PROP = /(?:^|[;{\s])(margin|padding)-(left|right|top|bottom)\s*:|(?:^|[;{\s])border-(left|right|top|bottom)(-(width|style|color))?\s*:|(?:^|[;{\s])border-(top|bottom)-(left|right)-radius\s*:|(?:^|[;{\s])(left|right|top|bottom)\s*:|(?:^|[;{\s])(float|clear)\s*:\s*(left|right)|text-align\s*:\s*(left|right)|(?:^|[;{\s])(overflow)-(x|y)\s*:|(?:^|[;{\s])(min-|max-)?(width|height)\s*:|translateX\(|scrollbar-gutter\s*:\s*stable\s+both/;
  const SHORT = /(?:^|[;{\s])(margin|padding)\s*:\s*([^;}]+)/;
  lines.forEach((line, i) => {
    if (/physical:/.test(line)) return;
    if (PROP.test(line)) bad.push(`${i + 1}: ${line.trim()}`);
    const m = SHORT.exec(line);
    // 3 or 4 value margin/padding shorthands encode physical sides
    if (m && m[2]!.trim().split(/\s+(?![^(]*\))/).length >= 3) bad.push(`${i + 1}: ${line.trim()}`);
  });
  return bad;
}

