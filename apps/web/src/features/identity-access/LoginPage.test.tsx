import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiProblem } from "@ari/api-client";
import { renderWithApp } from "../../test/render";

const post = vi.fn();
vi.mock("../../lib/api", () => ({ api: { POST: (...a: unknown[]) => post(...a) }, setCsrfFallback: vi.fn(), onUnauthorized: vi.fn() }));
vi.mock("@ari/api-client", async (orig) => {
  const actual = await orig<typeof import("@ari/api-client")>();
  return { ...actual, unwrap: async (p: Promise<{ data?: unknown; error?: unknown; response: { ok: boolean; status: number; headers: Headers } }>) => {
    const r = await p;
    if (r.error) throw new actual.ApiProblem({ status: r.response.status, code: (r.error as { code: string }).code });
    return r.data;
  } };
});
import { LoginPage } from "./LoginPage";
import { authFlow } from "./auth-flow";

describe("LoginPage", () => {
  beforeEach(() => { post.mockReset(); authFlow.clear(); });

  it("shows localized required errors and does not call the API", async () => {
    renderWithApp(<LoginPage />);
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect((await screen.findAllByText("Please fill in this field")).length).toBe(2);
    expect(post).not.toHaveBeenCalled();
  });

  it("shows a generic message for wrong credentials and clears the password", async () => {
    post.mockResolvedValue({ error: { code: "INVALID_CREDENTIALS" }, response: { ok: false, status: 401, headers: new Headers() } });
    renderWithApp(<LoginPage />);
    await userEvent.type(screen.getByLabelText(/E-mail/), "a@example.test");
    await userEvent.type(screen.getByLabelText(/Password/), "nope");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText(/The e-mail or password is not right/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText(/Password/)).toHaveValue(""));
  });

  it("keeps the challenge in memory only on success", async () => {
    post.mockResolvedValue({ data: { challengeToken: "tok", factors: ["totp"] }, response: { ok: true, status: 200, headers: new Headers() } });
    renderWithApp(<LoginPage />);
    await userEvent.type(screen.getByLabelText(/E-mail/), "a@example.test");
    await userEvent.type(screen.getByLabelText(/Password/), "pw");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(authFlow.get()?.token).toBe("tok"));
    expect(Object.keys(localStorage)).toEqual([]);
    expect(Object.keys(sessionStorage)).toEqual([]);
  });

  it("renders Hebrew RTL text when locale is he", () => {
    renderWithApp(<LoginPage />, { locale: "he" });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("התחברות");
    expect(document.documentElement.dir).toBe("rtl");
  });
  void ApiProblem;
});
