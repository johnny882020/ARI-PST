import type { ReactElement } from "react";
import { render } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { LocaleProvider } from "../app/locale";
import { makeQueryClient } from "../lib/query";
import type { Locale } from "@ari/i18n";

export function renderWithApp(ui: ReactElement, opts: { locale?: Locale; route?: string } = {}) {
  const qc = makeQueryClient();
  return render(
    <LocaleProvider initial={opts.locale ?? "en"}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[opts.route ?? "/"]}>{ui}</MemoryRouter>
      </QueryClientProvider>
    </LocaleProvider>,
  );
}
