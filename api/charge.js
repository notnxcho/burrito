import { cfg, sw, getGroupExpenses, currentUserId, isBurrito, num, err, handler } from "./_splitwise.js";

export default handler(async (req, res, body) => {
  const c = cfg();
  const userId = Number(body.userId);
  const override = Number(body.price); // explicit price from UI (custom prices live client-side)
  if (!userId) throw err(400, "Missing userId.");

  let price;
  if (override > 0) {
    price = override;
  } else {
    const expenses = await getGroupExpenses(c.groupId);
    const firstTime = !expenses
      .filter(isBurrito)
      .some((e) => (e.users || []).some((u) => u.user_id === userId && num(u.owed_share) > 0));
    price = firstTime ? c.firstTimePrice : c.defaultPrice;
  }
  const cost = price.toFixed(2);
  const meId = await currentUserId();

  const j = await sw("POST", "create_expense", {
    cost,
    description: "🌯 Burrito",
    currency_code: c.currency,
    group_id: c.groupId,
    users__0__user_id: meId,
    users__0__paid_share: cost,
    users__0__owed_share: "0.00",
    users__1__user_id: userId,
    users__1__paid_share: "0.00",
    users__1__owed_share: cost,
  });
  if (j.errors && Object.keys(j.errors).length) throw err(400, JSON.stringify(j.errors));
  return { ok: true, cost: Number(cost) };
});
