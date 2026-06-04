import { cfg, getGroup, getGroupExpenses, isBurrito, num, err, handler } from "./_splitwise.js";

export default handler(async () => {
  const c = cfg();
  if (!c.groupId) throw err(400, "No group configured (set SPLITWISE_GROUP_ID).");
  const [expenses, group] = await Promise.all([getGroupExpenses(c.groupId), getGroup(c.groupId)]);

  const nameById = {};
  for (const m of group.members || [])
    nameById[m.id] = [m.first_name, m.last_name].filter(Boolean).join(" ");

  const burritos = expenses.filter(isBurrito);
  const todayStr = new Date().toISOString().slice(0, 10);
  let todayTotal = 0, allTotal = 0, todayCount = 0;

  const history = burritos
    .map((e) => {
      const buyer = (e.users || []).find((u) => num(u.owed_share) > 0);
      const cost = num(e.cost);
      const day = (e.date || e.created_at || "").slice(0, 10);
      allTotal += cost;
      if (day === todayStr) { todayTotal += cost; todayCount++; }
      return { id: e.id, name: buyer ? nameById[buyer.user_id] || "Someone" : "Someone", cost, date: e.date || e.created_at };
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  return {
    currency: c.currency,
    todayTotal: Math.round(todayTotal * 100) / 100,
    allTotal: Math.round(allTotal * 100) / 100,
    todayCount,
    totalCount: burritos.length,
    history: history.slice(0, 100),
  };
});
