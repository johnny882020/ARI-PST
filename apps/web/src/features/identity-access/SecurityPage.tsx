import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { Alert, Badge, Button, Checkbox, Dialog, Input, Skeleton, Table, type TableColumn } from "@ari/design-system";
import { unwrap, type AuthMethod } from "@ari/api-client";
import { api } from "../../lib/api";
import { qk } from "../../lib/query";
import { useLocale, useT } from "../../app/locale";
import { PageHeading } from "../../shared/page";
import { ErrorPanel } from "../../shared/errors";
import { fmtDate } from "../../lib/format";
import { problemMessageKey } from "../../shared/problem-message";
import { classifyPasskeyError, createCredential, passkeysSupported } from "../../lib/webauthn";

/** Recovery codes: shown once, kept only in component state, cleared when the dialog closes. */
function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const t = useT();
  const [saved, setSaved] = useState(false);
  const download = () => {
    const url = URL.createObjectURL(new Blob([codes.join("\n") + "\n"], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url; a.download = "ari-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="stack">
      <p>{t("auth.enrol.recovery.lead")}</p>
      <ul className="recovery-list" data-testid="recovery-codes">{codes.map((c) => <li key={c}>{c}</li>)}</ul>
      <div className="row">
        <Button size="sm" onClick={() => void navigator.clipboard?.writeText(codes.join("\n"))}>{t("common.action.copy")}</Button>
        <Button size="sm" onClick={download}>{t("auth.enrol.recovery.download")}</Button>
        <Button size="sm" onClick={() => window.print()}>{t("auth.enrol.recovery.print")}</Button>
      </div>
      <Checkbox label={t("auth.enrol.recovery.saved")} checked={saved} onChange={(e) => setSaved(e.target.checked)} />
      <Button variant="primary" disabled={!saved} onClick={onDone}>{t("common.action.continue")}</Button>
    </div>
  );
}

export function TotpEnrol({ onClose }: { onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const begin = useQuery({ queryKey: ["auth", "totp-begin"], queryFn: () => unwrap(api.POST("/auth/enrol/totp")), staleTime: Infinity, gcTime: 0 });
  useEffect(() => {
    if (begin.data && canvas.current) void QRCode.toCanvas(canvas.current, begin.data.otpauthUri, { width: 192, margin: 1 });
  }, [begin.data]);
  const confirm = useMutation({
    mutationFn: () => unwrap(api.POST("/auth/enrol/totp/confirm", { body: { code: code.replace(/\s/g, "") } })),
    onSuccess: (r) => { setCodes(r.recoveryCodes); void qc.invalidateQueries({ queryKey: qk.methods }); },
    onError: (e) => setError(problemMessageKey(e)),
  });
  if (codes) return <RecoveryCodes codes={codes} onDone={onClose} />;
  if (begin.isPending) return <Skeleton lines={3} />;
  if (begin.error) return <ErrorPanel error={begin.error} />;
  const spaced = begin.data.secret.replace(/(.{4})/g, "$1 ").trim();
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); setError(null); confirm.mutate(); }}>
      <p>{t("auth.enrol.totp.lead")}</p>
      <div className="qr"><canvas ref={canvas} role="img" aria-label={t("auth.enrol.totp.qr")} /></div>
      <p>{t("auth.enrol.totp.manual")}</p>
      <div className="code-box" data-testid="totp-secret">{spaced}</div>
      {error ? <Alert tone="danger">{t(error as never)}</Alert> : null}
      <Input id="field-code" label={t("auth.mfa.code.label")} inputMode="numeric" autoComplete="one-time-code" maxLength={7} dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} required />
      <Button type="submit" variant="primary" loading={confirm.isPending}>{t("auth.enrol.confirm")}</Button>
    </form>
  );
}

export function PasskeyEnrol({ onClose }: { onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (codes) return <RecoveryCodes codes={codes} onDone={onClose} />;
  const run = async () => {
    setBusy(true); setError(null);
    try {
      const options = await unwrap(api.POST("/auth/enrol/webauthn/options"));
      const attestation = await createCredential(options);
      const r = await unwrap(api.POST("/auth/enrol/webauthn/verify", { body: { name: name || "Passkey", attestation } }));
      setCodes(r.recoveryCodes);
      void qc.invalidateQueries({ queryKey: qk.methods });
    } catch (e) {
      const c = classifyPasskeyError(e);
      setError(c === "cancelled" ? "auth.passkey.cancelled" : c === "alreadyRegistered" ? "auth.passkey.exists" : problemMessageKey(e));
    }
    setBusy(false);
  };
  return (
    <div className="stack">
      <p>{t("auth.enrol.passkey.lead")}</p>
      {error ? <Alert tone="danger">{t(error as never)}</Alert> : null}
      <Input label={t("auth.enrol.passkey.name")} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
      <Button variant="primary" loading={busy} onClick={() => void run()}>{t("auth.enrol.passkey.start")}</Button>
    </div>
  );
}

export function SecurityPage() {
  const t = useT();
  const { locale } = useLocale();
  const [dialog, setDialog] = useState<"totp" | "passkey" | null>(null);
  const q = useQuery({ queryKey: qk.methods, queryFn: () => unwrap(api.GET("/auth/methods")) });
  const cols: TableColumn<AuthMethod>[] = [
    { key: "name", header: t("auth.methods.name"), render: (m) => m.name },
    { key: "kind", header: t("auth.methods.kind"), render: (m) => <Badge>{t(m.kind === "passkey" ? "auth.methods.passkey" : "auth.methods.totp")}</Badge> },
    { key: "added", header: t("auth.methods.added"), render: (m) => fmtDate(m.addedAt, locale) },
    { key: "last", header: t("auth.methods.lastUsed"), render: (m) => (m.lastUsedAt ? fmtDate(m.lastUsedAt, locale) : t("auth.methods.never")) },
  ];
  return (
    <div className="stack">
      <PageHeading titleKey="auth.security.title" lead={t("auth.security.lead")} />
      <Table caption={t("auth.methods.caption")} columns={cols} rows={q.data?.items ?? []} rowKey={(m) => m.id} loading={q.isPending} error={q.isError ? <ErrorPanel error={q.error} /> : undefined} empty={t("table.empty.title")} />
      <div className="row">
        {passkeysSupported() ? <Button onClick={() => setDialog("passkey")}>{t("auth.security.addPasskey")}</Button> : <span className="muted">{t("auth.passkey.unsupported")}</span>}
        <Button onClick={() => setDialog("totp")}>{t("auth.security.addTotp")}</Button>
        <Link className="ds-btn ds-btn-quiet" to="/account/recovery-codes"><span className="ds-btn-label">{t("account.recovery.open")}</span></Link>
      </div>
      <Dialog open={dialog !== null} onClose={() => setDialog(null)} title={t(dialog === "passkey" ? "auth.security.addPasskey" : "auth.security.addTotp")}>
        {dialog === "totp" ? <TotpEnrol onClose={() => setDialog(null)} /> : dialog === "passkey" ? <PasskeyEnrol onClose={() => setDialog(null)} /> : null}
      </Dialog>
    </div>
  );
}
