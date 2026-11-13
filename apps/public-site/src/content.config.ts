import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { pageSchema, newsSchema, researchAreaSchema, partnerSchema, centerSchema, personSchema, legalSchema, settingsSchema } from './content/schemas';

// Entry ids are `<locale>/<file>` (not the frontmatter slug, which is shared across locales).
const loader = (name: string) =>
  glob({ pattern: '**/*.md', base: `./src/content/${name}`, generateId: ({ entry }) => entry.replace(/\.md$/, '') });

export const collections = {
  pages: defineCollection({ loader: loader('pages'), schema: pageSchema }),
  news: defineCollection({ loader: loader('news'), schema: newsSchema }),
  'research-areas': defineCollection({ loader: loader('research-areas'), schema: researchAreaSchema }),
  partners: defineCollection({ loader: loader('partners'), schema: partnerSchema }),
  centers: defineCollection({ loader: loader('centers'), schema: centerSchema }),
  people: defineCollection({ loader: loader('people'), schema: personSchema }),
  legal: defineCollection({ loader: loader('legal'), schema: legalSchema }),
  settings: defineCollection({ loader: glob({ pattern: '*.json', base: './src/content/settings' }), schema: settingsSchema }),
};
