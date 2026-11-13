// Generates public/admin/config.yml. Run: pnpm gen:cms-config. tests/unit/cms-drift.test.ts fails if the committed
// file differs from this output or if its fields drift from src/content/schemas.ts.
//
// RT-10 (CMS must only change content): see CMS-SECURITY.md. Every collection and the media folder live under
// src/content/. The `content-only-diff` check (scripts/check-content-only.mjs) fails any CMS-origin PR touching other paths.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const here = path.dirname(fileURLToPath(import.meta.url));
export const OUT = path.join(here, '../public/admin/config.yml');
const T = { i18n: true };
const D = { i18n: 'duplicate' };

const str = (name, label, o = {}) => ({ name, label, widget: 'string', ...T, ...o });
const txt = (name, label, o = {}) => ({ name, label, widget: 'text', ...T, ...o });
const bool = (name, label, o = {}) => ({ name, label, widget: 'boolean', default: false, ...T, ...o });
const num = (name, label, o = {}) => ({ name, label, widget: 'number', value_type: 'int', default: 100, ...D, ...o });
const date = (name, label, o = {}) => ({ name, label, widget: 'datetime', time_format: false, format: 'YYYY-MM-DD', ...T, ...o });
const sel = (name, label, options, o = {}) => ({ name, label, widget: 'select', options, ...D, ...o });
const list = (name, label, fields, o = {}) => ({ name, label, widget: 'list', fields, ...T, ...o });
const slugList = (name, label, o = {}) => ({ name, label, widget: 'list', field: { name: 'slug', label: 'Slug', widget: 'string' }, required: false, ...D, ...o });
const link = [str('label', 'Label'), str('url', 'URL (relative, https or mailto)')];
const image = (name, label, o = {}) => ({
  name, label, widget: 'object', required: false, ...T, ...o,
  fields: [
    { name: 'src', label: 'Image (stored under /uploads/)', widget: 'image', ...T },
    str('alt', 'Alt text (required unless decorative)', { required: false, hint: 'Describe the image for a screen reader.' }),
    bool('decorative', 'Decorative (no alt text needed)'),
    { name: 'width', label: 'Width px', widget: 'number', value_type: 'int', required: false, ...D },
    { name: 'height', label: 'Height px', widget: 'number', value_type: 'int', required: false, ...D },
  ],
});

const base = (slugOpts = {}) => [
  str('title', 'Title (max 70)', { hint: 'כותרת עד 70 תווים', pattern: ['^.{1,70}$', 'Up to 70 characters'] }),
  txt('description', 'Meta description (max 160)', { hint: 'תיאור עד 160 תווים', pattern: ['^.{1,160}$', 'Up to 160 characters'] }),
  { name: 'slug', label: 'Slug (ASCII kebab-case, same in he and en)', widget: 'string', ...D, pattern: ['^[a-z0-9]+(?:-[a-z0-9]+)*$', 'ASCII kebab-case'], ...slugOpts },
  { name: 'translation_status', label: 'Translation status', widget: 'select', options: ['complete', 'pending'], default: 'complete', ...T },
  bool('draft', 'Draft (never built into production)'),
  date('updated', 'Updated', { default: '' }),
  image('og_image', 'Social image'),
  bool('noindex', 'No index'),
];
const body = (o = {}) => ({ name: 'body', label: 'Body (Markdown)', widget: 'markdown', required: false, ...T, ...o });

