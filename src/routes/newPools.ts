import { Context } from 'hono';

const GECKO_NETWORK_MAP: Record<string, string> = {
  base: 'base',
  ethereum: 'eth',
  arbitrum: 'arbitrum',
  optimism: 'optimism',
  solana: 'solana',
};

interface GeckoPoolItem {
  id?: string;
  attributes?: {
    name?: string;
    address?: string;
    base_token_price_usd?: string;
    reserve_in_usd?: string;
    volume_usd?: { h24?: string };
    pool_created_at?: string;
  };
  relationships?: {
    dex?: { data?: { id?: string } };
    base_token?: { data?: { id?: string } };
  };
}

function scorePoolRisk(liquidityUsd: number, volume24hUsd: number): {
  riskScore: number;
  verdict: 'LOW_RISK' | 'MEDIUM_RISK' | 'HIGH_RISK';
  flags: string[];
} {
  let score = 15;
  const flags: string[] = ['NEWLY_CREATED_POOL'];

  if (liquidityUsd < 5_000) {
    score += 45;
    flags.push('VERY_LOW_LIQUIDITY_UNDER_5K');
  } else if (liquidityUsd < 25_000) {
    score += 25;
    flags.push('LOW_LIQUIDITY_UNDER_25K');
  }

  if (volume24hUsd === 0) {
    score += 15;
    flags.push('ZERO_24H_VOLUME');
  }

  const bounded = Math.min(100, score);
  const verdict = bounded >= 65 ? 'HIGH_RISK' : bounded >= 35 ? 'MEDIUM_RISK' : 'LOW_RISK';
  return { riskScore: bounded, verdict, flags };
}

export async function computeNewPools(
  chain: string = 'base',
  limit: number = 10,
  fetcher: typeof fetch = fetch,
) {
  const normalizedChain = chain.toLowerCase().trim() || 'base';
  const geckoNet = GECKO_NETWORK_MAP[normalizedChain] ?? 'base';
  const clampedLimit = Math.min(20, Math.max(1, limit));

  const res = await fetcher(
    `https://api.geckoterminal.com/api/v2/networks/${geckoNet}/new_pools`,
    { headers: { accept: 'application/json' } },
  );

  if (!res.ok) {
    throw new Error(`Upstream new_pools HTTP ${res.status}`);
  }

  const payload = (await res.json()) as { data?: GeckoPoolItem[] };
  const items = (payload.data ?? []).slice(0, clampedLimit);

  const pools = items.map((item) => {
    const attrs = item.attributes ?? {};
    const liquidityUsd = Number(attrs.reserve_in_usd ?? 0);
    const volume24hUsd = Number(attrs.volume_usd?.h24 ?? 0);
    const baseTokenRaw = item.relationships?.base_token?.data?.id ?? '';
    const baseTokenAddress = baseTokenRaw.includes('_')
      ? baseTokenRaw.split('_').slice(1).join('_')
      : baseTokenRaw;
    const risk = scorePoolRisk(liquidityUsd, volume24hUsd);

    return {
      poolAddress: attrs.address ?? null,
      name: attrs.name ?? null,
      dex: item.relationships?.dex?.data?.id ?? null,
      baseTokenAddress: baseTokenAddress || null,
      priceUsd: attrs.base_token_price_usd ? Number(attrs.base_token_price_usd) : null,
      liquidityUsd,
      volume24hUsd,
      createdAt: attrs.pool_created_at ?? null,
      ...risk,
    };
  });

  return {
    chain: normalizedChain,
    count: pools.length,
    pools,
    fetchedAt: new Date().toISOString(),
  };
}

export function createNewPoolsHandler(fetcher: typeof fetch = fetch) {
  return async (c: Context) => {
    const chain = c.req.query('chain')?.trim() || 'base';
    const rawLimit = Number(c.req.query('limit') ?? '10');
    const limit = Number.isFinite(rawLimit) ? rawLimit : 10;

    try {
      const data = await computeNewPools(chain, limit, fetcher);
      return c.json(data, 200, {
        'Cache-Control': 'public, max-age=10',
      });
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : 'Upstream pool feed failure' },
        502,
      );
    }
  };
}
