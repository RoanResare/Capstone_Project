# Charming Assistant catalog audit

## Current data paths

- `shared/clinicalServices.mjs` supplies the selectable veterinary, vaccination, and laboratory service names. Laboratory package inclusions are stored there.
- `shared/groomingServices.mjs` supplies dog and cat grooming package names and dog size bands; it does not contain prices.
- `shared/bookingAdditions.mjs` supplies the required Doctor's Fee. `buildClinicalSelections` attaches it to vaccination bookings.
- `src/app/data/systemData.js` contains broad category summaries and ranges, not the detailed price catalog.
- `service_pricelists` is surfaced by the existing pricelist API as category images. It has no structured line-item prices for the chatbot to consume. Loading it for chat would add reads and still require image interpretation.
- The Groq system prompt was the only structured source of most exact prices. A 500-token response cap caused explicit long-list answers to end mid-catalog, and the prompt's Kapon prices were not connected to live promotion status.

## Discrepancies and handling

- The supplied cat-grooming pricelist reference says Basic ₱450 and Sanitary ₱550. The previous assistant prompt said ₱500 and ₱600. Those conflicting static rates were removed from chatbot answers; customers are directed to the published pricelist for current cat rates. No database or business price was changed.
- The previous prompt supplied fixed Kapon registration and procedure prices without checking active promotion status. Those amounts were removed from chatbot answers. The assistant now directs customers to the current Low-Cost Kapon promotion or clinic staff.
- Wound Cleaning appears in the veterinary list and the separate ala carte list with different prices. Both entries remain in their existing categories; they are not merged.
- The required Doctor's Fee remains a separate booking addition attached to vaccination selections, matching the current booking implementation. No booking rule changed.

No Supabase reads, writes, schema changes, environment variables, or new external services were added. Exact catalog answers still use the existing Groq knowledge context for structured prices that do not have an application data source; extending prices beyond that safely requires structured catalog data to be approved and maintained separately.
