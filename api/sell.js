import { cfg, sw, currentUserId, err, handler } from "./_splitwise.js";

export default handler(async (req, res, body) => {
  const c = cfg();
  const title = String(body.title || "").trim() || "Burrito";
  const items = (Array.isArray(body.items) ? body.items : [])
    .map((it) => ({ userId: Number(it.userId), price: Number(it.price) }))
    .filter((it) => it.userId > 0 && it.price > 0 && isFinite(it.price));
  if (!items.length) throw err(400, "Add at least one buyer with a price.");

  const priced = items.map((it) => ({ userId: it.userId, price: Math.round(it.price * 100) / 100 }));
  const total = priced.reduce((s, it) => s + it.price, 0);
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
  priced.forEach((it, i) => {
    const k = i + 1;
    form[`users__${k}__user_id`] = it.userId;
    form[`users__${k}__paid_share`] = "0.00";
    form[`users__${k}__owed_share`] = it.price.toFixed(2);
  });

  const j = await sw("POST", "create_expense", form);
  if (j.errors && Object.keys(j.errors).length) throw err(400, JSON.stringify(j.errors));
  return { ok: true, total: Number(total.toFixed(2)), count: priced.length };
});
