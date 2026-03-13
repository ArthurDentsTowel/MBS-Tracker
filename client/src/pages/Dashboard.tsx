import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { RefreshCw, TrendingUp, TrendingDown, Minus, Lock, Unlock, Activity, Clock, AlertTriangle } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
  AreaChart, Area, CartesianGrid, BarChart, Bar, Cell, Legend,
} from "recharts";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";

// ─── Types ───────────────────────────────────────────────────────────────────

interface MarketData {
  fetchedAt: string;
  tnx: {
    price: number;
    change: number;
    changePct: number;
    dayLow: number;
    dayHigh: number;
    prevClose: number;
    date: string;
  } | null;
  mbs: {
    mbb: { price: number; change: number; changePct: number; dayLow: number; dayHigh: number; prevClose: number } | null;
    vmbs: { price: number; change: number; changePct: number; dayLow: number; dayHigh: number; prevClose: number } | null;
  };
  curve: {
    y1m?: number; y3m?: number; y1y?: number; y2y?: number;
    y5y?: number; y10y?: number; y30y?: number;
  } | null;
  couponPrices: Record<string, number>;
  lockFloatSignal: { signal: "LOCK" | "FLOAT" | "NEUTRAL"; reason: string; strength: number };
  editorialBias?: {
    headline: string | null;
    date: string | null;
    recommendations: { label: string; bias: "lock" | "float" | "neutral"; text: string }[];
    sourceUrl: string;
  };
}

