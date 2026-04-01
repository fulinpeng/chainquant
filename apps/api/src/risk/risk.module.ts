import { Global, Module } from "@nestjs/common";
import { FundsService } from "./funds.service";

@Global()
@Module({
  providers: [FundsService],
  exports: [FundsService],
})
export class RiskModule {}
