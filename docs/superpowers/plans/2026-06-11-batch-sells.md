# Batch Sells Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-person tap-to-charge (with automatic first-time pricing) with a batch "New sell" flow that creates one titled Splitwise expense for multiple buyers.

**Architecture:** Vercel serverless functions in `/api` talk to Splitwise; a Vite/React SPA in `/src` calls them. A "sell" becomes a single `create_expense` (you paid the total, each buyer owes their price), tagged with a `🌯` prefix so history/stats can find it. The UI gains a third tab: Sell · People · History.

**Tech Stack:** React 18 + Vite, Node serverless handlers, Splitwise REST API, a hand-rolled integration test (`api.test.mjs`) run with `node`.

**Repo note:** This directory is NOT a git repo. There are no `git commit` steps — each task ends with a verification command (`node api.test.mjs` or `npm run build`).

**Spec:** `docs/superpowers/specs/2026-06-11-batch-sells-design.md`

---

## File Structure

**Server (`/api`):**
- `sell.js` — **new**. Creates one expense from `{title, items[]}`.
- `charge.js` — **deleted**. Replaced by `sell.js`.
- `_splitwise.js` — `cfg()` drops `firstTimePrice`; `isBurrito` detects the `🌯` prefix.
- `config.js` — drops `firstTimePrice` from its response.
- `members.js` — drops `firstTime`/`basePrice`/`everCharged`.
- `history.js` — counts people charged; rows return `{id, title, total, count, date}`.
- `settle.js`, `groups.js` — unchanged.

**Frontend (`/src`):**
- `api.js` — drops `loadCustomPrices`/`saveCustomPrice`.
- `App.jsx` — three tabs; Sell builder + member picker; People list with mark-paid sheet; updated History; settings without first-time.
- `styles.css` — small additions for the price input, remove button, picker list.

**Tests / docs:**
- `api.test.mjs` — multi-user mock, sell tests, no first-time.
- `.env.example`, `README.md` — drop `FIRST_TIME_PRICE`; describe batch sells.

---

## Task 1: Rewrite the API test suite (failing first)

**Files:**
- Modify: `api.test.mjs` (full replacement)

- [ ] **Step 1: Replace `api.test.mjs` with the new suite**

This expresses the target behavior: a multi-user `create_expense` mock, a `sell` endpoint, members without `firstTime`, and history that counts people. Write the complete file:

