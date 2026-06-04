import { cfg, sw, currentUserId, err, handler } from "./_splitwise.js";

export default handler(async (req, res, body) => {
  const c = cfg();
  const userId = Number(body.userId);
  const amount = Number(body.amount);
  if (!userId || !(amount > 0)) throw err(400, "Missing userId/amount.");
  const cost = amount.toFixed(2);
  const meId = await currentUserId();

  const j = await sw("POST", "create_expense", {
    cost,
    description: "Payment",
    currency_code: c.currency,
    group_id: c.groupId,
    payment: true,
    users__0__user_id: userId, // coworker pays you
    users__0__paid_share: cost,
    users__0__owed_share: "0.00",
    users__1__user_id: meId, // you receive
    users__1__paid_share: "0.00",
    users__1__owed_share: cost,
  });
  if (j.errors && Object.keys(j.errors).length) throw err(400, JSON.stringify(j.errors));
  return { ok: true };
});
