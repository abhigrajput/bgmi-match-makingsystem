# Presentation outline (15 slides)

Visuals refer to `docs/screenshots/` and the diagrams in `docs/architecture.md`
and `docs/database.md`. Numbers are from `docs/ml-results.md` and
`docs/verification.md`.

**1. Title**
- SquadSync: AI tournament squad matchmaking for BGMI
- Abhishek GR · Shivakumar SH · Aishwarya YH · Aniketana SD
- Guide: Dr. Vishwanath K · KLE Institute of Technology, Hubballi
- *Visual:* landing page hero (`01-landing.png`)

**2. The problem**
- Squads formed by queue order or a single rating
- Four players, same rank, same role, no shared language or hours
- "The rating matched; nothing else did"
- *Visual:* four identical sniper icons with mismatched clocks

**3. Objectives**
- Player as a vector, not a number
- Explainable compatibility with hard constraints
- Optimiser measurably better than rank-only
- Model trained on peer feedback, no leakage
- *Visual:* objectives checklist

**4. Literature**
- Elo, Glicko, TrueSkill / TrueSkill 2: skill estimation
- Delalleau et al. 2012: matchmaking for enjoyment, not just balance
- Recommender systems; logistic regression; ROC-AUC; data leakage
- *Visual:* timeline of rating systems

**5. Architecture**
- Browser → Next.js on Vercel → Supabase Postgres (RLS)
- Scoring engine + model inside the web tier, one runtime
- Offline scripts: seed, train, verify
- *Visual:* architecture mermaid diagram

**6. Data model and security**
- 11 tables, 23 RLS policies, definer view for public role only
- Preferences and schedules private to their owner
- *Visual:* ER diagram

**7. Pair compatibility**
- 7 weighted components: skill, role, hours, comms, language, region, teamwork
- 3 hard vetoes force score 0
- UTC minute-of-week availability overlap
- *Visual:* formula + role matrix heat map

**8. Squad optimiser**
- Greedy fill in registration order with role-coverage bonus
- Swap improvement, ≤200 iterations, never creates a veto
- Deterministic; every unplaced player gets a reason
- *Visual:* squads with reasons (`08-squads-with-reasons.png`)

**9. Synthetic data, honest labels**
- 200 players with hidden latents; database stores noisy observables
- Labels from latents, features from observables
- Toxicity: affects ratings, not observable
- *Visual:* latent → observable → feature diagram

**10. The model**
- Logistic regression, 8 features, match-grouped split
- Serving: 0.7 × model + 0.3 × rules, vetoes first
- *Visual:* feature importance bars

**11. Model results**
- AUC 0.783 vs rule 0.723 vs rank-only 0.739 vs majority 0.500
- CV AUC 0.804 ± 0.014
- Availability and region ≈ 0 weight — matches how labels were generated
- *Visual:* metrics table from `/analytics` (`12-analytics.png`)

**12. Optimiser vs rank-only**
- 0 vetoed pairs vs 17
- Squad score 95.1 vs 76.9; role coverage 96% vs 89%
- Rank-only wins rating spread — by construction
- *Visual:* comparison tab (`09-comparison.png`)

**13. Product walkthrough**
- Register → form squads → reasons → match → feedback
- Leaderboard, analytics, mobile layout
- *Visual:* dashboard + mobile (`03-dashboard.png`, `13-mobile-dashboard.png`)

**14. Testing and quality**
- 81 unit tests, 24 catalog checks, 36 end-to-end checks incl. RLS attacks
- CI: typecheck, lint, test, build on every push
- *Visual:* terminal output of the test run

**15. Conclusion and future work**
- Constraint-aware formation beats rating-only grouping
- Next: real feedback, organiser role, squad-level models
- Live: bgmi-match-makingsystem.vercel.app
- *Visual:* QR code to the live URL
