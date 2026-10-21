# Business Pulse — Income & Expense Dashboard

A bright, mobile-first dashboard for small business owners to track income and
expenses. Built with plain HTML/CSS/JS — no build step, no dependencies.

**Live demo:** https://nitzaned-hash.github.io/dashboard_2_16.9.26/

See [spec.md](spec.md) for the full product spec.

## Running it

Open the [live demo](https://nitzaned-hash.github.io/dashboard_2_16.9.26/), or
just open [index.html](index.html) locally in any browser — there's no server
or build step required either way. Data is stored in the browser's
`localStorage`, so it persists between visits on the same device/browser but
isn't shared across devices.

A set of 25 sample transactions (9 income, 16 expense, spanning about three
months, including recurring rent/payroll/utilities) is seeded automatically
on first load so the dashboard isn't empty — edit or delete them freely,
they won't come back.

## Features

- **Add / edit / delete** income and expense transactions (amount, date,
  category, notes)
- **Default categories** (Sales, Services, Rent, Supplies, Payroll,
  Utilities, Marketing, Other), plus the ability to add your own from the
  transaction form
- **Recurring label** — tag a transaction as Weekly/Monthly/Yearly for
  reference (this does not auto-create future entries)
- **Dashboard overview**: total income, total expenses, net balance, an
  income-vs-expense trend chart, and a category breakdown donut chart, with
  hover/tap tooltips on both charts
- **Filtering** by date range (7/30/90 days, month, year, all time, or a
  custom range), category, and transaction type
- **Recent transactions feed** (card-style list, most recent 40)
- **All Transactions table** — a spreadsheet-style view (Date / Type /
  Category / Notes / Amount) of every transaction matching the current
  filters; click a row to edit it, same as the list above
- Currency formatting in ₪ (ILS)

## Design

- Bright, vibrant color palette; **no red anywhere** in the UI (including for
  negative balances, which use orange instead)
- Big, touch-friendly buttons and form fields (44px+ tap targets)
- Mobile-first responsive layout that scales up to a multi-column desktop
  layout at wider viewports
- Chart colors follow the data-viz accessibility method: fixed categorical
  color order, legends/labels on every chart (never color-only), and dark-mode
  variants of every color token

## Project structure

```
index.html   — page structure and markup
styles.css   — design tokens (light/dark), layout, components
app.js       — data layer (localStorage), chart rendering (canvas), UI logic
spec.md      — product spec
```

## Data & architecture notes

- `DataStore` and `CategoryStore` in [app.js](app.js) wrap all persistence.
  Nothing else in the app talks to `localStorage` directly — this is so a
  backend/cloud sync can be swapped in later (see spec.md's Future
  Considerations) without touching the UI code.
- The trend and category charts are drawn on `<canvas>` by hand (no charting
  library), with resize handling and hover/tap tooltips.

## Known limitations (by design, see spec.md)

- Single user, no login, no multi-device sync
- ILS only, no multi-currency support
- Recurring transactions are a label only, not an automatic engine
- No budgets/spending limits
