import type { MarketCandle } from "../market/market.service";

export type FvgAnalysis = {
  /** 与 signal 方向一致的 FVG 数量 */
  count: number;
  /** 时间上最近一根（数组末尾）同类 FVG 的缺口中轨价 */
  latestMid: number | null;
};

/**
 * 三 K 经典 FVG：
 * - 看涨：low[i] > high[i-2]
 * - 看跌：high[i] < low[i-2]
 * BUY 信号只计看涨；SELL 只计看跌。
 */
export function analyzeFvg(
  candles: MarketCandle[],
  direction: "BUY" | "SELL",
): FvgAnalysis {
  if (candles.length < 3) {
    return { count: 0, latestMid: null };
  }
  type Hit = { mid: number; time: number };
  const hits: Hit[] = [];
  for (let i = 2; i < candles.length; i++) {
    const first = candles[i - 2];
    const third = candles[i];
    if (direction === "BUY") {
      if (third.low > first.high) {
        const mid = (first.high + third.low) / 2;
        hits.push({ mid, time: third.time });
      }
    } else {
      if (third.high < first.low) {
        const mid = (first.low + third.high) / 2;
        hits.push({ mid, time: third.time });
      }
    }
  }
  if (hits.length === 0) {
    return { count: 0, latestMid: null };
  }
  hits.sort((a, b) => a.time - b.time);
  const latest = hits[hits.length - 1];
  return { count: hits.length, latestMid: latest.mid };
}
