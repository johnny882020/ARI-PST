/**
 * Endpoints the protected app needs that are NOT yet in packages/contracts/openapi.yaml
 * (canonical-decisions C-10 says the build adds them). Typed by hand in the same shape that
 * openapi-typescript emits, so one typed client covers both. When the contract gains these
 * paths, delete the matching entry here and re-run `pnpm gen`.
 */
import type { components } from "./generated/schema";

type S = components["schemas"];
type Json<T> = { content: { "application/json": T } };
type Res<T> = { headers: Record<string, unknown>; content: { "application/json": T } };
type NoContent = { headers: Record<string, unknown>; content?: never };
type ProblemRes = { headers: Record<string, unknown>; content: { "application/problem+json": S["Problem"] } };
type Errors = { 400: ProblemRes; 401: ProblemRes; 403: ProblemRes; 404: ProblemRes; 409: ProblemRes; 422: ProblemRes; 429: ProblemRes };
type NoPath = { query?: never; header?: never; path?: never; cookie?: never };
type PP<P> = { query?: never; header?: never; path: P; cookie?: never };

export type CartItem = {
  id: string;
  criteria: S["SearchFilters"];
  snapshot: { count: number | null; suppressed: boolean; label: string };
  addedAt: string;
};
export type Cart = { items: CartItem[]; limit: number };

export type Registration = {
  id: string;
  displayName: string;
  institution: string;
  email: string;
  status: "pending" | "approved" | "rejected";
  requestedAt: string;
};
export type RegistrationCreate = {
  email: string;
  displayName: string;
  institution: string;
  termsVersion: string;
  locale?: "he" | "en";
};

export type KPolicy = {
  id: string;
  fieldSet: string;
  k: number;
  pendingChange: null | { id: string; proposedK: number; proposedByUserId: string; reason: string };
};
export type RoleGrantRequest = {
  id: string;
  userId: string;
  role: S["Role"];
  centerId: string | null;
  reason: string;
  requestedByUserId: string;
  status: "pending" | "approved" | "rejected";
  requestedAt: string;
};
export type VoteTally = {
  required: number;
  members: number;
  approve: number;
  reject: number;
  abstain: number;
  myVote: "approve" | "reject" | "abstain" | null;
  conflictDeclared: boolean;
};
export type TotpEnrolment = { otpauthUri: string; secret: string };
export type AuthMethod = {
  id: string;
  kind: "passkey" | "totp";
  name: string;
  addedAt: string;
  lastUsedAt: string | null;
};
export type PrecheckDecision = {
  outcome: "forward" | "ask_info" | "reject";
  reasonCode?: string;
  note?: string;
};
export type ClientErrorReport = { name: string; route: string; version: string; traceId?: string };

