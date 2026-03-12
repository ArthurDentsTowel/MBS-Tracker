import type { VercelRequest, VercelResponse } from "@vercel/node";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function fetchJSON(url: string, headers: Record<string, string> = {}): Promise<any> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      Accept: "application/json",
      ...headers,
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 MBSTracker/1.0" },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.text();
}

function parsePrice(str: string | null | undefined): number | null {
  if (!str) return null;
  const num = parseFloat(str.replace(/[%,]/g, "").trim());
  return isNaN(num) ? null : num;
}

function parseChange(str: string | null | undefined): number | null {
  if (!str) return null;
  const num = parseFloat(str.replace(/[%,+]/g, "").trim());
  return isNaN(num) ? null : num;
}

// ─── CNBC ─────────────────────────────────────────────────────────────────────

async function cnbcQuote(symbol: string): Promise<any> {
  const url = `https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=${symbol}&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json`;
  const data = await fetchJSON(url);
  return data?.FormattedQuoteResult?.FormattedQuote?.[0] ?? null;
}

async function getTNXQuote() {
  try {
    const q = await cnbcQuote("US10Y");
    if (!q) return null;
    const price = parsePrice(q.last);
    const change = parseChange(q.change);
    return {
      price: price ? +price.toFixed(3) : null,
      change: change ? +change.toFixed(3) : null,
      changePct: price && change ? +((change / (price - change)) * 100).toFixed(3) : null,
      dayLow: parsePrice(q.low),
      dayHigh: parsePrice(q.high),
      prevClose: price && change ? +(price - change).toFixed(3) : null,
      date: new Date().toISOString().split("T")[0],
      lastUpdated: q.last_time ?? null,
    };
  } catch (e) {
    console.error("TNX error:", e);
    return null;
  }
}

async function getMBSETFs() {
  try {
    const [mbbQ, vmbsQ] = await Promise.all([cnbcQuote("MBB"), cnbcQuote("VMBS")]);
    function parseETF(q: any) {
      if (!q) return null;
      const price = parsePrice(q.last);
      const change = parseChange(q.change);
      const changePct = parseChange(q.change_pct ?? q.pctChange);
      return {
        price: price ? +price.toFixed(2) : null,
        change: change ? +change.toFixed(3) : null,
        changePct: changePct ? +changePct.toFixed(3) : null,
        dayLow: parsePrice(q.low),
        dayHigh: parsePrice(q.high),
        prevClose: price && change ? +(price - change).toFixed(2) : null,
        lastUpdated: q.last_time ?? null,
      };
    }
    return { mbb: parseETF(mbbQ), vmbs: parseETF(vmbsQ) };
  } catch (e) {
    console.error("MBS ETF error:", e);
    return { mbb: null, vmbs: null };
  }
}

async function getYieldCurve() {
  try {
    const symbols = [
      { key: "y3m", sym: "US3M" },
      { key: "y2y", sym: "US2Y" },
      { key: "y5y", sym: "US5Y" },
      { key: "y10y", sym: "US10Y" },
      { key: "y30y", sym: "US30Y" },
    ];
    const results = await Promise.all(
      symbols.map(async ({ key, sym }) => {
        try {
          const q = await cnbcQuote(sym);
          return { key, value: q ? parsePrice(q.last) : null };
        } catch {
          return { key, value: null };
        }
      })
    );
    const curve: any = {};
    for (const r of results) curve[r.key] = r.value;
    return {
      date: new Date().toISOString().split("T")[0],
      y1m: null, y3m: curve.y3m, y1y: null,
      y2y: curve.y2y, y5y: curve.y5y, y10y: curve.y10y, y30y: curve.y30y,
    };
  } catch (e) {
    console.error("Yield curve error:", e);
    return null;
  }
}

