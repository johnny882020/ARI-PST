import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { LocaleProvider } from "../app/locale";

const extend = vi.fn(async () => undefined);
const signOut = vi.fn(async () => undefined);
let expiresAt = "";
vi.mock("../app/session", () => ({ useSession: () => ({ state: { status: "authenticated", session: { expiresAt } }, extend, signOut }) }));
import { SessionTimer } from "./SessionTimer";

describe("SessionTimer", () => {
  beforeEach(() => { vi.useFakeTimers(); extend.mockClear(); signOut.mockClear(); });
  afterEach(() => vi.useRealTimers());

  it("warns 2 minutes before expiry with an alert dialog, then expires", async () => {
    expiresAt = new Date(Date.now() + 130_000).toISOString();
    render(<LocaleProvider initial="en"><SessionTimer /></LocaleProvider>);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await act(async () => { vi.advanceTimersByTime(15_000); });
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(120_000); });
    expect(signOut).toHaveBeenCalledWith("expired");
  });
});
