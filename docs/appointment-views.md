# Appointment Views

## Customer

My Appointments displays three bookings per page, with previous/next controls. The status dropdown includes Pending, Approved, Completed, Rejected, Cancelled and Expired. Search matches pet, service, date and other booking information. Changing a filter or page updates the selected details; a filter with no matches displays an empty state rather than unrelated appointment details.

## Admin and Staff

The inline detail panel is replaced by a full-width appointment calendar above the bounded appointment list, following the supplied calendar reference. Month, Week and Day views support Today, previous and next navigation. Clicking a date opens its Day view. Calendar bookings use the requested status colors:

- Pending: amber.
- Approved: green.
- Completed: dark green.
- Rejected, Cancelled and Expired: red.

The calendar includes all appointments, independently of the list filter. Click an event or list booking to open a modal with its details, staff assignment and available actions. Pending bookings offer Approve, Reject and Cancel, with formal confirmation prompts. Back, Close and Escape dismiss the popup while preserving the list category and calendar position.

Only Pending list entries are sorted by scheduled date/time, earliest first, under date headings. Other categories retain their existing ordering.

Mark appointment completed is disabled for Pending and terminal statuses. Only Approved can be completed; the existing Accepted/Confirmed storage values count as Approved. The backend rejects attempts to mark other statuses completed. This supersedes the earlier rule permitting Pending completion.

## Changed Files

- `src/app/components/CustomerProfile.jsx`: status/search controls, three-item pagination and selection handling.
- `src/app/components/portal/PortalPage.jsx`: chronological Pending groups, calendar integration, popup details and status styling.
- `src/app/components/portal/AppointmentCalendar.jsx` and `appointmentCalendar.css`: FullCalendar views, event colors, navigation and responsive resizing.
- `src/app/utils/appointmentPresentation.js`: shared presentation, filtering, pagination and Pending grouping helpers.
- `src/app/utils/appointmentActions.js`: Approved-only completion policy.
- `src/app/routes.jsx`: preserve the appointment workspace when its selection query changes, preventing calendar resets.
- `server/src/controllers/appointment.controller.js`: enforce Approved-only completion.
- `package.json`, `package-lock.json`: FullCalendar 6 React/day-grid/time-grid/interaction dependencies.
- `package.json` and `server/package.json`: separate Static Site builds from backend-only builds so API deployment does not require browser `VITE_` variables.
- `tests/appointmentPresentation.test.mjs`, `tests/appointmentActions.test.mjs`, `tests/appointmentWorkspace.test.mjs`, `server/tests/kaponPromo.test.js`: presentation and action regressions.
- `tests/appointmentViews.browser.mjs`: customer pagination/search, Pending order, calendar views, popup actions, completion restrictions and desktop/mobile layout checks.
- `dist/`: refreshed production output.

## Verification and Deployment

58 targeted regression tests passed, including role routing, promo behavior and backend appointment validation. Desktop/mobile browser checks passed using isolated mocked data. Screenshots are in `artifacts/appointment-views/`; the browser check closes its own server and browser and never modifies live Firebase data.

Deploy both frontend and backend with the updated package manifests. No additional Firebase rule change is required for these view/action changes; appointment writes still go through the authenticated API. The earlier Kapon promo's rule changes remain necessary if that feature has not yet been deployed.

The local preview is available on port 5175. This implementation uses the existing Firestore subscriptions, so live appointment changes update the calendar and list through AppContext.
