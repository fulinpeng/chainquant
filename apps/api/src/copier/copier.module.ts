import { Module } from "@nestjs/common";
import { CopierController } from "./copier.controller";
import { CopierService } from "./copier.service";
import { EngineModule } from "../engine/engine.module";
import { StateModule } from "../state/state.module";
import { MarketModule } from "../market/market.module";
import { TradingModule } from "../trading/trading.module";
import { SignalModule } from "../signal/signal.module";

@Module({
  imports: [MarketModule, SignalModule, TradingModule, EngineModule, StateModule],
  controllers: [CopierController],
  providers: [CopierService],
})
export class CopierModule {}

