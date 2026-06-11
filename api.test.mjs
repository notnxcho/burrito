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