```js
// Exercises the serverless function handlers against a mock Splitwise.
import http from "http";

/* ---- mock Splitwise on :4111 ---- */
const ME = 1;
let expenses = [
  { id: 900, deleted_at: null, payment: false, description: "🌯 Burrito", cost: "440.0",
    currency_code: "UYU", date: "2026-06-01T12:00:00Z",
    users: [{ user_id: ME, paid_share: "440.0", owed_share: "0.0" }, { user_id: 2, paid_share: "0.0", owed_share: "440.0" }] },
];
const members = [
  { id: ME, first_name: "Nacho", last_name: "L", picture: {}, balance: [{ currency_code: "UYU", amount: "440.0" }] },
  { id: 2, first_name: "Ana", last_name: "G", picture: {}, balance: [{ currency_code: "UYU", amount: "-440.0" }] },
  { id: 3, first_name: "Beto", last_name: "R", picture: {}, balance: [] },
];
const mock = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const u = req.url;
    res.setHeader("Content-Type", "application/json");
    if (u.startsWith("/get_current_user")) return res.end(JSON.stringify({ user: { id: ME } }));
    if (u.startsWith("/get_groups")) return res.end(JSON.stringify({ groups: [{ id: 10, name: "Oficina", members }] }));
    if (u.startsWith("/get_group/")) return res.end(JSON.stringify({ group: { id: 10, name: "Oficina", members } }));
    if (u.startsWith("/get_expenses")) return res.end(JSON.stringify({ expenses }));
    if (u.startsWith("/create_expense")) {
      const p = new URLSearchParams(raw);
      const users = [];
      for (let i = 0; p.has(`users__${i}__user_id`); i++) {
        users.push({
          user_id: +p.get(`users__${i}__user_id`),
          paid_share: p.get(`users__${i}__paid_share`),
          owed_share: p.get(`users__${i}__owed_share`),
        });
      }
      const e = { id: Math.floor(Math.random() * 1e6), deleted_at: null, payment: p.get("payment") === "true",
        description: p.get("description"), cost: p.get("cost"), currency_code: p.get("currency_code"),
        date: new Date().toISOString(), users };
      expenses.push(e);
      return res.end(JSON.stringify({ expenses: [e], errors: {} }));
    }
    res.statusCode = 404;
    res.end("{}");
  });
});
await new Promise((r) => mock.listen(4111, r));

/* ---- configure env so cfg() picks it up, then import handlers ---- */
process.env.SPLITWISE_API_BASE = "http://localhost:4111";
process.env.SPLITWISE_TOKEN = "test";
process.env.SPLITWISE_GROUP_ID = "10";
process.env.CURRENCY = "UYU";
process.env.DEFAULT_PRICE = "440";

const config = (await import("./api/config.js")).default;
const members_fn = (await import("./api/members.js")).default;
const sell = (await import("./api/sell.js")).default;
const settle = (await import("./api/settle.js")).default;
const history = (await import("./api/history.js")).default;
const groups = (await import("./api/groups.js")).default;

function fakeRes() {
  const r = { _status: 200, body: null, headersSent: false };
  r.status = (c) => ((r._status = c), r);
  r.json = (o) => ((r.body = o), (r.headersSent = true), r);
  return r;
}
async function call(fn, { method = "GET", body, headers = {} } = {}) {
  const req = { method, headers, body };
  const res = fakeRes();
  await fn(req, res);
  return { status: res._status, body: res.body };
}

let pass = 0, fail = 0;
const check = (n, c, x) => (c ? (pass++, console.log("  ✓", n)) : (fail++, console.log("  ✗", n, x ? JSON.stringify(x) : "")));

try {
  const cfg = await call(config);
  check("config reports token+group", cfg.body.hasToken && cfg.body.hasGroup, cfg.body);
  check("config has no firstTimePrice", !("firstTimePrice" in cfg.body), cfg.body);

  const grp = await call(groups);
  check("groups lists Oficina id 10", grp.body.groups.some((g) => g.id === 10), grp.body);

  let m = (await call(members_fn)).body;
  const ana = m.members.find((x) => x.name.startsWith("Ana"));
  const beto = m.members.find((x) => x.name.startsWith("Beto"));
  check("self excluded", !m.members.some((x) => x.name.startsWith("Nacho")));
  check("Ana owes 440, no firstTime field", ana.owes === 440 && !("firstTime" in ana), ana);
  check("Beto settled (owes 0)", beto.owes === 0, beto);

  const before = (await call(history)).body.totalCount;
  const s = await call(sell, { method: "POST", body: { title: "Tacos", items: [{ userId: ana.id, price: 440 }, { userId: beto.id, price: 410 }] } });
  check("sell ok, count 2, total 850", s.body.ok && s.body.count === 2 && s.body.total === 850, s.body);

  const empty = await call(sell, { method: "POST", body: { title: "x", items: [] } });
  check("sell with no items is 400", empty.status === 400, empty);

  const h = (await call(history)).body;
  check("totalCount grew by 2 people", h.totalCount === before + 2, { before, after: h.totalCount });
  const tacos = h.history.find((x) => x.title === "Tacos");
  check("Tacos row: 2 people, total 850", tacos && tacos.count === 2 && tacos.total === 850, tacos);
  check("today counts the new sell (2 🌯, $850)", h.todayCount === 2 && h.todayTotal === 850, { c: h.todayCount, t: h.todayTotal });

  const st = await call(settle, { method: "POST", body: { userId: 2, amount: 440 } });
  check("settle ok", st.body.ok === true, st.body);

  // PIN gate
  process.env.APP_PIN = "9";
  const blocked = await call(members_fn, { headers: {} });
  check("PIN blocks without header", blocked.status === 401, blocked);
  const allowed = await call(members_fn, { headers: { "x-app-pin": "9" } });
  check("PIN allows with header", allowed.status === 200);
  delete process.env.APP_PIN;

  console.log(`\n${fail === 0 ? "✅ ALL PASS" : "❌ FAIL"} — ${pass} passed, ${fail} failed`);
} catch (e) {
  console.error("TEST ERROR", e);
  fail++;
} finally {
  mock.close();
  process.exit(fail === 0 ? 0 : 1);
}
```

- [ ] **Step 2: Run the suite to confirm it fails**

Run: `node api.test.mjs`
Expected: FAIL — it throws/aborts importing `./api/sell.js` (file does not exist yet), so you'll see `TEST ERROR ... Cannot find module ... sell.js`. This proves the suite now targets the new design.

---

## Task 2: Drop first-time from config and switch detection to the `🌯` prefix

**Files:**
- Modify: `api/_splitwise.js:6-15` (`cfg`), `api/_splitwise.js:19-20` (`isBurrito`)
- Modify: `api/config.js:7-14`

- [ ] **Step 1: Update `cfg()` in `api/_splitwise.js`**

