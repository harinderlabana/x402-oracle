import { BASE_USDC_ADDRESS, DEFAULT_NETWORK, EndpointSpec } from './types';

export const ENDPOINT_SPECS: EndpointSpec[] = [
  {
    path: '/v1/token-risk',
    method: 'GET',
    priceUsd: '$0.002',
    summary: 'Token rug-risk & liquidity check',
    description:
      'Aggregates DexScreener liquidity/volume and GoPlus security flags into a fast risk score for autonomous trading and DeFi agents.',
    tags: ['defi', 'security', 'token-risk', 'trading'],
    queryParams: {
      chain: {
        type: 'string',
        required: false,
        description: 'Target chain slug (base, ethereum, arbitrum, optimism, solana). Defaults to base.',
        example: 'base',
      },
      address: {
        type: 'string',
        required: true,
        description: 'Token contract address.',
        example: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        chain: { type: 'string' },
        address: { type: 'string' },
        riskScore: { type: 'number', description: '0 (safest) to 100 (highest risk)' },
        verdict: { type: 'string', enum: ['LOW_RISK', 'MEDIUM_RISK', 'HIGH_RISK', 'UNKNOWN'] },
        flags: { type: 'array', items: { type: 'string' } },
        market: {
          type: 'object',
          properties: {
            symbol: { type: 'string' },
            priceUsd: { type: 'number' },
            liquidityUsd: { type: 'number' },
            volume24hUsd: { type: 'number' },
            dex: { type: 'string' },
          },
        },
        checkedAt: { type: 'string' },
      },
    },
  },
  {
    path: '/v1/gas-route',
    method: 'GET',
    priceUsd: '$0.001',
    summary: 'Multi-chain gas & execution cost oracle',
    description:
      'Returns live gas prices and estimated simple-transfer costs across Base, Ethereum, Arbitrum, Optimism, and Solana.',
    tags: ['gas', 'routing', 'multichain', 'oracle'],
    queryParams: {},
    outputSchema: {
      type: 'object',
      properties: {
        cheapestEvmChain: { type: 'string' },
        chains: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              chain: { type: 'string' },
              gasGwei: { type: 'number' },
              status: { type: 'string' },
            },
          },
        },
        fetchedAt: { type: 'string' },
      },
    },
  },
  {
    path: '/v1/wallet-pulse',
    method: 'GET',
    priceUsd: '$0.005',
    summary: 'Base wallet balance & activity pulse',
    description:
      'Queries Base mainnet public RPC for ETH balance, USDC balance, nonce (tx count), and activity tier.',
    tags: ['wallet', 'analytics', 'base', 'onchain'],
    queryParams: {
      address: {
        type: 'string',
        required: true,
        description: 'EVM wallet address (0x...).',
        example: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        address: { type: 'string' },
        network: { type: 'string' },
        ethBalance: { type: 'string' },
        usdcBalance: { type: 'string' },
        txCount: { type: 'number' },
        activityTier: { type: 'string', enum: ['DORMANT', 'LOW', 'ACTIVE', 'POWER_USER'] },
        checkedAt: { type: 'string' },
      },
    },
  },
  {
    path: '/v1/new-pools',
    method: 'GET',
    priceUsd: '$0.003',
    summary: 'Newly launched DEX pools pre-scored for rug risk',
    description:
      'Returns newly created DEX liquidity pools on Base, Ethereum, Arbitrum, Optimism, or Solana with inline liquidity and risk scoring.',
    tags: ['defi', 'new-pools', 'sniper', 'trading'],
    queryParams: {
      chain: {
        type: 'string',
        required: false,
        description: 'Target chain (base, ethereum, arbitrum, optimism, solana). Defaults to base.',
        example: 'base',
      },
      limit: {
        type: 'string',
        required: false,
        description: 'Max pools to return (1-20). Defaults to 10.',
        example: '10',
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        chain: { type: 'string' },
        count: { type: 'number' },
        pools: { type: 'array', items: { type: 'object' } },
        fetchedAt: { type: 'string' },
      },
    },
  },
];

