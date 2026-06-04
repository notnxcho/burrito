# 🌯 Burrito Charger (React + Vercel)

Charge coworkers for burritos and push each sale straight into your shared **Splitwise**
group. Search a person, tap, done.

- React (Vite) frontend + Splitwise calls handled by **Vercel serverless functions** in `/api`
  (the token can't live in the browser, and Splitwise blocks direct browser calls).
- Regular burrito **440**, first-ever burrito for a person **390** (automatic).
- Per-person custom default price (saved on your device).
- Running balance per coworker · **Mark paid** to settle someone up.
- Purchase history + today / all-time sales · phone + desktop · optional PIN lock.

## Stack / layout

```
index.html, vite.config.js      Vite app entry
src/        App.jsx, api.js, styles.css, main.jsx
api/        config.js members.js charge.js settle.js history.js groups.js  (+ _splitwise.js)
```

## Deploy on Vercel (~5 min)

1. Get a Splitwise API key at **https://secure.splitwise.com/apps** → Register your
   application → copy the API key.
2. Push this folder to GitHub, then import it at **https://vercel.com → Add New → Project**.
   Vercel auto-detects Vite (build `vite build`, output `dist`) and serves `/api/*` as functions.
3. In **Settings → Environment Variables** add:
   - `SPLITWISE_TOKEN` — your API key *(required)*
   - `SPLITWISE_GROUP_ID` — your burrito group's ID *(required)*
   - `APP_PIN` — e.g. `1234` *(optional, recommended — the URL is public)*
   - `CURRENCY=UYU`, `DEFAULT_PRICE=440`, `FIRST_TIME_PRICE=390`
4. **Don't know your group ID?** Deploy with just `SPLITWISE_TOKEN`, open the app — it lists
   your groups and their IDs. Copy the right one into `SPLITWISE_GROUP_ID` and redeploy.
5. Open the URL, add it to your phone's home screen, start charging.

## Local development

```bash
npm install
npx vercel dev      # runs the /api functions + Vite together on http://localhost:3000
```

(Or `npm run dev` for the UI only; it proxies `/api` to a `vercel dev` on :3000.)
Put your env vars in a local `.env` (see `.env.example`).

## How charges map to Splitwise

Each burrito creates an expense where **you paid** and the **coworker owes** the full amount,
so their Splitwise balance goes up. "Mark paid" records a settle-up payment from them to you.
Burrito expenses are named `🌯 Burrito` — that's how sales are counted and how a person's
first-ever burrito (→ 390) is detected. Balances and history come straight from Splitwise.

## Config reference

| Variable | Default | Meaning |
|---|---|---|
| `SPLITWISE_TOKEN` | — | Splitwise API key (required) |
| `SPLITWISE_GROUP_ID` | — | Your group's ID (required) |
| `CURRENCY` | `UYU` | Splitwise currency code |
| `DEFAULT_PRICE` | `440` | Regular burrito price |
| `FIRST_TIME_PRICE` | `390` | First-burrito price |
| `APP_PIN` | — | Optional PIN to use the app |
