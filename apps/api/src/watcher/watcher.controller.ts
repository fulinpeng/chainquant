import { Body, Controller, Get, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { WatcherService } from "./watcher.service";

@Controller("watcher")
export class WatcherController {
  constructor(private readonly watcherService: WatcherService) {}

  @Post("add")
  @HttpCode(HttpStatus.OK)
  add(@Body() body: { address: string }) {
    return this.watcherService.add(body?.address ?? "");
  }

  @Get("list")
  list() {
    return this.watcherService.list();
  }

  @Post("start")
  @HttpCode(HttpStatus.OK)
  start(@Body() body: { address: string }) {
    return this.watcherService.start(body?.address ?? "");
  }

  @Post("stop")
  @HttpCode(HttpStatus.OK)
  stop(@Body() body: { address: string }) {
    return this.watcherService.stop(body?.address ?? "");
  }

  @Post("delete")
  @HttpCode(HttpStatus.OK)
  delete(@Body() body: { address: string }) {
    return this.watcherService.delete(body?.address ?? "");
  }
}

