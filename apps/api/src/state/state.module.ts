import { Module } from "@nestjs/common";
import { StateStore } from "./state-store.service";

@Module({
  providers: [StateStore],
  exports: [StateStore],
})
export class StateModule {}
