# Verification record — 2026-09-14

This record covers the local September 2026 upgrade, not the historical deployment.

## Automated checks

- Node.js 24.16.0, npm 11.16.0 on Windows.
- `npm test`: 26 passed, 0 failed. Tests use isolated PGlite databases, real Express requests and real sharp decoding; external image storage is replaced by a test adapter.
- `npm run build`: passed. Tabler static CSS, source map and license notice are generated successfully. The sandbox denied one repeat copy; the authorized local build succeeded.
- `npm audit`: 0 known vulnerabilities at the time of checking. This is not a penetration test or a guarantee of security.
- `git diff --check`: no whitespace errors. Windows LF/CRLF notices are informational.

The two `Request failed` messages during tests are expected, intentionally injected database failures. The tests verify that clients receive controlled errors without internal database details.

## Browser acceptance in the isolated local demo

- Administrator sign-in and the private Home dashboard.
- Article table and Gallery views; combined filtering and links.
- Dedicated edit page and saved article detail.
- Mobile Home and editor at a 390 × 844 viewport; no horizontal document overflow in the checked pages.
- An unsaved plain-text preview preserves paragraphs.
- Creating a temporary draft through the actual browser Save action returns the saved detail page with the selected category and unpublished state.
- Delete confirmation can be cancelled without losing an article. The actual delete endpoint is covered by automated tests against disposable data.

Demo data is synthetic, explicitly labeled and reset on restart. No production articles were created, edited or deleted during verification.

## Not yet verified / requires owner configuration

- Migration against the real Neon database or a selected development branch, including any invalid historical rows.
- Rotation of previously exposed credentials. Removing credentials from current source does not remove Git history or revoke existing keys.
- Creation of the real administrator through the hidden-password CLI.
- Real Cloudinary upload and cleanup under the owner's account.
- Vercel preview deployment, production HTTPS/proxy cookies, and serverless asset packaging.
- Independent security review, load testing, backup restoration and accessibility audit.

See `IMPLEMENTATION_GUIDE_ZH.md` for the Chinese explanation of each phase and `README.md` for setup commands. The code changes are local and uncommitted; no Git push or deployment was performed.

## Readability and administrator UI revision

Following owner feedback, increased body/control text to 16px, supporting text to at least 14px and editor body text to 18px; strengthened muted text contrast. Added real Home/Articles/Categories top navigation with active-section state, uppercase FOLIO branding, task-focused management copy, visible filter labels and a compact sidebar action. Added two regression tests for navigation and administrator copy. Desktop and 390px mobile views are checked in the local demo; production data and authentication behavior are unchanged.

## Breadcrumb revision

Replaced duplicate top-level navigation with a semantic breadcrumb list. Home is the root; article creation, preview and editing have Home and Articles ancestors. Categories and About link back to Home. Only ancestors are links; the current page is marked with aria-current. The navigation regression test covers eight paths, including the Gallery query. The total remains 26 tests. Mobile navigation still uses the existing sidebar toggle.