async function getMNDCouponPrices(): Promise<Record<string, number>> {
  try {
    const html = await fetchText("https://www.mortgagenewsdaily.com/mbs");
    const prices: Record<string, number> = {};
    const rowMatches = Array.from(html.matchAll(/<tr[^>]+data-product="FNMA(\d+)"[^>]*>[\s\S]*?<td class="rate">\s*([\d]+)-([\d]+)\s*<\/td>/g));
    for (const m of rowMatches) {
      const couponRaw = m[1];
      const whole = parseInt(m[2]);
      const thirtySeconds = parseInt(m[3]);
      if (!isNaN(whole) && !isNaN(thirtySeconds)) {
        const price = +(whole + thirtySeconds / 32).toFixed(4);
        const key = `umbs${couponRaw}`;
        if (!prices[key]) prices[key] = price;
      }
    }
    return prices;
  } catch (e) {
    console.error("MND error:", e);
    return {};
  }
}

async function fetchYahooHistory(symbol: string, range: string): Promise<Map<string, number>> {
  const encoded = encodeURIComponent(symbol);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?interval=1d&range=${range}`;
  const data = await fetchJSON(url);
  const result = data?.chart?.result?.[0];
  if (!result) return new Map();
  const timestamps: number[] = result.timestamp ?? [];
  const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];
  const map = new Map<string, number>();
  for (let i = 0; i < timestamps.length; i++) {
    const c = closes[i];
    if (c != null) {
      const date = new Date(timestamps[i] * 1000).toISOString().split("T")[0];
      map.set(date, c);
    }
  }
  return map;
}

async function getHistoricalData(days = 90) {
  try {
    const range = days <= 30 ? "1mo" : "3mo";
    const cutoffDate = new Date(Date.now() - days * 86400 * 1000).toISOString().split("T")[0];
    const [tnxMap, mbbMap] = await Promise.all([
      fetchYahooHistory("^TNX", range),
      fetchYahooHistory("MBB", range),
    ]);
    const dates = Array.from(tnxMap.keys()).filter((d) => d >= cutoffDate).sort();
    return dates.map((date) => ({
      date,
      yield10y: +tnxMap.get(date)!.toFixed(3),
      mbbPrice: mbbMap.has(date) ? +mbbMap.get(date)!.toFixed(2) : null,
    }));
  } catch (e) {
    console.error("Historical data error:", e);
    return [];
  }
}

function computeLockFloatSignal(tnx: { price: number | null; change: number | null } | null) {
  if (!tnx?.price || tnx.change == null) {
    return { signal: "NEUTRAL" as const, reason: "Insufficient data to generate signal", strength: 1 };
  }
  const change = tnx.change;
  if (change >= 0.08) {
    const strength = change >= 0.2 ? 3 : change >= 0.12 ? 2 : 1;
    return { signal: "LOCK" as const, reason: `10yr +${change.toFixed(3)}% today — yield rising, rates likely worsening`, strength };
  }
  if (change <= -0.08) {
    const abs = Math.abs(change);
    const strength = abs >= 0.2 ? 3 : abs >= 0.12 ? 2 : 1;
    return { signal: "FLOAT" as const, reason: `10yr ${change.toFixed(3)}% today — yield falling, rates may improve`, strength };
  }
  return { signal: "NEUTRAL" as const, reason: `10yr flat (${change >= 0 ? "+" : ""}${change.toFixed(3)}%) — no clear direction`, strength: 1 };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const url = new URL(req.url!, `http://localhost`);
  const path = url.pathname;

  if (path === "/api/market") {
    try {
      const [tnx, mbs, curve, couponPrices] = await Promise.all([
        getTNXQuote(), getMBSETFs(), getYieldCurve(), getMNDCouponPrices(),
      ]);
      res.json({ fetchedAt: new Date().toISOString(), tnx, mbs, curve, couponPrices, lockFloatSignal: computeLockFloatSignal(tnx) });
    } catch (e: any) {
      console.error("/api/market error:", e);
      res.status(500).json({ error: e.message });
    }
    return;
  }

  if (path === "/api/history") {
    try {
      const days = Math.min(parseInt((url.searchParams.get("days") ?? "") || "90"), 365);
      const data = await getHistoricalData(days);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
    return;
  }

  res.status(404).json({ error: "Not found" });
}
