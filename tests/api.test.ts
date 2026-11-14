import { FacilitatorClient } from '@x402/core/server';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/index';
import { computeGasRoute } from '../src/routes/gasRoute';
import { computeNewPools } from '../src/routes/newPools';
import { computeTokenRisk } from '../src/routes/tokenRisk';
import { computeWalletPulse } from '../src/routes/walletPulse';

const TEST_WALLET = '0x1111111111111111111111111111111111111111';

const mockFacilitator: FacilitatorClient = {
  verify: async () => ({ isValid: false, invalidReason: 'mock' }),
  settle: async () => ({
    success: false,
    transaction: '',
    network: 'eip155:8453',
    errorReason: 'mock',
  }),
  getSupported: async () => ({
    kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:8453' }],
    extensions: ['bazaar'],
    signers: {},
  }),
};

describe('x402-oracle discovery & health', () => {
  const app = createApp({
    facilitatorClient: mockFacilitator,
    syncFacilitatorOnStart: true,
    overrides: { PAYEE_WALLET: TEST_WALLET },
  });

  it('serves service overview at /', async () => {
    const res = await app.request('/');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      service: string;
      payeeWallet: string;
      endpoints: Array<{ path: string }>;
    };
    expect(body.service).toBe('x402-oracle');
    expect(body.payeeWallet).toBe(TEST_WALLET);
    expect(body.endpoints.map((e) => e.path)).toEqual([
      '/v1/token-risk',
      '/v1/gas-route',
      '/v1/wallet-pulse',
      '/v1/new-pools',
    ]);
  });

  it('serves /.well-known/x402.json with all paid resources', async () => {
    const res = await app.request('/.well-known/x402.json');
    expect(res.status).toBe(200);
    const manifest = (await res.json()) as {
      x402Version: number;
      payment: { network: string; payeeWallet: string; currency: string };
      resources: Array<{ path: string; price: string }>;
    };
    expect(manifest.x402Version).toBe(2);
    expect(manifest.payment.network).toBe('eip155:8453');
    expect(manifest.payment.payeeWallet).toBe(TEST_WALLET);
    expect(manifest.payment.currency).toBe('USDC');
    expect(manifest.resources).toHaveLength(4);
  });

  it('serves /openapi.json with 402 and 200 responses', async () => {
    const res = await app.request('/openapi.json');
    expect(res.status).toBe(200);
    const spec = (await res.json()) as {
      openapi: string;
      paths: Record<string, { get: { responses: Record<string, unknown> } }>;
    };
    expect(spec.openapi).toBe('3.1.0');
    expect(Object.keys(spec.paths)).toEqual([
      '/v1/token-risk',
      '/v1/gas-route',
      '/v1/wallet-pulse',
      '/v1/new-pools',
    ]);
    expect(spec.paths['/v1/gas-route'].get.responses['402']).toBeDefined();
  });

  it('serves /.well-known/agent.json and /llms.txt', async () => {
    const cardRes = await app.request('/.well-known/agent.json');
    expect(cardRes.status).toBe(200);
    const card = (await cardRes.json()) as {
      authentication: { schemes: string[]; payeeWallet: string };
      skills: unknown[];
    };
    expect(card.authentication.schemes).toContain('x402');
    expect(card.authentication.payeeWallet).toBe(TEST_WALLET);
    expect(card.skills).toHaveLength(4);

    const llmsRes = await app.request('/llms.txt');
    expect(llmsRes.status).toBe(200);
    const llmsText = await llmsRes.text();
    expect(llmsText).toContain('/v1/new-pools');
    expect(llmsText).toContain(TEST_WALLET);
  });

  it('returns HTTP 402 on unpaid /v1/gas-route requests', async () => {
    const res = await app.request('/v1/gas-route');
    expect(res.status).toBe(402);
  });
});

