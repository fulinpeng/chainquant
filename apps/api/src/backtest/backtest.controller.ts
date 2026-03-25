import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { BacktestService } from "./backtest.service";

type RunBacktestBody = {
  symbol?: string;
  interval?: string;
  limit?: number;
};

@Controller("backtest")
export class BacktestController {
  constructor(private readonly backtestService: BacktestService) {}

  @Post("run")
  @HttpCode(HttpStatus.OK)
  run(@Body() body: RunBacktestBody) {
    return this.backtestService.run(body);
  }
}

