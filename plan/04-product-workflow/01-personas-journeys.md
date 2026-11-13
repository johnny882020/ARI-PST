# 01 — Personas and Journeys

Scope: REQ-004, 005, 006, 007, 012–018, 037, 068. All names are synthetic.
Roles use the canonical names from the contract pack §5.

## 1. Persona summary

| Role | Persona (synthetic) | Goal | Main fear | Success signal |
|---|---|---|---|---|
| `anonymous` | "Visitor Noa" (parent or student) | Understand what ARI-PST is. Find how to join or contact. | Jargon. Feeling data is exposed. | Finds a clear page in 2 clicks. |
| `researcher_il` | "Dr. Researcher Alef" | Find out if samples exist. Send a request. Track it. | Long forms. No status. | Request sent in one session. Status visible. |
| `researcher_intl` | "Dr. Researcher Beta" (partner lab) | See aggregate counts. Judge fit for collaboration. | Hidden data. Slow access. | Counts and a contact path. |
| `center_clinician` | "Clinician Gimel" (Synthetic Center A) | Know own center's samples. Spend near-zero time. | Extra work. Privacy risk. | Needs under 5 minutes a week. Sees own data back. |
| `national_coordinator` | "Coordinator Dalet" | Keep the index current. Run pre-checks. Help researchers. | Stale data. Manual rework. | Bulk import works. Stale list is short. |
| `committee_member` | "Committee Member Hey" | Decide fast, with the right facts. | Missing context. Unclear criteria. | Decision in one sitting. Record is clear. |
| `system_admin` | "Admin Vav" | Manage accounts, roles, content, logs. | Breaking separation of duties. | Can act without seeing sample data. |

Design rule from REQ-007 and REQ-068: the treating clinician is never the data-entry worker. The coordinator does entry. The clinician only verifies and sees value.

## 2. Role boundaries (reminder)
- `system_admin` cannot approve requests. `system_admin` cannot read sample data.
- `committee_member` cannot edit the index.
- `center_clinician` sees the coded record of own center only. Identity is resolved in the center's own system (GATE-CLINICIAN-ID).
- `researcher_intl` sees aggregate counts only (REQ-014, REQ-032).

## 3. Journey: anonymous visitor (REQ-004, 012, 019)

```mermaid
journey
  title Anonymous visitor finds and joins
  section Arrive
    Open home page (he default): 4: Visitor
    Read what ARI-PST is: 5: Visitor
  section Explore
    Browse research areas and infrastructure: 4: Visitor
    Read patients and families page: 5: Visitor
  section Act
    Open Join or Contact: 4: Visitor
    Send contact form: 4: Visitor
    Or open Login entry: 3: Visitor
```

Happy path: 3 pages, under 3 minutes. No login prompt blocks public content.

## 4. Journey: researcher_il (REQ-013, 034, 035, 036)

```mermaid
journey
  title Israeli researcher: search to delivery
  section Get access
    Receive invitation and verify email: 3: Researcher
    Set passkey or TOTP: 3: Researcher
  section Discover
    Search free text and filters: 5: Researcher
    See aggregate counts (k-anon applied): 4: Researcher
  section Request
    Add result sets to request cart: 5: Researcher
    Fill form (question, IRB, use, funding): 3: Researcher
    Submit request: 4: Researcher
  section Track
    See each step and who is acting: 5: Researcher
    Answer a need-more-info query: 3: Researcher
    Sign MTA and DTA: 3: Researcher
    Confirm delivery: 5: Researcher
```

## 5. Journey: researcher_intl (REQ-014, 032)

```mermaid
journey
  title International researcher: aggregate view
  section Access
    Register (approved by coordinator): 3: Partner
    Sign in with MFA: 3: Partner
  section Discover
    Search and filter: 5: Partner
    View aggregate counts only: 4: Partner
  section Next step
    Use contact route to the national coordinator: 4: Partner
    Partner sees no request cart: 2: Partner
```

Note: no cart for this role in Phase 1. A "collaboration inquiry" goes to the coordinator by contact form. See OPEN-401.

## 6. Journey: clinician low-effort path (REQ-007, 015, 068)

Design target: at most 5 minutes per week. No data entry by default.

