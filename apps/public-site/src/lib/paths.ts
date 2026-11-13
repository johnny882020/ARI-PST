import type { Locale } from '../content/schemas';
import { LOCALES } from '../content/schemas';

/** Absolute site path with trailing slash. slug '' = locale home. */
export const path = (locale: Locale, slug = ''): string => `/${locale}/${slug ? slug.replace(/^\/|\/$/g, '') + '/' : ''}`;
export const otherLocale = (l: Locale): Locale => (l === 'he' ? 'en' : 'he');
export { LOCALES };

/** Slug of a page within a locale, from the pathname (`/he/news/x/` -> `news/x`). */
export const slugFromPath = (pathname: string): string => pathname.replace(/^\/(he|en)\/?/, '').replace(/\/$/, '');
