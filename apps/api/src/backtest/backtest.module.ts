import { Module } from "@nestjs/common";
import { BacktestController } from "./backtest.controller";
import { BacktestService } from "./backtest.service";
import { MarketModule } from "../market/market.module";

@Module({
  imports: [MarketModule],
  controllers: [BacktestController],
  providers: [BacktestService],
})
export class BacktestModule {}

