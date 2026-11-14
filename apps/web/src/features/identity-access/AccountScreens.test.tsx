import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { LocaleProvider } from "../../app/locale";
import { makeQueryClient } from "../../lib/query";
import { renderWithApp } from "../../test/render";

const post = vi.fn();
const get = vi.fn();
vi.mock("../../lib/api", () => ({
  api: { POST: (path: string, init?: { body?: unknown }) => post(path, init?.body), GET: (path: string) => get(path) },
  setCsrfFallback: vi.fn(), onUnauthorized: vi.fn(),
}));
import { ForgotPasswordPage } from "./ForgotPasswordPage";
import { ResetPasswordPage } from "./ResetPasswordPage";
import { InviteAcceptPage } from "./InviteAcceptPage";
import { ChangePasswordPage } from "./ChangePasswordPage";
import { RecoveryCodesPage } from "./RecoveryCodesPage";
import { LoginPage } from "./LoginPage";

const TOKEN = "synthetic-reset-token-00001";
const PW = "a-long-synthetic-phrase";
const res = (status: number) => ({ ok: status < 400, status, headers: new Headers() });
const ok = (data?: unknown, status = 200) => ({ data, response: res(status) });
const invalid = (field: string, rule: string) => ({ error: { status: 422, code: "VALIDATION_FAILED", title: "Validation failed", errors: [{ field, rule }] }, response: res(422) });

async function fillNew(label = /New password/, repeat = /Repeat the/) {
  await userEvent.type(screen.getByLabelText(label), PW);
  await userEvent.type(screen.getByLabelText(repeat), PW);
}

beforeEach(() => { post.mockReset(); get.mockReset(); });

describe("sign-in page", () => {
  it("has a Forgot password link", () => {
    renderWithApp(<LoginPage />, { route: "/login" });
    expect(screen.getByRole("link", { name: "Forgot your password?" })).toHaveAttribute("href", "/forgot-password");
  });
});

