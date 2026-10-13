# DHSUD Issuance Tracker

A searchable dashboard for approved DHSUD Region VI applications and their
issuances. The supplied Google Sheet has been normalized into **183 issuance
records** from eight populated worksheet categories. The GitHub Pages build
uses a public copy with personal names reduced to surnames and sensitive
receipt, signature, and remarks fields removed.

## What is included

- Dashboard totals, monthly activity, issuance mix, and average processing time
- URL-addressable directory and dedicated registry page for every issuance type
- Searchable newest-first registry with type, year, and processor filters
- Public read-only registry with surname-only personal names
- Optional authenticated "My issuances", editing, and assignment workflows
- Immutable staff record history, administrator archive/restore, and selected-field recovery
- Version checks that prevent overwriting another staff member's changes
- Case-insensitive duplicate Reference Number prevention for new and changed records
- Email/password authentication and role-based access in Firestore mode
- Repeatable private-to-public sanitization and Firestore migration scripts
- GitHub Pages deployment workflow

## Architecture

- **Frontend:** React + TypeScript + Vite
- **Public data:** sanitized static JSON generated from an ignored private source
- **Optional database and authentication:** Firebase Cloud Firestore and Firebase Auth
- **Hosting:** GitHub Pages
- **Backend framework:** none. The Pages build is a read-only public registry;
  the optional staff mode uses the Firebase client SDK and Firestore rules.

## Local preview

Install dependencies, copy `.env.example` to `.env.local`, and temporarily set
`VITE_DEMO_MODE=true`. Demo mode uses two synthetic records and does not write
to Firestore. Real migrated records are never included in demo mode.

```powershell
npm install
npm run dev
```

Open <http://localhost:5174>. Never enable demo mode in the GitHub deployment.

## 1. Optional Firebase staff portal

The public Pages deployment does not need Firebase. To enable the authenticated
staff workflow separately:

