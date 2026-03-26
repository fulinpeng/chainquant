import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { CopierService } from "./copier.service";

type CopierRunBody = {
  address: string;
};

@Controller("copier")
export class CopierController {
  constructor(private readonly copierService: CopierService) {}

  @Post("run")
  @HttpCode(HttpStatus.OK)
  run(@Body() body: CopierRunBody) {
    return this.copierService.run(body);
  }
}

