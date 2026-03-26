import { Module } from "@nestjs/common";
import { EngineService } from "./engine.service";
import { EventModule } from "../event/event.module";
import { MarketModule } from "../market/market.module";

@Module({
  imports: [MarketModule, EventModule],
  providers: [EngineService],
  exports: [EngineService],
})
export class EngineModule {}
