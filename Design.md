# Design

From `tailwind.config.ts` and `app/globals.css`. `scripts/check-design.mjs` enforces the bans below and runs in CI.

## Tokens (as built)
Defined as RGB channels in `app/globals.css`, exposed through `tailwind.config.ts`. Dark is the default; a light set overrides them.

| Token | Dark | Use |
|---|---|---|
| `bg` | #0B0D12 | page background |
| `surface`, `surface-2` | #12151C, #1A1E27 | cards, raised areas |
| `border`, `border-strong` | #262B36, rgb(58 65 80) | dividers, inputs |
| `fg` | #E7E9EE | body text |
| `muted` | #8A91A0 | secondary text |
| `accent` / `accent-fg` | #F5A524 amber / dark text | primary actions |
| `data` | #22D3EE cyan | links, charts, data |
| `success`, `warning`, `danger` | green, amber, red | states |
| `role-*` | per-role tints | role badges only |

ASSUMPTION: the role colour `role-igl` (violet, 167 139 250) is a categorical data colour, not a brand gradient, so it does not break the "no purple gradients" ban. Revisit in Phase 3.

## Type and shape
- One sans family: Inter through `next/font` (`--font-inter`), `system-ui` fallback. Mono for numbers.
- Radius: `input` 8 px, `card` 10 px. ASSUMPTION: Phase 3 brings `card` to 8 px to match the single radius token.
- Motion: one 150 ms toast entrance. Nothing else animates.

## Components
Primitives in `components/ui/`: Button, Card, Dialog, Input, Label, Select, Slider, Table, Badge, RoleBadge, StatusBadge. Form helpers in `components/form/` (Banner, FieldError, SubmitButton). Route states in `components/shell/` (loading, error, empty panels). Every signed-in route has `loading.tsx` and `error.tsx`.

## Hard bans
`rounded-full` on buttons and inputs, purple or violet gradients, emoji as icons, em dashes in user-facing text, the phrases revolutionize, seamlessly, leverage, cutting-edge, game-changer, unleash and supercharge, placeholder text, "Made with" tags, fake metrics or counters, testimonials, cursor animation, parallax.

Public pages do not show `public_stats()`: it counts seeded demo rows.

## Tap targets and layout
Every link, button and field is at least 44 px (`h-11`, `min-h-11`, `min-w-11`). A checkbox's target includes its label. No horizontal scroll at 320, 375, 414, 768, 1024 or 1440 px. `scripts/check-ui.ts` measures all of this.

## Public shell
`PublicShell` is header, main and footer for public pages. `Wordmark` is the only logo and always links home. On phones the header links move into the native `<dialog>` in `components/ui/dialog.tsx`, which traps focus, closes on Escape and returns focus to the menu button.

## Auth form messages
- Field-specific problems render under the field (`FieldError`).
- Whole-form problems render in a `role="alert"` box above the form.
- Service outages use their own wording ("can't reach the sign-in service"), never "wrong password".
