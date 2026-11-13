/** WebAuthn JSON <-> ArrayBuffer helpers. Pure; browser APIs are only called from the pages. */
export function b64urlToBuf(s: string): ArrayBuffer {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
export function bufToB64url(buf: ArrayBuffer): string {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const passkeysSupported = (): boolean => typeof window !== "undefined" && "PublicKeyCredential" in window && !!navigator.credentials;

export type PasskeyError = "cancelled" | "alreadyRegistered" | "failed";
export function classifyPasskeyError(e: unknown): PasskeyError {
  const name = (e as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "AbortError") return "cancelled";
  if (name === "InvalidStateError") return "alreadyRegistered";
  return "failed";
}

export async function getAssertion(options: Record<string, unknown>): Promise<Record<string, unknown>> {
  const pk = { ...options, challenge: b64urlToBuf(String(options.challenge)) } as unknown as PublicKeyCredentialRequestOptions;
  if (Array.isArray((options as { allowCredentials?: unknown[] }).allowCredentials)) {
    pk.allowCredentials = ((options as { allowCredentials: { id: string; type: "public-key" }[] }).allowCredentials).map((c) => ({ ...c, id: b64urlToBuf(c.id) }));
  }
  const cred = (await navigator.credentials.get({ publicKey: pk })) as PublicKeyCredential | null;
  if (!cred) throw new DOMException("cancelled", "NotAllowedError");
  const r = cred.response as AuthenticatorAssertionResponse;
  return {
    id: cred.id, type: cred.type, rawId: bufToB64url(cred.rawId),
    response: { authenticatorData: bufToB64url(r.authenticatorData), clientDataJSON: bufToB64url(r.clientDataJSON), signature: bufToB64url(r.signature), userHandle: r.userHandle ? bufToB64url(r.userHandle) : null },
  };
}

export async function createCredential(options: Record<string, unknown>): Promise<Record<string, unknown>> {
  const o = options as { challenge: string; user: { id: string }; excludeCredentials?: { id: string; type: "public-key" }[] };
  const pk = { ...options, challenge: b64urlToBuf(o.challenge), user: { ...o.user, id: b64urlToBuf(o.user.id) } } as unknown as PublicKeyCredentialCreationOptions;
  if (o.excludeCredentials) pk.excludeCredentials = o.excludeCredentials.map((c) => ({ ...c, id: b64urlToBuf(c.id) }));
  const cred = (await navigator.credentials.create({ publicKey: pk })) as PublicKeyCredential | null;
  if (!cred) throw new DOMException("cancelled", "NotAllowedError");
  const r = cred.response as AuthenticatorAttestationResponse;
  return { id: cred.id, type: cred.type, rawId: bufToB64url(cred.rawId), response: { attestationObject: bufToB64url(r.attestationObject), clientDataJSON: bufToB64url(r.clientDataJSON) } };
}