export function buildX402Manifest(opts: {
  serviceName: string;
  serviceUrl: string;
  payeeWallet: string;
  network?: string;
}) {
  const network = opts.network || DEFAULT_NETWORK;
  return {
    x402Version: 2,
    name: opts.serviceName,
    description:
      'High-frequency on-chain oracle API for autonomous AI agents: token rug-risk, multi-chain gas routing, and wallet pulse.',
    provider: {
      name: opts.serviceName,
      url: opts.serviceUrl,
    },
    payment: {
      scheme: 'exact',
      network,
      asset: BASE_USDC_ADDRESS,
      currency: 'USDC',
      payeeWallet: opts.payeeWallet,
    },
    resources: ENDPOINT_SPECS.map((spec) => ({
      path: spec.path,
      method: spec.method,
      price: spec.priceUsd.replace('$', ''),
      currency: 'USDC',
      network,
      payeeWallet: opts.payeeWallet,
      description: spec.description,
      tags: spec.tags,
      parameters: spec.queryParams,
      schema: {
        output: spec.outputSchema,
      },
    })),
  };
}

export function buildOpenApiSpec(opts: { serviceName: string; serviceUrl: string }) {
  const paths: Record<string, unknown> = {};

  for (const spec of ENDPOINT_SPECS) {
    const parameters = Object.entries(spec.queryParams).map(([name, meta]) => ({
      name,
      in: 'query',
      required: meta.required,
      description: meta.description,
      schema: { type: meta.type, example: meta.example },
    }));

    paths[spec.path] = {
      get: {
        summary: spec.summary,
        description: `${spec.description} (x402 price: ${spec.priceUsd} USDC on Base)`,
        tags: spec.tags,
        parameters,
        responses: {
          '200': {
            description: 'Successful oracle response',
            content: {
              'application/json': {
                schema: spec.outputSchema,
              },
            },
          },
          '402': {
            description: 'Payment Required (x402 USDC challenge)',
          },
        },
      },
    };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: opts.serviceName,
      version: '0.1.0',
      description: 'x402-monetized on-chain data oracle for AI agents and trading bots.',
    },
    servers: [{ url: opts.serviceUrl }],
    paths,
  };
}

export function buildAgentCard(opts: {
  serviceName: string;
  serviceUrl: string;
  payeeWallet: string;
}) {
  return {
    name: opts.serviceName,
    description:
      'Autonomous x402-monetized on-chain oracle providing token rug-risk, new DEX pools, multi-chain gas routing, and wallet pulse.',
    url: opts.serviceUrl,
    version: '0.1.0',
    capabilities: {
      streaming: false,
      pushNotifications: false,
    },
    authentication: {
      schemes: ['x402'],
      network: DEFAULT_NETWORK,
      currency: 'USDC',
      payeeWallet: opts.payeeWallet,
    },
    skills: ENDPOINT_SPECS.map((spec) => ({
      id: spec.path.replace(/^\/v1\//, ''),
      name: spec.summary,
      description: `${spec.description} Price: ${spec.priceUsd} USDC via x402.`,
      tags: spec.tags,
      examples: [`GET ${opts.serviceUrl}${spec.path}`],
    })),
  };
}

export function buildLlmsTxt(opts: {
  serviceName: string;
  serviceUrl: string;
  payeeWallet: string;
}) {
  const lines = [
    `# ${opts.serviceName}`,
    '',
    `> High-frequency x402 paid on-chain oracle for AI agents (USDC on Base \`${DEFAULT_NETWORK}\`).`,
    '',
    `- Payee Wallet: \`${opts.payeeWallet}\``,
    `- x402 Manifest: ${opts.serviceUrl}/.well-known/x402.json`,
    `- OpenAPI Spec: ${opts.serviceUrl}/openapi.json`,
    `- Agent Card: ${opts.serviceUrl}/.well-known/agent.json`,
    '',
    '## Paid Endpoints (HTTP 402 Payment Required -> Sign X-PAYMENT)',
    '',
    ...ENDPOINT_SPECS.map(
      (s) => `- \`${s.method} ${s.path}\` (${s.priceUsd} USDC): ${s.description}`,
    ),
  ];
  return lines.join('\n');
}
