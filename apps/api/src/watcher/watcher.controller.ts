import { Body, Controller, Get, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { WatcherService } from "./watcher.service";
import type { ChainKey } from "../config/chains";
import type { EngineRuntimeConfig } from "../engine/types";

@Controller("watcher")
export class WatcherController {
  constructor(private readonly watcherService: WatcherService) {}

  @Post("add")
  @HttpCode(HttpStatus.OK)
  add(@Body() body: { address: string; chain?: ChainKey }) {
    return this.watcherService.add(body?.address ?? "", body?.chain ?? "arb");
  }

  @Get("list")
  list() {
    return this.watcherService.list();
  }

  @Post("start")
  @HttpCode(HttpStatus.OK)
  start(@Body() body: { address: string; chain?: ChainKey }) {
    return this.watcherService.start(body?.address ?? "", body?.chain ?? "arb");
  }

  @Post("stop")
  @HttpCode(HttpStatus.OK)
  stop(@Body() body: { address: string; chain?: ChainKey }) {
    return this.watcherService.stop(body?.address ?? "", body?.chain ?? "arb");
  }

  @Post("delete")
  @HttpCode(HttpStatus.OK)
  delete(@Body() body: { address: string; chain?: ChainKey }) {
    return this.watcherService.delete(body?.address ?? "", body?.chain ?? "arb");
  }

  @Post("update-config")
  @HttpCode(HttpStatus.OK)
  updateConfig(
    @Body()
    body: {
      address: string;
      chain?: ChainKey;
      config: Partial<EngineRuntimeConfig>;
    },
  ) {
    return this.watcherService.updateConfig(
      body?.address ?? "",
      body?.chain ?? "arb",
      body?.config ?? {},
    );
  }

  @Post("replay-tx")
  @HttpCode(HttpStatus.OK)
  replayTx(@Body() body: { txHash: string; chain?: ChainKey }) {
    return this.watcherService.replayTx(body?.txHash ?? "", body?.chain);
  }
}

