# Low-Cost Kapon Promo

## Operation

Admin and staff can manage the promotion under **Manage Schedule > Low-Cost Kapon Promo**.

1. Select **Activate Low-Cost Kapon** and enter the current HTTPS Google Form link.
2. Optionally set the title, description, and start/end date and time. The dates control when registration and booking are available; existing service slot/weekend rules still apply.
3. Use **Edit Promo** to update the form or dates without deactivating it.
4. Use **Deactivate** and accept the confirmation to stop new bookings and remove the customer announcement.

The service always remains in the catalog with its existing pricing and description. Only its booking availability changes. REGISTER NOW opens the saved Google Form, independently of the existing appointment booking flow.

## Deployment

Deploy both the updated frontend and Express backend from this repository, including the new `shared` directory. A frontend-only deployment does not install the required promo endpoint or booking enforcement.

Publish the updated **firestore.rules** to the same Firebase project already used by the website:

```powershell
firebase deploy --only firestore:rules --project YOUR_EXISTING_PROJECT_ID
```

Alternatively, open **Firebase Console > your existing project > Firestore Database > Rules**, replace the rules with this repository's complete `firestore.rules`, and select **Publish**. Do not replace the entire ruleset with only the new promo matches.

No new database, index, environment variable, authentication provider, or manually created Firestore document is required. The first activation creates the documents. Until the rules are published, promotion controls fail closed and Kapon bookings stay unavailable. No live rules or promotional records were changed during implementation.

## Data and Security

- `promotions/low-cost-kapon`: one public state record containing `isActive`, `revision`, title, description, formLink, startsAt, and endsAt. Deactivation leaves only `isActive: false` and the revision, so customers cannot read the old registration link.
- `promotionDetails/low-cost-kapon`: staff-only record retaining the last configuration and activation/update/deactivation timestamps and employee UID/name/role.
- Both documents reject all browser writes. The existing authenticated backend verifies active admin/staff privileges and performs the write transaction.
- Each mutation requires the revision displayed when the modal was opened. Concurrent edits reject with a conflict message instead of silently overwriting each other. The document IDs are fixed, preventing multiple active promo records.
- The customer subscription uses server-confirmed Firestore snapshots. Missing data, loading, and read errors never enable booking. Changes to activation or the form URL update the mounted dashboard without refresh.
- Optional start/end boundaries update the frontend via timers; the backend independently checks its own current time. The period controls when new bookings can be submitted, rather than changing the existing appointment dates/slots.
- Kapon creates and service/schedule changes check promo availability inside the appointment transaction. Existing appointments can still be cancelled or handled by staff after deactivation. Other services retain their existing behavior.

The implementation uses the existing [Firestore listener](https://firebase.google.com/docs/firestore/query-data/listen) and [transaction](https://firebase.google.com/docs/firestore/manage-data/transactions) patterns.

## Changed Files

| File | Change |
| --- | --- |
| `shared/lowCostKaponPromo.mjs` | Shared Google Form, date, availability and service validation. |
| `server/src/controllers/promo.controller.js` | Role-protected activate/edit/deactivate transaction and private metadata. |
| `server/src/controllers/appointment.controller.js` | Transactional enforcement for Kapon bookings. |
| `server/src/routes/auth.routes.js` | Authenticated promo write endpoint. |
| `firestore.rules` | Read-only public promo state and staff-only private metadata. |
| `src/app/services/kaponPromo.js` | Firestore subscription and authenticated API write. |
| `src/app/context/AppContext.jsx` | Promo state, subscription cleanup, scheduling boundaries and client booking guard. |
| `src/app/components/portal/KaponPromoManager.jsx` | Admin/staff controls and activation/edit modal. |
| `src/app/components/portal/PortalPage.jsx` | Promo controls in Manage Schedule. |
| `src/app/components/KaponPromoBanner.jsx` | Customer announcement with the saved registration URL and existing logo. |
| `src/app/components/CustomerProfile.jsx` | Conditional banner and catalog booking state. |
| `src/app/components/AppointmentBooking.jsx` | Disabled unavailable Kapon option and submission validation. |
| `tests/kaponPromo.test.mjs` | Shared validation and availability checks. |
| `tests/kaponPromoUi.test.mjs` | Catalog, banner, selector, controls, subscription and API checks. |
| `tests/kaponPromo.browser.mjs` | Desktop/mobile workflow checks using isolated mocked data. |
| `server/tests/kaponPromo.test.js` | Permissions, revisions, metadata, booking bypasses and deactivation checks. |
| `server/tests/sessionSecurity.test.js` | Test-loader support for the shared ESM validator used by the controller. |
| `dist/` | Refreshed production frontend. |

## Verification

```powershell
node --test tests/kaponPromo.test.mjs tests/kaponPromoUi.test.mjs tests/appointmentWorkspace.test.mjs tests/scheduleData.test.mjs server/tests/kaponPromo.test.js server/tests/sessionSecurity.test.js
npm.cmd run build
```

The browser check uses Playwright when it is already available. To use an existing cached installation without adding a dependency, set `KAPON_PLAYWRIGHT_MODULE` to its `index.mjs`, then run `node tests/kaponPromo.browser.mjs`. Screenshots are written to `artifacts/kapon-promo/`. It starts an isolated test server and closes the server/browser afterward; it does not modify live Firebase data.

The full regression run passed 103 of 105 tests. The two failures are in the unchanged `server/tests/schedulePermissions.test.js` fixture, which does not mock `db.runTransaction` required by the existing schedule controller. Promo-specific and existing appointment checks passed; this unrelated fixture was left unchanged.

After deployment, verify with separate authenticated staff and customer sessions: activate, edit the Google Form URL, deactivate, and confirm the customer's already-open catalog and banner update. The automated checks use mocked Firestore/API data; live Firebase rules and deployment still need this check.
