import { Injectable } from "@nestjs/common";
import { Interface, dataSlice, getAddress, zeroPadValue } from "ethers";

export type ParsedSwap = {
  token: string;
  type: "BUY" | "SELL";
  amount: string;
};

const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

@Injectable()
export class ParserService {
  private readonly v3Iface = new Interface([
    "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params)",
  ]);

  /**
   * MVP parser: supports a subset of Uniswap V3 swap calldata.
   * Returns null when tx is not recognized as a swap signal.
   */
  parseSwapTx(tx: { to?: string | null; data?: string | null }): ParsedSwap | null {
    const to = (tx.to ?? "").toLowerCase();
    const data = tx.data ?? "";
    if (!to || !data || data.length < 10) return null;

    // Uniswap V3 SwapRouter (mainnet)
    if (
      to !== "0xe592427a0aece92de3edee1f18e0157c05861564" &&
      to !== "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45"
    ) {
      return null;
    }

    // exactInputSingle selector: 0x04e45aaf
    if (!data.startsWith("0x04e45aaf")) return null;
    try {
      const decoded = this.v3Iface.decodeFunctionData("exactInputSingle", data);
      const params = decoded[0] as {
        tokenIn: string;
        tokenOut: string;
        amountIn: bigint;
      };
      const tokenIn = getAddress(params.tokenIn);
      const tokenOut = getAddress(params.tokenOut);
      const amount = params.amountIn.toString();

      const isBuy = tokenIn.toLowerCase() === WETH.toLowerCase();
      const token = isBuy ? tokenOut : tokenIn;
      return {
        token,
        type: isBuy ? "BUY" : "SELL",
        amount,
      };
    } catch {
      // fallback: best-effort raw parse for tokenIn/tokenOut
      try {
        const tokenInRaw = dataSlice(data, 4 + 12, 4 + 32);
        const tokenOutRaw = dataSlice(data, 4 + 32 + 12, 4 + 64);
        const tokenIn = getAddress(zeroPadValue(tokenInRaw, 20));
        const tokenOut = getAddress(zeroPadValue(tokenOutRaw, 20));
        const isBuy = tokenIn.toLowerCase() === WETH.toLowerCase();
        return {
          token: isBuy ? tokenOut : tokenIn,
          type: isBuy ? "BUY" : "SELL",
          amount: "0",
        };
      } catch {
        return null;
      }
    }
  }
}

