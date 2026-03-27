import { Module } from "@nestjs/common";
import { ExecutionService } from "./execution.service";
import { QuoterService } from "./quoter.service";

@Module({
  providers: [ExecutionService, QuoterService],
  exports: [ExecutionService],
})
export class ExecutionModule {}

