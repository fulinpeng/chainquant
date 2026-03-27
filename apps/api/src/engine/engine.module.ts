import { Module } from "@nestjs/common";
import { EngineManager } from "./engine.manager";
import { MarketModule } from "../market/market.module";
import { EngineController } from "./engine.controller";
import { ExecutionModule } from "../execution/execution.module";

@Module({
  imports: [MarketModule, ExecutionModule],
  controllers: [EngineController],
  providers: [EngineManager],
  exports: [EngineManager],
})
export class EngineModule {}