Replace the `cfg` function (remove the `firstTimePrice` line):

```js
export function cfg() {
  return {
    token: process.env.SPLITWISE_TOKEN || "",
    groupId: process.env.SPLITWISE_GROUP_ID || "",
    currency: process.env.CURRENCY || "UYU",
    defaultPrice: Number(process.env.DEFAULT_PRICE || 440),
    pin: process.env.APP_PIN || "",
  };
}
```

- [ ] **Step 2: Update `isBurrito` in `api/_splitwise.js`**

Replace the existing `isBurrito` export with the prefix test (old `🌯 Burrito` expenses still match because they start with `🌯`):

```js
export const isBurrito = (e) =>
  !e.payment && typeof e.description === "string" && e.description.trimStart().startsWith("🌯");
```

- [ ] **Step 3: Update `api/config.js`**

Replace the returned object so it no longer exposes `firstTimePrice`:

```js
import { cfg, handler } from "./_splitwise.js";

// Public: tells the UI how it's configured (no secrets returned).
export default handler(
  async () => {
    const c = cfg();
    return {
      hasToken: !!c.token,
      hasGroup: !!c.groupId,
      needsPin: !!c.pin,
      currency: c.currency,
      defaultPrice: c.defaultPrice,
    };
  },
  { pin: false }
);
```

- [ ] **Step 4: Run the suite**

Run: `node api.test.mjs`
Expected: still FAILs overall (sell.js still missing) but the `config has no firstTimePrice` check now passes. If you see `TEST ERROR ... sell.js`, that's expected at this stage — proceed.

---

## Task 3: Simplify `members.js` (no first-time)

**Files:**
- Modify: `api/members.js` (full replacement)

- [ ] **Step 1: Replace `api/members.js`**

Drop the expense fetch, `everCharged`, `firstTime`, and `basePrice`:

```js
import { cfg, getGroup, currentUserId, num, err, handler } from "./_splitwise.js";

export default handler(async () => {
  const c = cfg();
  if (!c.groupId) throw err(400, "No group configured (set SPLITWISE_GROUP_ID).");
  const [group, meId] = await Promise.all([getGroup(c.groupId), currentUserId()]);

  const members = (group.members || [])
    .filter((m) => m.id !== meId)
    .map((m) => {
      const bal = (m.balance || []).find((b) => b.currency_code === c.currency);
      const owes = bal ? -num(bal.amount) : 0;
      return {
        id: m.id,
        name: [m.first_name, m.last_name].filter(Boolean).join(" "),
        picture: m.picture?.medium || m.picture?.small || "",
        owes: Math.round(owes * 100) / 100,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return { members, currency: c.currency, me: meId };
});
```

- [ ] **Step 2: Run the suite**

Run: `node api.test.mjs`
Expected: still FAILs overall (sell.js missing), but the members checks (`self excluded`, `Ana owes 440, no firstTime field`, `Beto settled`) now pass once the suite can run far enough. It still aborts on the `sell.js` import — proceed.

---

## Task 4: Create `api/sell.js` and delete `api/charge.js`

**Files:**
- Create: `api/sell.js`
- Delete: `api/charge.js`

- [ ] **Step 1: Create `api/sell.js`**

```js
import { cfg, sw, currentUserId, err, handler } from "./_splitwise.js";

export default handler(async (req, res, body) => {
  const c = cfg();
  const title = String(body.title || "").trim() || "Burrito";
  const items = (Array.isArray(body.items) ? body.items : [])
    .map((it) => ({ userId: Number(it.userId), price: Number(it.price) }))
    .filter((it) => it.userId && it.price > 0);
  if (!items.length) throw err(400, "Add at least one buyer with a price.");

  const total = items.reduce((s, it) => s + it.price, 0);
  const meId = await currentUserId();

  const form = {
    cost: total.toFixed(2),
    description: `🌯 ${title}`,
    currency_code: c.currency,
    group_id: c.groupId,
    users__0__user_id: meId,
    users__0__paid_share: total.toFixed(2),
    users__0__owed_share: "0.00",
  };
  items.forEach((it, i) => {
    const k = i + 1;
    form[`users__${k}__user_id`] = it.userId;
    form[`users__${k}__paid_share`] = "0.00";
    form[`users__${k}__owed_share`] = it.price.toFixed(2);
  });

  const j = await sw("POST", "create_expense", form);
  if (j.errors && Object.keys(j.errors).length) throw err(400, JSON.stringify(j.errors));
  return { ok: true, total: Number(total.toFixed(2)), count: items.length };
});
```

- [ ] **Step 2: Delete the old charge handler**

