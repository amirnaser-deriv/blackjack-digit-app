"use client";

import React, {
  useState,
  useMemo,
  useEffect,
  useRef,
} from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

// ==========================================================
// Utility helpers for combinatorics & probability of digit sums
// ==========================================================
const comb = (n: number, r: number): number => {
  if (r < 0 || r > n) return 0;
  r = Math.min(r, n - r);
  let num = 1;
  let denom = 1;
  for (let i = 1; i <= r; i++) {
    num *= n - r + i;
    denom *= i;
  }
  return num / denom;
};

const P_k_n = (k: number, n: number): number => {
  if (n < 0 || n > 9 * k) return 0;
  let sum = 0;
  for (let j = 0; j <= Math.floor(n / 10); j++) {
    const term =
      (j % 2 === 0 ? 1 : -1) *
      comb(k, j) *
      comb(n - 10 * j + k - 1, k - 1);
    sum += term;
  }
  return sum / 10 ** k;
};

const F_k = (k: number, n: number): number => {
  let acc = 0;
  for (let m = 0; m <= n; m++) acc += P_k_n(k, m);
  return acc;
};

const prob = (k: number, n: number, bet: string): number => {
  if (bet === "Equal") return P_k_n(k, n);
  if (bet === "Higher") return 1 - F_k(k, n);
  if (bet === "Lower") return F_k(k, n - 1);
  return 0;
};

const payout = (
  stake: number,
  k: number,
  n: number,
  bet: string,
  margin = 0,
): number => {
  const p = prob(k, n, bet);
  return p > 0 ? parseFloat(((stake * (1 - margin)) / p).toFixed(2)) : 0;
};

// ======================
// Deriv live‑tick helper
// ======================
const DERIV_WS_URL =
  "wss://ws.binaryws.com/websockets/v3?l=EN&app_id=1089"; // demo app‑id

const useDerivTicks = (symbol: string) => {
  const [quote, setQuote] = useState<number | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const ws = new WebSocket(DERIV_WS_URL);

    ws.onopen = () => {
      setConnected(true);
      ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
    };

    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.msg_type === "tick") {
        setQuote(parseFloat(msg.tick.quote));
      }
    };

    ws.onerror = (e) => console.error("WS error", e);
    ws.onclose = () => setConnected(false);

    return () => ws.close();
  }, [symbol]);

  return { quote, connected } as const;
};

// ======================
// Misc helpers
// ======================
const HISTORY_LEN = 10; // how many price points to retain for the chart
const lastDigit = (price: number): number => Math.floor(price * 100) % 10;

// Available markets for the user to pick
const INDEX_OPTIONS = [
  { label: "100 Vol (2 sec) Index ", value: "R_100" },
  { label: "100 Vol Index",       value: "1HZ100V" },
  { label: "CRASH 300 Index",       value: "CRASH300N" },
  { label: "BOOM 300 Index",       value: "BOOM300N" },
  { label: "Bull Index",       value: "RDBULL" },
  { label: "Bear Index",       value: "RDBEAR" },
];

