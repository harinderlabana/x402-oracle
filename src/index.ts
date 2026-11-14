import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
  FacilitatorClient,
  HTTPFacilitatorClient,
  RoutesConfig,
  x402ResourceServer,
} from '@x402/core/server';
import { Network } from '@x402/core/types';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import {
  bazaarResourceServerExtension,
  declareDiscoveryExtension,
} from '@x402/extensions/bazaar';
import { paymentMiddleware } from '@x402/hono';
import {
  buildAgentCard,
  buildLlmsTxt,
  buildOpenApiSpec,
  buildX402Manifest,
  ENDPOINT_SPECS,
} from './discovery';
import { createGasRouteHandler } from './routes/gasRoute';
import { createNewPoolsHandler } from './routes/newPools';
import { createTokenRiskHandler } from './routes/tokenRisk';
import { createWalletPulseHandler } from './routes/walletPulse';
import { AppBindings, DEFAULT_NETWORK } from './types';

export interface CreateAppOptions {
  fetcher?: typeof fetch;
  facilitatorClient?: FacilitatorClient;
  syncFacilitatorOnStart?: boolean;
  overrides?: Partial<AppBindings>;
}

const DEFAULT_BINDINGS: AppBindings = {
  PAYEE_WALLET: '0x000000000000000000000000000000000000dEaD',
  X402_NETWORK: DEFAULT_NETWORK,
  X402_FACILITATOR_URL: 'https://facilitator.payai.network',
  SERVICE_NAME: 'x402-oracle',
  SERVICE_URL: 'https://x402-oracle.workers.dev',
};

function buildRoutesConfig(payeeWallet: string, network: Network): RoutesConfig {
  const routes: RoutesConfig = {};

  for (const spec of ENDPOINT_SPECS) {
    const exampleInput: Record<string, string> = {};
    for (const [key, meta] of Object.entries(spec.queryParams)) {
      if (meta.example) {
        exampleInput[key] = meta.example;
      }
    }

    routes[`${spec.method} ${spec.path}`] = {
      accepts: {
        scheme: 'exact',
        price: spec.priceUsd,
        network,
        payTo: payeeWallet,
      },
      description: spec.description,
      mimeType: 'application/json',
      extensions: {
        ...declareDiscoveryExtension({
          input: exampleInput,
          output: {
            schema: spec.outputSchema,
          },
        }),
      },
    };
  }

  return routes;
}

export function createApp(options: CreateAppOptions = {}) {
  const app = new Hono<{ Bindings: AppBindings }>();
  const fetcher = options.fetcher ?? fetch;
  const syncFacilitatorOnStart = options.syncFacilitatorOnStart ?? true;

  app.use('*', cors());

  // Free discovery & health endpoints
  app.get('/', (c) => {
    const env = { ...DEFAULT_BINDINGS, ...c.env, ...options.overrides };
    return c.json({
      service: env.SERVICE_NAME,
      status: 'ok',
      network: env.X402_NETWORK,
      payeeWallet: env.PAYEE_WALLET,
      discovery: {
        x402: `${env.SERVICE_URL}/.well-known/x402.json`,
        agentCard: `${env.SERVICE_URL}/.well-known/agent.json`,
        openapi: `${env.SERVICE_URL}/openapi.json`,
        llmsTxt: `${env.SERVICE_URL}/llms.txt`,
      },
      endpoints: ENDPOINT_SPECS.map((s) => ({
        method: s.method,
        path: s.path,
        priceUsd: s.priceUsd,
        summary: s.summary,
      })),
    });
  });

  app.get('/health', (c) => c.json({ ok: true, timestamp: new Date().toISOString() }));

  app.get('/.well-known/x402.json', (c) => {
    const env = { ...DEFAULT_BINDINGS, ...c.env, ...options.overrides };
    return c.json(
      buildX402Manifest({
        serviceName: env.SERVICE_NAME,
        serviceUrl: env.SERVICE_URL,
        payeeWallet: env.PAYEE_WALLET,
        network: env.X402_NETWORK,
      }),
    );
  });

  app.get('/openapi.json', (c) => {
    const env = { ...DEFAULT_BINDINGS, ...c.env, ...options.overrides };
    return c.json(
      buildOpenApiSpec({
        serviceName: env.SERVICE_NAME,
        serviceUrl: env.SERVICE_URL,
      }),
    );
  });

  app.get('/.well-known/agent.json', (c) => {
    const env = { ...DEFAULT_BINDINGS, ...c.env, ...options.overrides };
    return c.json(
      buildAgentCard({
        serviceName: env.SERVICE_NAME,
        serviceUrl: env.SERVICE_URL,
        payeeWallet: env.PAYEE_WALLET,
      }),
    );
  });

  app.get('/llms.txt', (c) => {
    const env = { ...DEFAULT_BINDINGS, ...c.env, ...options.overrides };
    return c.text(
      buildLlmsTxt({
        serviceName: env.SERVICE_NAME,
        serviceUrl: env.SERVICE_URL,
        payeeWallet: env.PAYEE_WALLET,
      }),
    );
  });

  // x402 payment middleware for /v1/* (cached per env config in Worker isolate)
  let cachedKey = '';
  let cachedMw: ReturnType<typeof paymentMiddleware> | null = null;

  app.use('/v1/*', async (c, next) => {
    const env = { ...DEFAULT_BINDINGS, ...c.env, ...options.overrides };
    const network = (env.X402_NETWORK || DEFAULT_NETWORK) as Network;
    const facilitatorUrl = env.X402_FACILITATOR_URL || DEFAULT_BINDINGS.X402_FACILITATOR_URL;
    const cacheKey = `${env.PAYEE_WALLET}:${network}:${facilitatorUrl}`;

    if (!cachedMw || cachedKey !== cacheKey) {
      const facilitator =
        options.facilitatorClient ?? new HTTPFacilitatorClient({ url: facilitatorUrl });
      const resourceServer = new x402ResourceServer(facilitator)
        .register(network, new ExactEvmScheme())
        .registerExtension(bazaarResourceServerExtension);

      const routes = buildRoutesConfig(env.PAYEE_WALLET, network);
      cachedMw = paymentMiddleware(
        routes,
        resourceServer,
        undefined,
        undefined,
        syncFacilitatorOnStart,
      );
      cachedKey = cacheKey;
    }

    return cachedMw(c, next);
  });

  // Paid endpoints
  app.get('/v1/token-risk', createTokenRiskHandler(fetcher));
  app.get('/v1/gas-route', createGasRouteHandler(fetcher));
  app.get('/v1/wallet-pulse', createWalletPulseHandler(fetcher));
  app.get('/v1/new-pools', createNewPoolsHandler(fetcher));

  return app;
}

export default createApp();
