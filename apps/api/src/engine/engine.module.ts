import { Module } from "@nestjs/common";
import { EngineManager } from "./engine.manager";
import { MarketModule } from "../market/market.module";

@Module({
  imports: [MarketModule],
  providers: [EngineManager],
  exports: [EngineManager],
})
export class EngineModule {}
