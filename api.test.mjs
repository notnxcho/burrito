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
      const e = { id: Math.floor(Math.random() * 1e6), deleted_at: null, payment: p.get("payment") === "true",
        description: p.get("description"), cost: p.get("cost"), currency_code: p.get("currency_code"),
        date: new Date().toISOString(),
        users: [{ user_id: +p.get("users__0__user_id"), paid_share: p.get("users__0__paid_share"), owed_share: p.get("users__0__owed_share") },
                { user_id: +p.get("users__1__user_id"), paid_share: p.get("users__1__paid_share"), owed_share: p.get("users__1__owed_share") }] };
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
process.env.FIRST_TIME_PRICE = "390";

const config = (await import("./api/config.js")).default;
const members_fn = (await import("./api/members.js")).default;
const charge = (await import("./api/charge.js")).default;
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

  const grp = await call(groups);
  check("groups lists Oficina id 10", grp.body.groups.some((g) => g.id === 10), grp.body);

  let m = (await call(members_fn)).body;
  const ana = m.members.find((x) => x.name.startsWith("Ana"));
  const beto = m.members.find((x) => x.name.startsWith("Beto"));
  check("self excluded", !m.members.some((x) => x.name.startsWith("Nacho")));
  check("Ana not first-time, base 440, owes 440", !ana.firstTime && ana.basePrice === 440 && ana.owes === 440, ana);
  check("Beto first-time, base 390", beto.firstTime && beto.basePrice === 390, beto);

  const ch = await call(charge, { method: "POST", body: { userId: beto.id, price: 500 } });
  check("explicit price override honored (500)", ch.body.cost === 500, ch.body);

  // no override -> server computes first-time (Ana already charged so 440)
  const ch2 = await call(charge, { method: "POST", body: { userId: ana.id } });
  check("no-override Ana charged 440", ch2.body.cost === 440, ch2.body);

  m = (await call(members_fn)).body;
  check("Beto now not first-time after charge", !m.members.find((x) => x.name.startsWith("Beto")).firstTime);

  const h = (await call(history)).body;
  check("history counts burritos, excludes payments", h.totalCount >= 3 && h.history.every((x) => x.cost > 0), { c: h.totalCount });

  const s = await call(settle, { method: "POST", body: { userId: 2, amount: 440 } });
  check("settle ok", s.body.ok === true, s.body);

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
