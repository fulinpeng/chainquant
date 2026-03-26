import { BadRequestException, Injectable } from "@nestjs/common";
import { MarketService } from "../market/market.service";
import { SignalService } from "../signal/signal.service";
import { TradingService } from "../trading/trading.service";

@Injectable()
export class CopierService {
  constructor(
    private readonly marketService: MarketService,
    private readonly signalService: SignalService,
    private readonly tradingService: TradingService,
  ) {}

  run(body: { address: string }) {
    const address = (body.address ?? "").trim();
    if (!address) {
      throw new BadRequestException("address is required");
    }

    // MVP: use local ETH/4H candles as the data source.
    const candles = this.marketService.getCandles({
      symbol: "eth",
      interval: "4h",
      limit: 10000,
    });

    if (candles.length < 80) {
      throw new BadRequestException("Not enough candles to run backtest");
    }

    const signals = this.signalService.generateSignals(candles);
    return this.tradingService.run(candles, signals);
  }
}

