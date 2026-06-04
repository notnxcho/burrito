import { sw, handler } from "./_splitwise.js";

// Lists your Splitwise groups + their IDs, so you can pick which to set as
// SPLITWISE_GROUP_ID. Requires a token but not a configured group.
export default handler(async () => {
  const j = await sw("GET", "get_groups");
  return {
    groups: (j.groups || [])
      .filter((g) => g.id !== 0)
      .map((g) => ({ id: g.id, name: g.name, members: (g.members || []).length })),
  };
});
