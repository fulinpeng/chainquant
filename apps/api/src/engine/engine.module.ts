import { Module } from "@nestjs/common";
import { EngineService } from "./engine.service";
import { StateModule } from "../state/state.module";
import { MarketModule } from "../market/market.module";

@Module({
  imports: [MarketModule, StateModule],
  providers: [EngineService],
  exports: [EngineService],
})
export class EngineModule {}
