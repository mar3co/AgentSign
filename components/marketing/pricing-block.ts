// One source for the pricing-as-data panel; mirrors FREE_SEND_LIMIT,
// FREE_KEEP_DAYS, PRO_KEEP_DAYS, and AGENT_CAP.
export const PRICING_BLOCK = `{
  "free": {
    "price_usd": 0,
    "keep_days": 7,
    "sends_per_30d": 20
  },
  "pro": {
    "price_usd_month": 19,
    "keep_days": 365,
    "named_agents": 10,
    "seats": "unlimited, flat"
  }
}`;
