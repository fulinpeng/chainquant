import { Global, Module } from "@nestjs/common";
import { DbSidecarService } from "./db-sidecar.service";

@Global()
@Module({
  providers: [DbSidecarService],
  exports: [DbSidecarService],
})
export class PersistenceModule {}
