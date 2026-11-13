import type { APIRoute } from 'astro';
import { SITE_URL, NOINDEX_ALL } from '../lib/env';

export const GET: APIRoute = () =>
  new Response(
    NOINDEX_ALL
      ? 'User-agent: *\nDisallow: /\n'
      : `User-agent: *\nAllow: /\nDisallow: /admin/\n\nSitemap: ${SITE_URL}/sitemap-index.xml\n`,
    { headers: { 'content-type': 'text/plain; charset=utf-8' } },
  );
