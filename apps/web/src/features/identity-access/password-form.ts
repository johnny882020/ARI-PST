import { z } from "zod";
import type { MessageKey } from "@ari/i18n";

/** Same bounds as the API contract: token 20..200 printable characters, password 12..128. */
export const TOKEN_OK = /^[\x21-\x7e]{20,200}$/;

/** New password and its repeat, checked in the browser before any call. */
export const newPasswordSchema = z
  .object({
    password: z.string().min(1, "form.error.required").min(12, "form.error.password.length").max(128, "form.error.password.length"),
    confirm: z.string().min(1, "form.error.required"),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "form.error.password.match" });
export type NewPasswordValues = z.infer<typeof newPasswordSchema>;

/** Server password rules (apps/api auth-local/password.ts) mapped to messages. */
export const PASSWORD_RULE: Record<string, MessageKey> = {
  REQUIRED: "form.error.required",
  LENGTH: "form.error.password.length",
  COMMON: "form.error.password.weak",
  REPEATED: "form.error.password.weak",
  CONTAINS_EMAIL: "form.error.password.weak",
};

