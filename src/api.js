// Tiny fetch wrapper that attaches the PIN header and throws on API errors.
export function getPin() {
  return localStorage.getItem("burrito_pin") || "";
}
export function setPin(p) {
  if (p) localStorage.setItem("burrito_pin", p);
  else localStorage.removeItem("burrito_pin");
}

export async function api(path, { method = "GET", body } = {}) {
  const headers = {};
  const pin = getPin();
  if (pin) headers["x-app-pin"] = pin;
  if (body) headers["Content-Type"] = "application/json";
  const res = await fetch(`/api/${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.error || "Request failed");
    e.status = res.status;
    throw e;
  }
  return data;
}

// Per-person custom prices live on this device (localStorage).
export function loadCustomPrices() {
  try {
    return JSON.parse(localStorage.getItem("burrito_custom") || "{}");
  } catch {
    return {};
  }
}
export function saveCustomPrice(id, price) {
  const all = loadCustomPrices();
  if (price === "" || price == null) delete all[id];
  else all[id] = Number(price);
  localStorage.setItem("burrito_custom", JSON.stringify(all));
  return all;
}

export const money = (n, currency = "UYU") =>
  `$${Number(n).toLocaleString("es-UY", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

export const initials = (name) =>
  (name || "?").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
