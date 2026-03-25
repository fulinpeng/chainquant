import { Controller, Get, Query } from "@nestjs/common";
import { MarketService } from "./market.service";

@Controller("market")
export class MarketController {
  constructor(private readonly marketService: MarketService) {}

  @Get("candles")
  getCandles(
    @Query("symbol") symbol?: string,
    @Query("interval") interval?: string,
    @Query("timeLevel") timeLevel?: string,
    @Query("limit") limit?: string,
  ) {
    return this.marketService.getCandles({
      symbol: symbol ?? "eth",
      interval: interval ?? timeLevel ?? "4h",
      limit: limit ? Number(limit) : 10000,
    });
  }
}

