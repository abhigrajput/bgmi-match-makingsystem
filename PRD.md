# PRD: SquadSync

First draft, built from README.md and docs/ on 2026-10-30. Describes what exists; it does not add features.

## Problem
BGMI tournament squads are usually formed in queue order, which seats players with clashing skill, roles, comms or schedules together. SquadSync forms squads from skill, role coverage, comms, language and shared play hours, and explains every squad.

## Users
- **Player:** signs up, completes a profile (IGN, roles, region, skill band, comms, languages, weekly availability), registers for tournaments, sees squads and match history, rates teammates.
- **Organiser:** everything a player can do, plus forming squads for a tournament and resetting demo tournaments. Granted only by `scripts/set-organiser.ts` (0006).

## In scope (built)
| Area | What exists |
|---|---|
| Auth | Email + password signup and login, confirmation callback, invite acceptance, sign out |
| Profile | Profile, preferences and availability editors, completeness card |
| Tournaments | List, detail, register with optional role, withdraw while open |
| Matchmaking | One-click formation (organiser), synergy score, ML or rule badge, reasons, weakest link, unplaced players with blocking rule, optimiser vs rank-only comparison |
| Matches | History, detail, mark completed, teammate feedback |
| Leaderboard | Top 100, role and region filters, IGN search |
| Analytics | Distributions, role mix, active model metrics (aggregates only) |
| Landing | Public page with real counts from `public_stats()` |

## Out of scope
Payments, chat or WhatsApp buttons, per-tournament organiser ownership, OAuth providers, a separate ML service (removed, see Architecture.md).

## Success criteria
- A new user can sign up, sign in, reach the dashboard and sign out.
- Formation never seats a vetoed pair and is deterministic for the same registrations.
- Private data (preferences, availability) is readable only by its owner, enforced by RLS.

ASSUMPTION: the product name shown to users is "SquadSync" (README title). The repo/package name `squad-recommender` is internal.
ASSUMPTION: synthetic seed players (`auth_user_id IS NULL`) are demo data and must be labelled as such (master prompt, Phase 4).
