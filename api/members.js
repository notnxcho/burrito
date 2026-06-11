import { cfg, getGroup, currentUserId, num, err, handler } from "./_splitwise.js";

export default handler(async () => {
  const c = cfg();
  if (!c.groupId) throw err(400, "No group configured (set SPLITWISE_GROUP_ID).");
  const [group, meId] = await Promise.all([getGroup(c.groupId), currentUserId()]);

  const members = (group.members || [])
    .filter((m) => m.id !== meId)
    .map((m) => {
      const bal = (m.balance || []).find((b) => b.currency_code === c.currency);
      const owes = bal ? -num(bal.amount) : 0;
      return {
        id: m.id,
        name: [m.first_name, m.last_name].filter(Boolean).join(" "),
        picture: m.picture?.medium || m.picture?.small || "",
        owes: Math.round(owes * 100) / 100,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return { members, currency: c.currency, me: meId };
});
