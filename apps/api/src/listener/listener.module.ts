import { Module } from "@nestjs/common";
import { EngineModule } from "../engine/engine.module";
import { MarketModule } from "../market/market.module";
import { ListenerService } from "./listener.service";
import { ParserService } from "./parser.service";

@Module({
  imports: [EngineModule, MarketModule],
  providers: [ListenerService, ParserService],
  exports: [ListenerService],
})
export class ListenerModule {}

