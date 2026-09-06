# ml-service

Python / FastAPI scoring service. **Empty placeholder in Phase 1.**

A sibling of the Next.js app rather than a subdirectory, because it is a
separate deployable with its own dependency manifest, lifecycle, and language
toolchain. The process boundary is visible in the file tree on purpose: nothing
in `app/` or `lib/` can import across it, because the import would not resolve.

Planned surface (Phase 4):

| Endpoint | Purpose |
|---|---|
| `POST /score-squad` | Score one proposed grouping |
| `POST /recommend` | Rank candidate squads for a queued player |
| `GET /health` | Liveness, used to decide the fallback in the web tier |

Until this exists, Next.js scores squads with the rule-based implementation in
`lib/` and records `matches.scoring_source = 'rule_based'`. See
`docs/architecture.md` section 4.
