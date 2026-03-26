import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from "@nestjs/common";
import { EngineManager } from "./engine.manager";

@Controller("engine")
export class EngineController {
  constructor(private readonly engineManager: EngineManager) {}

  @Get("list")
  list() {
    return this.engineManager.listEngineSummaries();
  }

  @Get("detail")
  detail(@Query("address") address?: string, @Query("token") token?: string) {
    return this.engineManager.getEngineDetail(address ?? "", token ?? "");
  }

  @Post("add-address")
  @HttpCode(HttpStatus.OK)
  addAddress(@Body() body: { address: string }) {
    return this.engineManager.addAddress(body.address);
  }
}

