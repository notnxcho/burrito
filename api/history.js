import { cfg, getGroupExpenses, isBurrito, num, err, handler } from "./_splitwise.js";

export default handler(async () => {
  const c = cfg();
  if (!c.groupId) throw err(400, "No group configured (set SPLITWISE_GROUP_ID).");
  const expenses = await getGroupExpenses(c.groupId);

  const burritos = expenses.filter(isBurrito);
  const todayStr = new Date().toISOString().slice(0, 10);
  let todayTotal = 0, allTotal = 0, todayCount = 0, totalCount = 0;

  const history = burritos
    .map((e) => {
      const buyers = (e.users || []).filter((u) => num(u.owed_share) > 0);
      const cost = num(e.cost);
      const day = (e.date || e.created_at || "").slice(0, 10);
      const title = String(e.description || "").trimStart().replace(/^🌯\s*/, "") || "Burrito";
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
