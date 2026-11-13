import { describe, expect, it } from "vitest";
import { b64urlToBuf, bufToB64url, classifyPasskeyError } from "./webauthn";

describe("webauthn helpers", () => {
  it("round-trips base64url", () => {
    const buf = new Uint8Array([0, 250, 251, 252, 255, 1, 2]).buffer;
    const s = bufToB64url(buf);
    expect(s).not.toMatch(/[+/=]/);
    expect([...new Uint8Array(b64urlToBuf(s))]).toEqual([0, 250, 251, 252, 255, 1, 2]);
  });
  it("maps browser errors to friendly classes", () => {
    expect(classifyPasskeyError({ name: "NotAllowedError" })).toBe("cancelled");
    expect(classifyPasskeyError({ name: "InvalidStateError" })).toBe("alreadyRegistered");
    expect(classifyPasskeyError(new Error("x"))).toBe("failed");
  });
});