const pageFields = [
  ...base({ widget: 'select', options: ['home', 'about', 'research-index', 'community', 'infrastructure', 'partners-index', 'news-index', 'patients', 'join', 'contact', 'login-entry'] }),
  bool('needs_review', 'Needs clinical/legal review (shows a notice)'),
  txt('intro', 'Intro', { required: false }),
  { name: 'hero', label: 'Hero (home)', widget: 'object', required: false, ...T, fields: [str('headline', 'Headline'), txt('subline', 'Subline'), { name: 'cta_primary', label: 'Primary CTA', widget: 'object', ...T, fields: link }, { name: 'cta_secondary', label: 'Secondary CTA', widget: 'object', required: false, ...T, fields: link }] },
  list('value_props', 'Value props (3)', [str('icon', 'Icon name'), str('title', 'Title'), txt('text', 'Text')], { required: false, max: 6 }),
  slugList('featured_partners', 'Featured partners (slugs)'),
  slugList('featured_news', 'Featured news (slugs)'),
  txt('login_teaser', 'Login teaser', { required: false }),
  txt('mission', 'Mission', { required: false }),
  list('principles', 'Principles', [str('title', 'Title'), txt('text', 'Text')], { required: false }),
  slugList('team', 'Team (people slugs)'),
  txt('governance', 'Governance', { required: false }),
  list('milestones', 'Milestones', [str('year', 'Year'), txt('text', 'Text')], { required: false }),
  list('groups', 'Groups', [str('name', 'Name'), str('role', 'Role'), txt('bio', 'Bio')], { required: false }),
  list('events', 'Events (public dates only)', [str('title', 'Title'), date('date', 'Date'), str('place', 'Place'), str('url', 'Link', { required: false })], { required: false }),
  txt('join_cta', 'Join call to action', { required: false }),
  list('layers', 'Layers', [str('icon', 'Icon name'), str('title', 'Title'), txt('text', 'Text')], { required: false }),
  txt('standards', 'Standards', { required: false }),
  list('how_it_works', 'How it works (steps)', [str('title', 'Title'), txt('text', 'Text')], { required: false }),
  txt('plain_intro', 'Plain-language intro (patients)', { required: false }),
  str('reading_level_note', 'Reading level note', { required: false }),
  txt('privacy_promise', 'Privacy promise', { required: false }),
  list('faq', 'FAQ', [str('q', 'Question'), txt('a', 'Answer')], { required: false }),
  list('support_links', 'Support links', [str('label', 'Label'), str('url', 'URL'), str('org', 'Organization')], { required: false }),
  txt('contact_cta', 'Contact call to action', { required: false }),
  { name: 'office_role_email', label: 'Role mailbox (never a personal address)', widget: 'string', required: false, ...D },
  txt('form_notice', 'Form notice (no medical details)', { required: false }),
  txt('consent_text', 'Consent text (needs legal review)', { required: false }),
  txt('success_text', 'Success text', { required: false }),
  list('who_can_login', 'Who can sign in', [str('role', 'Role'), txt('text', 'Text')], { required: false }),
  txt('request_access_text', 'Request access text', { required: false }),
  body(),
];

const folder = (name, label, fields, extra = {}) => ({
  name, label, folder: `src/content/${name}`, extension: 'md', format: 'frontmatter', create: true,
  slug: '{{slug}}', i18n: true, summary: '{{title}}', fields, ...extra,
});

