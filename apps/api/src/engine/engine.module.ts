import { Module } from "@nestjs/common";
import { EngineService } from "./engine.service";
import { MarketModule } from "../market/market.module";
import { TradingModule } from "../trading/trading.module";

@Module({
  imports: [MarketModule, TradingModule],
  providers: [EngineService],
  exports: [EngineService],
})
export class EngineModule {}