Run: `rm api/charge.js`
Expected: no output. Nothing imports `charge.js` after the Task 1 test rewrite.

- [ ] **Step 3: Run the suite**

Run: `node api.test.mjs`
Expected: the suite now runs to completion. The `sell` checks (`sell ok, count 2, total 850`, `sell with no items is 400`) pass. The history checks may still fail until Task 5 — that's expected.

---

## Task 5: Update `history.js` to count people and return sell rows

**Files:**
- Modify: `api/history.js` (full replacement)

- [ ] **Step 1: Replace `api/history.js`**

```js
import { cfg, getGroup, getGroupExpenses, isBurrito, num, err, handler } from "./_splitwise.js";

export default handler(async () => {
  const c = cfg();
  if (!c.groupId) throw err(400, "No group configured (set SPLITWISE_GROUP_ID).");
  const [expenses, group] = await Promise.all([getGroupExpenses(c.groupId), getGroup(c.groupId)]);

  const burritos = expenses.filter(isBurrito);
  const todayStr = new Date().toISOString().slice(0, 10);
  let todayTotal = 0, allTotal = 0, todayCount = 0, totalCount = 0;

  const history = burritos
    .map((e) => {
      const buyers = (e.users || []).filter((u) => num(u.owed_share) > 0);
      const cost = num(e.cost);
      const day = (e.date || e.created_at || "").slice(0, 10);
      const title = String(e.description || "").replace(/^🌯\s*/, "") || "Burrito";
      allTotal += cost;
      totalCount += buyers.length;
      if (day === todayStr) { todayTotal += cost; todayCount += buyers.length; }
      return { id: e.id, title, total: cost, count: buyers.length, date: e.date || e.created_at };
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  return {
    currency: c.currency,
    todayTotal: Math.round(todayTotal * 100) / 100,
    allTotal: Math.round(allTotal * 100) / 100,
    todayCount,
    totalCount,
    history: history.slice(0, 100),
  };
});
```

Note: `group` is fetched only to keep the call shape consistent with the rest of the app and to remain robust if rows later need member names; it is intentionally unused for row labels now (rows are labeled by title).

- [ ] **Step 2: Run the full suite — expect all green**

Run: `node api.test.mjs`
Expected: `✅ ALL PASS — 14 passed, 0 failed`

---

## Task 6: Remove client-side custom prices from `src/api.js`

**Files:**
- Modify: `src/api.js:29-43` (remove `loadCustomPrices` and `saveCustomPrice`)

- [ ] **Step 1: Delete the custom-price helpers**

Remove these two functions and the comment above them (lines 29–43), leaving `api`, `getPin`, `setPin`, `money`, `initials` intact. After the edit, the section between `setPin`'s closing brace and `export const money` should go directly from the `api` function to `money` with no `burrito_custom` references. The file should contain no occurrences of `loadCustomPrices`, `saveCustomPrice`, or `burrito_custom`.

- [ ] **Step 2: Verify nothing else imports them yet**

Run: `grep -rn "loadCustomPrices\|saveCustomPrice\|burrito_custom" src`
Expected: matches ONLY in `src/App.jsx` (removed in Task 8). If `src/api.js` appears, the deletion was incomplete — fix it.

---

## Task 7: Add CSS for the sell builder

**Files:**
- Modify: `src/styles.css` (append at end, after line 96)

- [ ] **Step 1: Append the new rules**

```css
.pricein { width: 84px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 10px; font-size: 16px; text-align: right; }
.rm { background: none; border: 0; color: var(--muted); font-size: 16px; cursor: pointer; padding: 4px 6px; flex-shrink: 0; }
.pickerlist { max-height: 50vh; overflow: auto; margin-top: 8px; }
.person:disabled { opacity: .55; cursor: default; }
.titlein { flex: 1; width: auto; text-align: left; padding: 12px 14px; border: 1px solid var(--line); border-radius: 12px; font-size: 16px; background: var(--card); }
```

- [ ] **Step 2: Sanity-check the file still parses**

Run: `npx vite build >/dev/null 2>&1 && echo OK || echo CHECK-AFTER-APP`
Expected: `CHECK-AFTER-APP` is acceptable here (App.jsx not rewritten yet); a hard CSS parse error would surface in Task 8's build. No action needed now.

---

## Task 8: Rewrite `src/App.jsx` — three tabs, sell builder, people, history

**Files:**
- Modify: `src/App.jsx` (full replacement)

- [ ] **Step 1: Replace `src/App.jsx` entirely**

