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
import { EventService } from "../event/event.service";

type CopierRunBody = {
  address: string;
};

type CopierSignalBody = {
  price: number;
};

@Controller("copier")
export class CopierController {
  constructor(
    private readonly copierService: CopierService,
    private readonly engineService: EngineService,
    private readonly eventService: EventService,
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
    return { events: this.eventService.getRecentEvents(20) };
  }

  @Post("signal")
  @HttpCode(HttpStatus.OK)
  signal(@Body() body: CopierSignalBody) {
    return this.engineService.triggerSignal(body.price);
  }
}