interface HistoryPoint {
  date: string;
  yield10y: number;
  mbbPrice: number | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(val: number | null | undefined, decimals = 3) {
  if (val == null || isNaN(val)) return "—";
  return val.toFixed(decimals);
}

function fmtChange(val: number | null | undefined, prefix = "") {
  if (val == null || isNaN(val)) return "—";
  const sign = val >= 0 ? "+" : "";
  return `${prefix}${sign}${val.toFixed(3)}`;
}

function isMarketOpen() {
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 6=Sat
  if (day === 0 || day === 6) return false;
  // NY time for bond market (7am–5pm ET approx)
  const etHour = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" })).getHours();
  return etHour >= 7 && etHour < 17;
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m ago`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ChangeIndicator({ val, suffix = "" }: { val: number | null | undefined; suffix?: string }) {
  if (val == null || isNaN(val)) return <span className="badge-neutral">—</span>;
  if (val > 0) return <span className="badge-up">▲ {fmtChange(val)}{suffix}</span>;
  if (val < 0) return <span className="badge-down">▼ {fmtChange(val)}{suffix}</span>;
  return <span className="badge-neutral">— {fmt(val)}{suffix}</span>;
}

function TrendIcon({ val }: { val: number | null | undefined }) {
  if (!val) return <Minus className="w-4 h-4 text-muted-foreground" />;
  if (val > 0) return <TrendingUp className="w-4 h-4" style={{ color: "hsl(0 72% 60%)" }} />;
  return <TrendingDown className="w-4 h-4" style={{ color: "hsl(142 71% 50%)" }} />;
}

// Custom Recharts tooltip
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="rounded-lg border px-3 py-2 text-xs"
      style={{ background: "hsl(220 13% 12%)", borderColor: "hsl(220 10% 20%)", fontFamily: "var(--font-mono)" }}
    >
      <p className="text-muted-foreground mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: p.color }}>
          {p.name}: <strong>{typeof p.value === "number" ? p.value.toFixed(3) : "—"}</strong>
        </p>
      ))}
    </div>
  );
}

// Yield Curve bar chart
function YieldCurveChart({ curve }: { curve: MarketData["curve"] }) {
  if (!curve) return (
    <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
      Yield curve unavailable
    </div>
  );

  const maturities = [
    { label: "1M", value: curve.y1m },
    { label: "3M", value: curve.y3m },
    { label: "1Y", value: curve.y1y },
    { label: "2Y", value: curve.y2y },
    { label: "5Y", value: curve.y5y },
    { label: "10Y", value: curve.y10y },
    { label: "30Y", value: curve.y30y },
  ].filter((m) => m.value != null);

  // Inverted curve detection
  const is2s10Inverted = curve.y2y && curve.y10y && curve.y10y < curve.y2y;

  return (
    <div>
      {is2s10Inverted && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-md text-xs"
          style={{ background: "hsl(0 72% 51% / 0.12)", color: "hsl(0 72% 65%)" }}>
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          2s/10s inverted — recession indicator active
        </div>
      )}
      <ResponsiveContainer width="100%" height={140}>
        <BarChart data={maturities} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="hsl(220 10% 16%)" />
          <XAxis dataKey="label" tick={{ fontSize: 11, fontFamily: "var(--font-mono)", fill: "hsl(215 12% 52%)" }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fontFamily: "var(--font-mono)", fill: "hsl(215 12% 52%)" }} axisLine={false} tickLine={false} domain={["auto", "auto"]} />
          <Tooltip content={<CustomTooltip />} />
          <Bar dataKey="value" name="Yield" radius={[3, 3, 0, 0]}>
            {maturities.map((entry, i) => (
              <Cell
                key={i}
                fill={entry.label === "10Y" ? "hsl(185 84% 42%)" : "hsl(220 10% 30%)"}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="flex justify-between mt-2 px-1">
        {maturities.map((m) => (
          <div key={m.label} className="text-center">
            <div className="metric-value text-xs" style={{
              color: m.label === "10Y" ? "hsl(185 84% 52%)" : "hsl(var(--foreground))"
            }}>{fmt(m.value, 2)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Lock/Float signal card
function LockFloatCard({
  signal,
  editorialBias,
}: {
  signal: MarketData["lockFloatSignal"];
  editorialBias?: MarketData["editorialBias"];
}) {
  const isLock = signal.signal === "LOCK";
  const isFloat = signal.signal === "FLOAT";

  const color = isLock
    ? "hsl(0 72% 51%)"
    : isFloat
    ? "hsl(142 71% 45%)"
    : "hsl(215 12% 52%)";

  const bg = isLock
    ? "hsl(0 72% 51% / 0.08)"
    : isFloat
    ? "hsl(142 71% 45% / 0.08)"
    : "hsl(220 10% 14% / 0.5)";

  const dots = [1, 2, 3].map((i) => (
    <div
      key={i}
      className="w-2.5 h-2.5 rounded-full"
      style={{
        background: i <= signal.strength ? color : "hsl(220 10% 20%)",
        transition: "background 0.3s",
      }}
    />
  ));

  return (
    <div className="data-card p-4 flex flex-col gap-3" style={{ background: bg, borderColor: `${color}33` }}>
      <div className="flex items-center justify-between">
        <span className="section-label">Lock / Float</span>
        <div className="flex gap-1">{dots}</div>
      </div>
      <div className="flex items-center gap-3">
        {isLock ? (
          <Lock className="w-7 h-7 flex-shrink-0" style={{ color }} />
        ) : isFloat ? (
          <Unlock className="w-7 h-7 flex-shrink-0" style={{ color }} />
        ) : (
          <Minus className="w-7 h-7 flex-shrink-0" style={{ color }} />
        )}
        <div>
          <div className="metric-value text-lg font-bold" style={{ color }}>
            {signal.signal}
          </div>
          <div className="text-xs mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>
            {signal.reason}
          </div>
        </div>
      </div>

      {editorialBias && editorialBias.recommendations.length > 0 && (
        <>
          <div className="border-t" style={{ borderColor: "hsl(220 10% 20%)" }} />
          <div>
            <div className="flex items-center justify-between mb-2">
              <a
                href={editorialBias.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-medium hover:underline"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                moving.com ↗
              </a>
              {editorialBias.date && (
                <span className="text-xs" style={{ color: "hsl(215 12% 40%)" }}>
                  {editorialBias.date}
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {editorialBias.recommendations.map((rec, i) => {
                const badgeColor =
                  rec.bias === "lock"
                    ? { bg: "hsl(0 72% 51% / 0.15)", text: "hsl(0 72% 65%)", border: "hsl(0 72% 51% / 0.3)" }
                    : rec.bias === "float"
                    ? { bg: "hsl(142 71% 45% / 0.15)", text: "hsl(142 71% 55%)", border: "hsl(142 71% 45% / 0.3)" }
                    : { bg: "hsl(220 10% 18%)", text: "hsl(215 12% 52%)", border: "hsl(220 10% 25%)" };
                // Shorten label: "Locking Today" → "Today", "Locking This Week" → "This Week"
                const shortLabel = rec.label.replace(/^lock(?:ing)?\s*/i, "").trim() || rec.label;
                return (
                  <div
                    key={i}
                    title={rec.text}
                    className="text-xs px-2 py-1 rounded"
                    style={{
                      background: badgeColor.bg,
                      color: badgeColor.text,
                      border: `1px solid ${badgeColor.border}`,
                    }}
                  >
                    {shortLabel || rec.label}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [historyDays, setHistoryDays] = useState(30);

  const { data: market, isLoading: marketLoading, refetch: refetchMarket, error: marketError } = useQuery<MarketData>({
    queryKey: ["/api/market"],
    refetchInterval: 5 * 60 * 1000, // 5 min
    refetchIntervalInBackground: false,
    staleTime: 4 * 60 * 1000,
  });

  const { data: history, isLoading: historyLoading } = useQuery<HistoryPoint[]>({
    queryKey: ["/api/history", historyDays],
    queryFn: () => fetch(`/api/history?days=${historyDays}`).then((r) => r.json()),
    staleTime: 10 * 60 * 1000,
  });

  // Update refresh time when data comes in
  useEffect(() => {
    if (market) setLastRefresh(new Date());
  }, [market]);

  const handleRefresh = () => {
    refetchMarket();
    setLastRefresh(new Date());
  };

  // Prepare history chart data
  const chartData = history?.map((h) => ({
    date: h.date.slice(5), // MM-DD
    "10yr": h.yield10y,
    MBB: h.mbbPrice,
  })) ?? [];

  // Compute spread (approximate MBS implied yield vs 10yr)
  // MBB 30-day SEC yield approximation: for visualization we show MBB price vs 10yr direction
  const spread = market?.curve?.y10y && market.mbs?.mbb?.price
    ? (market.curve.y10y + 1.65 - (100 - market.mbs.mbb.price) * 0.1) // simplified spread proxy
    : null;

  const marketOpen = isMarketOpen();
  const dataStale = market ? (Date.now() - new Date(market.fetchedAt).getTime()) > 10 * 60 * 1000 : false;

  return (
    <div className="flex flex-col h-screen" style={{ background: "hsl(var(--background))" }}>
      {/* Header */}
      <header
        className="flex items-center justify-between px-5 py-3 border-b flex-shrink-0"
        style={{ borderColor: "hsl(var(--border))", background: "hsl(220 13% 8%)" }}
      >
        <div className="flex items-center gap-3">
          {/* SVG Logo */}
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-label="MBS Tracker" className="flex-shrink-0">
            <rect width="28" height="28" rx="6" fill="hsl(185 84% 42% / 0.15)" />
            <path d="M6 20 L6 14 L10 10 L14 14 L18 8 L22 12 L22 20" stroke="hsl(185 84% 42%)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            <circle cx="22" cy="12" r="2" fill="hsl(185 84% 42%)" />
          </svg>
          <div>
            <h1 className="font-bold text-sm leading-tight" style={{ color: "hsl(var(--foreground))" }}>MBS Tracker</h1>
            <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>Secondary Market Monitor</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Market status */}
          <div className="flex items-center gap-1.5 text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
            <span className={`pulse-dot ${!marketOpen ? "stale" : ""}`} />
            {marketOpen ? "Markets Open" : "Markets Closed"}
          </div>

          {/* Last update */}
          <div className="flex items-center gap-1.5 text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
            <Clock className="w-3 h-3" />
            {market ? timeAgo(market.fetchedAt) : "—"}
          </div>

          {/* Refresh */}
          <button
            onClick={handleRefresh}
            data-testid="button-refresh"
            disabled={marketLoading}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md transition-colors"
            style={{
              background: "hsl(220 10% 16%)",
              color: "hsl(var(--foreground))",
              border: "1px solid hsl(var(--border))",
            }}
          >
            <RefreshCw className={`w-3 h-3 ${marketLoading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 main-scroll p-4">
        {marketError && (
          <div className="mb-4 px-4 py-3 rounded-lg text-sm flex items-center gap-2"
            style={{ background: "hsl(0 72% 51% / 0.1)", color: "hsl(0 72% 65%)", border: "1px solid hsl(0 72% 51% / 0.2)" }}>
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            Data fetch failed. Markets may be closed or data provider unavailable. Last data shown may be delayed.
          </div>
        )}

        <div className="dashboard-grid">
          {/* ─── 10yr Treasury — Primary KPI ─── */}
          <div className="data-card p-4 col-span-12 md:col-span-4" data-testid="card-tnx">
            <div className="flex items-center justify-between mb-1">
              <span className="section-label">10-Year Treasury</span>
              <TrendIcon val={market?.tnx?.change} />
            </div>
            {marketLoading && !market ? (
              <div className="h-12 rounded animate-pulse" style={{ background: "hsl(var(--muted))" }} />
            ) : (
              <>
                <div className="flex items-end gap-3 mt-2">
                  <span className="metric-value text-4xl font-bold" style={{ color: "hsl(185 84% 52%)" }} data-testid="text-tnx-price">
                    {fmt(market?.tnx?.price, 3)}
                    <span className="text-lg ml-1" style={{ color: "hsl(var(--muted-foreground))" }}>%</span>
                  </span>
                  <ChangeIndicator val={market?.tnx?.change} suffix="bps" />
                </div>
                <div className="flex items-center gap-4 mt-3 text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                  <span>L: <span className="metric-value text-foreground">{fmt(market?.tnx?.dayLow, 3)}</span></span>
                  <span>H: <span className="metric-value text-foreground">{fmt(market?.tnx?.dayHigh, 3)}</span></span>
                  <span>Prev: <span className="metric-value text-foreground">{fmt(market?.tnx?.prevClose, 3)}</span></span>
                </div>
                {/* Intraday range bar */}
                {market?.tnx && (
                  <div className="mt-3">
                    <div className="flex justify-between text-xs mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                      <span>{fmt(market.tnx.dayLow, 3)}</span>
                      <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>Day Range</span>
                      <span>{fmt(market.tnx.dayHigh, 3)}</span>
                    </div>
                    <div className="h-1.5 rounded-full" style={{ background: "hsl(220 10% 18%)" }}>
                      <div
                        className="h-1.5 rounded-full"
                        style={{
                          background: "hsl(185 84% 42%)",
                          width: market.tnx.dayHigh !== market.tnx.dayLow
                            ? `${((market.tnx.price - market.tnx.dayLow) / (market.tnx.dayHigh - market.tnx.dayLow)) * 100}%`
                            : "50%",
                        }}
                      />
                    </div>
                  </div>
                )}
              </>
            )}
            <div className="mt-3 pt-3 border-t text-xs" style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>
              ^TNX · CBOE · {market?.tnx?.date ?? "—"}
            </div>
          </div>

          {/* ─── Lock / Float Signal ─── */}
          <div className="col-span-12 md:col-span-4">
            {market ? (
              <LockFloatCard signal={market.lockFloatSignal} editorialBias={market.editorialBias} />
            ) : (
              <div className="data-card p-4 h-full flex items-center justify-center">
                <div className="h-20 w-full rounded animate-pulse" style={{ background: "hsl(var(--muted))" }} />
              </div>
            )}
          </div>

          {/* ─── MBS ETF Panel ─── */}
          <div className="data-card p-4 col-span-12 md:col-span-4" data-testid="card-mbs">
            <div className="flex items-center justify-between mb-1">
              <span className="section-label">MBS ETFs</span>
              <Activity className="w-3.5 h-3.5" style={{ color: "hsl(var(--muted-foreground))" }} />
            </div>
            {marketLoading && !market ? (
              <div className="space-y-2 mt-2">
                <div className="h-8 rounded animate-pulse" style={{ background: "hsl(var(--muted))" }} />
                <div className="h-8 rounded animate-pulse" style={{ background: "hsl(var(--muted))" }} />
              </div>
            ) : (
              <div className="space-y-3 mt-2">
                {/* MBB */}
                <div className="flex items-center justify-between py-2 border-b" style={{ borderColor: "hsl(var(--border))" }}>
                  <div>
                    <span className="text-sm font-semibold">MBB</span>
                    <span className="text-xs ml-2" style={{ color: "hsl(var(--muted-foreground))" }}>iShares MBS</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="metric-value text-sm" data-testid="text-mbb-price">${fmt(market?.mbs?.mbb?.price, 2)}</span>
                    <ChangeIndicator val={market?.mbs?.mbb?.changePct} suffix="%" />
                  </div>
                </div>
                {/* VMBS */}
                <div className="flex items-center justify-between py-2">
                  <div>
                    <span className="text-sm font-semibold">VMBS</span>
                    <span className="text-xs ml-2" style={{ color: "hsl(var(--muted-foreground))" }}>Vanguard MBS</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="metric-value text-sm" data-testid="text-vmbs-price">${fmt(market?.mbs?.vmbs?.price, 2)}</span>
                    <ChangeIndicator val={market?.mbs?.vmbs?.changePct} suffix="%" />
                  </div>
                </div>
                {/* Spread note */}
                <div className="text-xs pt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                  MBS ETFs closely track UMBS coupon movement. Price up = rates improving.
                </div>
              </div>
            )}
          </div>

          {/* ─── Yield Curve ─── */}
          <div className="data-card p-4 col-span-12 md:col-span-6" data-testid="card-yield-curve">
            <div className="flex items-center justify-between mb-3">
              <span className="section-label">Yield Curve</span>
              <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>US Treasury</span>
            </div>
            {marketLoading && !market ? (
              <div className="h-40 rounded animate-pulse" style={{ background: "hsl(var(--muted))" }} />
            ) : (
              <YieldCurveChart curve={market?.curve ?? null} />
            )}
          </div>

          {/* ─── MBS Spread Calculator ─── */}
          <div className="data-card p-4 col-span-12 md:col-span-6" data-testid="card-spread">
            <div className="flex items-center justify-between mb-3">
              <span className="section-label">Key Spreads</span>
              <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>Rate Context</span>
            </div>
            {marketLoading && !market ? (
              <div className="space-y-2">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="h-7 rounded animate-pulse" style={{ background: "hsl(var(--muted))" }} />
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                {[
                  {
                    label: "2yr / 10yr Spread",
                    value: market?.curve?.y10y && market?.curve?.y2y
                      ? market.curve.y10y - market.curve.y2y
                      : null,
                    tooltip: "Negative = inverted curve",
                    unit: "bps",
                    scaleBy: 100,
                  },
                  {
                    label: "5yr / 30yr Spread",
                    value: market?.curve?.y30y && market?.curve?.y5y
                      ? market.curve.y30y - market.curve.y5y
                      : null,
                    tooltip: "Shape of long end",
                    unit: "bps",
                    scaleBy: 100,
                  },
                  {
                    label: "10yr → 30yr Mortgage Premium",
                    value: market?.curve?.y10y
                      ? 1.65 // historical avg MBS spread to 10yr
                      : null,
                    tooltip: "~165bps avg spread (30yr fixed to 10yr)",
                    unit: "bps",
                    scaleBy: 100,
                    fixed: true,
                  },
                  {
                    label: "Estimated 30yr Mortgage Rate",
                    value: market?.curve?.y10y
                      ? market.curve.y10y + 1.65
                      : null,
                    tooltip: "10yr + ~165bps avg MBS spread",
                    unit: "%",
                    scaleBy: 1,
                  },
                ].map((row) => (
                  <div key={row.label} className="flex items-center justify-between py-1.5 border-b last:border-0"
                    style={{ borderColor: "hsl(var(--border))" }}>
                    <div>
                      <span className="text-xs">{row.label}</span>
                      <span className="text-xs ml-2" style={{ color: "hsl(var(--muted-foreground))" }}>({row.tooltip})</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="metric-value text-sm">
                        {row.value != null
                          ? `${(row.value * row.scaleBy).toFixed(row.unit === "%" ? 2 : 0)} ${row.unit}`
                          : "—"}
                      </span>
                      {row.value != null && row.unit === "bps" && !row.fixed && (
                        <span className={row.value < 0 ? "badge-down" : "badge-up"}>
                          {row.value < 0 ? "INV" : "NRM"}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
                <div className="text-xs mt-2 pt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                  Mortgage rate estimate = 10yr + ~165bps (historical avg). Actual spread varies with market conditions.
                </div>
              </div>
            )}
          </div>

          {/* ─── Historical Chart ─── */}
          <div className="data-card p-4 col-span-12" data-testid="card-history">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-4">
                <span className="section-label">10-Year Treasury &amp; MBB History</span>
                <div className="flex items-center gap-3 text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-3 h-0.5" style={{ background: "hsl(185 84% 42%)" }} />
                    10yr yield
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-3 h-0.5" style={{ background: "hsl(262 80% 65%)" }} />
                    MBB price
                  </span>
                </div>
              </div>
              <div className="flex gap-1">
                {[
                  { label: "30D", days: 30 },
                  { label: "60D", days: 60 },
                  { label: "90D", days: 90 },
                ].map((opt) => (
                  <button
                    key={opt.days}
                    onClick={() => setHistoryDays(opt.days)}
                    data-testid={`button-history-${opt.label}`}
                    className="text-xs px-2.5 py-1 rounded transition-colors"
                    style={{
                      background: historyDays === opt.days ? "hsl(185 84% 42% / 0.2)" : "hsl(220 10% 16%)",
                      color: historyDays === opt.days ? "hsl(185 84% 52%)" : "hsl(var(--muted-foreground))",
                      border: `1px solid ${historyDays === opt.days ? "hsl(185 84% 42% / 0.4)" : "hsl(var(--border))"}`,
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {historyLoading ? (
              <div className="h-48 rounded animate-pulse" style={{ background: "hsl(var(--muted))" }} />
            ) : chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartData} margin={{ top: 4, right: 48, left: -15, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 10% 15%)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fontFamily: "var(--font-mono)", fill: "hsl(215 12% 52%)" }}
                    axisLine={false}
                    tickLine={false}
                    interval={Math.floor(chartData.length / 6)}
                  />
                  <YAxis
                    yAxisId="yield"
                    orientation="left"
                    domain={["auto", "auto"]}
                    tick={{ fontSize: 10, fontFamily: "var(--font-mono)", fill: "hsl(185 84% 42%)" }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => `${v.toFixed(2)}%`}
                  />
                  <YAxis
                    yAxisId="price"
                    orientation="right"
                    domain={["auto", "auto"]}
                    tick={{ fontSize: 10, fontFamily: "var(--font-mono)", fill: "hsl(262 80% 65%)" }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => `$${v.toFixed(0)}`}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Line
                    yAxisId="yield"
                    type="monotone"
                    dataKey="10yr"
                    name="10yr yield"
                    stroke="hsl(185 84% 42%)"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, fill: "hsl(185 84% 42%)" }}
                  />
                  <Line
                    yAxisId="price"
                    type="monotone"
                    dataKey="MBB"
                    name="MBB price"
                    stroke="hsl(262 80% 65%)"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, fill: "hsl(262 80% 65%)" }}
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-48 text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
                No historical data available
              </div>
            )}
          </div>

          {/* ─── UMBS Coupon Prices (delayed) ─── */}
          {market?.couponPrices && Object.keys(market.couponPrices).length > 0 && (
            <div className="data-card p-4 col-span-12 md:col-span-6" data-testid="card-coupons">
              <div className="flex items-center justify-between mb-3">
                <span className="section-label">UMBS 30YR Coupons</span>
                <span className="text-xs px-2 py-0.5 rounded" style={{ background: "hsl(40 80% 50% / 0.12)", color: "hsl(40 80% 65%)" }}>
                  Delayed
                </span>
              </div>
              <div className="space-y-2">
                {Object.entries(market.couponPrices)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([key, price]) => {
                    const couponLabel = key.replace("umbs", "").replace(/(\d)(\d)$/, "$1.$2") + "%";
                    const isCurrentCoupon = price >= 98 && price <= 102;
                    return (
                      <div key={key} className="flex items-center justify-between py-1.5 border-b last:border-0"
                        style={{ borderColor: "hsl(var(--border))" }}>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium">UMBS {couponLabel}</span>
                          {isCurrentCoupon && (
                            <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "hsl(185 84% 42% / 0.12)", color: "hsl(185 84% 52%)" }}>
                              Current
                            </span>
                          )}
                        </div>
                        <span className="metric-value text-sm">{price.toFixed(4)}</span>
                      </div>
                    );
                  })}
              </div>
              <p className="text-xs mt-3" style={{ color: "hsl(var(--muted-foreground))" }}>
                Source: Mortgage News Daily · Delayed pricing
              </p>
            </div>
          )}

          {/* ─── Data Sources / Methodology ─── */}
          <div className="data-card p-4 col-span-12 md:col-span-6" data-testid="card-sources">
            <div className="mb-3">
              <span className="section-label">Data Sources & Methodology</span>
            </div>
            <div className="space-y-2 text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
              {[
                { label: "10yr Treasury (^TNX)", source: "CBOE via Stooq (free, EOD)", note: "Most authoritative daily rate" },
                { label: "MBB / VMBS ETFs", source: "NYSE via Stooq (free, EOD)", note: "Proxy for current coupon MBS pricing" },
                { label: "Full Yield Curve", source: "US Treasury via Stooq", note: "1mo through 30yr maturities" },
                { label: "UMBS Coupon Prices", source: "Mortgage News Daily (delayed)", note: "Price in 32nds converted to decimal" },
                { label: "Lock/Float Signal", source: "Computed from ^TNX daily change", note: "Simple momentum heuristic — not advisory" },
              ].map((item) => (
                <div key={item.label} className="flex gap-3 py-1.5 border-b last:border-0" style={{ borderColor: "hsl(var(--border))" }}>
                  <div className="w-2 h-2 rounded-full mt-1 flex-shrink-0" style={{ background: "hsl(185 84% 42%)" }} />
                  <div>
                    <span className="font-medium" style={{ color: "hsl(var(--foreground))" }}>{item.label}</span>
                    <span className="mx-2">·</span>
                    <span>{item.source}</span>
                    <div style={{ color: "hsl(215 12% 45%)" }}>{item.note}</div>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs mt-3 pt-2 border-t" style={{ borderColor: "hsl(var(--border))", color: "hsl(215 12% 40%)" }}>
              Not financial advice. For informational use only. All data subject to delay and availability.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 pb-4 flex items-center justify-between text-xs" style={{ color: "hsl(215 12% 40%)" }}>
          <span>MBS Tracker · Auto-refreshes every 5 min during market hours</span>
          <PerplexityAttribution />
        </div>
      </main>
    </div>
  );
}
