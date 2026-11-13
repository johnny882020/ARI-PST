import { useEffect, useRef } from "react";
import type { FieldValues, Path, UseFormSetError } from "react-hook-form";
import { isApiProblem } from "@ari/api-client";
import { Alert } from "@ari/design-system";
import { useT } from "../app/locale";
import type { MessageKey } from "@ari/i18n";

/** Maps `ValidationProblem.errors[]` (field, rule) to form field errors. Returns true if mapped. */
export function applyProblemToForm<T extends FieldValues>(e: unknown, setError: UseFormSetError<T>, known: readonly string[]): boolean {
  if (!isApiProblem(e) || e.errors.length === 0) return false;
  let any = false;
  for (const it of e.errors) {
    if (known.includes(it.field)) {
      setError(it.field as Path<T>, { type: "server", message: `server.${it.rule}` });
      any = true;
    }
  }
  return any;
}

const RULE_KEYS: Record<string, MessageKey> = {
  REQUIRED: "form.error.required",
  FORMAT: "form.error.format",
  VOCAB: "form.error.format",
  RANGE: "form.error.range",
  IDENTIFIER_SUSPECTED: "form.error.identifier",
};

/** Resolve a stored error message (i18n key or server rule marker) to text. */
export function useErrorText() {
  const t = useT();
  return (msg: string | undefined): string | undefined => {
    if (!msg) return undefined;
    if (msg.startsWith("server.")) return t(RULE_KEYS[msg.slice(7)] ?? "form.error.format");
    return t(msg as MessageKey);
  };
}

/** Error summary: role=alert, receives focus on a failed submit, links to fields. */
export function ErrorSummary({ errors, nonce }: { errors: { name: string; label: string }[]; nonce: number }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (nonce > 0 && errors.length) ref.current?.focus();
  }, [nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!errors.length) return null;
  return (
    <div ref={ref} tabIndex={-1} role="alert" className="error-summary">
      <Alert tone="danger" title={t("form.error.summary", { count: errors.length })}>
        <ul>
          {errors.map((e) => (
            <li key={e.name}>
              <a href={`#field-${e.name}`} onClick={(ev) => { ev.preventDefault(); document.getElementById(`field-${e.name}`)?.focus(); }}>
                {e.label}
              </a>
            </li>
          ))}
        </ul>
      </Alert>
    </div>
  );
}
