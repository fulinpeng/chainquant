import { Injectable, Logger } from "@nestjs/common";
import { Interface, getAddress } from "ethers";
import { CHAINS, type ChainConfig, type ChainKey } from "../config/chains";
import type { TransactionReceipt } from "ethers";

export type ParsedSwap = {
  token: string;
  type: "BUY" | "SELL";
  amount: string;
};

@Injectable()
export class ParserService {
  private readonly logger = new Logger(ParserService.name);
  private readonly v3Iface = new Interface([
    "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params)",
  ]);

  private static readonly TRANSFER_TOPIC0 =
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"; // Transfer(address,address,uint256)

  // Uniswap V4 PoolManager Swap event topic0 (matches Arbiscan screenshot example).
  private static readonly UNISWAP_V4_SWAP_TOPIC0 =
    "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f";

  parseSwapTx(
    tx: { to?: string | null; data?: string | null },
    chain: ChainKey,
    ctx?: {
      receipt?: TransactionReceipt;
      userAddress?: string;
    },
  ): ParsedSwap | null {
    const chainConfig = CHAINS[chain];
    if (!chainConfig) {
      this.logger.warn(`Unknown chain: ${String(chain)}`);
      return null;
    }

    const to = (tx.to ?? "").toLowerCase();
    const data = tx.data ?? "";
    if (!to || !data || data.length < 10) return null;

    const isV3Router = chainConfig.v3Routers.includes(to);
    const isV4UniversalRouter = chainConfig.v4UniversalRouters.includes(to);
    if (!isV3Router && !isV4UniversalRouter) {
      this.logger.log(`[${chainConfig.name}] 未识别 router: ${to}`);
      return null;
    }

    // Uniswap V3: SwapRouter02 exactInputSingle
    if (isV3Router) {
      if (!data.startsWith("0x04e45aaf")) {
        this.logger.log(`[${chainConfig.name}] 非 exactInputSingle swap`);
        return null;
      }

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

        const isBuy = tokenIn.toLowerCase() === chainConfig.wrappedNative.address;
        const token = isBuy ? tokenOut : tokenIn;
        return {
          token,
          type: isBuy ? "BUY" : "SELL",
          amount,
        };
      } catch (err) {
        this.logger.warn(
          `[${chainConfig.name}] V3 解析失败: ${err instanceof Error ? err.message : String(err)}`,
        );
        return null;
      }
    }

    // Uniswap V4: Universal Router (execute) -> parse from receipt logs
    if (isV4UniversalRouter) {
      const receipt = ctx?.receipt;
      const userAddress = ctx?.userAddress;
      if (!receipt) {
        this.logger.log(`[${chainConfig.name}] V4 解析需要 receipt`);
        return null;
      }
      if (!userAddress) {
        this.logger.log(`[${chainConfig.name}] V4 解析需要 userAddress`);
        return null;
      }
      return this.parseUniswapV4SwapFromReceipt(receipt, chainConfig, userAddress);
    }

    return null;
  }

  private parseUniswapV4SwapFromReceipt(
    receipt: TransactionReceipt,
    chainConfig: ChainConfig,
    userAddress: string,
  ): ParsedSwap | null {
    const user = userAddress.toLowerCase();

    const hasSwapEvent = receipt.logs.some((log) => {
      const t0 = log.topics?.[0]?.toLowerCase();
      return t0 === ParserService.UNISWAP_V4_SWAP_TOPIC0;
    });

    if (!hasSwapEvent) {
      this.logger.log(`[${chainConfig.name}] 非 swap（未命中 Uniswap V4 Swap 事件）`);
      return null;
    }

    let bestTokenOut: string | null = null;
    let bestValue: bigint = 0n;
    let userSentToken: string | null = null;
    let userSentValue: bigint = 0n;
    let hasWethUnwrapToNative = false;
    const wrappedNative = chainConfig.wrappedNative.address.toLowerCase();
    const routers = chainConfig.v4UniversalRouters.map((x) => x.toLowerCase());

    for (const log of receipt.logs) {
      if (!log.topics || log.topics.length < 3) continue;
      if (log.topics[0]?.toLowerCase() !== ParserService.TRANSFER_TOPIC0) continue;
      if (!log.data) continue;

      // topics: [event sig, from, to]
      let value: bigint;
      try {
        value = BigInt(log.data);
      } catch {
        continue;
      }
      if (value <= 0n) continue;

      const tokenAddr = log.address.toLowerCase();
      const fromAddr = this.topicToAddress(log.topics[1]);
      const toAddr = this.topicToAddress(log.topics[2]);

      // Option A: user receives ERC20 token directly.
      if (toAddr === user && (bestTokenOut === null || value > bestValue)) {
        bestTokenOut = tokenAddr;
        bestValue = value;
      }

      // Track user's major outgoing ERC20 token for unwrap fallback.
      if (fromAddr === user && tokenAddr !== wrappedNative && value > userSentValue) {
        userSentToken = tokenAddr;
        userSentValue = value;
      }

      // Option B signal: WETH unwrap (router burns WETH to zero and sends native ETH internally).
      if (
        tokenAddr === wrappedNative &&
        toAddr === "0x0000000000000000000000000000000000000000" &&
        fromAddr !== null &&
        routers.includes(fromAddr)
      ) {
        hasWethUnwrapToNative = true;
      }
    }

    if (bestTokenOut) {
      const type = bestTokenOut === wrappedNative ? "SELL" : "BUY";
      return {
        token: bestTokenOut,
        type,
        amount: bestValue.toString(),
      };
    }

    // Fallback for V4 USDC -> ETH style swap: no ERC20 to user, but unwrap exists.
    if (hasWethUnwrapToNative && userSentToken && userSentValue > 0n) {
      return {
        token: userSentToken,
        type: "SELL",
        amount: userSentValue.toString(),
      };
    }

    this.logger.log(`[${chainConfig.name}] 解析失败(未命中 ERC20 入账或 WETH unwrap)`);    
    return null;
  }

  private topicToAddress(topic?: string): string | null {
    if (!topic || topic.length < 42) return null;
    return `0x${topic.slice(26)}`.toLowerCase();
  }
}

