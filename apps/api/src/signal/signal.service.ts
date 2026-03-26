import { Injectable } from "@nestjs/common";
import type { MarketCandle } from "../market/market.service";

export type SignalType = "BUY";

export type Signal = {
  time: number;
  price: number;
  type: SignalType;
};

@Injectable()
export class SignalService {
  generateSignals(candles: MarketCandle[]): Signal[] {
    const signals: Signal[] = [];

    const every = 50;
    for (let i = 0; i < candles.length; i++) {
      if (i > 0 && i % every === 0) {
        const candle = candles[i];
        signals.push({
          time: candle.time,
          price: candle.close,
          type: "BUY",
        });
      }
    }

    return signals;
  }
}