export interface ExtPaths {
  "/session/extend": {
    parameters: Record<string, never>;
    post: { parameters: NoPath; requestBody?: never; responses: { 200: Res<S["Session"]> } & Pick<Errors, 401> };
  };
  "/auth/register": {
    parameters: Record<string, never>;
    post: {
      parameters: NoPath;
      requestBody: Json<RegistrationCreate>;
      responses: { 202: NoContent } & Pick<Errors, 422 | 429>;
    };
  };
  "/auth/mfa/recovery": {
    parameters: Record<string, never>;
    post: {
      parameters: NoPath;
      requestBody: Json<{ challengeToken: string; recoveryCode: string }>;
      responses: { 200: Res<S["Session"]> } & Pick<Errors, 401 | 429>;
    };
  };
  "/auth/methods": {
    parameters: Record<string, never>;
    get: { parameters: NoPath; requestBody?: never; responses: { 200: Res<{ items: AuthMethod[] }> } & Pick<Errors, 401> };
  };
  "/auth/enrol/totp": {
    parameters: Record<string, never>;
    post: { parameters: NoPath; requestBody?: never; responses: { 200: Res<TotpEnrolment> } & Pick<Errors, 401> };
  };
  "/auth/enrol/totp/confirm": {
    parameters: Record<string, never>;
    post: {
      parameters: NoPath;
      requestBody: Json<{ code: string }>;
      responses: { 200: Res<{ recoveryCodes: string[] }> } & Pick<Errors, 401 | 422>;
    };
  };
  "/auth/enrol/webauthn/options": {
    parameters: Record<string, never>;
    post: { parameters: NoPath; requestBody?: never; responses: { 200: Res<Record<string, unknown>> } & Pick<Errors, 401> };
  };
  "/auth/enrol/webauthn/verify": {
    parameters: Record<string, never>;
    post: {
      parameters: NoPath;
      requestBody: Json<{ name: string; attestation: Record<string, unknown> }>;
      responses: { 200: Res<{ recoveryCodes: string[] }> } & Pick<Errors, 401 | 422>;
    };
  };
  "/request-cart": {
    parameters: Record<string, never>;
    get: { parameters: NoPath; requestBody?: never; responses: { 200: Res<Cart> } & Pick<Errors, 403> };
  };
  "/request-cart/items": {
    parameters: Record<string, never>;
    post: {
      parameters: NoPath;
      requestBody: Json<{ criteria: S["SearchFilters"]; q?: string }>;
      responses: { 201: Res<Cart> } & Pick<Errors, 409 | 422>;
    };
  };
  "/request-cart/items/{itemId}": {
    parameters: Record<string, never>;
    delete: { parameters: PP<{ itemId: string }>; requestBody?: never; responses: { 200: Res<Cart> } };
  };
  "/request-cart/start": {
    parameters: Record<string, never>;
    post: {
      parameters: { query?: never; header?: { "Idempotency-Key"?: string }; path?: never; cookie?: never };
      requestBody?: never;
      responses: { 201: Res<S["Request"]> } & Pick<Errors, 409>;
    };
  };
  "/requests/{requestId}/precheck": {
    parameters: Record<string, never>;
    post: {
      parameters: PP<{ requestId: string }>;
      requestBody: Json<PrecheckDecision>;
      responses: { 200: Res<S["Request"]> } & Pick<Errors, 409 | 422>;
    };
  };
  "/requests/{requestId}/respond": {
    parameters: Record<string, never>;
    post: {
      parameters: PP<{ requestId: string }>;
      requestBody: Json<{ message: string }>;
      responses: { 200: Res<S["Request"]> } & Pick<Errors, 409 | 422>;
    };
  };
  "/requests/{requestId}/vote-tally": {
    parameters: Record<string, never>;
    get: {
      parameters: PP<{ requestId: string }>;
      requestBody?: never;
      responses: { 200: Res<VoteTally> } & Pick<Errors, 403>;
    };
  };
  "/samples/{sampleId}/flag": {
    parameters: Record<string, never>;
    post: {
      parameters: PP<{ sampleId: string }>;
      requestBody: Json<{ reasonCode: "wrong_field" | "withdrawn_consent" | "duplicate" | "other" }>;
      responses: { 204: NoContent } & Pick<Errors, 403>;
    };
  };
  "/registrations": {
    parameters: Record<string, never>;
    get: { parameters: NoPath; requestBody?: never; responses: { 200: Res<{ items: Registration[] }> } & Pick<Errors, 403> };
  };
  "/registrations/{id}/decision": {
    parameters: Record<string, never>;
    post: {
      parameters: PP<{ id: string }>;
      requestBody: Json<{ outcome: "approved" | "rejected" }>;
      responses: { 200: Res<Registration> } & Pick<Errors, 409>;
    };
  };
  "/k-policies": {
    parameters: Record<string, never>;
    get: { parameters: NoPath; requestBody?: never; responses: { 200: Res<{ items: KPolicy[] }> } & Pick<Errors, 403> };
  };
  "/k-policies/{id}/changes": {
    parameters: Record<string, never>;
    post: {
      parameters: PP<{ id: string }>;
      requestBody: Json<{ k: number; reason: string }>;
      responses: { 202: Res<KPolicy> } & Pick<Errors, 403 | 422>;
    };
  };
  "/k-policy-changes/{id}/approve": {
    parameters: Record<string, never>;
    post: {
      parameters: PP<{ id: string }>;
      requestBody?: never;
      responses: { 200: Res<KPolicy> } & Pick<Errors, 403 | 409>;
    };
  };
  "/role-grant-requests": {
    parameters: Record<string, never>;
    get: { parameters: NoPath; requestBody?: never; responses: { 200: Res<{ items: RoleGrantRequest[] }> } & Pick<Errors, 403> };
    post: {
      parameters: NoPath;
      requestBody: Json<{ userId: string; role: S["Role"]; centerId?: string; reason: string }>;
      responses: { 202: Res<RoleGrantRequest> } & Pick<Errors, 403 | 409 | 422>;
    };
  };
  "/role-grant-requests/{id}/decision": {
    parameters: Record<string, never>;
    post: {
      parameters: PP<{ id: string }>;
      requestBody: Json<{ outcome: "approved" | "rejected" }>;
      responses: { 200: Res<RoleGrantRequest> } & Pick<Errors, 403 | 409>;
    };
  };
  "/client-errors": {
    parameters: Record<string, never>;
    post: { parameters: NoPath; requestBody: Json<ClientErrorReport>; responses: { 204: NoContent } };
  };
}
