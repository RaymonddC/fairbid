# FairBid design system

How screens look. Read this before building or changing one, so screens made by different people (and different
Claude sessions) look like one product. The tokens live in `src/app/globals.css`; shared components in
`src/components/ui.tsx`.

## 1. Feel

A working tool for a small buyer and an overseas seller. The app is dark only: indigo night, not grey. There is no
light theme and no theme switch. A tender is paperwork, so the app looks like paperwork: sheets with sharp corners on
a dark desk, a print serif for headings, ruled notes and ledgers instead of rows of KPI cards, and one ink stamp for
the decision. The one light thing is the paper tender sheet on the sign-in page, lying on the indigo desk. Not a
generic SaaS dashboard: no glows, no gradients, few pills. Money and states are the content, so they get the
contrast; chrome stays quiet. Motion only shows what changed. All copy is English.

## 2. Colour roles

Use the token, never the hex. The tokens hold the one dark theme (`:root` in `globals.css`, `color-scheme: dark`).

| Token | Value | Role |
|---|---|---|
| `canvas` | `#0b0e1a` | The page: the desk the sheets lie on |
| `surface` | `#121628` | A sheet: cards (`Panel`), inputs, menus |
| `raised` | `#171c31` | A surface inside a surface |
| `ink` | `#eceef6` | Body text |
| `muted` | `#a0a6bc` | Labels, secondary lines |
| `faint` | `#8a91ab` | Small print. The faintest text allowed (5.7:1 on the surface) |
| `line`, `line-strong` | `#232842`, `#323856` | Hairlines; borders of secondary buttons |
| `dye` (+ `-hover`, `-soft`) | `#8c9bff` | Indigo, Sari's dye: the primary action, links, focus, the winning bid |
| `brand` | `#2e3fa3` | The logo tile only |
| `sun` (+ `-soft`) | `#f0b94a` | Turmeric: the logo seal, and money still held |
| `ok` | `#4cc38a` | Paid, done, inside budget |
| `warn` | `#e8b04b` | Needs the person: waiting, late, over budget |
| `flag` | `#f07a5f` | Wrong or suspicious: collusion flags, errors, destructive actions |
| `duty` | `#e3a43a` | Duty in cost bars |
| `chart-1`, `chart-2` | `#7484ea`, `#b98022` | Paid to sellers; still held |

Each semantic colour has a `-soft` wash for backgrounds; put the strong colour on text over its own wash.
Keep `flag` for what is wrong, never decoration.

## 3. Type

A tender is a document, so the type reads like one. **Newsreader** (a print serif) for page and section headings
(`h1`, `h2`, the `font-display` class), **IBM Plex Sans** for everything else, **IBM Plex Mono** only for identifiers
(tender, authorization and capture IDs: the `.ref` class). Body 14.5px. Headings weight 600, balanced wrapping;
serif headings track -0.01em, sans `h3` -0.02em. Most UI text is `text-sm`; labels and
small print `text-xs`. Money and counts use `.num` (tabular figures). Sentence case everywhere.

## 4. Components

Use these before writing new markup.

- **`Panel`**: a sheet of paper. Hairline border, a short shadow, 4px corners (the `.notice` class sets them), 20px padding. `featured` adds a thin indigo line
  on top: only for the recommended or winning bid, at most one per screen.
- **`Button`**: `primary` (indigo, the screen's main action), `secondary` (bordered), `danger` (red text, bordered).
  `loading` shows a spinner and blocks clicks while a request runs; use it for every PayPal call. `linkButton` gives
  a link the same look. At least 40px tall. Labels say what happens: "Close bidding", "Pay 30%", never "Submit".
- **`.stamp`**: the decision, inked like a stamp on a tender: "Best delivered" on the recommended bid, "Awarded" once
  awarded. Indigo double rule, slightly turned. One per screen; it replaces a pill for that bid.
- **`Pill`**: a status label, soft wash with strong text. `dot` marks live states (open, waiting, held).
- **`SectionTitle`**: a quiet heading inside a page, with optional context on the right.
- **`StatusPill`**, **`Stepper`**: the tender's state and where it is in the steps.
- **`Avatar`**: people get illustrated faces; organisations keep initials.
- **Toasts** (`Toaster`, sonner): the result of an action. Errors say what to do next.
- **Grids** (`BidGrid`, `TransactionsGrid`, AG Grid): for comparing many rows. Short values do not wrap.
- **`Confirm`**: anything that moves money or cannot be undone asks first, and says the amount.

## 5. Layout

Content max width 1200px, gutter 16px on phones and 32px from `sm`. Cards stack with even gaps; dense inside a
card, generous between cards. The top nav wraps under the logo below `md`. Every screen works at 375px wide with no
sideways page scroll; wide grids scroll inside their card.

## 6. Motion

Functional only: bars grow to their new width, new content fades in (200ms), dialogs fade (150ms). Skeletons while
loading. `prefers-reduced-motion` turns it all off; keep new animations under that rule.

## 7. Do and don't

Do:
- Put the number in a sentence: "EUR 2,540 held for Sari until delivery".
- Show money in the tender's currency with `formatEur`, from integer cents.
- Keep one primary button per screen.
- Write labels in the buyer's and seller's words.

Don't:
- No hard-coded colours, no new fonts, no gradients or glows anywhere.
- No word "escrow", and no button or copy that suggests a void or refund.
- No coloured stripes down the side of boxes, no all-caps labels.
- No pure black text, no pure white page.

## 8. Prompt for an agent

"Build it in FairBid's system: tokens from `globals.css` (dark only: canvas page, `Panel` sheets with a hairline, indigo `dye` for the one primary action and links, `ok` / `warn` / `flag` only for meaning), IBM Plex Sans with
tabular figures for money, Newsreader for headings, IBM Plex Mono for IDs, `Button` / `Pill` / `SectionTitle` from `ui.tsx`, sentence case,
labels that say what happens, works at 375px."
