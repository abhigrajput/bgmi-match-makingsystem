# AI-Powered Skill-Based Multiplayer Team Matching & Squad Recommendation System

A BGMI-oriented prototype that groups players into squads by measured skill,
declared role preference, availability overlap, and post-match peer feedback,
rather than by queue order alone.

**Status: Phase 1 — architecture and foundation.** No authentication, no
database connection, no matchmaking logic, no model. The schema is written and
deliberately not applied.

---

## Table of contents

- [Problem](#problem)
- [Approach](#approach)
- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Project structure](#project-structure)
- [Getting started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Environment variables](#environment-variables)
  - [Running locally](#running-locally)
- [Database](#database)
  - [Schema overview](#schema-overview)
  - [Applying migrations](#applying-migrations)
- [ML service](#ml-service)
  - [Rule-based fallback](#rule-based-fallback)
- [Development](#development)
  - [Scripts](#scripts)
  - [Conventions](#conventions)
- [Roadmap](#roadmap)
- [Documentation](#documentation)
- [License](#license)

---

## Problem

<!-- Phase 1: see the landing page at / for the current statement. -->

## Approach

<!-- Phase 1: see the landing page at / for the current statement. -->

## Architecture

Browser → Next.js → Supabase, with a separate Python ML service called by
Next.js and a rule-based fallback for when that service is unavailable.

Full write-up, including the diagram and the reasoning for two runtimes:
[`docs/architecture.md`](docs/architecture.md).

## Tech stack

| Layer | Choice |
|---|---|
| Web | Next.js 14 (App Router), TypeScript |
| Styling | Tailwind CSS |
| Data | Supabase (Postgres + Auth) |
| ML | Python, FastAPI *(Phase 4)* |

## Project structure

<!-- Boundaries and the reasoning behind them: docs/architecture.md section 1. -->

```
app/                    routes, layouts, server actions
components/             presentational React
lib/                    clients, scoring, validation
types/                  shared TypeScript contracts
supabase/migrations/    ordered SQL, single source of schema truth
docs/                   design decisions
scripts/                seeding and maintenance
ml-service/             FastAPI service (empty in Phase 1)
```

## Getting started

### Prerequisites

<!-- TODO -->

### Installation

<!-- TODO -->

### Environment variables

Copy `.env.example` to `.env.local` and fill in the values. `.env.example`
contains names only and never values.

<!-- TODO: table of variables and where each is obtained -->

### Running locally

<!-- TODO -->

## Database

### Schema overview

Eight tables: `profiles`, `player_stats`, `player_preferences`,
`player_availability`, `matchmaking_queue`, `matches`, `match_participants`,
`match_feedback`.

ER diagram and per-table rationale: [`docs/database.md`](docs/database.md).

### Applying migrations

<!-- TODO. Note: 0001_init.sql has NOT been applied. -->

## ML service

<!-- TODO: Phase 4 -->

### Rule-based fallback

Matchmaking never depends on the ML service being reachable. When it is not,
Next.js scores squads in-process and records `matches.scoring_source =
'rule_based'`. See [`docs/architecture.md`](docs/architecture.md) section 4.

## Development

### Scripts

<!-- TODO -->

### Conventions

<!-- TODO -->

## Roadmap

| Phase | Scope |
|---|---|
| 1 | Structure, docs, unapplied schema, types, landing page |
| 2 | Auth, RLS, `updated_at` triggers, profile CRUD |
| 3 | Matchmaking queue, rule-based scorer, match lifecycle |
| 4 | FastAPI service, training pipeline, ML scoring path |

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — system context, runtime split, fallback path
- [`docs/database.md`](docs/database.md) — ER diagram, table-by-table rationale

## License

<!-- TODO -->
