-- Starter diagnosis vocabulary (draft, needs clinical sign-off under GATE-SCHEMA).
-- Portal codes are ours. icdo3_morph is a REFERENCE only and is NOT unique:
-- ICD-O-3.2 maps several CNS5 pediatric-type diffuse high-grade glioma types to the same 9385/3.
-- Only codes confirmed in a cited source are filled. All others stay NULL (UNVERIFIED).
-- Hebrew labels are drafts. A clinical language reviewer must confirm them.
INSERT INTO portal.diagnosis_terms (diagnosis_code, parent_code, level, icdo3_morph, label_en, label_he, is_selectable) VALUES
 ('glioma_group',            NULL,           'group',  NULL,   'Gliomas, glioneuronal and neuronal tumours', 'גליומות וגידולים גליונוירונליים ונוירונליים', false),
 ('embryonal_group',         NULL,           'group',  NULL,   'Embryonal tumours', 'גידולים עובריים', false),
 ('ependymal_group',         NULL,           'group',  NULL,   'Ependymal tumours', 'גידולי אפנדימה', false),
 ('other_cns_group',         NULL,           'group',  NULL,   'Other CNS tumours', 'גידולי מערכת עצבים מרכזית אחרים', false),
 ('ped_diffuse_hgg_family',  'glioma_group', 'family', '9385/3','Pediatric-type diffuse high-grade gliomas', 'גליומות מפושטות דרגה גבוהה מסוג ילדים', true),
 ('ped_diffuse_lgg_family',  'glioma_group', 'family', NULL,   'Pediatric-type diffuse low-grade gliomas', 'גליומות מפושטות דרגה נמוכה מסוג ילדים', true),
 ('circumscribed_astro_family','glioma_group','family', NULL,  'Circumscribed astrocytic gliomas', 'גליומות אסטרוציטריות תחומות', true),
 ('dmg_h3k27',               'ped_diffuse_hgg_family','type','9385/3','Diffuse midline glioma, H3 K27-altered', 'גליומה מפושטת של קו האמצע, שינוי H3 K27', true),
 ('dhg_h3g34',               'ped_diffuse_hgg_family','type','9385/3','Diffuse hemispheric glioma, H3 G34-mutant', 'גליומה מפושטת המיספרית, מוטציית H3 G34', true),
 ('pilocytic_astrocytoma',   'circumscribed_astro_family','type',NULL,'Pilocytic astrocytoma', 'אסטרוציטומה פילוציטית', true),
 ('medulloblastoma_family',  'embryonal_group','family',NULL,  'Medulloblastoma', 'מדולובלסטומה', true),
 ('mb_wnt',                  'medulloblastoma_family','type',NULL,'Medulloblastoma, WNT-activated', 'מדולובלסטומה, מופעלת WNT', true),
 ('mb_shh',                  'medulloblastoma_family','type',NULL,'Medulloblastoma, SHH-activated', 'מדולובלסטומה, מופעלת SHH', true),
 ('mb_non_wnt_non_shh',      'medulloblastoma_family','type',NULL,'Medulloblastoma, non-WNT/non-SHH', 'מדולובלסטומה, לא WNT ולא SHH', true),
 ('ependymoma_family',       'ependymal_group','family',NULL,  'Ependymoma', 'אפנדימומה', true),
 ('ependymoma_posterior_fossa','ependymoma_family','type',NULL,'Posterior fossa ependymoma', 'אפנדימומה של הפוסה האחורית', true),
 ('ependymoma_supratentorial','ependymoma_family','type',NULL, 'Supratentorial ependymoma', 'אפנדימומה סופרהטנטוריאלית', true),
 ('cns_tumour_nos',          'other_cns_group','family',NULL,  'CNS tumour, not otherwise specified', 'גידול מערכת עצבים מרכזית, לא מוגדר', true),
 ('cns_tumour_pending_dx',   'other_cns_group','family',NULL,  'CNS tumour, diagnosis pending', 'גידול מערכת עצבים מרכזית, אבחנה בהמתנה', true);

INSERT INTO portal.diagnosis_synonyms (diagnosis_code, lang, term, kind) VALUES
 ('dmg_h3k27','en','DMG','abbreviation'),
 ('dmg_h3k27','en','DIPG','legacy_name'),
 ('dmg_h3k27','en','diffuse intrinsic pontine glioma','legacy_name'),
 ('dmg_h3k27','he','DIPG','legacy_name'),
 ('dmg_h3k27','he','גליומה פונטינית מפושטת','legacy_name'),
 ('dhg_h3g34','en','H3 G34 glioma','synonym'),
 ('ped_diffuse_hgg_family','en','pediatric high grade glioma','synonym'),
 ('ped_diffuse_hgg_family','en','pHGG','abbreviation'),
 ('ped_diffuse_hgg_family','he','גליומה דרגה גבוהה בילדים','synonym'),
 ('pilocytic_astrocytoma','en','PA','abbreviation'),
 ('pilocytic_astrocytoma','en','juvenile pilocytic astrocytoma','legacy_name'),
 ('mb_wnt','en','WNT medulloblastoma','spelling_variant'),
 ('mb_shh','en','SHH medulloblastoma','spelling_variant'),
 ('medulloblastoma_family','en','MB','abbreviation'),
 ('medulloblastoma_family','he','מדולובלסטומה','spelling_variant'),
 ('medulloblastoma_family','he','מדולובלסטומות','spelling_variant'),
 ('ependymoma_family','he','אפנדימומה','spelling_variant'),
 ('ependymoma_posterior_fossa','en','PF ependymoma','abbreviation'),
 ('ependymoma_posterior_fossa','en','PFA','abbreviation');