describe("ForgotPasswordPage", () => {
  it("sends the address and shows the same neutral text whatever the answer", async () => {
    post.mockResolvedValue(ok({ accepted: true }, 202));
    renderWithApp(<ForgotPasswordPage />, { route: "/forgot-password" });
    await userEvent.type(screen.getByLabelText(/E-mail/), "synthetic.user@example.invalid");
    await userEvent.click(screen.getByRole("button", { name: "Send the link" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/auth/password-reset/request", { email: "synthetic.user@example.invalid" }));
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Check your e-mail");
    expect(screen.getByText(/If an account uses this address/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/not found|no account|unknown/i);
  });
  it("checks the address before calling the API", async () => {
    renderWithApp(<ForgotPasswordPage />, { route: "/forgot-password" });
    await userEvent.type(screen.getByLabelText(/E-mail/), "not-an-address");
    await userEvent.click(screen.getByRole("button", { name: "Send the link" }));
    expect(await screen.findByText("Enter a valid e-mail address")).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });
  it("renders in Hebrew", () => {
    renderWithApp(<ForgotPasswordPage />, { route: "/forgot-password", locale: "he" });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("איפוס סיסמה");
  });
});

describe("ResetPasswordPage", () => {
  it("without a token shows the link message and a way to ask again", () => {
    renderWithApp(<ResetPasswordPage />, { route: "/reset-password" });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("This link cannot be used");
    expect(screen.getByRole("link", { name: "Ask for a new link" })).toHaveAttribute("href", "/forgot-password");
  });
  it("sends token and new password, then leads to sign in; nothing is stored in the browser", async () => {
    post.mockResolvedValue({ response: res(204) });
    renderWithApp(<ResetPasswordPage />, { route: `/reset-password?token=${TOKEN}` });
    await fillNew();
    await userEvent.click(screen.getByRole("button", { name: "Save the new password" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/auth/password-reset/confirm", { token: TOKEN, password: PW }));
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Your password is changed");
    expect(screen.getByRole("link", { name: "Go to sign in" })).toHaveAttribute("href", "/login");
    expect(Object.keys(localStorage)).toEqual([]); expect(Object.keys(sessionStorage)).toEqual([]);
  });
  it("a used or expired token shows the link message; a weak password stays on the form", async () => {
    post.mockResolvedValueOnce(invalid("password", "COMMON")).mockResolvedValueOnce(invalid("token", "FORMAT"));
    renderWithApp(<ResetPasswordPage />, { route: `/reset-password?token=${TOKEN}` });
    await fillNew();
    await userEvent.click(screen.getByRole("button", { name: "Save the new password" }));
    expect((await screen.findAllByText(/too easy to guess/)).length).toBeGreaterThan(0);
    await userEvent.type(screen.getByLabelText(/Repeat the/), PW);
    await userEvent.click(screen.getByRole("button", { name: "Save the new password" }));
    expect(await screen.findByText(/was used already, or has expired/)).toBeInTheDocument();
  });
});

describe("InviteAcceptPage", () => {
  const renderInvite = (path: string) => render(
    <LocaleProvider initial="en">
      <QueryClientProvider client={makeQueryClient()}>
        <MemoryRouter initialEntries={[path]}><Routes><Route path="/invite/:token" element={<InviteAcceptPage />} /></Routes></MemoryRouter>
      </QueryClientProvider>
    </LocaleProvider>,
  );
  it("sets the password with the invite token, then leads to sign-in and MFA enrolment", async () => {
    post.mockResolvedValue({ response: res(204) });
    renderInvite(`/invite/${TOKEN}`);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Accept the invitation");
    await fillNew();
    await userEvent.click(screen.getByRole("button", { name: "Activate the account" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/auth/verify-email", { token: TOKEN, password: PW }));
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Your account is active");
    expect(screen.getByRole("link", { name: "Sign in and set up two-step verification" })).toHaveAttribute("href", "/login?next=%2Fsetup-mfa");
  });
  it("a short token shows the invitation message", () => {
    renderInvite("/invite/short");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("This invitation cannot be used");
  });
});

describe("ChangePasswordPage", () => {
  it("sends current and new password; a wrong current password goes to its field", async () => {
    post.mockResolvedValueOnce(invalid("currentPassword", "FORMAT")).mockResolvedValueOnce({ response: res(204) });
    renderWithApp(<ChangePasswordPage />, { route: "/account/password" });
    await userEvent.type(screen.getByLabelText(/Current password/), "old-synthetic-phrase");
    await fillNew(/^New password/, /Repeat the new password/);
    await userEvent.click(screen.getByRole("button", { name: "Save the new password" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/auth/password", { currentPassword: "old-synthetic-phrase", newPassword: PW }));
    expect((await screen.findAllByText("The current password is not correct.")).length).toBeGreaterThan(0);
    await userEvent.type(screen.getByLabelText(/Current password/), "old-synthetic-phrase");
    await userEvent.type(screen.getByLabelText(/Repeat the new password/), PW);
    await userEvent.click(screen.getByRole("button", { name: "Save the new password" }));
    expect(await screen.findByText(/Your other sessions have ended/)).toBeInTheDocument();
  });
});

describe("RecoveryCodesPage", () => {
  it("shows the count, makes new codes once, and copies them", async () => {
    get.mockResolvedValue(ok({ unused: 2 }));
    const codes = Array.from({ length: 10 }, (_, i) => `synth${i}00-00000000`);
    post.mockResolvedValue(ok({ recoveryCodes: codes }));
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderWithApp(<RecoveryCodesPage />, { route: "/account/recovery-codes" });
    expect(await screen.findByTestId("recovery-count")).toHaveTextContent("You have 2 unused codes.");
    expect(screen.getByText(/Only a few codes are left/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Make new codes" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/auth/recovery-codes", undefined));
    expect((await screen.findByTestId("recovery-codes")).querySelectorAll("li")).toHaveLength(10);
    await userEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith(codes.join("\n"));
    expect(await screen.findByText("The codes are copied.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByTestId("recovery-codes")).toBeNull();
    expect(document.body.textContent).not.toContain(codes[0]);
  });
  it("renders the count in Hebrew", async () => {
    get.mockResolvedValue(ok({ unused: 0 }));
    renderWithApp(<RecoveryCodesPage />, { route: "/account/recovery-codes", locale: "he" });
    expect(await screen.findByTestId("recovery-count")).toHaveTextContent("יש לכם 0 קודים שלא נוצלו.");
  });
});
