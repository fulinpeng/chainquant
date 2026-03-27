import { Module } from "@nestjs/common";
import { HealthModule } from "./health/health.module";
import { AuthModule } from "./auth/auth.module";
import { MarketModule } from "./market/market.module";
import { BacktestModule } from "./backtest/backtest.module";
import { TradingModule } from "./trading/trading.module";
import { CopierModule } from "./copier/copier.module";
import { ListenerModule } from "./listener/listener.module";
import { WatcherModule } from "./watcher/watcher.module";
import { PersistenceModule } from "./persistence/persistence.module";
import { QueryModule } from "./query/query.module";

@Module({
  imports: [
    PersistenceModule,
    HealthModule,
    AuthModule,
    MarketModule,
    ListenerModule,
    BacktestModule,
    TradingModule,
    CopierModule,
    WatcherModule,
    QueryModule,
  ],
})
export class AppModule {}
