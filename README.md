# DHSUD Issuance Tracker

A searchable dashboard for approved DHSUD Region VI applications and their
issuances. The supplied Google Sheet has been normalized into **183 issuance
records** from eight populated worksheet categories. The GitHub Pages build
uses a public copy with personal names reduced to surnames and sensitive
receipt, signature, and remarks fields removed.

## What is included

- Dashboard totals, monthly activity, issuance mix, and average processing time
- Searchable registry with type, year, and processor filters
- Public read-only registry with surname-only personal names
- Optional authenticated "My issuances", editing, and assignment workflows
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
npx firebase-tools login
npx firebase-tools use --add
npx firebase-tools deploy --only firestore
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

Deterministic document IDs make the migration safe to rerun. Environment values
are never written to files.

## 4. Deploy with GitHub Pages

1. Push this folder to a public GitHub repository with `main` as the default branch.
2. In **Settings → Pages**, choose **GitHub Actions** as the source.
3. Push to `main` or manually run **Deploy dashboard to GitHub Pages**.

The workflow calculates the correct Pages base path and builds with
`VITE_PUBLIC_DATA_MODE=true`. Firebase is not needed for this read-only public
registry, and editing controls are disabled.

## Data model

```text
issuances/{issuanceId}
  reference_number, issuance_type, date_filed, date_issued
  project_name, location, applicant, developer, owner
  processor, assigned_to, or_number, remarks
  source_sheet, source_row, details
  created_at, updated_at, updated_by

users/{firebaseAuthUid}
  active, role, name, email, processor_code
```

The original workbook and full normalized dataset are ignored by Git. Only the
surname-only, redacted `issuances.public.json` snapshot is published.
