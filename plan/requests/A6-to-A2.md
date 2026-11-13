# A6 to A2 (Security and Privacy)

1. Confirm CSP, headers, and cookie plan in `plan/06-frontend/04-protected-app-security.md` sections 2 to 4 (`__Host-ari_sid` SameSite=Strict; `__Host-ari_csrf` double-submit with HMAC bound to session).
2. Session timers: idle 15 min, absolute 8 h, warning at T-2 min, step-up window 10 min (ASSUMPTION-A6-02/03). Please set final values.
3. Should the suppression threshold k be shown to users (help page)? Default here: no number next to cells; global note only (OPEN-A6-05).
4. Print/screenshot policy for record views (OPEN-A6-04).
5. Free-text PII pattern rules for the server check (client only warns).
6. Retention for public-form messages (default 30 days after delivery).
7. Legal review needed: analytics consent model, cookie notice, privacy policy, terms, accessibility statement (Israeli standard version), photos of children.
