# 05 — UX writing guide and microcopy
Covers REQ-020, REQ-071. Rules in `01-brand-identity.md` §3 apply. Keys use `area.screen.element`. Hebrew copy is a draft; a native Hebrew editor must review. Legal copy needs legal review.

## 1. Rules
- Sentence case. No exclamation marks in errors.
- Buttons are verbs: "Send request", "שלח בקשה".
- Say what happens next.
- Say what is saved.
- Say "samples" and "data" (דגימות, נתונים). Do not say "patients" in the researcher app.
- Do not mention small numbers. Do not hint which category is small.
- Errors: what happened + what to do. No codes in the main sentence. Trace ID in small print.
- Numbers: digits. Hebrew plural forms use ICU plural rules (one, two, other) — Hebrew has `one`, `two`, `other` (and `many` in CLDR). Use message format, not string concat.

## 2. Microcopy tables
### 2.1 Common actions
| Key | EN | HE |
|---|---|---|
| common.action.save | Save | שמירה |
| common.action.cancel | Cancel | ביטול |
| common.action.back | Back | חזרה |
| common.action.continue | Continue | המשך |
| common.action.retry | Try again | ניסיון חוזר |
| common.action.clearFilters | Clear filters | ניקוי סינונים |
| search.input.placeholder | Try a diagnosis or sample type | אפשר לנסות אבחנה או סוג דגימה |
| cart.action.add | Add to request cart | הוספה לסל הבקשה |
| request.action.submit | Send request | שליחת בקשה |

