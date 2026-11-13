import { getCollection, getEntry, type CollectionEntry } from 'astro:content';
import type { Locale } from '../content/schemas';

export type Name = 'pages' | 'news' | 'research-areas' | 'partners' | 'centers' | 'people' | 'legal';

/** Entries of one locale; drafts are never built (plan 03). Sorted by `order`/date by callers. */
export async function list<N extends Name>(name: N, locale: Locale): Promise<CollectionEntry<N>[]> {
  const all = (await getCollection(name)) as CollectionEntry<N>[];
  return all.filter((e) => e.id.startsWith(`${locale}/`) && !(e.data as { draft?: boolean }).draft);
}

export async function page(locale: Locale, slug: string) {
  const e = await getEntry('pages', `${locale}/${slug}`);
  if (!e || e.data.draft) throw new Error(`Missing page ${locale}/${slug}`);
  return e;
}

export async function settings(locale: Locale) {
  const e = await getEntry('settings', locale);
  if (!e) throw new Error(`Missing settings for ${locale}`);
  return e.data;
}

/** True if a slug exists (and is not draft/pending) in the other locale, for hreflang. */
export async function hasTranslation(name: Name, locale: Locale, slug: string): Promise<boolean> {
  const e = await getEntry(name as 'pages', `${locale}/${slug}` as never);
  return !!e && !(e.data as { draft?: boolean }).draft && (e.data as { translation_status?: string }).translation_status !== 'pending';
}
