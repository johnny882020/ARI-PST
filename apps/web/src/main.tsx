import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router-dom";
import { ToastProvider } from "@ari/design-system";
import "@ari/design-system/styles.css";
import "./styles/app.css";
import { LocaleProvider } from "./app/locale";
import { makeQueryClient } from "./lib/query";
import { router } from "./routes/router";
import { ErrorBoundary, RootErrorFallback } from "./shared/errors";

const queryClient = makeQueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LocaleProvider>
      <ErrorBoundary fallback={() => <RootErrorFallback />}>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <RouterProvider router={router} />
          </ToastProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </LocaleProvider>
  </StrictMode>,
);
