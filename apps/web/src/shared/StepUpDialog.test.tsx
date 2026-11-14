import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LocaleProvider } from "../app/locale";

const post = vi.fn();
vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, api: { POST: (...a: unknown[]) => post(...a) } };
});
const setSession = vi.fn();
vi.mock("../app/session", () => ({
  useSession: () => ({ state: { status: "authenticated", session: { mfaEnrolled: true } }, setSession }),
}));
import { requestStepUp } from "../lib/api";
import { StepUpHost } from "./StepUpDialog";

const SESSION = { userId: "usr_1", roles: [], csrfToken: "c", expiresAt: "2026-11-14T10:00:00Z", stepUpFresh: true };

describe("StepUpHost (sensitive action after 5 minutes)", () => {
  beforeEach(() => { post.mockReset(); setSession.mockReset(); });

  it("asks for the 6-digit code, calls POST /auth/step-up, updates the session and lets the call retry", async () => {
    post.mockResolvedValue({ data: SESSION, response: new Response(null, { status: 200 }) });
    render(<LocaleProvider initial="en"><StepUpHost /></LocaleProvider>);
    let answer: Promise<boolean> = Promise.resolve(false);
    act(() => { answer = requestStepUp(); });
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Confirm it is you");
    fireEvent.change(screen.getByLabelText(/6-digit code/), { target: { value: "123 456" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await expect(answer).resolves.toBe(true);
    expect(post).toHaveBeenCalledWith("/auth/step-up", { body: { totpCode: "123456" } });
    expect(setSession).toHaveBeenCalledWith(SESSION);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("Cancel answers false: the caller gets the original problem, the user stays signed in", async () => {
    render(<LocaleProvider initial="en"><StepUpHost /></LocaleProvider>);
    let answer: Promise<boolean> = Promise.resolve(true);
    act(() => { answer = requestStepUp(); });
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await expect(answer).resolves.toBe(false);
    expect(post).not.toHaveBeenCalled();
  });

  it("a wrong code shows an error and keeps the dialog open", async () => {
    post.mockResolvedValue({ data: undefined, error: { title: "x", status: 401, code: "UNAUTHENTICATED" }, response: new Response(null, { status: 401 }) });
    render(<LocaleProvider initial="en"><StepUpHost /></LocaleProvider>);
    act(() => { void requestStepUp(); });
    await screen.findByRole("dialog");
    fireEvent.change(screen.getByLabelText(/6-digit code/), { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByText(/That code did not work/)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
