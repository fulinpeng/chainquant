import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { AuthService } from "./auth.service";

type SiweRequestBody = {
  message: string;
  signature: string;
};

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("siwe")
  @HttpCode(HttpStatus.OK)
  authenticateSiwe(@Body() body: SiweRequestBody) {
    return this.authService.authenticateSiwe(body);
  }
}
