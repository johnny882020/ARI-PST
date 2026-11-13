import { beforeEach, describe, expect, it } from "vitest";
import { readPref, writePref } from "./ui-prefs";

describe("ui-prefs allow-list", () => {
  beforeEach(() => localStorage.clear());
  it("stores only allowed keys and values", () => {
    writePref("ui.theme", "dark");
    writePref("ui.theme", "<script>");
    expect(readPref("ui.theme")).toBe("dark");
    expect(Object.keys(localStorage)).toEqual(["ui.theme"]);
  });
  it("ignores tampered stored values", () => {
    localStorage.setItem("ui.locale", "fr");
    expect(readPref("ui.locale")).toBeNull();
  });
  it("never throws when storage is blocked", () => {
    const orig = Object.getOwnPropertyDescriptor(globalThis, "localStorage")!;
    Object.defineProperty(globalThis, "localStorage", { get() { throw new Error("blocked"); }, configurable: true });
    expect(readPref("ui.theme")).toBeNull();
    expect(() => writePref("ui.theme", "dark")).not.toThrow();
    Object.defineProperty(globalThis, "localStorage", orig);
  });
});
