import type { Express } from "express";
import { createServer, type Server } from "http";

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

// ─── CNBC Quote API ───────────────────────────────────────────────────────────

async function cnbcQuote(symbol: string): Promise<any> {
  const url = `https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=${symbol}&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json`;
  const data = await fetchJSON(url);
  return data?.FormattedQuoteResult?.FormattedQuote?.[0] ?? null;
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

// ─── 10-Year Treasury ─────────────────────────────────────────────────────────

async function getTNXQuote() {
  try {
    const q = await cnbcQuote("US10Y");
    if (!q) return null;

    const price = parsePrice(q.last);
    const change = parseChange(q.change);
    const open = parsePrice(q.open);

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

// ─── MBS ETFs ─────────────────────────────────────────────────────────────────

async function getMBSETFs() {
  try {
    const [mbbQ, vmbsQ] = await Promise.all([
      cnbcQuote("MBB"),
      cnbcQuote("VMBS"),
    ]);

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

// ─── Yield Curve (CNBC) ───────────────────────────────────────────────────────

async function getYieldCurve() {
  try {
    // Fetch multiple maturities in parallel
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

    const curve: any = { date: new Date().toISOString().split("T")[0] };
    for (const r of results) curve[r.key] = r.value;

    return {
      date: curve.date,
      y1m: null,
      y3m: curve.y3m,
      y1y: null,
      y2y: curve.y2y,
      y5y: curve.y5y,
      y10y: curve.y10y,
      y30y: curve.y30y,
    };
  } catch (e) {
    console.error("Yield curve error:", e);
    return null;
  }
}

// ─── UMBS Coupon Prices from MND (delayed) ────────────────────────────────────

async function getMNDCouponPrices(): Promise<Record<string, number>> {
  try {
    const html = await fetchText("https://www.mortgagenewsdaily.com/mbs");
    const prices: Record<string, number> = {};
    // MND HTML structure: <tr data-product="FNMA45"> ... <td class="rate">97-24</td>
    const rowMatches = Array.from(html.matchAll(/<tr[^>]+data-product="FNMA(\d+)"[^>]*>[\s\S]*?<td class="rate">\s*([\d]+)-([\d]+)\s*<\/td>/g));
    for (const m of rowMatches) {
      const couponRaw = m[1]; // e.g. "45" → 4.5, "50" → 5.0
      const whole = parseInt(m[2]);
      const thirtySeconds = parseInt(m[3]);
      if (!isNaN(whole) && !isNaN(thirtySeconds)) {
        const price = +(whole + thirtySeconds / 32).toFixed(4);
        const key = `umbs${couponRaw}`; // e.g. umbs45, umbs50
        if (!prices[key]) prices[key] = price;
      }
    }
    return prices;
  } catch (e) {
    console.error("MND error:", e);
    return {};
  }
}

// ─── Historical data from Yahoo Finance (free, no auth) ──────────────────────

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

// ─── Moving.com Editorial Lock Bias ──────────────────────────────────────────

interface EditorialRecommendation {
  label: string;
  bias: "lock" | "float" | "neutral";
  text: string;
}

interface EditorialBias {
  headline: string | null;
  date: string | null;
  recommendations: EditorialRecommendation[];
  sourceUrl: string;
}

async function getMovingComBias(): Promise<EditorialBias | null> {
  try {
    const url = "https://www.moving.com/mortgage/mortgage-market-commentary.asp";
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // Site uses Windows-1252/latin-1 encoding
    const buf = await res.arrayBuffer();
    const html = new TextDecoder("windows-1252").decode(buf);

    // Extract date from meta description or article text
    const dateMatch =
      html.match(/commentary.*?for\s+((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4})/i) ??
      html.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}/i) ??
      html.match(/\b(\d{1,2}\/\d{1,2}\/\d{4})\b/);
    const date = dateMatch ? dateMatch[1] ?? dateMatch[0] : null;

    // Extract headline — first <h1> or <h2> tag text
    const headlineMatch = html.match(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/i);
    const headline = headlineMatch
      ? headlineMatch[1].replace(/<[^>]+>/g, "").replace(/&nbsp;/gi, " ").trim()
      : null;

    // Extract lock/float recommendations
    // HTML format: <A href="...#Lock...">Lock</A> if my closing were taking place within 7 days...<br>
    const recommendations: EditorialRecommendation[] = [];
    const recPattern = /<A[^>]*#(Lock|Float)[^>]*>(?:Lock|Float)<\/A>\s*if my closing were taking place\s*([^<.]+)/gi;
    const recMatches = Array.from(html.matchAll(recPattern));
    for (const m of recMatches) {
      const biasWord = m[1].toLowerCase() as "lock" | "float";
      const timeframe = m[2].trim().replace(/\s*\.*$/, ""); // e.g. "within 7 days"
      // Format label: "Within 7 Days", "8–20 Days", etc.
      const label = timeframe
        .replace(/between (\d+) and (\d+)/, "$1–$2")
        .replace(/\b\w/g, (c: string) => c.toUpperCase());
      recommendations.push({
        label,
        bias: biasWord,
        text: `${biasWord === "lock" ? "Lock" : "Float"} if closing ${timeframe}`,
      });
    }

    return { headline, date, recommendations, sourceUrl: url };
  } catch (e) {
    console.error("MovingCom bias error:", e);
    return null;
  }
}

// ─── Lock/Float Signal ────────────────────────────────────────────────────────

function computeLockFloatSignal(tnx: { price: number | null; change: number | null } | null) {
  if (!tnx?.price || tnx.change == null) {
    return { signal: "NEUTRAL" as const, reason: "Insufficient data to generate signal", strength: 1 };
  }

  const change = tnx.change;

  if (change >= 0.08) {
    const strength = change >= 0.2 ? 3 : change >= 0.12 ? 2 : 1;
    return {
      signal: "LOCK" as const,
      reason: `10yr +${change.toFixed(3)}% today — yield rising, rates likely worsening`,
      strength,
    };
  }

  if (change <= -0.08) {
    const abs = Math.abs(change);
    const strength = abs >= 0.2 ? 3 : abs >= 0.12 ? 2 : 1;
    return {
      signal: "FLOAT" as const,
      reason: `10yr ${change.toFixed(3)}% today — yield falling, rates may improve`,
      strength,
    };
  }

  return {
    signal: "NEUTRAL" as const,
    reason: `10yr flat (${change >= 0 ? "+" : ""}${change.toFixed(3)}%) — no clear direction`,
    strength: 1,
  };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function registerRoutes(httpServer: Server, app: Express) {
  // Main market data
  app.get("/api/market", async (_req, res) => {
    try {
      const [tnx, mbs, curve, couponPrices, editorialBias] = await Promise.all([
        getTNXQuote(),
        getMBSETFs(),
        getYieldCurve(),
        getMNDCouponPrices(),
        getMovingComBias(),
      ]);

      res.json({
        fetchedAt: new Date().toISOString(),
        tnx,
        mbs,
        curve,
        couponPrices,
        lockFloatSignal: computeLockFloatSignal(tnx),
        ...(editorialBias ? { editorialBias } : {}),
      });
    } catch (e: any) {
      console.error("/api/market error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // Historical data
  app.get("/api/history", async (req, res) => {
    try {
      const days = Math.min(parseInt(req.query.days as string) || 90, 365);
      const data = await getHistoricalData(days);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  return httpServer;
}