```jsx
import { useEffect, useRef, useState } from "react";
import { api, getPin, setPin, money, initials } from "./api.js";

export default function App() {
  const [config, setConfig] = useState(null);
  const [members, setMembers] = useState([]);
  const [currency, setCurrency] = useState("UYU");
  const [tab, setTab] = useState("sell");
  const [sheet, setSheet] = useState(null); // a member (people mark-paid) or {settings:true}
  const [needPin, setNeedPin] = useState(false);
  const [fatal, setFatal] = useState("");
  const [ready, setReady] = useState(false);
  const [toast, setToast] = useState(null);

  const toastTimer = useRef();
  const showToast = (msg, err = false) => {
    setToast({ msg, err });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  };

  async function loadMembers() {
    const d = await api("members");
    setMembers(d.members);
    setCurrency(d.currency);
  }

  async function boot() {
    setFatal("");
    setReady(false);
    let cfg;
    try {
      cfg = await api("config");
    } catch {
      setFatal("Can't reach the server.");
      return;
    }
    setConfig(cfg);
    setCurrency(cfg.currency);
    if (!cfg.hasToken || !cfg.hasGroup) {
      setReady(true);
      return;
    }
    if (cfg.needsPin && !getPin()) {
      setNeedPin(true);
      setReady(true);
      return;
    }
    try {
      await loadMembers();
      setNeedPin(false);
    } catch (e) {
      if (e.status === 401) {
        setPin("");
        setNeedPin(true);
      } else setFatal(e.message);
    }
    setReady(true);
  }

  useEffect(() => {
    boot();
  }, []);

  /* ---------- gates ---------- */
  if (!ready) return <Shell><Spinner /></Shell>;
  if (fatal)
    return (
      <Shell>
        <Panel title="Something went off">
          <p>{fatal}</p>
          <button className="btn btn-ghost" onClick={boot}>Try again</button>
        </Panel>
      </Shell>
    );
  if (config && !config.hasToken) return <Shell><NeedEnv /></Shell>;
  if (config && !config.hasGroup) return <Shell><NeedGroup /></Shell>;
  if (needPin)
    return (
      <Shell>
        <PinGate
          onUnlock={async (pin) => {
            setPin(pin);
            try {
              await loadMembers();
              setNeedPin(false);
            } catch (e) {
              setPin("");
              showToast(e.status === 401 ? "Wrong PIN" : e.message, true);
            }
          }}
        />
      </Shell>
    );

  /* ---------- actions ---------- */
  async function doSell(title, items) {
    try {
      const { total, count } = await api("sell", { method: "POST", body: { title, items } });
      showToast(`Sold ${count} 🌯 — ${money(total, currency)}`);
      await loadMembers();
      return true;
    } catch (e) {
      showToast(e.message, true);
      return false;
    }
  }
  async function doSettle(m) {
    try {
      await api("settle", { method: "POST", body: { userId: m.id, amount: m.owes } });
      setSheet(null);
      showToast(`${m.name.split(" ")[0]} marked paid ✓`);
      await loadMembers();
    } catch (e) {
      showToast(e.message, true);
    }
  }

  return (
    <Shell onGear={() => setSheet({ settings: true })}>
      {tab === "sell" && (
        <SellView members={members} currency={currency} defaultPrice={config?.defaultPrice ?? 440} onSell={doSell} />
      )}
      {tab === "people" && <PeopleView members={members} currency={currency} onPick={(m) => setSheet(m)} />}
      {tab === "history" && <HistoryView currency={currency} />}

      <TabBar tab={tab} setTab={setTab} />

      {sheet && !sheet.settings && (
        <PersonSheet m={sheet} currency={currency} onClose={() => setSheet(null)} onSettle={doSettle} />
      )}
      {sheet && sheet.settings && (
        <SettingsSheet
          config={config}
          currency={currency}
          onClose={() => setSheet(null)}
          onForgetPin={() => {
            setPin("");
            setSheet(null);
            showToast("PIN forgotten");
          }}
        />
      )}

      {toast && <div className={"toast show" + (toast.err ? " err" : "")}>{toast.msg}</div>}
    </Shell>
  );
}

/* ----------------------------- sell ----------------------------- */
function SellView({ members, currency, defaultPrice, onSell }) {
  const [title, setTitle] = useState("");
  const [items, setItems] = useState([]); // [{ id, name, price }]
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  const inSell = new Set(items.map((it) => it.id));
  const total = items.reduce((s, it) => s + (Number(it.price) || 0), 0);
  const canCreate = items.some((it) => Number(it.price) > 0) && !busy;

  function addPerson(m) {
    if (inSell.has(m.id)) return;
    setItems((xs) => [...xs, { id: m.id, name: m.name, price: defaultPrice }]);
  }
  function setPrice(id, value) {
    setItems((xs) => xs.map((it) => (it.id === id ? { ...it, price: value } : it)));
  }
  function remove(id) {
    setItems((xs) => xs.filter((it) => it.id !== id));
  }
  async function create() {
    setBusy(true);
    const payload = items
      .map((it) => ({ userId: it.id, price: Number(it.price) || 0 }))
      .filter((it) => it.price > 0);
    const ok = await onSell(title, payload);
    setBusy(false);
    if (ok) {
      setTitle("");
      setItems([]);
    }
  }

  return (
    <>
      <div className="row" style={{ marginTop: 0 }}>
        <input className="titlein" placeholder="What's this sell? (e.g. Burritos Friday)" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>

      <div className="list" style={{ marginTop: 12 }}>
        {items.length ? (
          items.map((it) => (
            <div key={it.id} className="person" style={{ cursor: "default" }}>
              <div className="avatar">{initials(it.name)}</div>
              <div className="info"><div className="name">{it.name}</div></div>
              <input
                className="pricein"
                type="number"
                inputMode="numeric"
                value={it.price}
                onChange={(e) => setPrice(it.id, e.target.value)}
              />
              <button className="rm" onClick={() => remove(it.id)} title="Remove">✕</button>
            </div>
          ))
        ) : (
          <div className="empty">No buyers yet — add who bought.</div>
        )}
      </div>

      <button className="btn btn-ghost" onClick={() => setPicking(true)}>+ Add buyers</button>
      <button className="btn btn-primary" disabled={!canCreate} onClick={create}>
        {busy ? "Creating…" : `Create sell — ${money(total, currency)}`}
      </button>

      {picking && (
        <MemberPicker members={members} currency={currency} inSell={inSell} onAdd={addPerson} onClose={() => setPicking(false)} />
      )}
    </>
  );
}

function MemberPicker({ members, currency, inSell, onAdd, onClose }) {
  const [query, setQuery] = useState("");
  const filtered = members.filter((m) => m.name.toLowerCase().includes(query.toLowerCase()));
  return (
    <Scrim onClose={onClose}>
      <h2>Add buyers</h2>
      <div className="search" style={{ marginTop: 8 }}>
        <span className="icon">🔎</span>
        <input placeholder="Search a coworker…" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
      </div>
      <div className="list pickerlist">
        {filtered.length ? (
          filtered.map((m) => (
            <button key={m.id} className="person" onClick={() => onAdd(m)} disabled={inSell.has(m.id)}>
              <div className="avatar" style={m.picture ? { backgroundImage: `url('${m.picture}')` } : undefined}>
                {m.picture ? "" : initials(m.name)}
              </div>
              <div className="info">
                <div className="name">{m.name}</div>
                <div className="sub">{m.owes > 0 ? <span className="owes">owes {money(m.owes, currency)}</span> : "all settled"}</div>
              </div>
              <span className="pricepill ghostpill">{inSell.has(m.id) ? "added" : "+"}</span>
            </button>
          ))
        ) : (
          <div className="empty">No matches.</div>
        )}
      </div>
      <button className="btn btn-primary" onClick={onClose}>Done</button>
    </Scrim>
  );
}

/* ----------------------------- people ----------------------------- */
function PeopleView({ members, currency, onPick }) {
  const [query, setQuery] = useState("");
  const filtered = members.filter((m) => m.name.toLowerCase().includes(query.toLowerCase()));
  return (
    <>
      <div className="search">
        <span className="icon">🔎</span>
        <input placeholder="Search a coworker…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="list">
        {filtered.length ? (
          filtered.map((m) => (
            <button key={m.id} className="person" onClick={() => onPick(m)}>
              <div className="avatar" style={m.picture ? { backgroundImage: `url('${m.picture}')` } : undefined}>
                {m.picture ? "" : initials(m.name)}
              </div>
              <div className="info">
                <div className="name">{m.name}</div>
                <div className="sub">{m.owes > 0 ? <span className="owes">owes {money(m.owes, currency)}</span> : "all settled"}</div>
              </div>
              {m.owes > 0 && <span className="pricepill ghostpill">{money(m.owes, currency)}</span>}
            </button>
          ))
        ) : (
          <div className="empty">No matches.</div>
        )}
      </div>
    </>
  );
}

function PersonSheet({ m, currency, onClose, onSettle }) {
  const first = m.name.split(" ")[0];
  return (
    <Scrim onClose={onClose}>
      <h2>{m.name}</h2>
      <div className="meta">{m.owes > 0 ? <>Currently owes you <b>{money(m.owes, currency)}</b></> : "All settled up"}</div>
      {m.owes > 0 ? (
        <button className="btn btn-green" onClick={() => onSettle(m)}>
          Mark paid (clear {money(m.owes, currency)})
        </button>
      ) : (
        <p style={{ color: "var(--muted)", fontSize: 14 }}>{first} has nothing outstanding.</p>
      )}
      <button className="muted-link" onClick={onClose}>Close</button>
    </Scrim>
  );
}

/* ----------------------------- shared / presentational ----------------------------- */
function Shell({ children, onGear }) {
  return (
    <>
      <header>
        <span style={{ fontSize: 22 }}>🌯</span>
        <h1>Burrito Charger</h1>
        {onGear && (
          <button className="gear" title="Settings" onClick={onGear}>
            ⚙︎
          </button>
        )}
      </header>
      <main>{children}</main>
    </>
  );
}

function Spinner() {
  return (
    <div className="empty">
      <span className="spin dark" />
    </div>
  );
}

function Panel({ title, children }) {
  return (
    <div className="panel">
      <h2>{title}</h2>
      {children}
    </div>
  );
}

function SettingsSheet({ config, currency, onClose, onForgetPin }) {
  return (
    <Scrim onClose={onClose}>
      <h2>Settings</h2>
      <div className="meta">Currency: {currency} · Regular {money(config.defaultPrice, currency)}</div>
      <p style={{ fontSize: 13, color: "var(--muted)" }}>
        Token, group and the regular price are set via environment variables on Vercel.
      </p>
      <button className="btn btn-ghost" onClick={onForgetPin}>Forget PIN on this device</button>
      <button className="muted-link" onClick={onClose}>Close</button>
    </Scrim>
  );
}

function TabBar({ tab, setTab }) {
  return (
    <div className="tabbar">
      <button className={tab === "sell" ? "active" : ""} onClick={() => setTab("sell")}>
        <span className="t">🌯</span>
        <span className="l">Sell</span>
      </button>
      <button className={tab === "people" ? "active" : ""} onClick={() => setTab("people")}>
        <span className="t">👥</span>
        <span className="l">People</span>
      </button>
      <button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>
        <span className="t">📜</span>
        <span className="l">History</span>
      </button>
    </div>
  );
}

function HistoryView({ currency }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    api("history").then(setD).catch((e) => setErr(e.message));
  }, []);
  if (err) return <Panel title="Couldn't load history"><p>{err}</p></Panel>;
  if (!d) return <Spinner />;
  return (
    <>
      <div className="stats">
        <div className="stat">
          <div className="label">Today ({d.todayCount} 🌯)</div>
          <div className="value">{money(d.todayTotal, currency)}</div>
        </div>
        <div className="stat">
          <div className="label">All time ({d.totalCount} 🌯)</div>
          <div className="value">{money(d.allTotal, currency)}</div>
        </div>
      </div>
      <div className="list">
        {d.history.length ? (
          d.history.map((h) => {
            const dt = new Date(h.date);
            const when = dt.toLocaleString("es-UY", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
            return (
              <div key={h.id} className="person" style={{ cursor: "default" }}>
                <div className="avatar">🌯</div>
                <div className="info">
                  <div className="name">{h.title}</div>
                  <div className="sub">{h.count} {h.count === 1 ? "person" : "people"} · {when}</div>
                </div>
                <span className="pricepill ghostpill">{money(h.total, currency)}</span>
              </div>
            );
          })
        ) : (
          <div className="empty">No sells yet.</div>
        )}
      </div>
    </>
  );
}

function NeedEnv() {
  return (
    <Panel title="Connect Splitwise">
      <p>
        Set the <b>SPLITWISE_TOKEN</b> environment variable in your Vercel project (your Splitwise
        API key from secure.splitwise.com/apps), then redeploy.
      </p>
    </Panel>
  );
}

function NeedGroup() {
  const [groups, setGroups] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    api("groups").then((d) => setGroups(d.groups)).catch((e) => setErr(e.message));
  }, []);
  return (
    <Panel title="Pick your group">
      <p>
        Set <b>SPLITWISE_GROUP_ID</b> in your Vercel env to the burrito group below, then redeploy.
      </p>
      {err && <p style={{ color: "var(--accent-d)" }}>{err}</p>}
      {!groups && !err && <Spinner />}
      <div className="list">
        {(groups || []).map((g) => (
          <div key={g.id} className="person" style={{ cursor: "default" }}>
            <div className="avatar">{initials(g.name)}</div>
            <div className="info">
              <div className="name">{g.name}</div>
              <div className="sub">{g.members} people</div>
            </div>
            <span className="pricepill ghostpill">ID {g.id}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function PinGate({ onUnlock }) {
  const [pin, setPinVal] = useState("");
  return (
    <Panel title="Enter PIN">
      <p>This app is PIN-protected.</p>
      <input type="tel" inputMode="numeric" placeholder="PIN" value={pin} onChange={(e) => setPinVal(e.target.value)} />
      <button className="btn btn-primary" onClick={() => onUnlock(pin.trim())}>
        Unlock
      </button>
    </Panel>
  );
}

function Scrim({ children, onClose }) {
  return (
    <div className="scrim open" onClick={(e) => e.target.classList.contains("scrim") && onClose()}>
      <div className="sheet">{children}</div>
    </div>
  );
}
```

