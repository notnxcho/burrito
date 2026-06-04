import { cfg, sw, getGroup, getGroupExpenses, currentUserId, isBurrito, num, err, handler } from "./_splitwise.js";

export default handler(async () => {
  const c = cfg();
  if (!c.groupId) throw err(400, "No group configured (set SPLITWISE_GROUP_ID).");
  const [group, expenses, meId] = await Promise.all([
    getGroup(c.groupId),
    getGroupExpenses(c.groupId),
    currentUserId(),
  ]);
  const burritos = expenses.filter(isBurrito);

  const everCharged = new Set();
  for (const e of burritos)
    for (const u of e.users || []) if (num(u.owed_share) > 0) everCharged.add(u.user_id);

  const members = (group.members || [])
    .filter((m) => m.id !== meId)
    .map((m) => {
      const bal = (m.balance || []).find((b) => b.currency_code === c.currency);
      const owes = bal ? -num(bal.amount) : 0;
      const firstTime = !everCharged.has(m.id);
      return {
        id: m.id,
        name: [m.first_name, m.last_name].filter(Boolean).join(" "),
        picture: m.picture?.medium || m.picture?.small || "",
        owes: Math.round(owes * 100) / 100,
        firstTime,
        basePrice: firstTime ? c.firstTimePrice : c.defaultPrice,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return { members, currency: c.currency, me: meId };
});
