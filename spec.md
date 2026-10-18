# Expense & Income Dashboard — Spec

## Overview
A dashboard for small business owners to track expenses and income. Must work well on both mobile and desktop.

## Target Users
Business owners who need a quick, clear view of money coming in and going out — not accountants, so the UI should stay simple and approachable. Single user, no team/multi-user accounts.

## Platform & Tech
- Responsive web app, mobile-first layout that scales up to desktop
- Touch-friendly on mobile, mouse-friendly on desktop
- Built with plain HTML/CSS/JS (no framework, no build step)
- No login/authentication — single user, opens straight into the dashboard

## Data Storage
- Local-first: data stored in the browser (e.g. localStorage) for now
- Designed so a backend/cloud sync can be added later without a full rewrite (keep data access behind a simple data-layer abstraction)

## Currency & Locale
- Default currency: ILS (₪)

## Visual Style
- Bright, vibrant color palette
- Big, easy-to-tap buttons
- **No red anywhere in the UI** (not for errors, losses, alerts, or decoration — use alternatives like orange, purple, or dark amber for warnings/negative values)

## Core Features

### Transactions
- **Income tracking**: add, edit, delete income entries (amount, date, category, notes)
- **Expense tracking**: add, edit, delete expense entries (amount, date, category, notes)
- **Default categories** (editable by user): Sales, Services, Rent, Supplies, Payroll, Utilities, Marketing, Other
- **Recurring flag**: a transaction can be tagged as Weekly / Monthly / Yearly for reference only — no automatic creation of future entries (simple label, not an engine)

### Dashboard Overview
- **Big number summary cards**: total income, total expenses, net balance for the selected period
- **Income vs. expense trend chart**: line/bar chart over time (by week/month)
- **Category breakdown chart**: pie/donut split of income or expenses by category
- **Recent transactions feed**: scrollable list of latest entries
- **Filtering**: by date range (day/week/month/year) and by category

### Actions
- Big "Add Income" and "Add Expense" buttons, prominently placed and easy to tap on mobile and desktop

## Non-Goals (for now)
- Multi-currency support (ILS only for now)
- Invoicing or payment processing
- Multi-user/team accounts or login
- Tax calculations
- Budget/spending-limit tracking
- Automatic recurring-transaction creation (flag only, not an engine)

## Future Considerations
- Backend/cloud sync and login, if multi-device access is needed later
- Budget goals per category
- Full recurring-transaction automation