- [ ] **Step 2: Confirm no stale references remain**

Run: `grep -rn "firstTime\|ChargeSheet\|loadCustomPrices\|saveCustomPrice\|firstTimePrice\|basePrice" src`
Expected: no output.

- [ ] **Step 3: Build the frontend**

Run: `npm run build`
Expected: Vite build succeeds (`✓ built in …`), no errors. This compiles JSX, `App.jsx`, `api.js`, and `styles.css` together — a missing import or syntax error fails here.

- [ ] **Step 4 (optional manual check): Run the app end to end**

Run: `npx vercel dev` (needs a local `.env` with a real `SPLITWISE_TOKEN`/`SPLITWISE_GROUP_ID`), open the URL, and verify: Sell tab adds buyers, edits prices, and "Create sell" posts one expense; People tab shows balances and Mark paid clears one; History lists the sell by title with the people count.

---

## Task 9: Update docs and env example

**Files:**
- Modify: `.env.example:8` (remove `FIRST_TIME_PRICE`)
- Modify: `README.md` (remove first-time references; describe batch sells)

- [ ] **Step 1: Remove `FIRST_TIME_PRICE` from `.env.example`**

Delete the line `FIRST_TIME_PRICE=390` so the file ends:

```
CURRENCY=UYU
DEFAULT_PRICE=440
# APP_PIN=1234                              # optional: require a PIN to charge
```

