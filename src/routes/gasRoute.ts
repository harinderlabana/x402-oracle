import { Context } from 'hono';
import { hexWeiToGwei, jsonRpcCall } from '../utils/rpc';

const EVM_RPCS: Array<{ chain: string; rpcUrl: string }> = [
  { chain: 'base', rpcUrl: 'https://mainnet.base.org' },
  { chain: 'optimism', rpcUrl: 'https://mainnet.optimism.io' },
  { chain: 'arbitrum', rpcUrl: 'https://arb1.arbitrum.io/rpc' },
  { chain: 'ethereum', rpcUrl: 'https://cloudflare-eth.com' },
];

export async function computeGasRoute(fetcher: typeof fetch = fetch) {
  const results = await Promise.all(
    EVM_RPCS.map(async ({ chain, rpcUrl }) => {
      try {
        const hexPrice = await jsonRpcCall<string>(rpcUrl, 'eth_gasPrice', [], fetcher);
        const gasGwei = Number(hexWeiToGwei(hexPrice).toFixed(6));
        return { chain, gasGwei, status: 'ok' as const };
      } catch (err) {
        return {
          chain,
          gasGwei: null,
          status: 'error' as const,
          error: err instanceof Error ? err.message : 'RPC error',
        };
      }
    }),
  );

  const okChains = results
    .filter((r): r is { chain: string; gasGwei: number; status: 'ok' } => r.status === 'ok')
    .sort((a, b) => a.gasGwei - b.gasGwei);

  return {
    cheapestEvmChain: okChains[0]?.chain ?? null,
    chains: results,
    fetchedAt: new Date().toISOString(),
  };
}

export function createGasRouteHandler(fetcher: typeof fetch = fetch) {
  return async (c: Context) => {
    const data = await computeGasRoute(fetcher);
    return c.json(data, 200, {
      'Cache-Control': 'public, max-age=5',
    });
  };
}
