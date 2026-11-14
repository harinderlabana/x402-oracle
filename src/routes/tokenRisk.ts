import { Context } from 'hono';
import { withEdgeCache } from '../utils/cache';
import { isValidEvmAddress, jsonRpcCall } from '../utils/rpc';

const EVM_PUBLIC_RPCS: Record<string, string> = {
  base: 'https://mainnet.base.org',
  optimism: 'https://mainnet.optimism.io',
  arbitrum: 'https://arb1.arbitrum.io/rpc',
  ethereum: 'https://cloudflare-eth.com',
};

const CHAIN_ID_MAP: Record<string, string> = {
  ethereum: '1',
  optimism: '10',
  bsc: '56',
  polygon: '137',
  base: '8453',
  arbitrum: '42161',
};

interface DexScreenerPair {
  chainId?: string;
  dexId?: string;
  priceUsd?: string;
  liquidity?: { usd?: number };
  volume?: { h24?: number };
  baseToken?: { symbol?: string };
}

interface GoPlusTokenResult {
  is_honeypot?: string;
  is_open_source?: string;
  is_mintable?: string;
  cannot_sell_all?: string;
  buy_tax?: string;
  sell_tax?: string;
  owner_change_balance?: string;
}

export async function computeTokenRisk(
  chain: string,
  address: string,
  fetcher: typeof fetch = fetch,
) {
  const normalizedChain = chain.toLowerCase().trim() || 'base';
  const normalizedAddr = address.trim();
  const flags: string[] = [];
  let riskScore = 10;

  // 1. DexScreener market & liquidity lookup
  let market: {
    symbol: string | null;
    priceUsd: number | null;
    liquidityUsd: number;
    volume24hUsd: number;
    dex: string | null;
  } = {
    symbol: null,
    priceUsd: null,
    liquidityUsd: 0,
    volume24hUsd: 0,
    dex: null,
  };

  try {
    const dexRes = await fetcher(
      `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(normalizedAddr)}`,
    );
    if (dexRes.ok) {
      const dexData = (await dexRes.json()) as { pairs?: DexScreenerPair[] };
      const pairs = (dexData.pairs ?? []).filter(
        (p) => !p.chainId || p.chainId.toLowerCase() === normalizedChain,
      );
      const top = pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
      if (top) {
        market = {
          symbol: top.baseToken?.symbol ?? null,
          priceUsd: top.priceUsd ? Number(top.priceUsd) : null,
          liquidityUsd: top.liquidity?.usd ?? 0,
          volume24hUsd: top.volume?.h24 ?? 0,
          dex: top.dexId ?? null,
        };
      } else {
        riskScore += 25;
        flags.push('NO_ACTIVE_DEX_PAIR');
      }
    }
  } catch {
    flags.push('DEX_LOOKUP_UNAVAILABLE');
  }

  if (market.liquidityUsd > 0 && market.liquidityUsd < 10_000) {
    riskScore += 30;
    flags.push('LOW_LIQUIDITY_UNDER_10K');
  } else if (market.liquidityUsd === 0 && !flags.includes('NO_ACTIVE_DEX_PAIR')) {
    riskScore += 20;
    flags.push('ZERO_REPORTED_LIQUIDITY');
  }

  // 2. GoPlus security check for EVM chains
  const evmChainId = CHAIN_ID_MAP[normalizedChain];
  if (evmChainId) {
    try {
      const gpRes = await fetcher(
        `https://api.gopluslabs.io/api/v1/token_security/${evmChainId}?contract_addresses=${encodeURIComponent(normalizedAddr)}`,
      );
      if (gpRes.ok) {
        const gpJson = (await gpRes.json()) as {
          result?: Record<string, GoPlusTokenResult>;
        };
        const info = gpJson.result?.[normalizedAddr.toLowerCase()];
        if (info) {
          if (info.is_honeypot === '1') {
            riskScore += 60;
            flags.push('HONEYPOT_DETECTED');
          }
          if (info.cannot_sell_all === '1') {
            riskScore += 35;
            flags.push('CANNOT_SELL_ALL');
          }
          if (info.owner_change_balance === '1') {
            riskScore += 30;
            flags.push('OWNER_CAN_MODIFY_BALANCE');
          }
          if (info.is_open_source === '0') {
            riskScore += 15;
            flags.push('UNVERIFIED_SOURCE');
          }
          if (info.is_mintable === '1') {
            riskScore += 10;
            flags.push('MINTABLE_SUPPLY');
          }
          const buyTax = Number(info.buy_tax ?? 0);
          const sellTax = Number(info.sell_tax ?? 0);
          if (buyTax > 0.1 || sellTax > 0.1) {
            riskScore += 20;
            flags.push(`HIGH_TAX_BUY_${Math.round(buyTax * 100)}_SELL_${Math.round(sellTax * 100)}`);
          }
        }
      }
    } catch {
      flags.push('SECURITY_LOOKUP_UNAVAILABLE');
    }
  }

  // 3. Direct on-chain bytecode & totalSupply() verification for EVM chains
  let onchain: { isContract: boolean | null; totalSupplyRaw: string | null } = {
    isContract: null,
    totalSupplyRaw: null,
  };
  const rpcUrl = EVM_PUBLIC_RPCS[normalizedChain];
  if (rpcUrl && isValidEvmAddress(normalizedAddr)) {
    try {
      const [code, supplyHex] = await Promise.all([
        jsonRpcCall<string>(rpcUrl, 'eth_getCode', [normalizedAddr, 'latest'], fetcher),
        jsonRpcCall<string>(
          rpcUrl,
          'eth_call',
          [{ to: normalizedAddr, data: '0x18160ddd' }, 'latest'],
          fetcher,
        ).catch(() => '0x'),
      ]);
      const isContract = typeof code === 'string' && code !== '0x' && code.length > 2;
      onchain = {
        isContract,
        totalSupplyRaw:
          supplyHex && supplyHex !== '0x' ? BigInt(supplyHex).toString() : null,
      };
      if (!isContract) {
        riskScore += 50;
        flags.push('NOT_A_CONTRACT_EOA');
      }
    } catch {
      flags.push('ONCHAIN_RPC_UNAVAILABLE');
    }
  }

  const boundedScore = Math.min(100, Math.max(0, riskScore));
  const verdict =
    boundedScore >= 65 ? 'HIGH_RISK' : boundedScore >= 35 ? 'MEDIUM_RISK' : 'LOW_RISK';

  return {
    chain: normalizedChain,
    address: normalizedAddr,
    riskScore: boundedScore,
    verdict,
    flags,
    market,
    onchain,
    checkedAt: new Date().toISOString(),
  };
}

export function createTokenRiskHandler(fetcher: typeof fetch = fetch) {
  return async (c: Context) => {
    const address = c.req.query('address')?.trim();
    const chain = c.req.query('chain')?.trim() || 'base';

    if (!address || address.length < 20) {
      return c.json(
        { error: 'Missing or invalid `address` query parameter.' },
        400,
      );
    }

    const cacheKey = `https://cache.x402-oracle.internal/v1/token-risk?chain=${encodeURIComponent(chain.toLowerCase())}&address=${encodeURIComponent(address.toLowerCase())}`;
    const { data, cacheHit } = await withEdgeCache(cacheKey, 30, () =>
      computeTokenRisk(chain, address, fetcher),
    );
    return c.json(data, 200, {
      'Cache-Control': 'public, max-age=30',
      'X-Cache': cacheHit ? 'HIT' : 'MISS',
    });
  };
}
