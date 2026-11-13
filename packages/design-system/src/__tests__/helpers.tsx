import { render } from "@testing-library/react";
import { configureAxe } from "vitest-axe";
import type { ReactElement } from "react";
import { DesignSystemProvider, type Locale } from "../index";

export const LOCALES: Locale[] = ["he", "en"];

export function renderIn(ui: ReactElement, locale: Locale = "en") {
  return render(<DesignSystemProvider locale={locale}>{ui}</DesignSystemProvider>);
}

// jsdom cannot compute colors; contrast is covered by token pairs in plan/05 04-accessibility.md.
// "region" is a page-level rule and does not apply to isolated components.
export const axe = configureAxe({
  rules: { "color-contrast": { enabled: false }, region: { enabled: false } },
});
