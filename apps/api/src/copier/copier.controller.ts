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

type CopierRunBody = {
  address: string;
};

@Controller("copier")
export class CopierController {
  constructor(
    private readonly copierService: CopierService,
    private readonly engineService: EngineService,
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
}
