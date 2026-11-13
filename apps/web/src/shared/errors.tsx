import { Component, useEffect, type ErrorInfo, type ReactNode } from "react";
import { isRouteErrorResponse, Link, useLocation, useNavigate, useRouteError } from "react-router-dom";
import { Button, EmptyState, ErrorState } from "@ari/design-system";
import { useT } from "../app/locale";
import { isApiProblem } from "@ari/api-client";
import { problemMessageKey, traceIdOf } from "./problem-message";
import { reportClientError } from "./error-reporter";
import { PageHeading } from "./page";

export function ErrorPanel({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useT();
  return (
    <ErrorState title={t("error.generic.title")} traceId={traceIdOf(error)} onRetry={onRetry} retryLabel={t("common.action.retry")}>
      {t(problemMessageKey(error))}
    </ErrorState>
  );
}

export function Forbidden403() {
  const t = useT();
  return (
    <>
      <PageHeading titleKey="error.forbidden.title" />
      <EmptyState title={t("error.forbidden.title")} icon="lock" headingLevel={2}>
        {t("error.forbidden.body")}
      </EmptyState>
    </>
  );
}

export function NotFound404() {
  const t = useT();
  return (
    <>
      <PageHeading titleKey="error.notFound.title" />
      <EmptyState title={t("error.notFound.title")} headingLevel={2} action={<Link className="ds-btn ds-btn-primary" to="/"><span className="ds-btn-label">{t("error.notFound.home")}</span></Link>}>
        {t("error.notFound.body")}
      </EmptyState>
    </>
  );
}

/** Route-level boundary (React Router errorElement): a crash in one feature does not blank the shell. */
export function RouteErrorElement() {
  const err = useRouteError();
  const loc = useLocation();
  const t = useT();
  const navigate = useNavigate();
  useEffect(() => {
    reportClientError(err instanceof Error ? err.name : "RouteError", loc.pathname);
  }, [err, loc.pathname]);
  if (isRouteErrorResponse(err) && err.status === 404) return <NotFound404 />;
  if (isApiProblem(err) && err.status === 403) return <Forbidden403 />;
  return (
    <div className="narrow">
      <PageHeading titleKey="error.generic.title" />
      <ErrorState title={t("error.generic.title")} traceId={traceIdOf(err)} onRetry={() => navigate(0)} retryLabel={t("common.action.retry")}>
        {t("error.generic.body")}
      </ErrorState>
    </div>
  );
}

interface BoundaryProps {
  children: ReactNode;
  fallback: (reset: () => void) => ReactNode;
  scope?: string;
}

/** Root and widget boundaries. Reports error name + route only: never props, input or query strings. */
export class ErrorBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, _info: ErrorInfo) {
    reportClientError(error.name, window.location.pathname);
  }
  reset = () => this.setState({ failed: false });
  render() {
    return this.state.failed ? this.props.fallback(this.reset) : this.props.children;
  }
}

export function RootErrorFallback() {
  const t = useT();
  return (
    <main className="narrow" style={{ paddingBlock: "4rem" }}>
      <h1 className="page-title">{t("error.generic.title")}</h1>
      <p>{t("error.generic.body")}</p>
      <Button variant="primary" onClick={() => window.location.reload()}>
        {t("error.reload")}
      </Button>
    </main>
  );
}

export function WidgetBoundary({ children }: { children: ReactNode }) {
  const t = useT();
  return (
    <ErrorBoundary
      fallback={(reset) => (
        <ErrorState title={t("error.generic.title")} onRetry={reset} retryLabel={t("common.action.retry")}>
          {t("error.generic.body")}
        </ErrorState>
      )}
    >
      {children}
    </ErrorBoundary>
  );
}