- [ ] **Step 2: Update `README.md`**

Make these edits:

- In the intro bullets, replace `- Regular burrito **440**, first-ever burrito for a person **390** (automatic).` with `- Create a **sell**: name it, add the people who bought, set each person's price, charge them all at once.` and replace `- Per-person custom default price (saved on your device).` with `- Regular price **440** (per person, editable on each sell).`
- In the env list under step 3, change `- `CURRENCY=UYU`, `DEFAULT_PRICE=440`, `FIRST_TIME_PRICE=390`` to `- `CURRENCY=UYU`, `DEFAULT_PRICE=440``.
- Replace the entire "## How charges map to Splitwise" section body with:

```
Each **sell** creates one Splitwise expense titled with your text (stored with a
`🌯` prefix), where **you paid** the total and **each added person owes** their own
price — so their balances go up. "Mark paid" records a settle-up payment from a
person to you. Sales are detected by the `🌯` prefix; that's how history and the
today / all-time counts find them. Counts are per **person charged** (a 3-person
sell counts as 3). Balances and history come straight from Splitwise.
```

- In the "## Config reference" table, delete the `FIRST_TIME_PRICE` row.

- [ ] **Step 3: Verify no first-time references survive in docs**

Run: `grep -rn "FIRST_TIME\|first-time\|first-ever\|first burrito" README.md .env.example`
Expected: no output.

---

## Self-Review

**Spec coverage:**
- Remove first-time → Tasks 2 (config/cfg), 3 (members), 4 (sell replaces charge), 8 (UI), 9 (docs). ✓
- Drop per-person saved default price → Tasks 6 (api.js), 8 (App.jsx). ✓
- One expense per sell, you pay total, each owes their price → Task 4. ✓
- `🌯` detection marker, blank title → "Burrito" → Tasks 2 (isBurrito), 4 (sell). ✓
- History counts people; rows {id,title,total,count,date} → Task 5; UI rows → Task 8. ✓
- Three tabs / builder / member picker / People mark-paid → Task 8 (+ CSS Task 7). ✓
- Tests updated (multi-user mock, sell, no first-time) → Task 1. ✓
- README/.env updates → Task 9. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete content. ✓

**Type/name consistency:** sell endpoint contract `{title, items:[{userId, price}]}` → `{ok,total,count}` is identical across Task 1 (test), Task 4 (handler), Task 8 (`doSell`/`SellView`). History row shape `{id,title,total,count,date}` matches between Task 5 and the Task 8 `HistoryView`. `config.defaultPrice` used in Task 8 is provided by Task 2's config. ✓
