import { Module } from "@nestjs/common";
import { EngineManager } from "./engine.manager";
import { MarketModule } from "../market/market.module";
import { EngineController } from "./engine.controller";

@Module({
  imports: [MarketModule],
  controllers: [EngineController],
  providers: [EngineManager],
  exports: [EngineManager],
})
export class EngineModule {}
