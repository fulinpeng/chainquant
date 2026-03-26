"use client";

import { useAccount, useChainId, useConnect, useDisconnect, useSwitchChain } from "wagmi";

export function useWallet() {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();

  const injected = connectors[0];

  return {
    address,
    isConnected,
    chainId,
    connectors,
    connect: () => {
      if (injected) {
        connect({ connector: injected });
      }
    },
    switchChain,
    disconnect,
  };
}
