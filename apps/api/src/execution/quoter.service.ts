import { Injectable } from "@nestjs/common";
import { Contract, JsonRpcProvider } from "ethers";

@Injectable()
export class QuoterService {
  private readonly quoterV2Address = "0x61ffe014ba17989e743c5f6cb21bf9697530b21e";

  async quoteExactInputSingle(input: {
    tokenIn: string;
    tokenOut: string;
    fee: number;
    amountIn: bigint;
  }): Promise<bigint> {
    const rpcUrl = (process.env.RPC_URL ?? "").trim();
    if (!rpcUrl) {
      throw new Error("RPC_URL is missing");
    }
    const provider = new JsonRpcProvider(rpcUrl);
    const quoter = new Contract(
      this.quoterV2Address,
      [
        "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)",
      ],
      provider,
    );

    const result = (await quoter.quoteExactInputSingle.staticCall({
      tokenIn: input.tokenIn,
      tokenOut: input.tokenOut,
      amountIn: input.amountIn,
      fee: input.fee,
      sqrtPriceLimitX96: 0,
    })) as [bigint, bigint, number, bigint];

    return result[0];
  }
}