### 2.2 Errors
| Key | EN | HE |
|---|---|---|
| error.generic.title | Something went wrong | משהו השתבש |
| error.generic.body | We could not finish this. Your work is saved. Please try again. | לא הצלחנו להשלים את הפעולה. מה שהזנתם נשמר. אפשר לנסות שוב. |
| error.network.body | You seem to be offline. We will keep your changes here. | נראה שאין חיבור. השינויים נשמרים כאן. |
| error.forbidden.title | You cannot open this page | אין הרשאה לפתוח את הדף הזה |
| error.forbidden.body | Your role does not include this page. If you think this is a mistake, contact the coordinator. | התפקיד שלכם אינו כולל את הדף הזה. אם לדעתכם זו טעות, פנו לרכז/ת. |
| error.notFound.title | We cannot find this page | לא מצאנו את הדף |
| error.session.body | Your session ended for safety. Sign in again to continue. | ההתחברות הסתיימה מטעמי אבטחה. יש להתחבר שוב כדי להמשיך. |
| error.trace.label | Reference for support | מספר אסמכתה לתמיכה |
| form.error.required | Please fill in this field | נא למלא את השדה |
| form.error.summary | {count, plural, one {1 field needs your attention} other {# fields need your attention}} | {count, plural, one {שדה אחד דורש תשומת לב} two {שני שדות דורשים תשומת לב} other {# שדות דורשים תשומת לב}} |
| form.error.identifier | This looks like it may identify a person. Remove it. The portal does not accept identifying details. | נראה שזה עלול לזהות אדם. נא להסיר. הפורטל אינו מקבל פרטים מזהים. |
| auth.error.code | That code did not work. Check the code and try again. | הקוד לא תקין. נא לבדוק ולנסות שוב. |

### 2.3 Suppression (k-anonymity)
| Key | EN | HE |
|---|---|---|
| counts.suppressed.label | Too few to show | מעט מדי להצגה |
| counts.suppressed.sr | Count not shown, to protect privacy | המספר אינו מוצג, כדי להגן על הפרטיות |
| counts.suppressed.why.title | Why are some numbers hidden? | למה חלק מהמספרים מוסתרים? |
| counts.suppressed.why.body | When a group is very small, a number could help identify a child. We hide it to protect families. Contact the coordinator if you need more detail for your study. | כשקבוצה קטנה מאוד, מספר עלול לסייע בזיהוי ילד. אנחנו מסתירים אותו כדי להגן על משפחות. אם יש צורך בפירוט נוסף למחקר, אפשר לפנות לרכז/ת. |
| counts.merged.chip | Includes related categories | כולל קטגוריות קרובות |
| counts.merged.body | Some small groups are combined into a wider category. | קבוצות קטנות מאוחדות לקטגוריה רחבה יותר. |
| counts.coordinatorView | Coordinator view: exact counts | תצוגת רכז/ת: מספרים מדויקים |

### 2.4 Consent and privacy
| Key | EN | HE |
|---|---|---|
| privacy.badge | This portal holds no patient identity | בפורטל הזה אין זהות של מטופלים |
| privacy.notice.short | We keep coded, de-identified sample information only. Names and ID numbers stay at the hospital. | אנחנו שומרים רק מידע מקודד ומנותק מזהות על דגימות. שמות ומספרי זהות נשארים בבית החולים. |
| privacy.notice.more | Read the full privacy policy | לקריאת מדיניות הפרטיות המלאה |
| consent.analytics.title | Help us improve this site? | לעזור לנו לשפר את האתר? |
| consent.analytics.body | We would like to count visits. We do not track you across sites. You can change this at any time. | נשמח לספור ביקורים. אנחנו לא עוקבים אחריכם באתרים אחרים. אפשר לשנות בכל עת. |
| consent.analytics.accept | Accept | אישור |
| consent.analytics.decline | Decline | דחייה |
| consent.terms.checkbox | I have read and agree to the researcher terms (version {version}) | קראתי ואני מסכימ/ה לתנאי החוקרים (גרסה {version}) |
| consent.freetext.warning | Do not enter names, ID numbers, or any detail that could identify a child. | נא לא להזין שמות, מספרי זהות או כל פרט שעלול לזהות ילד. |
All consent text: needs legal review.

### 2.5 Empty states
| Key | EN | HE |
|---|---|---|
| search.empty.title | No samples match these filters | אין דגימות התואמות לסינון |
| search.empty.body | Try removing one filter, or search a broader term. | אפשר להסיר סינון אחד או לחפש מונח רחב יותר. |
| cart.empty.title | Your request cart is empty | סל הבקשה ריק |
| cart.empty.body | Search the index and add the groups you need. | אפשר לחפש במאגר ולהוסיף את הקבוצות הנדרשות. |
| tracker.empty.title | You have no requests yet | עדיין אין לכם בקשות |
| tracker.empty.body | When you send a request, you can follow every step here. | אחרי שליחת בקשה, אפשר לעקוב כאן אחרי כל שלב. |
| coordinator.empty.title | No records need review | אין רשומות הממתינות לבדיקה |
| committee.empty.title | No requests wait for your decision | אין בקשות הממתינות להחלטתכם |
| table.empty.title | Nothing to show yet | אין עדיין מה להציג |

### 2.6 Request tracker statuses
| Key | EN | HE |
|---|---|---|
| tracker.status.submitted | Sent. We received your request. | נשלחה. הבקשה התקבלה. |
| tracker.status.precheck | A coordinator is checking your request. | רכז/ת בודק/ת את הבקשה. |
| tracker.status.needsInfo | We need a little more from you. | אנחנו צריכים ממכם עוד קצת מידע. |
| tracker.status.committee | The committee is reviewing. | הוועדה בוחנת את הבקשה. |
| tracker.status.approved | Approved. Next: coordination with the center. | אושרה. השלב הבא: תיאום עם המרכז. |
| tracker.status.rejected | Not approved. Read the reasons below. | לא אושרה. הנימוקים מופיעים למטה. |
| tracker.status.agreement | Agreement (MTA/DTA) is being prepared. | ההסכם (MTA/DTA) בהכנה. |
| tracker.status.delivered | Delivered. | נמסרה. |

### 2.7 Public / families
| Key | EN | HE |
|---|---|---|
| home.hero.title | Science that walks beside families | מדע שהולך לצד המשפחות |
| home.hero.body | Hospitals and researchers in Israel share what they know, so children with brain tumors get better answers sooner. | בתי חולים וחוקרים בישראל משתפים בידע, כדי שילדים עם גידולי מוח יקבלו תשובות טובות מהר יותר. |
| families.disclaimer | This site does not hold your child's medical record. Talk to your care team about treatment. | באתר הזה אין תיק רפואי של הילד או הילדה. לשאלות על הטיפול יש לפנות לצוות המטפל. |
| families.term.explain | What does this mean? | מה זה אומר? |

## 3. Notifications (email, in-app)
- Subject states the status, not the drama: "Your request: committee review started" / "בקשתכם: הוועדה החלה בבדיקה".
- No personal data, no sample details in email. Link to the portal.
- Footer: privacy link and why they got the email.

## 4. Review process
Native Hebrew editor + clinical lead + parent advisor review all public and families copy. Researcher copy: reviewed by a researcher panel. UNVERIFIED owner names; A4 assigns.
