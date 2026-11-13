import { getCollection, type CollectionEntry } from 'astro:content';
import type { Locale } from '../content/schemas';

export type Name = 'pages' | 'news' | 'research-areas' | 'partners' | 'centers' | 'people' | 'legal';

/** Entries of one locale; drafts are never built (plan 03). Sorted by `order`/date by callers. */
export async function list<N extends Name>(name: N, locale: Locale): Promise<CollectionEntry<N>[]> {
  const all = (await getCollection(name as 'pages')) as unknown as CollectionEntry<N>[];
  return all.filter((e) => e.id.startsWith(`${locale}/`) && !(e.data as { draft?: boolean }).draft);
}

export async function page(locale: Locale, slug: string): Promise<CollectionEntry<'pages'>> {
  const e = (await list('pages', locale)).find((x) => x.id === `${locale}/${slug}`);
  if (!e) throw new Error(`Missing page ${locale}/${slug}`);
  return e;
}

export async function settings(locale: Locale) {
  const all = await getCollection('settings');
  const e = all.find((x) => x.id === locale);
  if (!e) throw new Error(`Missing settings for ${locale}`);
  return e.data;
}

/** True if the entry exists (and is not draft/pending) in the given locale, for hreflang. */
export async function hasTranslation(name: Name, locale: Locale, slug: string): Promise<boolean> {
  const all = await list(name, locale);
  return all.some((e) => {
    const d = e.data as { slug: string; translation_status?: string };
    return d.slug === slug && d.translation_status !== 'pending';
  });
}
