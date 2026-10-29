# Compact UI review

The existing teal, cream, gold branding and layouts are preserved. No root font-size reduction, CSS zoom, or layout scaling is used.

- Shared type utilities: body 14px, text-sm 13px, labels 12px, section headings 18–22px. Root remains 16px.
- Shared app-card utility: 16px mobile / 20px wider padding, 16px radius, subtle existing-palette border.
- Reduced large panel padding, section gaps, form/button padding, and authentication hero heights.
- Customer and staff desktop sidebars are 216px. Customer navigation uses two columns on narrow screens.
- Service cards size naturally on phones and align in equal-height desktop grids.
- Mobile text inputs remain 16px and coarse-pointer controls retain a 44px minimum height.

## Validation

Production build passed. dist was copied to server/dist so the local backend serves the current bundle.

18 browser checks at device scale factor 1, with widths 390, 768, and 1440: homepage, login, signup, customer overview, services, and profile. No horizontal page overflow or page errors were observed. Dashboard screenshots use an isolated fixture with no authenticated account or booking writes; staff portal changes were reviewed in source and compiled.

The syntax-tree comparison across 22 edited React components found no non-styling changes. Backend, API clients, authentication context, routes, and booking handlers are unchanged.

Screenshots: dashboard-overview-1440.png, dashboard-services-390.png, dashboard-signup-1440.png, dashboard-signup-390.png. Structured viewport results: responsive-results.json.