1. Create a project in the [Firebase Console](https://console.firebase.google.com/).
2. Under **Build → Firestore Database**, create a production-mode database.
3. Under **Build → Authentication → Sign-in method**, enable Email/Password.
4. Add the deployed site under Authentication → Settings → Authorized domains.
5. Add a Firebase Web app and copy its six public configuration values into
   `.env.local` using the names in `.env.example`.
6. Deploy the checked-in database rules:

```powershell
npm run firebase -- login
npm run firebase -- deploy --only firestore
```

Create an Authentication user and a corresponding `users/{UID}` Firestore
document with these fields:

| Field | Type | Example |
|---|---|---|
| `active` | boolean | `true` |
| `role` | string | `admin` |
| `name` | string | `Registry Administrator` |
| `email` | string | `admin@example.gov.ph` |
| `processor_code` | string | `AJRDC` |

Other users may have the `processor` or `viewer` role. `processor_code` connects
legacy records to a user's **My issuances** view.

## 2. Regenerate and sanitize spreadsheet data

The full normalized snapshot is kept locally in the ignored
`private-data/issuances.json`. After downloading a newer workbook as
`reference.xlsx`, regenerate the private snapshot and then the publish-safe one:

```powershell
python scripts/extract_spreadsheet.py reference.xlsx private-data/issuances.json
npm run sanitize
npm test
```

The sanitizer preserves organization names, reduces personal party names to
surnames, and removes remarks, receipt numbers, signature paths, and direct
assignments from the public snapshot.

## 3. Optional Firestore import

Set the six Firebase values plus credentials for an authorized administrator.
The importer reads only the ignored private dataset and never requires a
service-account key:

```powershell
$env:FIREBASE_API_KEY="..."
$env:FIREBASE_AUTH_DOMAIN="..."
$env:FIREBASE_PROJECT_ID="..."
$env:FIREBASE_STORAGE_BUCKET="..."
$env:FIREBASE_MESSAGING_SENDER_ID="..."
$env:FIREBASE_APP_ID="..."
$env:FIREBASE_IMPORT_EMAIL="admin@example.gov.ph"
$env:FIREBASE_IMPORT_PASSWORD="..."
npm run import
```

Deterministic document IDs make the migration safe to rerun: existing records are
skipped, preserving staff edits and history. New records receive a creation
history entry and a reserved reference number. Duplicate source numbers must be
reconciled before importing into a new database. Environment values are never
written to files.

## 4. Deploy with GitHub Pages

1. Push this folder to a public GitHub repository with `main` as the default branch.
2. In **Settings → Pages**, choose **GitHub Actions** as the source.
3. Add the six `VITE_FIREBASE_*` values from `.env.local` as repository
   variables under **Settings → Secrets and variables → Actions → Variables**.
4. Push to `main` or manually run **Deploy dashboard to GitHub Pages**.

The workflow calculates the correct Pages base paths and publishes two builds:

- `/DHSUD6Logbook/` is the surname-only public registry built with
  `VITE_PUBLIC_DATA_MODE=true`.
- `/DHSUD6Logbook/staff/` is the authenticated Firestore staff portal built
  with `VITE_PUBLIC_DATA_MODE=false`.

The public registry does not use Firebase and keeps editing controls disabled.
Dedicated issuance pages use hash routes such as
`/DHSUD6Logbook/#/types/development-permit`, so direct links and browser
navigation work without server-side routing support from GitHub Pages.

## Data model

```text
issuances/{issuanceId}
  reference_number, issuance_type, date_filed, date_issued, expiry_date
  project_name, location, applicant, developer, owner
  processor, assigned_to, or_number, remarks
  source_sheet, source_row, details
  created_at, updated_at, updated_by

users/{firebaseAuthUid}
  active, role, name, email, processor_code
```

REMC Decision Numbers are normalized and validated as `REMC-YYYY-NUMBER`.
Existing decisions may use one uppercase letter suffix, such as
`REMC-2026-0010A`.

Temporary License to Sell records use the same core fields as License to Sell
records. Their `expiry_date` is automatically set to one calendar year after
`date_issued`.

Conditional License to Sell (CLS) uses the same core fields, with a required
user-entered `expiry_date` on or after `date_issued`. Total escrow and cumulative
payments are saved as integer `escrow_total_centavos` and `escrow_paid_centavos`.
Payment must be at least 25% (rounded up to the next centavo) and no more than
100% of escrow. The form, record details, and CSV export calculate the minimum,
actual paid percentage, remaining balance, and remaining percentage.

CLS expiry warnings appear on the dashboard, register, and record details only
when the expiry date has passed in Asia/Manila and an unpaid balance remains.
The license is valid through the expiry date; fully paid records do not trigger
this combined warning. Existing TLS automatic expiry behavior is unchanged.
Run `npm test` for escrow and expiry boundary tests. Deploy `firestore.rules`
alongside this feature (`npm run firebase -- deploy --only firestore:rules`);
GitHub Pages deployment does not deploy database rules.

New and changed Reference Numbers are reserved transactionally in
`issuance_reference_numbers`, preventing two staff members from saving the
same number concurrently. Three duplicate groups inherited from the source
workbook remain grandfathered until their correct replacement numbers are
confirmed: `REMC-2025-152`, `REMC-2025-158`, and `2026/06-15`.

The original workbook and full normalized dataset are ignored by Git. Only the
surname-only, redacted `issuances.public.json` snapshot is published.

## Record history and recovery (staff portal)

Open a record and select **History** to see the action, Philippine timestamp,
staff name, reason, and changed values. Each write saves a complete before/after
snapshot atomically with the record, authenticated staff UID, and incremented
version. Rules reject missing, forged, modified, or deleted history entries.
Existing records start with their exact pre-change baseline on their first
tracked change; earlier edits cannot be reconstructed. History is available to
active staff viewers, processors, and administrators, and is never published
in the public snapshot.

Processors and administrators can edit active records with a reason. Only
administrators can archive, restore, or recover earlier values. **Archive record**
replaces permanent deletion. Archived records leave active lists, dashboard
counts, and exports, and remain in the administrator's **Archived records**
register. Their reference numbers remain reserved. The three inherited shared
numbers listed above are permanently blocked for new or changed references;
both original entries remain editable, archivable, and restorable with their
unchanged numbers.

To recover an earlier edit, choose a version (or its initial baseline) in
History, select the fields to recover, and review the complete record in the
form. Enter a recovery reason and save. Validation and reference reservations
still apply, and recovery creates a new history entry. Restore an archived
record before recovering values. Record versions are checked inside the save
transaction; a stale form must be closed and reopened against the latest record.

The sanitizer excludes archived records and explicitly allows public fields,
removing staff and history metadata. Publishing remains a separate snapshot
process; staff archive/restore operations do not update an already published
public snapshot automatically. Supply current private data when republishing.
The spreadsheet importer skips existing records rather than overwriting them.

### Deployment and verification

Deploy the updated `firestore.rules` together with this staff portal release:

```powershell
npm run firebase -- deploy --only firestore:rules
```

Rules must be deployed before staff use this release. Older open staff tabs and
older importer versions cannot save under the new rules; reload the staff portal
after deployment. No live-data migration or index change is required. History
starts lazily on each legacy record's next change. GitHub Pages does not deploy
Firestore rules. This repository's PR workflow checks both builds and runs the
rules against an isolated emulator; it does not deploy the rules.

Run `npm test` for data, escrow, history, recovery and redaction tests. With Java
21+ installed, run actual Firestore permission and concurrency tests locally:

```powershell
npm run firebase -- emulators:exec --only firestore --project demo-issuance-history "npm run test:rules"
```

The rules tests clear only the `demo-issuance-history` project on a loopback
emulator. No production credentials are needed. Database administrators using
privileged server credentials can bypass client rules, so independent database
backups remain necessary for disaster recovery.
