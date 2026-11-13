/** In-memory only: the pending login challenge. Lost on reload by design (user signs in again). */
let challenge: { token: string; factors: string[] } | null = null;
export const authFlow = {
  set(token: string, factors: string[]) { challenge = { token, factors }; },
  get() { return challenge; },
  clear() { challenge = null; },
};
