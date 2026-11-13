/** Join/contact form island. Posts JSON to /api/v1/public/forms/{join|contact}. No sensitive fields exist. */
type Kind = 'join' | 'contact';

const form = document.querySelector<HTMLFormElement>('form[data-form]');
if (form) init(form);

function init(f: HTMLFormElement) {
  const kind = f.dataset.form as Kind;
  const endpoint = `${f.dataset.apiBase ?? ''}/api/v1/public/forms/${kind}`;
  const challengeUrl = f.dataset.challengeUrl ?? '';
  const msg = JSON.parse(f.dataset.msg ?? '{}') as Record<string, string>;
  const summary = f.querySelector<HTMLElement>('[data-summary]')!;
  const status = f.querySelector<HTMLElement>('[data-status]')!;
  const submit = f.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const started = performance.now();

  // Pre-select subject from ?subject=general (Patients page links here with the general subject only).
  const subj = f.querySelector<HTMLSelectElement>('select[name="subject"]');
  const q = new URLSearchParams(location.search).get('subject');
  if (subj && q && [...subj.options].some((o) => o.value === q)) subj.value = q;

  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const errors = validate(f, msg);
    renderErrors(f, summary, errors, msg);
    if (errors.length) return;
    submit.disabled = true;
    status.textContent = challengeUrl ? msg.verifying! : msg.sending!;
    try {
      const body = collect(f, kind, Math.round(performance.now() - started));
      if (challengeUrl) body.altcha = await solveChallenge(challengeUrl);
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      });
      if (res.status === 202 || res.ok) {
        f.reset();
        status.textContent = msg.success!;
        status.classList.add('status');
        status.focus();
        fire(`${kind}_form_submit_success`);
      } else {
        throw new Error(res.status === 429 ? 'rate' : 'send');
      }
    } catch (e) {
      status.classList.remove('status');
      status.textContent = '';
      renderErrors(f, summary, [{ name: '', text: (e as Error).message === 'rate' ? msg.errRate! : msg.errSend! }], msg);
    } finally {
      submit.disabled = false;
    }
  });
}

interface FieldError { name: string; text: string }

const LONG_DIGITS = /\d[\d\s-]{7,}\d/; // ID-like numbers / long digit strings are refused (plan 02 section 8)
const URLS = /https?:\/\/|www\./gi;

function validate(f: HTMLFormElement, msg: Record<string, string>): FieldError[] {
  const out: FieldError[] = [];
  for (const el of Array.from(f.elements) as HTMLInputElement[]) {
    if (!el.name || el.name === 'website') continue;
    el.removeAttribute('aria-invalid');
    let text = '';
    if (el.type === 'checkbox' && el.required && !el.checked) text = msg.errConsent!;
    else if (el.required && el.type !== 'checkbox' && !el.value.trim()) text = msg.errRequired!;
    else if (el.type === 'email' && el.value && !el.checkValidity()) text = msg.errEmail!;
    else if (el.tagName === 'TEXTAREA' || el.name === 'name' || el.name === 'organization') {
      if (LONG_DIGITS.test(el.value)) text = msg.errIdentifier!;
      else if (el.tagName === 'TEXTAREA' && (el.value.match(URLS)?.length ?? 0) > 2) text = msg.errLinks!;
    }
    if (text) { out.push({ name: el.name, text }); el.setAttribute('aria-invalid', 'true'); }
  }
  return out;
}

function renderErrors(f: HTMLFormElement, summary: HTMLElement, errors: FieldError[], msg: Record<string, string>) {
  f.querySelectorAll('[data-err]').forEach((n) => n.remove());
  summary.replaceChildren();
  summary.hidden = errors.length === 0;
  if (!errors.length) return;
  const h = document.createElement('h2');
  h.textContent = msg.errSummary!;
  h.className = 'small';
  const ul = document.createElement('ul');
  errors.forEach((e, i) => {
    const li = document.createElement('li');
    if (e.name) {
      const el = f.elements.namedItem(e.name) as HTMLElement | null;
      const a = document.createElement('a');
      const lbl = f.querySelector(`label[for="${el?.id}"]`)?.textContent ?? e.name;
      a.href = `#${el?.id ?? ''}`;
      a.textContent = `${lbl.replace(/\s*\(.*\)\s*$/, '')}: ${e.text}`;
      a.addEventListener('click', (ev) => { ev.preventDefault(); el?.focus(); });
      li.append(a);
      if (el) {
        const p = document.createElement('p');
        p.className = 'err';
        p.dataset.err = '1';
        p.id = `${el.id}-err-${i}`;
        p.textContent = e.text;
        el.setAttribute('aria-describedby', `${el.getAttribute('aria-describedby') ?? ''} ${p.id}`.trim());
        el.closest('.field, fieldset')?.append(p);
      }
    } else li.textContent = e.text;
    ul.append(li);
  });
  summary.append(h, ul);
  summary.focus();
}

function collect(f: HTMLFormElement, kind: Kind, elapsed: number): Record<string, unknown> {
  const fd = new FormData(f);
  const o: Record<string, unknown> = { locale: document.documentElement.lang, elapsed_ms: elapsed };
  for (const key of new Set(fd.keys())) {
    const all = fd.getAll(key).map(String);
    o[key] = key === 'interests' ? all : key === 'consent_contact' ? all[0] === 'on' : all[0];
  }
  if (kind === 'join' && !('interests' in o)) o.interests = [];
  return o;
}

/** ALTCHA-compatible proof of work (SHA-256). Challenge comes from the server; nothing leaves the origin. */
async function solveChallenge(url: string): Promise<string> {
  const c = (await (await fetch(url, { credentials: 'omit' })).json()) as {
    algorithm: string; challenge: string; salt: string; maxnumber: number; signature: string;
  };
  const enc = new TextEncoder();
  for (let n = 0; n <= c.maxnumber; n++) {
    const buf = await crypto.subtle.digest('SHA-256', enc.encode(c.salt + n));
    const hex = Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
    if (hex === c.challenge) {
      return btoa(JSON.stringify({ algorithm: c.algorithm, challenge: c.challenge, number: n, salt: c.salt, signature: c.signature }));
    }
  }
  throw new Error('send');
}

function fire(name: string) {
  (window as unknown as { umami?: { track: (n: string) => void } }).umami?.track(name);
}
