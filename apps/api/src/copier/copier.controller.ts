import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from "@nestjs/common";
import { CopierService } from "./copier.service";
import { EngineManager } from "../engine/engine.manager";
import type { CopierSignalPayload } from "../engine/types";

type CopierRunBody = {
  address: string;
};

type CopierEngineKeyBody = {
  address: string;
  /** 交易标的代币；省略时默认与 `address` 相同。 */
  token?: string;
};

type CopierSignalBody = CopierSignalPayload;

function resolveEngineKey(body: { address?: string; token?: string }): {
  address: string;
  token: string;
} {
  const address = (body.address ?? "").trim();
  if (!address) {
    throw new BadRequestException("address is required");
  }
  const token = (body.token ?? address).trim();
  if (!token) {
    throw new BadRequestException("token is required");
  }
  return { address, token };
}

@Controller("copier")
export class CopierController {
  constructor(
    private readonly copierService: CopierService,
    private readonly engineManager: EngineManager,
  ) {}

  @Post("run")
  @HttpCode(HttpStatus.OK)
  run(@Body() body: CopierRunBody) {
    return this.copierService.run(body);
  }

  @Post("start")
  @HttpCode(HttpStatus.OK)
  start(@Body() body: CopierEngineKeyBody) {
    const { address, token } = resolveEngineKey(body);
    const engine = this.engineManager.getOrCreateEngine(address, token);
    const out = engine.start();
    this.engineManager.notifyEngineStarted();
    return out;
  }

  @Post("stop")
  @HttpCode(HttpStatus.OK)
  async stop(@Body() body: CopierEngineKeyBody) {
    const { address, token } = resolveEngineKey(body);
    const engine = this.engineManager.getEngineOrThrow(address, token);
    const out = await engine.stop();
    this.engineManager.notifyEngineStopped();
    return out;
  }

  @Get("status")
  status(
    @Query("address") addressQ?: string,
    @Query("token") tokenQ?: string,
  ) {
    const { address, token } = resolveEngineKey({
      address: addressQ,
      token: tokenQ,
    });
    return this.engineManager.getEngineOrThrow(address, token).getStatus();
  }

  @Get("result")
  result(
    @Query("address") addressQ?: string,
    @Query("token") tokenQ?: string,
  ) {
    const { address, token } = resolveEngineKey({
      address: addressQ,
      token: tokenQ,
    });
    return this.engineManager.getEngineOrThrow(address, token).getResult();
  }

  @Get("events")
  events(
    @Query("address") addressQ?: string,
    @Query("token") tokenQ?: string,
  ) {
    const { address, token } = resolveEngineKey({
      address: addressQ,
      token: tokenQ,
    });
    const engine = this.engineManager.getEngineOrThrow(address, token);
    return { events: engine.getRecentEvents(20) };
  }

  @Post("signal")
  @HttpCode(HttpStatus.OK)
  signal(@Body() body: CopierSignalBody & CopierEngineKeyBody) {
    const { address, token } = resolveEngineKey(body);
    return this.engineManager.handleSignal(address, {
      type: body.type,
      token,
    });
  }
}
