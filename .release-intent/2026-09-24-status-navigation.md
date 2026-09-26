---
impact: minor
type: feat
area: status
---

# Navigate adoptable leaves and clarify status controls

Improve External folder status navigation with a next adoptable leaf action,
filtered adoptable/total leaf counts and whole-branch tooltips. Put refresh at
the top, search above the legends, and navigation above folder details. Note
identity restrictions offer a shortcut to template exclusion settings.

Authority: explicit status-page navigation request; product intent's explicit
diagnosis and previewed adoption workflow; ADR-0032 and ADR-0033. Product intent
is unchanged. Availability continues to mean no known snapshot blocker, with
fresh adoption checks required.

Local validation on 2026-09-24: `npm test` (473 tests), `npm run lint`,
`npm run build`, and `npm run format:check` passed. The formatting check reported
a non-fatal incremental-cache write warning. Browser checks with synthetic data
covered filtered counts and whole-branch tooltips, navigation through collapsed
branches, disabled navigation under note restrictions, the settings callback,
and the stacked narrow layout. Live Obsidian integration was not run; the
settings-opening adapter was unit-tested with a manual-navigation fallback.
