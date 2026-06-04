import { cfg, handler } from "./_splitwise.js";

// Public: tells the UI how it's configured (no secrets returned).
export default handler(
  async () => {
    const c = cfg();
    return {
      hasToken: !!c.token,
      hasGroup: !!c.groupId,
      needsPin: !!c.pin,
      currency: c.currency,
      defaultPrice: c.defaultPrice,
      firstTimePrice: c.firstTimePrice,
    };
  },
  { pin: false }
);
