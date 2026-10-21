# Project instructions — Business Pulse dashboard

## Workflow: always commit, push, and document

After making any code change in this project (new feature, fix, refactor,
style change, etc.), always do all three of the following as part of
finishing the task — do not wait to be asked each time:

1. **Document the change.**
   - Update [README.md](README.md) if the change affects features, usage,
     setup, or project structure.
   - Update [spec.md](spec.md) if the change affects the product spec
     (scope, features, design rules like "no red").
   - Keep docs in sync with the code in the same turn as the change, not as
     a follow-up.
2. **Commit.** Use a descriptive commit message (what changed and why, not
   just "update files"). Stage only the relevant files.
3. **Push** to `origin master` right after committing, so the GitHub repo
   ([nitzaned-hash/dashboard_2_16.9.26](https://github.com/nitzaned-hash/dashboard_2_16.9.26))
   never drifts far from local work.

This authorizes routine commit + push for this project's own repo without
asking each time. Still check in first for anything destructive or unusual:
force-push, rewriting history, deleting branches, or pushing to any remote
other than `origin`.

## Repo facts

- Remote: `origin` → `https://github.com/nitzaned-hash/dashboard_2_16.9.26` (public —
  switched from private so GitHub Pages could be enabled on the free plan)
- Live site: https://nitzaned-hash.github.io/dashboard_2_16.9.26/ (GitHub
  Pages, served from `master` / `/`). Pages auto-redeploys on every push to
  `master`, so no extra step is needed after a normal commit + push.
- Default branch: `master`
- `.claude/` is gitignored (local dev-preview config with machine-specific
  paths) — never force-add it.
- No build step: `index.html`, `styles.css`, `app.js` are hand-written,
  plain, dependency-free. Keep it that way unless asked otherwise.
- Airtable mock data lives in the "Mock Data" base (`appYFa7UObm82c5t9`),
  table "Transactions" (`tblxeZl6jQP11A6xM`), via this session's Airtable
  MCP connector — not a token pasted by the user. Fields: Date, Type
  (Income/Expense), Category, Notes, Amount, Recurring (None/Weekly/
  Monthly/Yearly). The dashboard's optional client-side Airtable sync
  (see README.md) defaults its Base ID/Table ID fields to these IDs.
  **Never commit a real Airtable token to this repo or hardcode one into
  app.js/index.html** — it's a public repo; the whole design keeps the
  token out of the published code and in the user's own browser storage
  only. If asked to "connect" another external service to this live site,
  raise the same client-side-secret-exposure concern before implementing.
