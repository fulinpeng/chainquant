import { Module } from "@nestjs/common";
import { ListenerModule } from "../listener/listener.module";
import { WatcherController } from "./watcher.controller";
import { WatcherService } from "./watcher.service";

@Module({
  imports: [ListenerModule],
  controllers: [WatcherController],
  providers: [WatcherService],
  exports: [WatcherService],
})
export class WatcherModule {}

