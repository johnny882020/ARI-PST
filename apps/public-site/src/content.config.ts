import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { collectionSchemas } from './content/schemas';

const md = (name: keyof typeof collectionSchemas) =>
  defineCollection({
    loader: glob({ pattern: '**/*.md', base: `./src/content/${name}` }),
    schema: collectionSchemas[name],
  });

export const collections = {
  pages: md('pages'),
  news: md('news'),
  'research-areas': md('research-areas'),
  partners: md('partners'),
  centers: md('centers'),
  people: md('people'),
  legal: md('legal'),
  settings: defineCollection({
    loader: glob({ pattern: '*.json', base: './src/content/settings' }),
    schema: collectionSchemas.settings,
  }),
};
