# 04 — Phase 1 User Stories (MVP) with Gherkin

Format: As a role, I want X, so that Y. Traces to REQ and FR IDs. All data is synthetic.
Test IDs (TC-###) are assigned by A8. Priority is Must unless noted.
Global Given: "the portal runs with synthetic data".

## A. Public site (E01)

### US-001 Browse public pages
As an `anonymous` visitor, I want to read the public pages, so that I understand ARI-PST. (REQ-001, 004, 012, 019, 053)
```gherkin
Scenario: Visitor opens every public page
  Given I am not logged in
  When I open each of Home, About, Research areas, Community, Infrastructure, Global partners, News, Patients and families, Join/Contact
  Then each page loads with status 200
  And no sample or request data is shown
  And a Login entry link is visible on every page

Scenario: Visitor cannot reach the protected area
  Given I am not logged in
  When I open a protected URL "/app/search"
  Then I am redirected to the login page
```

### US-002 Switch language and direction
As a visitor, I want Hebrew (RTL) and English, so that I read in my language. (REQ-020)
```gherkin
Scenario: Default locale is Hebrew
  Given my browser has no language preference stored
  When I open the home page
  Then the page language is "he" and direction is "rtl"

Scenario: Switch to English
  When I choose "English" in the language switcher
  Then the page language is "en" and direction is "ltr"
  And the same page opens in English
```

### US-003 Contact and join
As a visitor, I want to send a contact or join message, so that the team can reply. (REQ-019; FR-012)
```gherkin
Scenario: Send contact message
  Given I am on the Join/Contact page
  When I fill name, email, topic and message and accept the privacy notice
  And I submit
  Then I see a confirmation
  And the coordinator inbox receives a message

Scenario: Abuse is limited
  When I submit the form more than the rate limit allows in one hour
  Then I receive status 429 with a problem+json body
```

### US-004 Privacy, terms, consent
As a visitor, I want a privacy policy, terms, and a choice on analytics. (REQ-026, 025)
```gherkin
Scenario: Analytics only after consent
  Given I open the site for the first time
  Then no analytics request is sent
  When I accept analytics in the consent banner
  Then analytics events may be sent
  When I decline
  Then no analytics request is sent

Scenario: Policies reachable
  Then the footer links to Privacy policy and Terms of use in both languages
```

### US-005 Staff edit content
As a non-technical content editor, I want to edit pages in a web UI, so that I need no developer. (REQ-024, 069)
```gherkin
Scenario: Edit a news item
  Given I am a content editor signed in to the CMS
  When I change a news item and save
  Then a pull request is created
  And a preview with synthetic data is built
  When a reviewer merges the pull request
  Then the public site updates after CI passes
```

### US-006 Accessible, mobile, discoverable
As a visitor, I want accessible mobile pages, so that anyone can use them. (REQ-021, 022, 023)
```gherkin
Scenario: Accessibility gate
  When CI runs axe on every public page in "he" and "en"
  Then there are zero critical or serious violations

Scenario: Mobile layout
  Given a viewport width of 360 px
  Then there is no horizontal scroll on any public page

Scenario: SEO basics (Should)
  Then each page has a unique title, meta description, hreflang links and appears in sitemap.xml
```

## B. Identity and access (E02)

### US-010 Invite and register a researcher
As a `national_coordinator`, I want to invite researchers, so that only approved people register. (REQ-013, 014; ASSUMPTION-03)
```gherkin
Scenario: Invite and verify
  Given I am a national_coordinator
  When I invite "researcher@example.test" as "researcher_il"
  Then an invitation email with a one-time link is sent
  When the invitee opens the link within 7 days and sets credentials
  Then the email is marked verified
  And the account role is "researcher_il"
  And an audit event "identity.user_registered" is written

Scenario: Expired invitation
  When the invitee opens a link older than 7 days
  Then the link is rejected with a clear message
```

### US-011 Log in with MFA
As a protected-area user, I want two-factor login, so that accounts stay safe. (REQ-044, 001)
```gherkin
Scenario: Password plus TOTP
  Given I have enrolled TOTP
  When I enter correct password and a valid TOTP code
  Then I get a server-side session
  And an audit event "identity.login_succeeded" is written

Scenario: No access without second factor
  Given I entered the correct password only
  Then no protected API call succeeds
```

### US-012 Enroll passkey
As a user, I want a passkey, so that login is fast and phishing-resistant. (REQ-044)
```gherkin
Scenario: Enroll and use a passkey
  Given I am logged in
  When I enroll a WebAuthn passkey
  Then the next login accepts the passkey as the second factor
  And TOTP remains as fallback
```

### US-013 Session control
As a user, I want sessions to end safely. (REQ-044, 045)
```gherkin
Scenario: Idle timeout
  Given I am logged in
  When I am idle longer than the idle limit
  Then my next request returns 401 and I must log in again

Scenario: Logout invalidates session
  When I log out
  Then the old session cookie no longer works
```

### US-014 Brute-force protection
As an admin, I want login attempts limited. (REQ-044, 045)
```gherkin
Scenario: Lockout after repeated failures
  When 5 failed logins occur for one account within 15 minutes
  Then further attempts are delayed or locked
  And an audit event "identity.login_failed" is written for each failure
  And the response does not reveal if the account exists
```

### US-015 MFA reset
As a `system_admin`, I want to reset a user's MFA after an identity check, so that locked-out users recover. (REQ-018, 044)
```gherkin
Scenario: Reset with a second approver
  Given a user lost their second factor
  When I request an MFA reset and a second admin approves
  Then old factors are removed
  And the user must enroll again at next login
  And audit events "identity.mfa_reset_requested" and "identity.mfa_reset_approved" are written
```

### US-016 Role-based access
As the owner, I want each role limited to its rights. (REQ-012, 037, 045, 053)
```gherkin
Scenario Outline: Role matrix
  Given I am logged in as "<role>"
  When I call "<endpoint>"
  Then the status is <status>

  Examples:
    | role                 | endpoint                  | status |
    | researcher_intl      | POST /api/v1/requests     | 403    |
    | researcher_il        | GET /api/v1/samples/{id}  | 403    |
    | committee_member     | PATCH /api/v1/samples/{id}| 403    |
    | system_admin         | GET /api/v1/samples/{id}  | 403    |
    | system_admin         | POST /api/v1/requests/{id}/votes | 403 |
    | anonymous            | GET /api/v1/search/counts | 401    |
```

### US-017 Clinician center scope
As a `center_clinician`, I see only my center. (REQ-015, 037)
```gherkin
Scenario: Own center only
  Given I am a center_clinician scoped to "ctr_A"
  When I list records
  Then every record has source_center_id "ctr_A"

Scenario: Other center is hidden
  When I request a record of "ctr_B" by its id
  Then the response is 404
  And an audit event "authz.denied" is written
```

## C. Search and discovery (E04)

### US-020 Free-text search
As a `researcher_il`, I want to search by words. (REQ-005, 030)
```gherkin
Scenario: Search by diagnosis term
  Given I am logged in as researcher_il
  When I search "medulloblastoma"
  Then I see aggregate result counts and facet counts
  And I see no individual record
  And the search is logged as "search.executed" with filter keys but no free text
```

### US-021 Filters
As a researcher, I want to filter, so that I narrow results. (REQ-031)
```gherkin
Scenario: Combine filters
  When I filter diagnosis, sample type, age band, center, attached data and clinical time point
  Then the counts reflect all active filters
  And I can clear all filters in one action
```

### US-022 Aggregate counts only
As a `researcher_il`, I see counts, not records. (REQ-013, 032)
```gherkin
Scenario: No record-level data for external users
  When I call the search API as researcher_il
  Then the response contains only counts per group
  And no field "sample_code" appears in the response
```

### US-023 k-anonymity
As the owner, I want small counts hidden. (REQ-033; GATE-K, default k = 5)
```gherkin
Scenario: Suppress and merge small cells
  Given a filter result has a group with 3 records and k is 5
  Then the group count is not shown
  And the group is merged into a broader category such as "other" or a wider age band
  And the merged count is at least 5

Scenario: No subtraction attack
  Given totals and sub-counts are both shown
  Then suppressed cells cannot be recovered by subtracting displayed counts

Scenario: Threshold is configuration
  When an admin-approved config change sets k to 7
  Then the new threshold applies to the next query
  And the change is audited
```

### US-024 International researcher view
As a `researcher_intl`, I want aggregate counts. (REQ-014, 032, 037)
```gherkin
Scenario: Aggregate only, no cart
  Given I am logged in as researcher_intl
  Then I see search, filters and aggregate counts
  And I do not see the request cart or "Submit request"
  And I see a "Contact the coordinator" action
```

### US-025 Smart search
As a researcher, I want search to understand synonyms and codes. (REQ-030)
```gherkin
Scenario: Synonym and typo tolerance
  When I search a known synonym or a misspelling of a diagnosis name
  Then results include the canonical diagnosis group
  And a "Did you mean" hint is shown for typos

Scenario: Hebrew and English terms
  When I search in Hebrew or in English
  Then both match the same diagnosis group
```

### US-026 Clinician sees own-center records
As a `center_clinician`, I want to see my center's coded records. (REQ-015, 027, 039; GATE-CLINICIAN-ID)
```gherkin
Scenario: Coded record with reference to local system
  Given I am scoped to "ctr_A"
  When I open a record
  Then I see the v1 schema fields only
  And I see "contact_ref" and a hint to look up identity in my center's own system
  And no name, ID number, date of birth or MRN is shown or stored
```

### US-027 Coordinator cross-center view
As a `national_coordinator`, I want to see all centers' non-identified records. (REQ-016)
```gherkin
Scenario: Broad index view
  Given I am a national_coordinator
  When I open the index
  Then I see records from all centers with v1 fields
  And I can filter by completeness and staleness
  And each record open is audited as "sample.viewed"
```

## D. Access requests (E05)

### US-030 Request cart
As a `researcher_il`, I want to collect result sets, so that I can request them together. (REQ-034)
```gherkin
Scenario: Add to cart from search
  Given I have search results
  When I add a result group to my cart
  Then the cart shows the saved filter and counts per center
  And the request state is "cart"
```

### US-031 Submit request form
As a researcher, I want to submit the form. (REQ-035, 042; FR-012)
```gherkin
Scenario: Complete submission
  Given my cart has at least one item
  When I fill research question, IRB/Helsinki approval ref, planned use and funding sources
  And I submit with an idempotency key
  Then the request state is "submitted" then "pre_check"
  And I get a receipt notification
  And an audit event "request.submitted" is written

Scenario: Missing field blocks submit
  When I leave the IRB approval reference empty
  Then the form shows an error and the state stays "cart"

Scenario: Duplicate submit
  When the same idempotency key is sent twice
  Then only one request exists
```

### US-032 Track request
As an applicant, I want to see every step. (REQ-036; FR-014)
```gherkin
Scenario: Timeline
  Given my request moved through pre_check and committee_decision
  When I open it
  Then I see each state with date, actor role and a structured message
  And I do not see individual committee votes
```

### US-033 Coordinator pre-check
As a `national_coordinator`, I want a checklist. (REQ-034)
```gherkin
Scenario: Pass pre-check
  Given a request is in "pre_check"
  When I tick all checklist items and choose "pass"
  Then the state is "committee_decision"
  And committee members are notified

Scenario: Fail pre-check needs a reason
  When I choose "fail" without a reason code
  Then the action is refused
```

### US-034 Needs more info
As a coordinator or committee member, I want to ask the applicant a question. (REQ-034)
```gherkin
Scenario: Ask and resume
  Given a request is in "committee_decision"
  When the committee requests info
  Then the state is "needs_more_info" and the info clock starts
  When the applicant responds
  Then the state returns to "committee_decision"

Scenario: Info timeout
  When 14 days pass without a response
  Then the request closes with reason "expired"
```

### US-035 Committee decision
As a `committee_member`, I want to vote with criteria. (REQ-017; GATE-COMMITTEE; ASSUMPTION-04)
```gherkin
Scenario: Quorum reached
  Given N is 2 and M is 3
  When two members vote "approve" with criteria scores and a rationale code
  Then the decision is recorded as "approve"
  And the state is "center_coordination"

Scenario: No conflict of interest
  Given I declared a conflict on this request
  Then I cannot vote on it

Scenario: Committee cannot edit the index
  When I call an index edit endpoint
  Then the status is 403
```

### US-036 Partial approval
As a committee, I want to approve some items only. (REQ-034; FR-004)
```gherkin
Scenario: Approve part of a request
  Given a request has items from "ctr_A" and "ctr_B"
  When quorum chooses "approve_partial" with item "ctr_B" declined
  Then item states are "approved" and "declined"
  And the applicant sees per-item outcome and reasons
```

### US-037 Center coordination
As a center contact, I want to confirm or decline my center's items. (REQ-027, 034, 010)
```gherkin
Scenario: Center confirms
  Given a request is in "center_coordination"
  When the center_clinician of "ctr_A" confirms their items
  Then those items stay "approved"
  When all centers have answered
  Then the state is "mta_dta"

Scenario: Center cannot act on other centers
  When a ctr_A user tries to confirm a ctr_B item
  Then the status is 404

Scenario: Center timeout escalates
  When a center does not answer within 10 business days
  Then the coordinator is notified
```

### US-038 MTA/DTA record
As a coordinator, I want to track agreements per center. (REQ-051)
```gherkin
Scenario: Record signed agreements
  Given a request is in "mta_dta"
  When I record an MTA and a DTA for every involved center with document reference and date
  Then the state is "delivery"
  And "request.agreements_signed" is audited

Scenario: Missing agreement blocks delivery
  When one center has no recorded agreement
  Then the transition to "delivery" is refused
```

### US-039 Delivery and close
As an applicant, I want to know when delivery is done. (REQ-063)
```gherkin
Scenario: Full path to closed
  Given a request is in "delivery"
  When every approved item is marked delivered
  Then the state is "closed" with reason "delivered"
  And the metric event "request.delivered" is emitted with time-to-delivery in days
```

### US-040 Withdraw
As an applicant, I want to withdraw. (REQ-034)
```gherkin
Scenario: Withdraw any time before close
  Given my request is in any state except "closed"
  When I withdraw
  Then the state is "closed" with reason "withdrawn"
  And open center tasks are cancelled
```

### US-041 Appeal
As an applicant whose request was rejected, I want one appeal. (REQ-017, 034)
```gherkin
Scenario: Appeal within window
  Given my request is "rejected" and 10 days have passed
  When I file an appeal with a reason
  Then the state is "appeal_review"

Scenario: Appeal window closed
  When 30 days have passed
  Then the request is "closed" with reason "rejected"
  And I cannot appeal
```

### US-042 Timers and reminders
As a coordinator, I want SLAs enforced automatically. (REQ-034; FR-002)
```gherkin
Scenario: Reminder before breach
  Given pre_check SLA is 5 business days
  When 4 business days pass without action
  Then a reminder goes to the assigned coordinator

Scenario: Timers are data
  When an admin-approved change sets "info_response_days" to 21
  Then new info requests use 21 days
```

## E. Ingestion and freshness (E06, E03)

### US-050 Single record entry (minimal screen)
As a `national_coordinator`, I want a short entry screen. (REQ-007, 028, 068)
```gherkin
Scenario: Enter a record with required fields only
  Given I open "New record"
  When I fill the required v1 fields using dropdowns and a month picker
  Then the record is saved with a generated opaque sample_code
  And last_verified_at is set
  And an audit event "sample.created" is written

Scenario: No free text for clinical content
  Then the form has no free-text clinical field
```

### US-051 Bulk import CSV/XLSX
As a coordinator, I want to import many rows. (REQ-003, 016, 056; GATE-INGEST; FR-005)
```gherkin
Scenario: Dry-run then commit
  Given I upload a CSV built from the v1 template
  When I run dry-run
  Then I see counts of valid rows, warnings and errors with row numbers
  And nothing is written
  When I commit
  Then valid rows are written under one batch ID
  And "sample.import_committed" is audited with batch ID and row counts

Scenario: Invalid enum value
  Given a row has sample_type "fresh"
  Then the row is an error with code "enum_invalid" and no value echoed
```

### US-052 Identifier rejection
As the owner, I want identifiers blocked. (REQ-002, 038, 041, 042; FR-006)
```gherkin
Scenario: Identifier pattern in a file
  Given a file has a 9-digit national-ID-like value in any column
  When I run dry-run
  Then the whole file is rejected
  And the message names the column and row but not the value
  And "sample.import_rejected_identifier" is audited

Scenario: Unknown column
  Given a file has a column not in schema v1
  Then dry-run fails with "unknown_column"
```

### US-053 Stale-records list
As a coordinator, I want to see stale records. (REQ-067; FR-007)
```gherkin
Scenario: Stale list
  Given stale_after_days is 180
  And a record has last_verified_at 200 days ago
  When I open the stale list
  Then the record is listed with its center and age in days
  And I can send a verification task to that center
```

### US-054 Clinician confirm or flag
As a `center_clinician`, I want one-tap actions. (REQ-067, 068; FR-008)
```gherkin
Scenario: Confirm record
  Given a record of my center is flagged stale
  When I tap "Still accurate"
  Then last_verified_at is updated
  And "sample.verified" is audited

Scenario: Flag record
  When I tap "Flag" and choose reason "depleted"
  Then availability is set to "depleted" after coordinator review
  And no free text is accepted
```

### US-055 Ethics approval reference
As a coordinator, I want each record to carry its ethics approval. (REQ-040)
```gherkin
Scenario: Required reference
  When I save a record without ethics_approval_ref
  Then the save is refused

Scenario: Opaque value
  Then ethics_approval_ref accepts only an approval ID pattern
```

### US-056 RedCAP and Madgam mapping
As a coordinator, I want a mapping to RedCAP and Madgam fields. (REQ-029, 039, 055, 056)
```gherkin
Scenario: Mapping table available
  When I open "Field mapping"
  Then I see each v1 field with its RedCAP and Madgam source name
  And no patient-level value is stored

Scenario: Template follows mapping
  When I download the import template
  Then its columns equal schema v1 fields
```

### US-057 Genomics availability flag
As a researcher, I want to know if genomic data exists. (REQ-058)
```gherkin
Scenario: Flag only
  Then "attached_data" may include "wes", "wgs" or "rna_seq" as a flag
  And no sequence file or variant is stored or shown
```

## F. Admin and committee (E07)

### US-060 Manage users and roles
As a `system_admin`, I want to manage accounts. (REQ-018, 045)
```gherkin
Scenario: Disable account
  When I disable a user
  Then their sessions end at once
  And "identity.user_disabled" is audited

Scenario: Set center scope
  When I create a center_clinician
  Then a center_id is required
```

### US-061 Configure committee
As a `national_coordinator` with committee-admin right, I want to set members, N-of-M and criteria. (REQ-017; GATE-COMMITTEE; FR-003)
```gherkin
Scenario: Criteria as data
  When I add a criterion "scientific merit" with scale 1 to 5 and weight 2
  Then new decision forms show it
  And old decisions keep their original criteria version

Scenario: Change N-of-M
  When I set N to 3 and M to 5
  Then quorum for new rounds uses 3 of 5
  And the change is audited as "governance.committee_config_changed"
```

### US-062 Committee dashboard
As a committee member, I want an overview. (REQ-017)
```gherkin
Scenario: Dashboard
  When I open the dashboard
  Then I see pending requests, age vs SLA, outcomes by month
  And no sample-level data
```

### US-063 Admin cannot read samples
As the owner, I want separation of duties. (REQ-018, 045)
```gherkin
Scenario: Admin blocked from sample data
  Given I am a system_admin
  When I open any sample or request content view
  Then the status is 403
  And I can still see audit metadata and account lists
```

### US-064 Four-eyes for high roles
As the owner, I want a second approver for powerful roles. (REQ-045; FR-011)
```gherkin
Scenario: Grant needs second admin
  When an admin grants "committee_member" role
  Then the grant is "pending"
  When a different admin approves
  Then the role becomes active
  And the same admin cannot approve own grant
```

## G. Audit (E08)

### US-070 Audit events
As an auditor-admin, I want who viewed, downloaded and approved. (REQ-046)
```gherkin
Scenario: View is logged
  When a coordinator opens a record
  Then an audit event "sample.viewed" exists with actor id, role, target id, time and trace id
  And it has no free text and no identifier

Scenario: Download is logged
  When any export is generated
  Then an audit event "export.created" exists with row count and purpose code

Scenario: Approval is logged
  When a committee decision is recorded
  Then "request.committee_decided" exists with decision and item list
```

### US-071 Audit search and export
As a `system_admin`, I want to search and export the log. (REQ-018, 046)
```gherkin
Scenario: Filter log
  When I filter by actor, event type and date range
  Then matching events are listed with cursor pagination
  And exporting is itself audited
```

### US-072 Audit immutability
As the owner, I want a tamper-evident log. (REQ-046)
```gherkin
Scenario: Append only
  When any user or admin tries to edit or delete an audit row through the API
  Then there is no such endpoint
  And the database role used by the app cannot update or delete audit rows
```

### US-073 Failed access logged
As the owner, I want denied access logged. (REQ-046)
```gherkin
Scenario: Denied action
  When a user is denied by RBAC or center scope
  Then "authz.denied" is audited with role and target type, not target content
```

## H. Security, privacy, operations (E08, E09, E11)

### US-080 Retention and deletion
As the owner, I want a retention policy enforced. (REQ-043, 047)
```gherkin
Scenario: Retention job
  Given retention for closed requests is configured
  When the scheduled job runs
  Then expired request form text is deleted or anonymised
  And a summary event "retention.run_completed" is audited with counts

Scenario: Encryption
  Then all traffic uses TLS
  And database storage is encrypted at rest (verified by A2 checklist)
```

### US-081 Full export and import round trip
As the owner, I want to export all data, so that I can move platforms. (REQ-054, 070)
```gherkin
Scenario: Round trip
  Given a synthetic data set
  When a system export runs in an approved maintenance action
  And the export is imported into an empty environment
  Then record counts and checksums match
```
Note: system export is a platform operation by a break-glass procedure. It is not a UI for `system_admin` to read samples. See OPEN-405.

### US-082 Backup and restore
As the owner, I want proven restore. (REQ-048, 072)
```gherkin
Scenario: Restore drill
  When the restore drill runs into a clean environment
  Then the data is restored within RTO 4 h
  And the loss window is within RPO 15 minutes
  And the result is recorded in the drill log
```

### US-083 Pilot metric events
As the owner, I want pilot metrics measured. (REQ-066, 025; FR-010)
```gherkin
Scenario: Events have no identifiers
  When a metric event is emitted
  Then its properties contain only enums, counts, durations and opaque ids
  And no email, name or free text is present

Scenario: Metrics report
  When I open the metrics page as national_coordinator
  Then I see the pilot metrics M1 to M7 from 05-roadmap-and-metrics.md
```

## I. Story coverage map

| Area | Stories |
|---|---|
| Roles | US-010, 016, 017, 024, 026, 027, 035, 060, 063 |
| Auth/MFA | US-011..015 |
| Search, aggregate, k-anon | US-020..025 |
| Request flow | US-030..042 |
| Ingestion | US-050..057 |
| Admin/committee | US-060..064 |
| Audit | US-070..073 |
| Public site | US-001..006 |
| Security/ops/metrics | US-080..083 |
