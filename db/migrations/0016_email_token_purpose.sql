-- 0016 e-mail token purpose as the challenge kind. kind: expand
-- The auth adapter stored every e-mail token with kind 'invite' and ignored the purpose (review R-08). It now stores the
-- purpose ('invite', 'verify', 'password_reset') as the kind, and the consume step matches it. This widens the CHECK on
-- authn.challenges.kind. Existing rows keep their kind ('login', 'webauthn_reg', 'webauthn_auth', 'invite'), so the new
-- constraint validates on a table that holds data. No row changes. authn.challenges is owned by app_migrator (0010).
ALTER TABLE authn.challenges DROP CONSTRAINT IF EXISTS challenges_kind_check;
ALTER TABLE authn.challenges ADD CONSTRAINT challenges_kind_check
  CHECK (kind IN ('login', 'webauthn_reg', 'webauthn_auth', 'invite', 'verify', 'password_reset'));
