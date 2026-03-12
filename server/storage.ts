import { type MarketSnapshot, type YieldHistory } from "@shared/schema";

export interface IStorage {
  getLatestSnapshot(): MarketSnapshot | null;
  saveSnapshot(snapshot: Omit<MarketSnapshot, "id" | "fetchedAt">): MarketSnapshot;
  getYieldHistory(days?: number): YieldHistory[];
  saveYieldHistory(records: Omit<YieldHistory, "id">[]): void;
}

export class MemStorage implements IStorage {
  private latestSnapshot: MarketSnapshot | null = null;
  private yieldHistoryStore: YieldHistory[] = [];
  private nextId = 1;

  getLatestSnapshot(): MarketSnapshot | null {
    return this.latestSnapshot;
  }

  saveSnapshot(snapshot: Omit<MarketSnapshot, "id" | "fetchedAt">): MarketSnapshot {
    this.latestSnapshot = {
      id: this.nextId++,
      fetchedAt: new Date(),
      ...snapshot,
    };
    return this.latestSnapshot;
  }

  getYieldHistory(days = 90): YieldHistory[] {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().split("T")[0];
    return this.yieldHistoryStore
      .filter((r) => r.date >= cutoffStr)
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  saveYieldHistory(records: Omit<YieldHistory, "id">[]): void {
    const existing = new Set(this.yieldHistoryStore.map((r) => r.date));
    for (const rec of records) {
      if (!existing.has(rec.date)) {
        this.yieldHistoryStore.push({ id: this.nextId++, ...rec });
        existing.add(rec.date);
      }
    }
  }
}

export const storage = new MemStorage();
