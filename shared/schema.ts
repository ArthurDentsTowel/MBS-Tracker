import { pgTable, text, real, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Market snapshot stored in memory (no DB needed for this app)
export const marketSnapshots = pgTable("market_snapshots", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
  tnxPrice: real("tnx_price"),
  tnxChange: real("tnx_change"),
  tnxChangePct: real("tnx_change_pct"),
  tnxDayLow: real("tnx_day_low"),
  tnxDayHigh: real("tnx_day_high"),
  tnxPrevClose: real("tnx_prev_close"),
  mbbPrice: real("mbb_price"),
  mbbChange: real("mbb_change"),
  mbbChangePct: real("mbb_change_pct"),
  vmbbPrice: real("vmbs_price"),
  vmbbChange: real("vmbs_change"),
  vmbbChangePct: real("vmbs_change_pct"),
  // Treasury curve
  yield1m: real("yield_1m"),
  yield3m: real("yield_3m"),
  yield1y: real("yield_1y"),
  yield2y: real("yield_2y"),
  yield5y: real("yield_5y"),
  yield10y: real("yield_10y"),
  yield30y: real("yield_30y"),
  // MND delayed coupon data
  umbs45: real("umbs_45"),
  umbs50: real("umbs_50"),
  umbs55: real("umbs_55"),
  umbs60: real("umbs_60"),
  umbs65: real("umbs_65"),
});

export const insertMarketSnapshotSchema = createInsertSchema(marketSnapshots).omit({ id: true, fetchedAt: true });
export type InsertMarketSnapshot = z.infer<typeof insertMarketSnapshotSchema>;
export type MarketSnapshot = typeof marketSnapshots.$inferSelect;

// Historical yield data for sparklines / charts
export const yieldHistory = pgTable("yield_history", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  date: text("date").notNull(),
  yield10y: real("yield_10y").notNull(),
  yield2y: real("yield_2y"),
  yield30y: real("yield_30y"),
  mbbClose: real("mbb_close"),
  spread: real("spread"), // MBB yield implied vs 10y
});

export type YieldHistory = typeof yieldHistory.$inferSelect;
