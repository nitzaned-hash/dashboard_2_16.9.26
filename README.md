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
- **Optional Airtable sync** (⚙️ in the top bar) — see below
- **Competitors tab** — a second screen showing competitor ratings and
  customer reviews scraped with Apify — see below
- **Live exchange rates** — an external public API (Frankfurter) feeds an
  Overview panel: today's ILS rates, a 30-day USD/ILS trend, and the net
  balance converted to USD/EUR/GBP — see below
- Currency formatting in ₪ (ILS)

## Airtable sync (optional)

The gear icon in the top bar opens **Airtable Sync** settings. This is
entirely opt-in and off by default; nothing calls Airtable unless you connect
it yourself.

- Paste your own Airtable **personal access token**, plus a base ID and
  table ID (the table ID field defaults to the `Transactions` table the
  project was built against). Connecting doesn't verify credentials until
  you first sync or edit a transaction.
- Your token is saved **only in your browser's `localStorage`**. It is never
  written into `app.js`, `index.html`, or committed to this repo — the repo
  itself contains no real token, only the client-side code that reads one if
  you supply it.
- Once connected, adding, editing, or deleting a transaction in the
  dashboard also pushes that change to Airtable (best-effort — if the
  request fails you still keep your local change, with a toast telling you
  the sync failed).
- **Sync now** pulls every record from the configured Airtable table: rows
  it recognizes (by a stored Airtable record ID) are updated locally, new
  ones are added. It does not delete local rows that were removed on the
  Airtable side — that's a known limitation, not a bug.
- **Why isn't this wired up by default?** This dashboard is a public static
  site (GitHub Pages) with no backend. Any token baked into the published
  `app.js` would be visible to every visitor via view-source or the network
  tab. Keeping the token client-side-only, pasted by you into your own
  browser, avoids ever publishing a real credential.

## Exchange rates (external public API)

The Overview shows a live **Exchange rates** panel powered by the free
[Frankfurter API](https://frankfurter.dev) (European Central Bank reference
rates; listed in [public-apis](https://github.com/public-apis/public-apis)).

- Calls: `GET https://api.frankfurter.dev/v2/rates?base=ILS&quotes=USD,EUR,GBP`
  for today's rates and `...?from=<30 days ago>&to=<today>&base=USD&quotes=ILS`
  for the trend (see [rates.js](rates.js)).
- **No API key or token** is needed and the API allows cross-origin requests,
  so it is called straight from the browser — nothing secret exists to leak
  from this public repo.
- The net balance for the currently selected period (shown in the cards) is
  converted to USD / EUR / GBP and updates when the period or filters change.
- If the API is unreachable the panel shows "Exchange rates are unavailable"
  and the rest of the dashboard keeps working.

## Competitor Watch (Apify)

The **Competitors** tab is a market-research screen: it shows how competing
businesses are rated on Google Maps and what their customers praise or
complain about. The data is collected by an [Apify](https://www.apify.com)
**Google Maps Scraper** actor and shown as summary cards, a rating-by-competitor
bar chart, a complaints/praise review feed, and a table of all competitors.

Two ways to feed it:

- **Snapshot (works for everyone, no token):** export the Apify dataset as
  JSON and save it as `data/competitors.json`. The live site then shows it
  to every visitor (badge: *Apify · snapshot*). When exporting, pick only the
  fields you need (`title`, `totalScore`, `reviewsCount`, `categoryName`,
  `address`, `website`, `url`, and review `text` / `stars` /
  `publishedAtDate`) so reviewer names and other personal data don't end up
  in this public repo.
- **Live (optional, your browser only):** in **Apify settings** paste your own
  Apify API token and the dataset ID (Apify console → the run → Storage).
  Like the Airtable token, it is saved **only in `localStorage`**, never in
  the code or repo, and is sent only to `api.apify.com`. Use a token with
  limited permissions where possible (badge: *Apify · live*).

What the screen shows depends on what the scraper collected:

- **Always:** competitors tracked, cities covered, how many have a website,
  most common category, a "market map" (businesses per category and per city)
  and a table of all competitors with Website / Map links.
- **Only if the data has them:** average rating, total reviews, top rated, a
  rating-by-competitor chart and the complaints/praise review feed. These
  parts are hidden automatically when the dataset has no `totalScore` /
  `reviews` (e.g. a cheap run with reviews switched off).

The committed `data/competitors.json` is an Apify Google Maps export of 16
ceramics businesses in Israel. It contains only business name, categories,
city, website and map link (street addresses and internal IDs were removed).

All scraped text is rendered with `textContent` (never `innerHTML`), and
website/map links are only rendered if they are `http(s)` URLs.

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
index.html       — page structure and markup (Overview + Competitors views)
styles.css       — design tokens (light/dark), layout, components
app.js           — data layer (localStorage), chart rendering (canvas), UI logic
competitors.js   — Competitors tab: Apify data (live or snapshot) and its rendering
rates.js         — Exchange-rates panel: Frankfurter public API (no key)
data/            — optional competitors.json snapshot exported from Apify
spec.md          — product spec
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
