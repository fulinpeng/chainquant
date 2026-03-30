export type ChainKey = "ethereum" | "base" | "op" | "arb" | "bnb";

export type ChainConfig = {
  key: ChainKey;
  name: string;
  enabled: boolean;
  wsUrlEnv: string;
  v3Routers: string[]; // 已小写的合约地址列表
  v4UniversalRouters: string[]; // 已小写的合约地址列表
  wrappedNative: {
    symbol: string;
    address: string; // 已小写的合约地址
  };
  stableTokens: {
    symbol: string;
    address: string; // 已小写的合约地址
  }[];
};

// 仅通过 `exactInputSingle` 做最小化的 Uniswap V3 外围合约识别。
// 可在各链上按实际情况增删 Router 地址。
export const CHAINS: Record<ChainKey, ChainConfig> = {
  ethereum: {
    key: "ethereum",
    name: "Ethereum",
    enabled: false,
    wsUrlEnv: "ETH_WS_URL",
    v3Routers: [
      "0xe592427a0aece92de3edee1f18e0157c05861564",
      "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45",
    ],
    v4UniversalRouters: [
      "0xa51afafe0263b40edaef0df8781ea9aa03e381a3",
    ],
    wrappedNative: {
      symbol: "WETH",
      address: "0xc02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2".toLowerCase(),
    },
    stableTokens: [],
  },
  base: {
    key: "base",
    name: "Base",
    enabled: false,
    wsUrlEnv: "BASE_WS_URL",
    v3Routers: [
      // Base 上常用 SwapRouter02 部署地址之一
      "0x2626664c2603336e57b271c5c0b26f421741e481",
      // 部分 Router 地址在多链间相同
      "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45",
    ],
    v4UniversalRouters: [
      "0xa51afafe0263b40edaef0df8781ea9aa03e381a3",
    ],
    wrappedNative: {
      symbol: "WETH",
      address: "0x4200000000000000000000000000000000000006".toLowerCase(),
    },
    stableTokens: [],
  },
  op: {
    key: "op",
    name: "Optimism",
    enabled: false,
    wsUrlEnv: "OP_WS_URL",
    v3Routers: ["0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45"],
    v4UniversalRouters: [
      "0xa51afafe0263b40edaef0df8781ea9aa03e381a3",
    ],
    wrappedNative: {
      symbol: "WETH",
      address: "0x4200000000000000000000000000000000000006".toLowerCase(),
    },
    stableTokens: [],
  },
  arb: {
    key: "arb",
    name: "Arbitrum",
    enabled: true,
    wsUrlEnv: "ARB_WS_URL",
    v3Routers: ["0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45"],
    v4UniversalRouters: [
      "0xa51afafe0263b40edaef0df8781ea9aa03e381a3",
    ],
    wrappedNative: {
      symbol: "WETH",
      address: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1".toLowerCase(),
    },
    stableTokens: [
      {
        symbol: "USDC",
        address: "0xaf88d065e77c8cc2239327c5edb3a432268e5831".toLowerCase(),
      },
      {
        symbol: "USDT",
        address: "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9".toLowerCase(),
      },
    ],
  },
  bnb: {
    key: "bnb",
    name: "BNB Chain",
    enabled: false,
    wsUrlEnv: "BNB_WS_URL",
    v3Routers: ["0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45"],
    v4UniversalRouters: [
      "0xa51afafe0263b40edaef0df8781ea9aa03e381a3",
    ],
    wrappedNative: {
      symbol: "WBNB",
      address: "0xbb4cdb9cbdd36b01bd1cbaebf2de08d9173bc095c".toLowerCase(),
    },
    stableTokens: [],
  },
};