describe('oracle route computation (mocked upstream)', () => {
  it('flags honeypot and low liquidity in computeTokenRisk', async () => {
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('dexscreener.com')) {
        return new Response(
          JSON.stringify({
            pairs: [
              {
                chainId: 'base',
                dexId: 'uniswap',
                priceUsd: '0.0042',
                liquidity: { usd: 2500 },
                volume: { h24: 1200 },
                baseToken: { symbol: 'SCAM' },
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.includes('gopluslabs.io')) {
        return new Response(
          JSON.stringify({
            result: {
              '0xabc0000000000000000000000000000000000123': {
                is_honeypot: '1',
                is_open_source: '0',
                buy_tax: '0.0',
                sell_tax: '0.5',
              },
            },
          }),
          { status: 200 },
        );
      }
      return new Response('{}', { status: 404 });
    };

    const result = await computeTokenRisk(
      'base',
      '0xabc0000000000000000000000000000000000123',
      mockFetch,
    );
    expect(result.verdict).toBe('HIGH_RISK');
    expect(result.riskScore).toBeGreaterThanOrEqual(80);
    expect(result.flags).toContain('HONEYPOT_DETECTED');
    expect(result.flags).toContain('LOW_LIQUIDITY_UNDER_10K');
    expect(result.market.symbol).toBe('SCAM');
  });

  it('picks cheapest EVM chain in computeGasRoute', async () => {
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      const hexByHost: Record<string, string> = {
        'mainnet.base.org': '0x989680', // 0.01 gwei
        'mainnet.optimism.io': '0x1312d00', // 0.02 gwei
        'arb1.arbitrum.io': '0x5f5e100', // 0.1 gwei
        'cloudflare-eth.com': '0x3b9aca000', // 16 gwei
      };
      const match = Object.entries(hexByHost).find(([host]) => url.includes(host));
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: match?.[1] ?? '0x0' }), {
        status: 200,
      });
    };

    const result = await computeGasRoute(mockFetch);
    expect(result.cheapestEvmChain).toBe('base');
    expect(result.chains).toHaveLength(4);
    expect(result.chains.every((c) => c.status === 'ok')).toBe(true);
  });

  it('formats ETH, USDC, and activityTier in computeWalletPulse', async () => {
    const mockFetch: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { method?: string };
      if (body.method === 'eth_getBalance') {
        return new Response(
          JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0xde0b6b3a7640000' }), // 1 ETH
          { status: 200 },
        );
      }
      if (body.method === 'eth_getTransactionCount') {
        return new Response(
          JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x2a' }), // 42 txs
          { status: 200 },
        );
      }
      if (body.method === 'eth_call') {
        return new Response(
          JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x2faf080' }), // 50 USDC (50_000_000)
          { status: 200 },
        );
      }
      return new Response('{}', { status: 400 });
    };

    const pulse = await computeWalletPulse(TEST_WALLET, mockFetch);
    expect(pulse.ethBalance).toBe('1.000000');
    expect(pulse.usdcBalance).toBe('50.000000');
    expect(pulse.txCount).toBe(42);
    expect(pulse.activityTier).toBe('ACTIVE');
  });

  it('scores newly launched DEX pools in computeNewPools', async () => {
    const mockFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              attributes: {
                name: 'NEWMEME / WETH',
                address: '0xpool1',
                base_token_price_usd: '0.0012',
                reserve_in_usd: '1200',
                volume_usd: { h24: '0' },
                pool_created_at: '2026-11-13T22:00:00Z',
              },
              relationships: {
                dex: { data: { id: 'uniswap-v3-base' } },
                base_token: { data: { id: 'base_0xtoken1' } },
              },
            },
          ],
        }),
        { status: 200 },
      );

    const result = await computeNewPools('base', 5, mockFetch);
    expect(result.count).toBe(1);
    expect(result.pools[0].baseTokenAddress).toBe('0xtoken1');
    expect(result.pools[0].verdict).toBe('HIGH_RISK');
    expect(result.pools[0].flags).toContain('VERY_LOW_LIQUIDITY_UNDER_5K');
  });
});
