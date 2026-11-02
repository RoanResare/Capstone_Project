# User-entered text validation

`shared/textModeration.mjs` is the single lightweight rule-based policy used by the browser and backend. It normalizes Unicode compatibility forms, combining marks, zero-width characters, common Cyrillic/Greek lookalikes, repeated letters, separators, selected punctuation masks, and common leetspeak. It flags explicit profanity, Filipino/Taglish abuse, discriminatory slurs and attacks, targeted harassment, and direct threats. It does not rewrite submitted text or log the submitted value. The frontend displays one generic field error and clears that field's error as the user edits it; APIs repeat validation and return `INVALID_TEXT` plus field names.

## Audited editable text and write paths

- Account names and user-chosen usernames: customer registration and availability checks, customer profile edits, employee create/update, and authenticated self-profile writes through the generic database endpoint. Emails, passwords, phone numbers, and machine-generated account IDs are excluded.
- Pet names, custom breeds, and notes: customer pet profile form, Admin/Staff pet notes, booking snapshots, and `/auth/pets/:id`. Existing visit/medical history controls are read-only and their records are not rewritten by validation.
- Appointment pet names and notes when newly submitted or changed, plus Admin/Staff rejection/cancellation explanations and changed reason fields: `/auth/appointments/:id` validates before committing. Fixed structured decision categories and service IDs are not treated as prose.
- Promotion title and description: Admin/Staff promotion form and promotion API. Google Form URL and start/end values are excluded.
- Admin/Staff pet-photo moderation notes and employee fraud reasons: their existing authenticated API handlers validate these optional free-text values.
- Customer chatbot messages remain on the existing conversational safety path. No profanity validator blocks pet emergencies, identity questions, or mental-health/self-harm discussion. The existing Groq instructions now ask for brief supportive guidance when a customer signals self-harm or immediate danger.

The audit found no separate editable customer-feedback/review form or endpoint. Address fields are not present in the current signup/profile forms. Search, login identifiers, dates, numeric inputs, URLs, passwords, OTPs, tokens, photo data, and generated IDs remain outside moderation. No new database reads, tables, columns, indexes, triggers, migrations, external moderation services, or dependencies were added; existing saved records are not bulk scanned or changed.