```mermaid
journey
  title Clinician low-effort path
  section Onboard (once)
    Coordinator creates account for clinician: 4: Coordinator
    Clinician sets passkey: 3: Clinician
  section Weekly value
    Open My Center dashboard: 5: Clinician
    See own samples, counts, last-verified dates: 5: Clinician
    See which samples were requested: 5: Clinician
  section Optional action
    One-tap Confirm still accurate on a flagged record: 5: Clinician
    One-tap Flag as wrong or depleted (no free text): 4: Clinician
  section Never
    No identifiers typed into the portal: 5: Clinician
    No long forms: 5: Clinician
```

Rules:
- Default screen is read-only value: counts, requests touching own samples, freshness.
- Allowed actions: `confirm_record`, `flag_record` with enum reason. No free text (REQ-042).
- Notifications are digests, weekly, with one link. No per-record emails.
- Repeat value: "Your center contributed to N requests this quarter" (aggregate, k-anon safe).
- Identity of a patient is looked up in the center's own system. The record shows a `contact_ref` and a link-out hint only.

## 7. Journey: national_coordinator bulk path (REQ-016, 027, 067, GATE-INGEST)

```mermaid
journey
  title Coordinator bulk path
  section Prepare
    Download CSV template for schema v1: 4: Coordinator
    Fill template from center RedCAP export (no identifiers): 3: Coordinator
  section Import
    Upload CSV or XLSX to staging: 4: Coordinator
    Dry-run: see row errors and identifier warnings: 4: Coordinator
    Fix rows and re-upload: 3: Coordinator
    Commit import: 5: Coordinator
  section Upkeep
    Open Stale records list: 4: Coordinator
    Bulk confirm with center: 4: Coordinator
    Export for audit: 4: Coordinator
  section Requests
    Pre-check incoming requests: 4: Coordinator
```

Rules:
- Dry-run is mandatory before commit.
- Files with suspected identifiers are rejected as a whole. Row detail never echoes the value.
- Every commit writes an audit event and a batch ID.
- Single-record screen exists for fixes. It has a minimal field set (REQ-068).

## 8. Journey: committee_member (REQ-017)

```mermaid
journey
  title Committee member decides
  section Prepare
    Get notification of pending request: 4: Member
    Open decision pack (question, IRB, use, funding, items, pre-check note): 4: Member
  section Decide
    Score against configured criteria: 3: Member
    Vote approve, reject, request info, or partial: 4: Member
    Add structured rationale: 3: Member
  section After
    See outcome when N-of-M is reached: 4: Member
    View dashboard (volume, age, outcomes): 4: Member
```

The member sees request content and aggregate item counts. The member never sees sample-level index records. The member cannot edit the index.

## 9. Journey: system_admin (REQ-018, 045, 046)

```mermaid
journey
  title System admin operates the portal
  section Accounts
    Create or disable account: 4: Admin
    Assign role and center scope: 4: Admin
    Reset MFA after identity check: 3: Admin
  section Content
    Review content edits (Git PR): 4: Admin
  section Oversight
    Review audit log (metadata only): 4: Admin
    Export audit log: 4: Admin
  section Limits
    Cannot approve requests: 5: Admin
    Cannot read sample data: 5: Admin
```

Role changes that give high power need a second approver (four-eyes). See `06-governance.md`.

## 10. Top journeys (ranked)

| # | Journey | Role | Phase 1 |
|---|---|---|---|
| J1 | Find samples with search and filters | `researcher_il` | Yes |
| J2 | Submit a request from cart | `researcher_il` | Yes |
| J3 | Track a request and answer questions | `researcher_il` | Yes |
| J4 | Bulk import and dry-run | `national_coordinator` | Yes |
| J5 | Pre-check a request | `national_coordinator` | Yes |
| J6 | Decide on a request | `committee_member` | Yes |
| J7 | Weekly value view and confirm | `center_clinician` | Yes |
| J8 | Aggregate view for partners | `researcher_intl` | Yes |
| J9 | Public browse and contact | `anonymous` | Yes |
| J10 | Manage accounts and logs | `system_admin` | Yes |
| J11 | Resolve stale records | `national_coordinator` | Yes |
