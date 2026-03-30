import { BadRequestException, Injectable } from "@nestjs/common";
import { SiweMessage } from "siwe";

type SiweRequestBody = {
  message: string;
  signature: string;
};

@Injectable()
export class AuthService {
  async authenticateSiwe(body: SiweRequestBody) {
    const { message, signature } = body ?? {};

    if (!message || !signature) {
      throw new BadRequestException("Missing `message` or `signature`");
    }

    let siweMessage: SiweMessage;
    try {
      siweMessage = new SiweMessage(message);
    } catch {
      throw new BadRequestException("Invalid SIWE message format");
    }

    try {
      const result = await siweMessage.verify({ signature });
      if (!result?.success) {
        throw new BadRequestException("Invalid SIWE signature");
      }
    } catch {
      // `siwe` 在 suppressExceptions=false 时可能以 { success: false, error: ... } 形式 reject。
      throw new BadRequestException("Invalid SIWE signature");
    }

    return {
      address: siweMessage.address,
    };
  }
}
