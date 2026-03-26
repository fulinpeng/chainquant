import { Module } from "@nestjs/common";
import { EngineService } from "./engine.service";
import { MarketModule } from "../market/market.module";

@Module({
  imports: [MarketModule],
  providers: [EngineService],
  exports: [EngineService],
})
export class EngineModule {}
