import { Context } from 'hono';
import { BASE_USDC_ADDRESS } from '../types';
import { hexToNumber, hexWeiToEth, isValidEvmAddress, jsonRpcCall } from '../utils/rpc';

const BASE_PUBLIC_RPC = 'https://mainnet.base.org';
// ERC-20 balanceOf(address) selector = 0x70a08231
const BALANCE_OF_SELECTOR = '0x70a08231';

function encodeBalanceOfCall(address: string): string {
  const clean = address.toLowerCase().replace(/^0x/, '').padStart(64, '0');
  return `${BALANCE_OF_SELECTOR}${clean}`;
}

function formatUsdcBalance(hexBalance: string): string {
  const raw = BigInt(hexBalance === '0x' ? '0x0' : hexBalance);
  const whole = raw / 10n ** 6n;
  const frac = (raw % 10n ** 6n).toString().padStart(6, '0');
  return `${whole}.${frac}`;
}

function classifyActivity(txCount: number): 'DORMANT' | 'LOW' | 'ACTIVE' | 'POWER_USER' {
  if (txCount === 0) return 'DORMANT';
  if (txCount < 10) return 'LOW';
  if (txCount < 100) return 'ACTIVE';
  return 'POWER_USER';
}

export async function computeWalletPulse(address: string, fetcher: typeof fetch = fetch) {
  const [ethHex, nonceHex, usdcHex] = await Promise.all([
    jsonRpcCall<string>(BASE_PUBLIC_RPC, 'eth_getBalance', [address, 'latest'], fetcher),
    jsonRpcCall<string>(BASE_PUBLIC_RPC, 'eth_getTransactionCount', [address, 'latest'], fetcher),
    jsonRpcCall<string>(
      BASE_PUBLIC_RPC,
      'eth_call',
      [{ to: BASE_USDC_ADDRESS, data: encodeBalanceOfCall(address) }, 'latest'],
      fetcher,
    ),
  ]);

  const txCount = hexToNumber(nonceHex);

  return {
    address,
    network: 'eip155:8453',
    ethBalance: hexWeiToEth(ethHex),
    usdcBalance: formatUsdcBalance(usdcHex),
    txCount,
    activityTier: classifyActivity(txCount),
    checkedAt: new Date().toISOString(),
  };
}

export function createWalletPulseHandler(fetcher: typeof fetch = fetch) {
  return async (c: Context) => {
    const address = c.req.query('address')?.trim();
    if (!isValidEvmAddress(address)) {
      return c.json({ error: 'Invalid or missing EVM `address` query parameter.' }, 400);
    }

    try {
      const result = await computeWalletPulse(address, fetcher);
      return c.json(result, 200, {
        'Cache-Control': 'public, max-age=15',
      });
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : 'Upstream RPC failure' },
        502,
      );
    }
  };
}
