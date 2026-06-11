# Batch Sells — Design

**Date:** 2026-06-11
**Status:** Approved for planning

## Goal

Replace the current one-tap, one-person charge flow (with automatic first-time
pricing) with a **batch "New sell"** flow: the user names the expense, adds the
people who bought, sets each person's price, and creates a single Splitwise
expense for the whole sell.

## Summary of changes

- **Remove** the "first time" feature entirely (the automatic 390 price for a
  person's first-ever burrito, and everything that supports it).
- **Remove** the per-person saved-default-price feature (localStorage custom
  prices). All prices in the builder default to the regular price and are edited
  inline.
- **Add** a "New sell" builder: a title field, a buyer picker, a per-person
  editable price, and a "Create sell" action.
- A sell maps to **one** Splitwise expense: the user paid the total, each added
  person owes their own price.
- The app gains a third tab. Tabs become **Sell · People · History**.

## Splitwise mapping

One sell → one `create_expense` call:

- `description` = `🌯 ` + the title the user typed (see Detection below).
- `cost` = sum of all per-person prices.
- User 0 = the current user (you): `paid_share` = total, `owed_share` = `0.00`.
- Users 1..N = each buyer: `paid_share` = `0.00`, `owed_share` = their price.

Example — title "Burritos Friday", Ana 440, Beto 440, Caro 410:

```
Splitwise expense "🌯 Burritos Friday"  cost 1290
  You   paid 1290  owed 0
  Ana   paid 0     owed 440
  Beto  paid 0     owed 440
  Caro  paid 0     owed 410
```

"Mark paid" (settle) is unchanged — it still records a settle-up payment from one
person to you for their full balance.

## Detection marker

History and stats currently recognize burrito expenses by
`description.includes("Burrito")`. With user-typed titles that no longer holds, so
detection switches to the **`🌯` emoji prefix**:

- Every sell is stored as `🌯 <title>`.
- `isBurrito(e)` becomes: not a payment, and `description` starts with `🌯`.
- Backward compatible: existing `🌯 Burrito` expenses still match.
- If the user leaves the title blank, default it to `Burrito`, so the stored
  description is `🌯 Burrito`.
- For display, strip a leading `🌯 ` (and bare `🌯`) from the description.

## API changes

### New: `api/sell.js`
- `POST` with body `{ title: string, items: [{ userId: number, price: number }] }`.
- Validation: at least one item with `price > 0`; otherwise `400`. Items with
  non-positive price are dropped; if none remain, `400`. Title trimmed; blank →
  `"Burrito"`.
- Builds the `create_expense` form: user 0 = `currentUserId()` paying the summed
  total, users 1..N = each buyer owing their price (`users__<k>__...`, k = 1..N).
- Each cost field formatted to 2 decimals; total = sum, also 2 decimals.
- Returns `{ ok: true, total: number, count: number }` (count = number of buyers).
- Reuses the same `errors` check and `handler()`/PIN wrapper as the old charge.

### Removed: `api/charge.js`
Deleted — replaced by `sell.js`. No other server file imports it.

### `api/config.js`
- Drop `firstTimePrice` from the returned object.

### `api/_splitwise.js`
- `cfg()`: drop `firstTimePrice` / `FIRST_TIME_PRICE`.
- `isBurrito`: change to the `🌯`-prefix test described above.

### `api/members.js`
- Drop `firstTime` and the `everCharged` computation.
- `basePrice` becomes simply `c.defaultPrice` (or drop `basePrice` and let the
  client use the config default — see Frontend). Keep `id`, `name`, `picture`,
  `owes`.

### `api/history.js`
Currently assumes one buyer per expense. With batch sells an expense has many.
New semantics:

- **Stats count** (`Today (N 🌯)` / `All time (N 🌯)`): N = total **people
  charged** = count of `owed_share > 0` entries across all burrito expenses (so a
  3-person sell counts as 3 burritos). Totals = sum of expense `cost`.
- **`todayCount`** = people charged today; **`totalCount`** = people charged
  all-time.
- **History rows**: one row per sell (expense), returning
  `{ id, title, total, count, date }` where `title` is the description with the
  `🌯 ` marker stripped, `total` = expense cost, `count` = number of buyers.

## Frontend changes (`src/App.jsx`, `src/api.js`)

### Tabs
`Sell · People · History` (replacing `Charge · History`). Default tab = `Sell`.

### Sell tab — the builder
- **Title** text input (placeholder e.g. "What's this sell?").
- **Add buyers**: a control that opens a searchable member picker (reuse the
  existing search + person-row styling). Selecting a person adds them to the sell;
  already-added people are excluded or shown checked.
- **Selected list**: each added person shows name, an editable numeric price
  (prefilled with the regular `defaultPrice` from config), and a remove (×).
- **Create sell** button shows the running total: "Create sell — $<total>".
  Disabled until ≥1 buyer with price > 0. On success: clear the builder, toast
  "Sold N 🌯 — $<total>", and (if People/History are showing) data refreshes on
  next view.
- Calls `api("sell", { method: "POST", body: { title, items } })`.

### People tab — balances + settle
- The existing member list (name, avatar, owes / all-settled).
- Tapping a person opens a sheet with **Mark paid** only (clears their balance via
  the unchanged `settle` endpoint). No price field, no charge button, no custom
  default price.

### History tab
- Stats cards unchanged in shape; values now reflect people-charged counts.
- Rows show the sell **title**, total, and a sub line like "N people · <date>"
  instead of a single person's name.

### `src/api.js`
- Remove `loadCustomPrices` / `saveCustomPrice` and the `burrito_custom`
  localStorage usage (custom default prices are gone).
- Keep `api`, `getPin`, `setPin`, `money`, `initials`.

### Removed UI
- `ChargeSheet` (price + charge + custom-default-price) is removed; its
  Mark-paid piece moves to the People sheet.
- All "first burrito" / "1st" tags and `firstTime` references in components.
- `SettingsSheet`: drop the "First-time" figure from the displayed line.

## Tests (`api.test.mjs`)

- Update the mock `create_expense` to accept an arbitrary number of users
  (`users__0..users__N`) instead of exactly two, so a batch sell is recorded
  correctly.
- Replace first-time assertions:
  - members no longer carry `firstTime` / first-time `basePrice`.
  - Remove the charge-endpoint tests; add `sell` tests: a multi-person sell
    creates one expense, total = sum, each buyer owes their price, and the
    description starts with `🌯`.
  - History test: a 3-person sell increments the people-charged count by 3.
- Keep config/groups/members(self-excluded, owes)/settle/PIN tests, adjusting for
  removed fields.
- Drop `FIRST_TIME_PRICE` from the test env setup.

## Config / docs

- `.env.example` and README: remove `FIRST_TIME_PRICE` and all first-time
  references; update the "How charges map to Splitwise" section to describe
  batch sells (one titled expense, multiple owers) and the `🌯`-prefix detection.

## Out of scope

- Editing or deleting a sell after creation (done in Splitwise directly).
- Splitting a single item's cost across people (each person has their own price).
- Server-side persisted prices or per-person defaults.
