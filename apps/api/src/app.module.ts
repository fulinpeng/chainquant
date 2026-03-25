import { Module } from "@nestjs/common";
import { HealthModule } from "./health/health.module";
import { AuthModule } from "./auth/auth.module";
import { MarketModule } from "./market/market.module";
import { BacktestModule } from "./backtest/backtest.module";

@Module({
  imports: [HealthModule, AuthModule, MarketModule, BacktestModule],
})
export class AppModule {}
