import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from "@nestjs/common";
import { CopierService } from "./copier.service";
import { EngineService } from "../engine/engine.service";
import { StateStore } from "../state/state-store.service";

type CopierRunBody = {
  address: string;
};

type CopierSignalBody = {
  type: "BUY" | "SELL";
};

@Controller("copier")
export class CopierController {
  constructor(
    private readonly copierService: CopierService,
    private readonly engineService: EngineService,
    private readonly stateStore: StateStore,
  ) {}

  @Post("run")
  @HttpCode(HttpStatus.OK)
  run(@Body() body: CopierRunBody) {
    return this.copierService.run(body);
  }

  @Post("start")
  @HttpCode(HttpStatus.OK)
  start(@Body() body: CopierRunBody) {
    return this.engineService.start(body.address);
  }

  @Post("stop")
  @HttpCode(HttpStatus.OK)
  stop() {
    return this.engineService.stop();
  }

  @Get("status")
  status() {
    return this.engineService.getStatus();
  }

  @Get("result")
  result() {
    return this.engineService.getResult();
  }

  @Get("events")
  events() {
    const events = this.stateStore.getEvents();
    const tail = events.slice(-20);
    return { events: tail };
  }

  @Post("signal")
  @HttpCode(HttpStatus.OK)
  signal(@Body() body: CopierSignalBody) {
    return this.engineService.onSignal({ type: body.type });
  }
}
