import { createBrowserRouter, Outlet, type RouteObject } from "react-router-dom";
import { Skeleton } from "@ari/design-system";
import { SessionProvider } from "../app/session";
import { StepUpHost } from "../shared/StepUpDialog";
import { AppLayout, PublicLayout } from "../shared/layout/AppLayout";
import { PublicOnly, RequireEnrolmentSession, RequireSession, RoleHome } from "../shared/guards";
import { NotFound404, RouteErrorElement } from "../shared/errors";
import { ROUTES } from "./route-table";

function Root() {
  return (
    <SessionProvider>
      <Outlet />
      <StepUpHost />
    </SessionProvider>
  );
}

const lazyRoute = (r: (typeof ROUTES)[number]): RouteObject => ({
  path: r.path,
  lazy: async () => ({ Component: (await r.load()).Component, HydrateFallback: () => <Skeleton lines={3} /> }),
  errorElement: <RouteErrorElement />,
});

function grouped(): RouteObject[] {
  const pub = ROUTES.filter((r) => r.roles === "public");
  const any = ROUTES.filter((r) => r.roles === "any");
  const byRoles = new Map<string, typeof ROUTES>();
  for (const r of ROUTES) {
    if (r.roles === "public" || r.roles === "any" || r.roles === "enrol") continue;
    const k = [...r.roles].sort().join(",");
    byRoles.set(k, [...(byRoles.get(k) ?? []), r]);
  }
  return [
    { element: <PublicOnly />, children: [{ element: <PublicLayout />, children: pub.filter((r) => !r.openWhenSignedIn).map(lazyRoute) }] },
    { element: <PublicLayout />, children: pub.filter((r) => r.openWhenSignedIn).map(lazyRoute) },
    { element: <RequireEnrolmentSession />, children: [{ element: <PublicLayout />, children: ROUTES.filter((r) => r.roles === "enrol").map(lazyRoute) }] },
    {
      element: <RequireSession />,
      children: [
        {
          element: <AppLayout />,
          children: [
            { index: true, element: <RoleHome /> },
            ...any.map(lazyRoute),
            ...[...byRoles.entries()].map(([k, rs]) => ({
              element: <RequireSession roles={k.split(",") as never} />,
              children: rs.map(lazyRoute),
            })),
            { path: "*", element: <NotFound404 /> },
          ],
        },
      ],
    },
  ];
}

export const router = createBrowserRouter([{ element: <Root />, errorElement: <RouteErrorElement />, children: grouped() }]);
