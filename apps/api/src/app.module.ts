import { Module } from "@nestjs/common";
import { HealthModule } from "./health/health.module";
import { AuthModule } from "./auth/auth.module";
import { MarketModule } from "./market/market.module";
import { BacktestModule } from "./backtest/backtest.module";
import { TradingModule } from "./trading/trading.module";
import { CopierModule } from "./copier/copier.module";

@Module({
  imports: [
    HealthModule,
    AuthModule,
    MarketModule,
    BacktestModule,
    TradingModule,
    CopierModule,
  ],
})
export class AppModule {}
