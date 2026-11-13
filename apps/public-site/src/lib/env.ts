/** Build-time configuration. All values are public. See .env.example. */
const e = import.meta.env;
const bool = (v: unknown, d = false) => (v === undefined || v === '' ? d : String(v).toLowerCase() === 'true');

export const SITE_URL = ((e.SITE_URL as string | undefined) || 'https://www.ari-pst.example').replace(/\/$/, '');
export const PORTAL_URL = (e.PUBLIC_PORTAL_URL as string | undefined) || '/app/';
export const API_BASE = ((e.PUBLIC_API_BASE as string | undefined) || '').replace(/\/$/, '');
export const ALTCHA_URL = (e.PUBLIC_ALTCHA_CHALLENGE_URL as string | undefined) || '';
export const UMAMI_SRC = (e.PUBLIC_UMAMI_SRC as string | undefined) || '';
export const UMAMI_ID = (e.PUBLIC_UMAMI_WEBSITE_ID as string | undefined) || '';
/** Analytics is OFF unless explicitly enabled AND fully configured. */
export const ANALYTICS_ON = bool(e.PUBLIC_ANALYTICS_ENABLED) && UMAMI_SRC.startsWith('https://') && UMAMI_ID.length > 0;
export const NOINDEX_ALL = bool(e.PUBLIC_NOINDEX);
