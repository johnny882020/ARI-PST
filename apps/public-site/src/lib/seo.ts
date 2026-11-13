import type { Locale } from '../content/schemas';
import { SITE_URL } from './env';
import { path, otherLocale } from './paths';

export const abs = (p: string): string => `${SITE_URL}${p}`;

export interface Crumb { name: string; path: string }

export function hreflangLinks(locale: Locale, slug: string, hasOther: boolean) {
  const links: { hreflang: string; href: string }[] = [{ hreflang: locale, href: abs(path(locale, slug)) }];
  if (hasOther) links.push({ hreflang: otherLocale(locale), href: abs(path(otherLocale(locale), slug)) });
  // x-default points at the default-locale (he) page when it exists.
  if (locale === 'he') links.push({ hreflang: 'x-default', href: abs(path('he', slug)) });
  else if (hasOther) links.push({ hreflang: 'x-default', href: abs(path('he', slug)) });
  return links;
}

/** Legal entity name is a placeholder until GATE-OPERATOR closes. */
export const organizationLd = (logoPath: string) => ({
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'ARI-PST × Tech4Cancer',
  url: SITE_URL + '/',
  logo: abs(logoPath),
  sameAs: [] as string[],
});

export const websiteLd = (locale: Locale) => ({
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'ARI-PST × Tech4Cancer',
  url: abs(path(locale)),
  inLanguage: locale === 'he' ? 'he-IL' : 'en',
});

export const breadcrumbLd = (crumbs: Crumb[]) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: abs(c.path) })),
});

export const newsArticleLd = (o: { locale: Locale; headline: string; description: string; date: Date; modified: Date; url: string }) => ({
  '@context': 'https://schema.org',
  '@type': 'NewsArticle',
  headline: o.headline,
  description: o.description,
  datePublished: o.date.toISOString(),
  dateModified: o.modified.toISOString(),
  inLanguage: o.locale === 'he' ? 'he-IL' : 'en',
  mainEntityOfPage: abs(o.url),
  publisher: { '@type': 'Organization', name: 'ARI-PST × Tech4Cancer' },
});

export const eventLd = (e: { name: string; date: Date; place: string; url?: string }) => ({
  '@context': 'https://schema.org',
  '@type': 'Event',
  name: e.name,
  startDate: e.date.toISOString().slice(0, 10),
  eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
  location: { '@type': 'Place', name: e.place },
  ...(e.url ? { url: e.url } : {}),
});

/** FAQPage only for reviewed plain Q/A content (caller decides). */
export const faqLd = (items: { q: string; a: string }[]) => ({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: items.map((i) => ({ '@type': 'Question', name: i.q, acceptedAnswer: { '@type': 'Answer', text: i.a } })),
});

/** JSON-LD must not break out of the script element. */
export const ldString = (o: unknown): string => JSON.stringify(o).replace(/</g, '\\u003c');
