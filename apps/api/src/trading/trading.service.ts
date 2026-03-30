import { Injectable } from "@nestjs/common";
import type { MarketCandle } from "../market/market.service";
import type { Signal } from "../signal/signal.service";

type PendingEntry = {
  signal: Signal;
  entryPrice: number;
  expiresAtIndex: number; // 包含该索引在内的到期 K 线索引
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
  // 同一根 K 线同时触发止损与止盈时，优先止损（偏保守）。
  if (candle.low <= pos.stopLoss) return { hit: true, price: pos.stopLoss };
  if (candle.high >= pos.takeProfit) return { hit: true, price: pos.takeProfit };
  return { hit: false, price: 0 };
}

@Injectable()
export class TradingService {
  /**
   * 供引擎/回测共用的 ATR 计算（非完整 `run()` 流水线）。
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

      // 1）有持仓时先检查止损/止盈。
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

      // 2）无持仓时处理待入场（超时 / 触发）。
      if (!position && pending) {
        if (i > pending.expiresAtIndex) {
          pending = null;
        } else {
          // 规则：价格 ≤ 入场价则做多入场；用 candle.low 表示「曾触及」。
          if (candle.low <= pending.entryPrice) {
            const atr = this.computeAtr(candles, i, atrPeriod);
            if (atr !== null && Number.isFinite(atr) && atr > 0) {
              const entryPrice = pending.entryPrice;
              const stopLoss = entryPrice - atr * 2;
              const takeProfit = entryPrice + (entryPrice - stopLoss) * 2; // 盈亏比 1:2
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

      // 3）在 candle.time 与信号时间对齐时消费信号。
      // 保持原逻辑：仅在没有持仓且没有待入场时才响应。
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

    // 4）回测结束：若仍有持仓，按最后一根 K 线收盘价平仓。
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

