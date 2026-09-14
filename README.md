# CONTENT DESK · WEB322

An administrator-only article CMS built with Node.js, Express, EJS, PostgreSQL, Cloudinary and Tabler. The September 2026 upgrade adds a private Home dashboard, administrator sessions, a unified article table/gallery, a dedicated editor and regression tests. It retains the original server-rendered architecture.

## Local demo (no database account needed)

Requires Node.js 22.9+ or 24 and npm. From this project directory, run each command separately:

```powershell
npm.cmd install
```

```powershell
npm.cmd run demo
```

Open http://127.0.0.1:3839. Demo username: `demo`. Demo password: `Folio-demo-only-2026!`.

These are public, disposable demo credentials, never production credentials. The demo binds only to 127.0.0.1, uses an isolated in-memory PGlite PostgreSQL engine and local image storage, does not load .env, and never connects to Neon or Cloudinary. Restarting the demo resets its data. The production entry point never enables demo mode or creates this account.

## Real database setup

The upgrade does not automatically connect to or migrate the historical Neon database. Historical source contained credentials: replace any exposed active credentials before configuring the upgraded app. Removing them from current source does not remove them from Git history.

1. Choose a development/test PostgreSQL database or isolated Neon branch first. Keep the original data backed up before migrating it.
2. Create `.env` using `.env.example` as the template. Supply the database URL, a random session secret and optional Cloudinary credentials. `.env` is Git-ignored. Do not paste credentials into logs or commit them.
3. Generate a session secret locally with the following command, and put its output in `.env`:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

4. Apply the idempotent migration to that selected database:

```powershell
npm.cmd run db:migrate
```

The migration creates missing tables and adds an administrator table, shared sessions, login-attempt counters, a tracked image public ID, and an edit timestamp. It preserves existing article values. The foreign key and required-field CHECK initially use NOT VALID so old invalid rows are reported instead of silently rewritten; the migration runner validates the constraints when no invalid rows remain. New writes are constrained immediately. Existing category IDs and names remain unchanged. A fresh database needs at least one category inserted by its owner; there is no category CRUD UI.

5. Create your administrator interactively. Password input is hidden; use 15–128 characters. Duplicate usernames are rejected without overwriting the account.

```powershell
npm.cmd run admin:create
```

6. Start the real application:

```powershell
npm.cmd start
```

Open http://localhost:3838. Cloudinary is optional until a new image is uploaded; an unconfigured upload returns a clear error and preserves the editor input. Existing images remain usable if their URLs belong to res.cloudinary.com.

Remote database connections verify TLS certificates. Local PostgreSQL may set DATABASE_SSL=false. Set NODE_ENV=production on the deployed host and TRUST_PROXY=1 only behind the intended trusted single reverse proxy. Secure session cookies require HTTPS in production.

## Features and behavior

- Home: real article counts, unpublished work, recent edits and category totals. Unknown legacy edit times remain unknown.
- Articles: title search, combined category/status/date filters, whitelisted sort choices, 10-row pagination and Table/Gallery links that preserve filters.
- Dedicated editor: preview unsaved plain text, preserve paragraph breaks, preview/cancel/replace/remove covers, required-field feedback and unsaved-change warnings.
- Published is an internal state. All articles remain private to administrators; there is no public reader website.
- Changing an article does not overwrite articleDate. New edits set updated_at. SELECT returns calendar dates as text to avoid timezone day shifts.
- Authentication: username and scrypt password hash; no public registration. PostgreSQL-backed express-session, session ID rotation, 2-hour idle expiry, 8-hour absolute expiry, active-admin checks, CSRF and shared login counters (20/IP and 10/username per 15-minute window).
- Image uploads: JPEG/PNG/WebP, max 4 MiB and 20 megapixels; decoded, oriented, resized to fit 2400×2400 and encoded as WebP. The 4 MiB file cap leaves room under Vercel's 4.5 MB request limit. No SVG uploads.
- Images use HTTPS URLs. A new upload is rolled back when the DB write fails. Replaced/deleted tracked assets are cleaned up after the database operation. Legacy images without a public ID are retained rather than guessing which cloud asset to delete. Failed cleanup is logged and may require manual cloud-asset review.
- Database errors are distinct from missing records. The UI and API get appropriate status codes; internal error details are not returned.

## Source map

| File | Responsibility |
| --- | --- |
| index.js | Local/serverless entry point; no automatic migrations |
| app.js | Middleware, protected routes, upload orchestration and HTTP errors |
| content-service.js | Parameterized SQL, categories, filters and dashboard queries |
| lib/validation.js | Field, identifier and filter validation |
| lib/auth.js | Password hashing, CSRF and login logic |
| lib/database.js | Environment-based PostgreSQL pool with verified TLS |
| lib/images.js | Image validation/normalization and Cloudinary adapter |
| views/admin/ | Active EJS templates and shared layout |
| public/css/admin.css | Tabler-based visual design and responsive layouts |
| public/js/admin.js | Browser form handling, previews, mobile navigation and delete dialog |
| migrations/001_admin_cms.sql | Current schema upgrade |
| tests/ | Isolated SQL, HTTP and security regression tests |
| docs/IMPLEMENTATION_GUIDE_ZH.md | Step-by-step Chinese explanation and interview notes |

Historical templates directly under views/, old CSS files, data/*.json, and setup.sql remain for coursework reference. Runtime views are explicitly restricted to views/admin; JSON is not a runtime data source. The old /articles/modify URL redirects to the unified article list. No batch file deletion was performed.

## Tests and assets

```powershell
npm.cmd test
```

Tests execute SQL against an isolated PGlite PostgreSQL WASM engine and exercise real Express routes with Supertest. Cloudinary is replaced with a test adapter; image decoding uses the real sharp library. These are not claims of live Neon/Cloudinary/Vercel verification or an independent penetration test.

```powershell
npm.cmd run build
```

Copies Tabler CSS, its source map and license notice into the ignored public/vendor output for static hosting. Local development also serves installed Tabler assets directly. No frontend framework build or React migration is required.

```powershell
npm.cmd audit
```

The lockfile pins the resolved dependencies. Audit results reflect the advisory database at the time of the check; a clean audit does not prove the absence of all security bugs.

## Deployment boundary

vercel.json keeps the existing explicit Node builder and adds a static build for public assets, filesystem-first routing and EJS template inclusion. npm run build is verified locally; the upgraded version has not been published or tested on Vercel. Before deployment, configure fresh environment values, migrate the chosen database, create the administrator, verify proxy/cookie settings and check actual login/upload behavior in a preview environment. Never deploy the local demo command.

Future scope: MFA, controlled password recovery, role-specific permissions, audit history, recoverable deletion, optimistic concurrent-edit conflict handling, and rich-text sanitization if a rich-text editor is introduced.

References: [Tabler](https://tabler.io/admin-template), [Express sessions](https://expressjs.com/en/resources/middleware/session/), [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [Vercel request limits](https://vercel.com/docs/functions/limitations).
