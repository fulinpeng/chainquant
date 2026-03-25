"use client";

import { useAccount, useConnect, useDisconnect } from "wagmi";

export function useWallet() {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();

  const injected = connectors[0];

  return {
    address,
    isConnected,
    connect: () => {
      if (injected) {
        connect({ connector: injected });
      }
    },
    disconnect,
  };
}