export const config = {
  backend: {
    name: 'github',
    repo: 'johnny882020/ARI-PST',
    branch: 'main',
    base_url: 'https://cms-auth.ari-pst.example', // self-hosted GitHub OAuth proxy (A7). Placeholder until deployed.
    auth_endpoint: 'auth',
    // Branch names for editorial workflow: cms/<collection>/<slug>. CI treats cms/* as normal PR branches.
    commit_messages: { create: 'content: create {{collection}} "{{slug}}"', update: 'content: update {{collection}} "{{slug}}"', delete: 'content: delete {{collection}} "{{slug}}"', uploadMedia: 'content: upload "{{path}}"', deleteMedia: 'content: delete "{{path}}"', openAuthoring: 'content: {{message}}' },
  },
  publish_mode: 'editorial_workflow', // draft -> in review -> ready = PR + labels. Roles come from GitHub permissions.
  locale: 'en',
  site_url: 'https://www.ari-pst.example',
  display_url: 'https://www.ari-pst.example',
  // RT-10: media lives under src/content so the CMS never writes outside src/content/**. Build copies it to /uploads.
  media_folder: 'src/content/uploads',
  public_folder: '/uploads',
  i18n: { structure: 'multiple_folders', locales: ['he', 'en'], default_locale: 'he' },
  collections: [
    folder('pages', 'Pages', pageFields, { create: false, delete: false, identifier_field: 'slug' }),
    folder('news', 'News', [
      ...base(),
      date('date', 'Publication date'),
      txt('summary', 'Summary (max 300)', { pattern: ['^.{1,300}$', 'Up to 300 characters'] }),
      image('cover', 'Cover image'),
      { name: 'tags', label: 'Tags', widget: 'list', default: [], required: false, ...T },
      { name: 'author', label: 'Author (people slug)', widget: 'string', required: false, ...D },
      body(),
    ], { identifier_field: 'slug', sort: 'date:desc' }),
    folder('research-areas', 'Research areas', [
      ...base(), str('name', 'Name'), txt('summary', 'Summary (max 300)'), num('order', 'Order'), image('image', 'Image'),
      slugList('related_news', 'Related news (slugs)'), body(),
    ], { identifier_field: 'slug' }),
    folder('partners', 'Global partners (text names only, NO logos)', [
      ...base(), str('name', 'Name'), str('country', 'Country'),
      { name: 'url', label: 'Website (https)', widget: 'string', required: false, ...D },
      txt('summary', 'Summary'),
      sel('type', 'Type', ['pediatric-oncology', 'research-network', 'hospital', 'university', 'other']),
      num('order', 'Order'),
    ], { identifier_field: 'slug', hint: 'Partner logos are not allowed until OPEN-LOGO-PERMISSION is closed.' }),
    folder('centers', 'Centers (directory)', [
      ...base(), str('name', 'Name'), str('city', 'City', { required: false }),
      sel('kind', 'Kind', ['hospital', 'research-center', 'biobank']),
      sel('status', 'Status', ['participating', 'planned']),
      txt('summary', 'Summary'),
      { name: 'url', label: 'Website (https)', widget: 'string', required: false, ...D },
      num('order', 'Order'),
    ], { identifier_field: 'slug' }),
    folder('people', 'Researchers (directory)', [
      ...base(), str('name', 'Name'), str('role', 'Role'), str('affiliation', 'Affiliation', { required: false }), txt('bio', 'Bio'),
      slugList('research_areas', 'Research areas (slugs)'),
      { name: 'consent_on_file', label: 'Documented consent on file (required for real people)', widget: 'boolean', default: false, ...D },
      { name: 'placeholder', label: 'Synthetic placeholder', widget: 'boolean', default: false, ...D },
      num('order', 'Order'),
    ], { identifier_field: 'slug', hint: 'No real personal data without documented consent. Legal/privacy reviewer must approve.' }),
    folder('legal', 'Legal pages (needs legal review)', [
      ...base({ widget: 'select', options: ['privacy', 'terms', 'accessibility', 'analytics'] }),
      str('version', 'Version', { ...D }),
      date('effective_date', 'Effective date'),
      { name: 'needs_legal_review', label: 'Needs legal review (shows a draft notice)', widget: 'boolean', default: true, ...T },
      str('standard', 'Standard (accessibility)', { required: false }),
      str('conformance', 'Conformance (accessibility)', { required: false }),
      { name: 'known_issues', label: 'Known issues', widget: 'list', required: false, default: [], ...T },
      str('contact', 'Contact (accessibility)', { required: false }),
      date('last_review', 'Last review', { required: false }),
      body(),
    ], { create: false, delete: false, identifier_field: 'slug' }),
    {
      name: 'settings', label: 'Site settings', delete: false,
      files: ['he', 'en'].map((l) => ({
        name: l, label: l === 'he' ? 'Hebrew' : 'English', file: `src/content/settings/${l}.json`,
        fields: [
          { name: 'site_name', label: 'Site name', widget: 'string' },
          { name: 'tagline', label: 'Tagline', widget: 'string' },
          { name: 'nav', label: 'Navigation', widget: 'list', fields: [{ name: 'slug', label: 'Page slug', widget: 'string' }, { name: 'label', label: 'Label', widget: 'string' }] },
          { name: 'footer_text', label: 'Footer text', widget: 'string' },
          { name: 'social', label: 'Social links', widget: 'list', required: false, default: [], fields: [{ name: 'label', label: 'Label', widget: 'string' }, { name: 'url', label: 'URL', widget: 'string' }] },
          { name: 'default_og', label: 'Default social image', widget: 'object', required: false, fields: [{ name: 'src', label: 'Image', widget: 'image' }, { name: 'alt', label: 'Alt', widget: 'string', required: false }, { name: 'decorative', label: 'Decorative', widget: 'boolean', default: false }] },
          { name: 'analytics_enabled', label: 'Analytics enabled (also needs env config)', widget: 'boolean', default: false },
        ],
      })),
    },
  ],
};

export const render = () =>
  '# GENERATED by scripts/gen-cms-config.mjs. Do not edit by hand. Run `pnpm gen:cms-config`.\n# RT-10: this CMS is limited to src/content/** (collections + media). See CMS-SECURITY.md.\n' +
  YAML.stringify(config, { lineWidth: 0 });

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(OUT, render());
  console.log('wrote', OUT);
}
