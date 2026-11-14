import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithApp } from "../../test/render";

const verify = vi.fn();
vi.mock("../../lib/api", () => ({ api: { POST: (_path: string, init: { body: unknown }) => verify(init.body) }, setCsrfFallback: vi.fn(), onUnauthorized: vi.fn() }));
import { VerifyEmailPage } from "./VerifyEmailPage";

const TOKEN = "synthetic-verify-token-0001";
const ok = { response: { ok: true, status: 204, headers: new Headers() } };
const invalid = (field: string, rule: string) => ({ error: { status: 422, code: "VALIDATION_FAILED", title: "Validation failed", errors: [{ field, rule }] }, response: { ok: false, status: 422, headers: new Headers() } });

describe("VerifyEmailPage", () => {
  beforeEach(() => verify.mockReset());

  it("says the link is not complete when there is no token, and shows no form", () => {
    renderWithApp(<VerifyEmailPage />, { route: "/verify-email" });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("This link cannot be used");
    expect(screen.queryByLabelText(/New password/)).toBeNull();
  });

  it("checks length and match before calling the API", async () => {
    renderWithApp(<VerifyEmailPage />, { route: `/verify-email?token=${TOKEN}` });
    await userEvent.type(screen.getByLabelText(/New password/), "short");
    await userEvent.type(screen.getByLabelText(/Repeat the password/), "short");
    await userEvent.click(screen.getByRole("button", { name: "Set password" }));
    expect((await screen.findAllByText("Use 12 to 128 characters")).length).toBeGreaterThan(0);
    await userEvent.clear(screen.getByLabelText(/New password/));
    await userEvent.type(screen.getByLabelText(/New password/), "a-long-synthetic-phrase");
    await userEvent.clear(screen.getByLabelText(/Repeat the password/));
    await userEvent.type(screen.getByLabelText(/Repeat the password/), "a-different-phrase-here");
    await userEvent.click(screen.getByRole("button", { name: "Set password" }));
    expect((await screen.findAllByText("The two passwords are not the same")).length).toBeGreaterThan(0);
    expect(verify).not.toHaveBeenCalled();
  });

  it("sends token and password, then shows the next steps and a sign-in link", async () => {
    verify.mockResolvedValue(ok);
    renderWithApp(<VerifyEmailPage />, { route: `/verify-email?token=${TOKEN}` });
    await userEvent.type(screen.getByLabelText(/New password/), "a-long-synthetic-phrase");
    await userEvent.type(screen.getByLabelText(/Repeat the password/), "a-long-synthetic-phrase");
    await userEvent.click(screen.getByRole("button", { name: "Set password" }));
    await waitFor(() => expect(verify).toHaveBeenCalledWith({ token: TOKEN, password: "a-long-synthetic-phrase" }));
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Your e-mail is verified and your password is set");
    expect(screen.getByRole("link", { name: "Go to sign in" })).toHaveAttribute("href", "/login");
    expect(screen.getByText(/set up two-step verification/)).toBeInTheDocument();
    expect(Object.keys(localStorage)).toEqual([]);
    expect(Object.keys(sessionStorage)).toEqual([]);
  });

  it("a used or expired token shows the link message, not a field error", async () => {
    verify.mockResolvedValue(invalid("token", "FORMAT"));
    renderWithApp(<VerifyEmailPage />, { route: `/verify-email?token=${TOKEN}` });
    await userEvent.type(screen.getByLabelText(/New password/), "a-long-synthetic-phrase");
    await userEvent.type(screen.getByLabelText(/Repeat the password/), "a-long-synthetic-phrase");
    await userEvent.click(screen.getByRole("button", { name: "Set password" }));
    expect(await screen.findByText(/This link is no longer valid/)).toBeInTheDocument();
  });

  it("maps a server password rule to the field", async () => {
    verify.mockResolvedValue(invalid("password", "COMMON"));
    renderWithApp(<VerifyEmailPage />, { route: `/verify-email?token=${TOKEN}` });
    await userEvent.type(screen.getByLabelText(/New password/), "a-long-synthetic-phrase");
    await userEvent.type(screen.getByLabelText(/Repeat the password/), "a-long-synthetic-phrase");
    await userEvent.click(screen.getByRole("button", { name: "Set password" }));
    expect((await screen.findAllByText(/too easy to guess/)).length).toBeGreaterThan(0);
  });

  it("renders in Hebrew", () => {
    renderWithApp(<VerifyEmailPage />, { route: `/verify-email?token=${TOKEN}`, locale: "he" });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("אימות הדוא״ל וקביעת סיסמה");
  });
});
