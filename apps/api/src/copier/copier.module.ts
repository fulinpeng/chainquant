import { Module } from "@nestjs/common";
import { CopierController } from "./copier.controller";
import { CopierService } from "./copier.service";
import { MarketModule } from "../market/market.module";
import { TradingModule } from "../trading/trading.module";

@Module({
  imports: [MarketModule, TradingModule],
  controllers: [CopierController],
  providers: [CopierService],
})
export class CopierModule {}