// ==========================================================
// Main React Component
// ==========================================================
export default function BlackjackOptionApp() {
  // --- Inputs --- //
  const [duration, setDuration] = useState(5);
  const [target, setTarget] = useState(22);
  const [betType, setBetType] = useState("Equal");
  const [stake, setStake] = useState(1.0);
  const [margin, setMargin] = useState(0.05);
  const [symbol, setSymbol] = useState("1HZ100V");   // default market


  // Live feed (use any synthetic symbol you prefer)
  const { quote, connected } = useDerivTicks(symbol);

  // Price history for the chart
  const [history, setHistory] = useState<{ t: number; price: number }[]>([]);
  const tickRef = useRef(0);

  // --- Contract state --- //
  const [active, setActive] = useState(false);
  const [ticksLeft, setTicksLeft] = useState(0);
  const [digits, setDigits] = useState<number[]>([]);
  const [outcome, setOutcome] = useState<"win" | "lose" | null>(null);
  const runningSum = useMemo(() => digits.reduce((a, b) => a + b, 0), [digits]);

  // Pre‑computed odds & payouts (recompute when inputs change)
  const summary = useMemo(() => {
    const p = prob(duration, target, betType);
    return {
      p,
      fair: payout(stake, duration, target, betType, 0),
      offered: payout(stake, duration, target, betType, margin),
    };
  }, [duration, target, betType, stake, margin]);

  /* ---- outcome helper ---- */
  const evaluateOutcome = (sum: number): void => {
    let win: boolean;
    if (betType === "Equal") win = sum === target;
    else if (betType === "Higher") win = sum > target;
    else win = sum < target;
    setOutcome(win ? "win" : "lose");
  };

  // Push every real tick into state
  useEffect(() => {
    if (quote === null) return; // nothing yet

    tickRef.current += 1;
    setHistory((h) => [
      ...h.slice(-(HISTORY_LEN - 1)),
      { t: tickRef.current, price: quote },
    ]);

    if (active) {
      setDigits((prev) => [...prev, lastDigit(quote)]);
      setTicksLeft((tl) => tl - 1);
    }
  }, [quote, active]);

  // Finish contract when ticksLeft hits 0
  useEffect(() => {
    if (active && ticksLeft === 0) {
      setActive(false);
      evaluateOutcome(runningSum);
    }
  }, [ticksLeft, active, runningSum]);

  // Hide the win/lose banner after 1 s and show odds again
  useEffect(() => {
    if (outcome) {
      const id = setTimeout(() => setOutcome(null), 1000);
      return () => clearTimeout(id);
    }
  }, [outcome]);

  //Reset chart & counters when the user changes symbol (Only if no contract is running; prevents mid-bet switches.)
  useEffect(() => {
  if (!active) {
    setHistory([]);
    tickRef.current = 0;
    setDigits([]);
  }
}, [symbol, active]);

  const handlePlaceBet = () => {
    setOutcome(null);
    setDigits([]);
    setTicksLeft(duration);
    setActive(true);
  };

  // ------ UI helpers ------ //
  const DigitDisplay = () => (
    <div className="flex flex-wrap gap-1 items-center justify-center">
      {digits.map((d, i) => (
        <Badge key={i} variant="secondary" className="font-mono text-sm">
          {d}
        </Badge>
      ))}
      {Array.from({ length: ticksLeft }).map((_, i) => (
        <Badge
          key={`p${i}`}
          variant="outline"
          className="opacity-50 font-mono text-sm"
        >
          ?
        </Badge>
      ))}
    </div>
  );

  // ==========================================================
  // Render
  // ==========================================================
  return (
    <div className="flex flex-col items-center p-6 gap-6 max-w-xl mx-auto">
      {/* Price Card */}
      <Card className="w-full shadow-lg border border-gray-200">
        <CardContent className="p-6 space-y-4">
          <h2 className="text-xl font-bold text-center">
          {INDEX_OPTIONS.find(o => o.value === symbol)?.label ?? symbol}
          {!connected && (
            <span className="ml-2 text-xs text-red-500">(offline)</span>
          )}
        </h2>
          {/* ─── Index picker ─────────────────────────────────────────────── */}
          <div className="space-y-2">
            <Label>Market</Label>
            <Select
              value={symbol}
              disabled={active}          // lock during an active bet
              onValueChange={setSymbol}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select index" />
              </SelectTrigger>
              <SelectContent>
                {INDEX_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-center text-3xl font-mono">
            {quote !== null ? `$${quote.toFixed(2)}` : "--"}
          </p>
          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={history} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="t" hide />
                <YAxis domain={["auto", "auto"]} hide />
                <Tooltip
                  formatter={(v: number | string) =>
                    `$${(typeof v === "number" ? v : Number(v)).toFixed(2)}`
                  }
                  labelFormatter={() => ""}
                />
                <Line
                  type="monotone"
                  dataKey="price"
                  dot={false}
                  strokeWidth={2}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Option Card */}
      <Card className="w-full shadow-lg border border-gray-200">
        <CardContent className="p-6 space-y-6">
          <h1 className="text-2xl font-bold text-center">Blackjack‑Digit Option</h1>

          {/* Inputs */}
          <div className="space-y-2">
            <Label htmlFor="duration">Duration (ticks): {duration}</Label>
            <Slider
              id="duration"
              min={1}
              max={10}
              step={1}
              disabled={active}
              value={[duration]}
              onValueChange={([v]) => {
                setDuration(v);
                setTarget((t) => Math.min(t, 9 * v));
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="target">Target Sum</Label>
            <Input
              id="target"
              type="number"
              min={0}
              max={9 * duration}
              step={1}
              disabled={active}
              value={target}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                if (!isNaN(n))
                  setTarget(Math.max(0, Math.min(9 * duration, n)));
              }}
            />
          </div>
          <div className="space-y-2">
            <Label>Bet Type</Label>
            <Select value={betType} disabled={active} onValueChange={setBetType}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select bet" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Equal">Equal</SelectItem>
                <SelectItem value="Higher">Higher</SelectItem>
                <SelectItem value="Lower">Lower</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="stake">Stake (USD)</Label>
            <Input
              id="stake"
              type="number"
              min={0.1}
              step={0.01}
              disabled={active}
              value={stake}
              onChange={(e) => setStake(parseFloat(e.target.value) || 0)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="margin">House Edge (%)</Label>
            <Input
              id="margin"
              type="number"
              min={0}
              max={20}
              step={0.1}
              disabled={active}
              value={margin * 100}
              onChange={(e) => setMargin((parseFloat(e.target.value) || 0) / 100)}
            />
          </div>

          {/* Live Contract */}
          {active && (
            <div className="space-y-3 text-center">
              <p className="text-sm font-medium">
                Collecting digits… ({ticksLeft} ticks left)
              </p>
              <DigitDisplay />
              <p className="text-sm">
                Current Sum: <span className="font-semibold">{runningSum}</span>
              </p>
            </div>
          )}

          {/* Outcome */}
          {outcome && (
            <div className="text-center p-4 rounded-xl bg-gray-50">
              {outcome === "win" ? (
                <p className="text-lg font-bold text-green-600">
                  You win ${summary.offered.toFixed(2)}!
                </p>
              ) : (
                <p className="text-lg font-bold text-red-600">
                  You lose. Better luck next time!
                </p>
              )}
            </div>
          )}

          {/* Odds (only when idle) */}
          {!active && !outcome && (
            <div className="p-4 bg-gray-50 rounded-xl text-center space-y-2">
              <p className="text-sm">
                Win Probability: <span className="font-semibold">{(summary.p * 100).toFixed(4)}%</span>
              </p>
              <p className="text-sm">
                Fair Payout: <span className="font-semibold">${summary.fair.toFixed(2)}</span>
              </p>
              <p className="text-lg font-bold">
                Offered Payout: ${summary.offered.toFixed(2)}
              </p>
            </div>
          )}

          <Button className="w-full" disabled={active} onClick={handlePlaceBet}>
            {active ? "Betting…" : "Place Bet"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
