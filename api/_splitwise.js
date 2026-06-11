// Shared Splitwise helper for the Vercel serverless functions.
// All config comes from environment variables (serverless = no writable disk).

const SW = process.env.SPLITWISE_API_BASE || "https://secure.splitwise.com/api/v3.0";

export function cfg() {
  return {
    token: process.env.SPLITWISE_TOKEN || "",
    groupId: process.env.SPLITWISE_GROUP_ID || "",
    currency: process.env.CURRENCY || "UYU",
    defaultPrice: Number(process.env.DEFAULT_PRICE || 440),
    pin: process.env.APP_PIN || "",
  };
}

export const num = (v) => Number(v || 0);

export const isBurrito = (e) =>
  !e.payment && typeof e.description === "string" && e.description.trimStart().startsWith("🌯");

export async function sw(method, endpoint, body) {
  const c = cfg();
  if (!c.token) throw err(400, "No Splitwise token configured (set SPLITWISE_TOKEN).");
  const opts = { method, headers: { Authorization: `Bearer ${c.token}` } };
  if (body) {
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) form.append(k, String(v));
    opts.body = form;
    opts.headers["Content-Type"] = "application/x-www-form-urlencoded";
  }
  const res = await fetch(`${SW}/${endpoint}`, opts);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw err(res.status, `Splitwise returned non-JSON (status ${res.status}).`);
  }
  if (res.status === 401 || res.status === 403)
    throw err(401, "Splitwise rejected the token. Check SPLITWISE_TOKEN.");
  return json;
}

export async function currentUserId() {
  const j = await sw("GET", "get_current_user");
  return j.user?.id;
}
export async function getGroup(groupId) {
  return (await sw("GET", `get_group/${groupId}`)).group;
}
export async function getGroupExpenses(groupId) {
  const j = await sw("GET", `get_expenses?group_id=${groupId}&limit=0`);
  return (j.expenses || []).filter((e) => !e.deleted_at);
}

export function err(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// Wrap a handler: parse JSON body, enforce PIN, JSON errors.
export function handler(fn, { pin = true } = {}) {
  return async (req, res) => {
    try {
      if (pin) {
        const c = cfg();
        if (c.pin && req.headers["x-app-pin"] !== c.pin)
          return res.status(401).json({ error: "PIN required or incorrect." });
      }
      const body = await readBody(req);
      const out = await fn(req, res, body);
      if (out !== undefined && !res.headersSent) res.status(200).json(out);
    } catch (e) {
      if (!res.headersSent) res.status(e.status || 500).json({ error: e.message || "Server error" });
    }
  };
}

async function readBody(req) {
  if (req.method === "GET" || req.method === "HEAD") return {};
  if (req.body && typeof req.body === "object") return req.body; // Vercel pre-parses JSON
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
