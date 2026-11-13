/** Consent island. Analytics script is injected ONLY after "granted". Default: nothing is measured. */
const COOKIE = 'ari_consent';
const MAX_AGE = 60 * 60 * 24 * 180;

type Choice = 'granted' | 'denied';

function read(): Choice | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${COOKIE}=v1:(granted|denied)`));
  return m ? (m[1] as Choice) : null;
}
function write(c: Choice) {
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${COOKIE}=v1:${c}; Max-Age=${MAX_AGE}; Path=/; SameSite=Lax${secure}`;
}
const optedOutByBrowser = (): boolean =>
  navigator.doNotTrack === '1' || (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;

function loadAnalytics(src: string, id: string) {
  if (document.querySelector('script[data-ari-analytics]')) return;
  const s = document.createElement('script');
  s.defer = true;
  s.src = src;
  s.dataset.websiteId = id;
  s.dataset.doNotTrack = 'true';
  s.dataset.ariAnalytics = '1';
  document.head.appendChild(s);
}

const banner = document.getElementById('consent');
if (banner) {
  const src = banner.dataset.umamiSrc ?? '';
  const id = banner.dataset.websiteId ?? '';
  const show = () => { banner.hidden = false; banner.querySelector<HTMLElement>('[data-consent="accept"]')?.focus({ preventScroll: true }); };
  const hide = () => { banner.hidden = true; };

  if (optedOutByBrowser()) {
    // DNT / Sec-GPC are treated as denied: no banner, no script.
    hide();
  } else {
    const current = read();
    if (current === 'granted') loadAnalytics(src, id);
    else if (current === null) banner.hidden = false;
  }

  banner.addEventListener('click', (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLElement>('[data-consent]');
    if (!btn) return;
    const had = read();
    if (btn.dataset.consent === 'accept') { write('granted'); hide(); loadAnalytics(src, id); }
    else { write('denied'); hide(); if (had === 'granted') location.reload(); /* withdraw = unload the script */ }
  });

  document.querySelectorAll<HTMLElement>('[data-consent-open]').forEach((el) =>
    el.addEventListener('click', () => { show(); }),
  );
}
