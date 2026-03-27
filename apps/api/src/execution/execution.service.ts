import { Injectable, Logger } from "@nestjs/common";
import { CHAINS } from "../config/chains";
import { Contract, JsonRpcProvider, Wallet, parseUnits } from "ethers";

type ExecuteParams = {
  mode: "paper" | "live";
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  maxTradeAmount: number;
  slippage: number;
};

type ExecuteResult =
  | { ok: true; mode: "paper" | "live"; txHash?: string }
  | { ok: false; mode: "paper" | "live"; reason: string };

@Injectable()
export class ExecutionService {
  private readonly logger = new Logger(ExecutionService.name);
  private inFlight = false;

  async execute(params: ExecuteParams): Promise<ExecuteResult> {
    if (this.inFlight) {
      return { ok: false, mode: params.mode, reason: "trade_in_flight" };
    }
    if (!Number.isFinite(params.amountIn) || params.amountIn <= 0) {
      return { ok: false, mode: params.mode, reason: "invalid_amount" };
    }
    if (!Number.isFinite(params.maxTradeAmount) || params.maxTradeAmount <= 0) {
      return { ok: false, mode: params.mode, reason: "invalid_max_trade_amount" };
    }
    if (params.amountIn > params.maxTradeAmount) {
      return { ok: false, mode: params.mode, reason: "max_trade_amount_exceeded" };
    }
    if (!Number.isFinite(params.slippage) || params.slippage <= 0 || params.slippage > 0.05) {
      return { ok: false, mode: params.mode, reason: "invalid_slippage" };
    }

    if (params.mode === "paper") {
      return { ok: true, mode: "paper" };
    }

    this.inFlight = true;
    try {
      const txHash = await this.sendSwapTx({
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        amountIn: params.amountIn,
        slippage: params.slippage,
      });
      return { ok: true, mode: "live", txHash };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Live execution failed: ${msg}`);
      return { ok: false, mode: "live", reason: msg };
    } finally {
      this.inFlight = false;
    }
  }

  private async sendSwapTx(input: {
    tokenIn: string;
    tokenOut: string;
    amountIn: number;
    slippage: number;
  }): Promise<string> {
    const rpcUrl = (process.env.RPC_URL ?? "").trim();
    const privateKey = (process.env.PRIVATE_KEY ?? "").trim();
    if (!rpcUrl || !privateKey) {
      throw new Error("RPC_URL or PRIVATE_KEY is missing");
    }

    const provider = new JsonRpcProvider(rpcUrl);
    const wallet = new Wallet(privateKey, provider);
    const routerAddress = CHAINS.arb.v3Routers[0];
    if (!routerAddress) {
      throw new Error("arb v3 router is not configured");
    }

    const abi = [
      "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
    ];
    const erc20Abi = [
      "function allowance(address owner,address spender) view returns (uint256)",
      "function approve(address spender,uint256 value) returns (bool)",
    ];
    const router = new Contract(routerAddress, abi, wallet);

    const amountInWei = parseUnits(String(input.amountIn), 18);
    const bps = Math.floor(input.slippage * 10_000);
    const amountOutMinimum = (amountInWei * BigInt(10_000 - bps)) / 10_000n;

    // Minimal live support: tokenIn is treated as ERC20 and approved to router.
    const tokenInContract = new Contract(input.tokenIn, erc20Abi, wallet);
    const allowance = (await tokenInContract.allowance(wallet.address, routerAddress)) as bigint;
    if (allowance < amountInWei) {
      const approveTx = await tokenInContract.approve(routerAddress, amountInWei);
      await approveTx.wait();
    }

    const tx = await router.exactInputSingle(
      {
        tokenIn: input.tokenIn,
        tokenOut: input.tokenOut,
        fee: 3000,
        recipient: wallet.address,
        amountIn: amountInWei,
        amountOutMinimum,
        sqrtPriceLimitX96: 0,
      },
    );
    return tx.hash as string;
  }
}

