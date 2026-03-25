"use client";

import { useCallback, useState } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { isSupportedChainId } from "@/config/supportedChains";

function generateNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function buildSiweMessage(params: {
  domain: string;
  address: string;
  statement: string;
  uri: string;
  chainId: number;
  nonce: string;
  issuedAt: string;
}) {
  const { domain, address, statement, uri, chainId, nonce, issuedAt } =
    params;

  return `${domain} wants you to sign in with your Ethereum account:\n${address}\n\n${statement}\n\nURI: ${uri}\nVersion: 1\nChain ID: ${chainId}\nNonce: ${nonce}\nIssued At: ${issuedAt}`;
}

export function useSiweSignIn(address?: string) {
  const { chainId } = useAccount();
  const { data: walletClient } = useWalletClient();
  const [signedAddress, setSignedAddress] = useState<string | undefined>();
  const [isSigning, setIsSigning] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const isSupportedChain = isSupportedChainId(chainId);
  const canSign = Boolean(address && walletClient && isSupportedChain);

  const apiBaseUrl =
    process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

  const signIn = useCallback(async () => {
    if (!address) {
      setError("Wallet address is not available.");
      return;
    }
    if (!walletClient) {
      setError("Wallet client is not ready yet. Please try again.");
      return;
    }

    setIsSigning(true);
    setError(undefined);

    try {
      const domain = window.location.host;
      const uri = window.location.origin;
      const chainId = walletClient.chain?.id ?? 1;
      const nonce = generateNonce();
      const issuedAt = new Date().toISOString();
      const statement = "Sign in to ChainQuant.";

      const message = buildSiweMessage({
        domain,
        address,
        statement,
        uri,
        chainId,
        nonce,
        issuedAt,
      });

      const signature = await walletClient.signMessage({
        message,
      });

      const res = await fetch(`${apiBaseUrl}/auth/siwe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, signature }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Request failed: ${res.status}`);
      }

      const data: { address: string } = await res.json();
      setSignedAddress(data.address);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setIsSigning(false);
    }
  }, [address, walletClient, apiBaseUrl]);

  const clearSignedAddress = useCallback(() => {
    setSignedAddress(undefined);
    setError(undefined);
  }, []);

  return {
    signedAddress,
    isSigning,
    error,
    canSign,
    isSupportedChain,
    signIn,
    clearSignedAddress,
  };
}

