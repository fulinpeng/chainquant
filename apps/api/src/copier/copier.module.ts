import { Module } from "@nestjs/common";
import { CopierController } from "./copier.controller";
import { CopierService } from "./copier.service";
import { MarketModule } from "../market/market.module";
import { TradingModule } from "../trading/trading.module";
import { SignalModule } from "../signal/signal.module";

@Module({
  imports: [MarketModule, SignalModule, TradingModule],
  controllers: [CopierController],
  providers: [CopierService],
})
export class CopierModule {}

