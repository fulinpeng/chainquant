import { BadRequestException, Injectable } from "@nestjs/common";
import type { MarketCandle } from "../market/market.service";
import { MarketService } from "../market/market.service";

type StrategySignal = "BUY" | "SELL" | "HOLD";
type PositionSide = "LONG" | "SHORT";

type Position = {
  side: PositionSide;
  entryPrice: number;
  entryTime: number;
  stopLoss: number;
  takeProfit: number;
};

type TradeRecord = {
  side: PositionSide;
  entryTime: number;
  entryPrice: number;
  exitTime: number;
  exitPrice: number;
  profit: number;
};

type BacktestStats = {
  totalTrades: number;
  winRate: number;
  totalPnL: number;
};

type BacktestResponse = {
  trades: TradeRecord[];
  stats: BacktestStats;
};

function sma(values: number[], period: number, endIndex: number): number | null {
  const start = endIndex - period + 1;
  if (start < 0) return null;
  let sum = 0;
  for (let i = start; i <= endIndex; i++) sum += values[i];
  return sum / period;
}

function computeSignalFromCloses(
  closes: number[],
  i: number,
): StrategySignal {
  if (i < 10) return "HOLD";

  const ma5Prev = sma(closes, 5, i - 1);
  const ma10Prev = sma(closes, 10, i - 1);
  const ma5 = sma(closes, 5, i);
  const ma10 = sma(closes, 10, i);

  if (ma5Prev === null || ma10Prev === null || ma5 === null || ma10 === null) {
    return "HOLD";
  }

  const crossedUp = ma5Prev <= ma10Prev && ma5 > ma10;
  const crossedDown = ma5Prev >= ma10Prev && ma5 < ma10;

  if (crossedUp) return "BUY";
  if (crossedDown) return "SELL";
  return "HOLD";
}

function computeAtrSimpleAvgHighLow(
  candles: MarketCandle[],
  endIndex: number,
  period: number,
): number | null {
  const start = endIndex - period + 1;
  if (start < 0) return null;

  let sum = 0;
  for (let i = start; i <= endIndex; i++) {
    const c = candles[i];
    sum += c.high - c.low;
  }

  return sum / period;
}

function closeLong(candle: MarketCandle, pos: Position) {
  // Stop-loss has priority over take-profit if both are hit in the same candle.
  if (candle.low <= pos.stopLoss) return { hit: true, price: pos.stopLoss };
  if (candle.high >= pos.takeProfit) return { hit: true, price: pos.takeProfit };
  return { hit: false, price: 0 };
}

function closeShort(candle: MarketCandle, pos: Position) {
  // Stop-loss has priority over take-profit if both are hit in the same candle.
  if (candle.high >= pos.stopLoss) return { hit: true, price: pos.stopLoss };
  if (candle.low <= pos.takeProfit) return { hit: true, price: pos.takeProfit };
  return { hit: false, price: 0 };
}

@Injectable()
export class BacktestService {
  constructor(private readonly marketService: MarketService) {}

  run(body: { symbol?: string; interval?: string; limit?: number }): BacktestResponse {
    const symbol = (body.symbol ?? "eth").toLowerCase().trim();
    const interval = (body.interval ?? "4h").toLowerCase().trim();
    const limit = typeof body.limit === "number" ? body.limit : 100;

    const candles = this.marketService.getCandles({
      symbol,
      interval,
      limit: Math.min(Math.max(limit, 10), 10000),
    });

    if (candles.length < 60) {
      throw new BadRequestException("Not enough candles to run backtest");
    }

    return this.backtest(candles);
  }

  private backtest(candles: MarketCandle[]): BacktestResponse {
    const trades: TradeRecord[] = [];

    const atrPeriod = 14;

    const closes = candles.map((c) => c.close);

    let position: Position | null = null;

    // Use i starting at 50 as in the requested loop rule.
    for (let i = 50; i < candles.length; i++) {
      const candle = candles[i];
      const signal = computeSignalFromCloses(closes, i);

      // 1) If we have a position, check SL/TP first.
      if (position) {
        if (position.side === "LONG") {
          const hit = closeLong(candle, position);
          if (hit.hit) {
            const exitTime = candle.time;
            const exitPrice = hit.price;
            const profit = exitPrice - position.entryPrice;
            trades.push({
              side: position.side,
              entryTime: position.entryTime,
              entryPrice: position.entryPrice,
              exitTime,
              exitPrice,
              profit,
            });
            position = null;
            continue;
          }
        } else {
          const hit = closeShort(candle, position);
          if (hit.hit) {
            const exitTime = candle.time;
            const exitPrice = hit.price;
            const profit = position.entryPrice - exitPrice;
            trades.push({
              side: position.side,
              entryTime: position.entryTime,
              entryPrice: position.entryPrice,
              exitTime,
              exitPrice,
              profit,
            });
            position = null;
            continue;
          }
        }

        // 2) If no SL/TP hit, check reverse signal next.
        const reverseSignal =
          (position.side === "LONG" && signal === "SELL") ||
          (position.side === "SHORT" && signal === "BUY");

        if (reverseSignal) {
          const exitTime = candle.time;
          const exitPrice = candle.close;
          const profit =
            position.side === "LONG"
              ? exitPrice - position.entryPrice
              : position.entryPrice - exitPrice;

          trades.push({
            side: position.side,
            entryTime: position.entryTime,
            entryPrice: position.entryPrice,
            exitTime,
            exitPrice,
            profit,
          });

          position = null;
          continue;
        }
      }

      // 3) Open only if there is no open position.
      if (!position) {
        if (signal === "HOLD") continue;

        const atr = computeAtrSimpleAvgHighLow(candles, i, atrPeriod);
        if (atr === null || !Number.isFinite(atr) || atr <= 0) continue;

        const entryTime = candle.time;
        const entryPrice = candle.close;

        if (signal === "BUY") {
          position = {
            side: "LONG",
            entryTime,
            entryPrice,
            stopLoss: entryPrice - atr * 3,
            takeProfit: entryPrice + atr * 6, // 1:2
          };
        } else if (signal === "SELL") {
          position = {
            side: "SHORT",
            entryTime,
            entryPrice,
            stopLoss: entryPrice + atr * 3,
            takeProfit: entryPrice - atr * 6, // 1:2
          };
        }
      }
    }

    // Close any open position at the end using the last close.
    if (position) {
      const last = candles[candles.length - 1];
      const exitTime = last.time;
      const exitPrice = last.close;
      const profit =
        position.side === "LONG"
          ? exitPrice - position.entryPrice
          : position.entryPrice - exitPrice;

      trades.push({
        side: position.side,
        entryTime: position.entryTime,
        entryPrice: position.entryPrice,
        exitTime,
        exitPrice,
        profit,
      });
    }

    const totalTrades = trades.length;
    const wins = trades.filter((t) => t.profit > 0).length;
    const totalPnL = trades.reduce((sum, t) => sum + t.profit, 0);
    const winRate = totalTrades ? wins / totalTrades : 0;

    return {
      trades,
      stats: {
        totalTrades,
        winRate,
        totalPnL,
      },
    };
  }
}

