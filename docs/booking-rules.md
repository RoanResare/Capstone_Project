# Booking Rules

- Each new grouped appointment contains one pet profile.
- Up to two different catalog services may be paired if they fit within 120 minutes. Laboratory Testing and Pet Grooming are explicitly disallowed together in either selection order. Duplicate services and more than two services are rejected.
- Add another service adds a second selection to the last pet's appointment. It no longer creates another appointment record.
- Add another pet creates a separate appointment. The existing two-booking account limit continues to apply.
- The service summary joins both service names so customer and staff appointment details display the complete booking.
- Estimated duration is the sum of the existing catalog durations. The backend recalculates this value instead of trusting the submitted number.
- An inactive Low-Cost Kapon promotion blocks Kapon whether it is the primary or secondary service. Weekend restrictions apply to every selected service.
- Every appointment reserves a fixed 120-minute block at 9:00 AM, 11:00 AM, 2:00 PM or 4:00 PM. Morning capacities remain 3; afternoon capacities remain 2. Submitted duration/capacity values cannot override this policy.
- The backend checks assigned staff against active appointments using the full reserved block. Conflicting assignments are rejected; adjacent blocks do not overlap.

## Validation and Existing Records

The same shared pairing and duration validation runs in the service selectors, frontend submit handling and backend booking transaction. A 120-minute pair fits; a longer pair must be booked separately. Existing records with a pairing that is now disallowed can still be cancelled or processed without changing their services/schedule. Changing those services or rescheduling applies the new rules.

## Files

- `shared/bookingServices.mjs`: service count/duplicate validation, single-pet validation, catalog duration totals and interval overlap checks.
- `src/app/components/AppointmentBooking.jsx`: grouped service controls, duplicate prevention, duration summary and one payload per pet.
- `src/app/context/AppContext.jsx`: validates grouped payloads and applies schedule restrictions to all services.
- `server/src/controllers/appointment.controller.js`: validates grouped bookings, recomputes duration, and enforces staff conflicts within the transaction.
- `tests/bookingServices.test.mjs`, `server/tests/kaponPromo.test.js`: validation, duration, promo and conflict regression tests.
- `tests/kaponPromo.browser.mjs`: checks second-service selection and confirms a paired booking sends one appointment payload.
- `dist/`: refreshed production build.

Legacy single-service records continue to work. Frontend and backend must both be deployed for the new grouping and enforcement.
