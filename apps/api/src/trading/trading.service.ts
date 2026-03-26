import { Injectable } from "@nestjs/common";
import type { MarketCandle } from "../market/market.service";
import type { Signal } from "../signal/signal.service";

type PendingEntry = {
  signal: Signal;
  entryPrice: number;
  expiresAtIndex: number; // inclusive index
};

type Position = {
  entryTime: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
};

export type TradeRecord = {
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

export type TradingBacktestResponse = {
  trades: TradeRecord[];
  stats: BacktestStats;
};

export function computeAtrSimpleAvgHighLow(
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

function maybeCloseLong(candle: MarketCandle, pos: Position) {
  // If both SL/TP are hit in the same candle, prioritize stop-loss (conservative).
  if (candle.low <= pos.stopLoss) return { hit: true, price: pos.stopLoss };
  if (candle.high >= pos.takeProfit) return { hit: true, price: pos.takeProfit };
  return { hit: false, price: 0 };
}

@Injectable()
export class TradingService {
  /**
   * Shared ATR helper for engines / backtests (not the full `run()` pipeline).
   */
  computeAtr(
    candles: MarketCandle[],
    endIndex: number,
    period = 14,
  ): number | null {
    return computeAtrSimpleAvgHighLow(candles, endIndex, period);
  }

  run(candles: MarketCandle[], signals: Signal[]): TradingBacktestResponse {
    const trades: TradeRecord[] = [];

    const atrPeriod = 14;
    const delayPct = 0.03;
    const entryTimeoutBars = 20;

    let pending: PendingEntry | null = null;
    let position: Position | null = null;

    const signalsByTime = new Map<number, Signal[]>();
    for (const s of signals) {
      const list = signalsByTime.get(s.time);
      if (list) list.push(s);
      else signalsByTime.set(s.time, [s]);
    }

    for (let i = 0; i < candles.length; i++) {
      const candle = candles[i];

      // 1) If we have a position, check SL/TP first.
      if (position) {
        const hit = maybeCloseLong(candle, position);
        if (hit.hit) {
          trades.push({
            entryTime: position.entryTime,
            entryPrice: position.entryPrice,
            exitTime: candle.time,
            exitPrice: hit.price,
            profit: hit.price - position.entryPrice,
          });
          position = null;
        }
      }

      // 2) If no position, handle pending entry (timeout / trigger).
      if (!position && pending) {
        if (i > pending.expiresAtIndex) {
          pending = null;
        } else {
          // Rule: price <= entryPrice => enter long. We use candle.low as "touched".
          if (candle.low <= pending.entryPrice) {
            const atr = this.computeAtr(candles, i, atrPeriod);
            if (atr !== null && Number.isFinite(atr) && atr > 0) {
              const entryPrice = pending.entryPrice;
              const stopLoss = entryPrice - atr * 2;
              const takeProfit = entryPrice + (entryPrice - stopLoss) * 2; // RR 1:2
              position = {
                entryTime: candle.time,
                entryPrice,
                stopLoss,
                takeProfit,
              };
            }
            pending = null;
          }
        }
      }

      // 3) Consume signals when candle.time matches.
      // Keep the original behavior: only react when there is no position and no pending entry.
      if (!position && !pending) {
        const list = signalsByTime.get(candle.time);
        const signal = list?.find((s) => s.type === "BUY");
        if (signal) {
          const entryPrice = signal.price * (1 - delayPct);
          pending = {
            signal,
            entryPrice,
            expiresAtIndex: i + entryTimeoutBars,
          };
        }
      }
    }

    // 4) End of backtest: if still in position, close at the last close price.
    if (position) {
      const last = candles[candles.length - 1];
      trades.push({
        entryTime: position.entryTime,
        entryPrice: position.entryPrice,
        exitTime: last.time,
        exitPrice: last.close,
        profit: last.close - position.entryPrice,
      });
      position = null;
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

