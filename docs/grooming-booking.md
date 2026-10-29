# Grooming appointments

Customer booking offers price-free checkboxes based on the selected saved pet profile:

- Dogs: Basic, Bath & Blowdry, Sanitary, Full Groom, Puppy Cut.
- Cats: Basic Grooming, Sanitary Grooming, Full Grooming.
- Both species: Nail Clipping, Ear Cleaning, Anal Sac Expression, Face Trim, Paw Pad Trim, Poodle Feet, Tummy & Butt Trim, Wound Cleaning, Toothbrush.

Choose exactly one grooming service OR one or two à la carte services. A grooming selection disables every other checkbox; an à la carte selection disables grooming options, and a second à la carte choice disables the remaining à la carte options. Checked options remain enabled so customers can uncheck them and switch groups. Changing pets clears all grooming selections. Grooming for other species is unavailable. Saved weight may supply a dog size label but is no longer needed to determine prices or make a booking.

The shared grooming model validates counts, duplicates, mutually exclusive categories and species in both the browser and API. The server reads the saved pet document, checks customer ownership, and builds canonical service names from selected IDs instead of trusting submitted names or prices. New appointment grooming data contains serviceIds, services (id/name/category), name, petType and size. No grooming price is stored. Legacy single-service records remain readable and can be approved without requiring rebooking.

Admin and staff see the selected grooming services in the appointment heading. The duplicate Requested grooming services panel and repeated service row were removed. Customer summaries and appointment service labels include the selected services. Pending-to-approved updates preserve these details.

Validation covers the complete species catalogs, rejected mixed/duplicate/oversized selections, canonical server persistence, approval preservation, admin/staff detail rendering, and desktop/mobile booking interactions. The browser fixture mocks authentication, app data and pricelist content; it checks UI behavior and submitted payloads without creating live appointments.
