#!/usr/bin/env node
/**
 * Lightweight MCP (Model Context Protocol) stdio wrapper for x402-oracle.
 * Allows any MCP-compatible AI agent to discover and invoke the x402 endpoints.
 * If an endpoint returns HTTP 402, the wrapper surfaces the x402 payment challenge
 * so the agent's wallet signer can sign and retry with X-PAYMENT.
 */

import * as readline from 'node:readline';

const BASE_URL = process.env.X402_ORACLE_URL || 'https://x402-oracle.workers.dev';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

const TOOLS = [
  {
    name: 'x402_token_risk',
    description:
      'Check token rug-risk, liquidity, and GoPlus security flags ($0.002 USDC via x402 on Base).',
    inputSchema: {
      type: 'object',
      properties: {
        address: { type: 'string', description: 'Token contract address' },
        chain: { type: 'string', description: 'Chain slug (default: base)' },
        xPaymentHeader: {
          type: 'string',
          description: 'Optional X-PAYMENT header if already signed for x402',
        },
      },
      required: ['address'],
    },
  },
  {
    name: 'x402_gas_route',
    description:
      'Get live gas prices and cheapest EVM chain across Base, Optimism, Arbitrum, and Ethereum ($0.001 USDC via x402 on Base).',
    inputSchema: {
      type: 'object',
      properties: {
        xPaymentHeader: {
          type: 'string',
          description: 'Optional X-PAYMENT header if already signed for x402',
        },
      },
    },
  },
  {
    name: 'x402_wallet_pulse',
    description:
      'Check Base wallet ETH balance, USDC balance, tx count, and activity tier ($0.005 USDC via x402 on Base).',
    inputSchema: {
      type: 'object',
      properties: {
        address: { type: 'string', description: 'EVM wallet address (0x...)' },
        xPaymentHeader: {
          type: 'string',
          description: 'Optional X-PAYMENT header if already signed for x402',
        },
      },
      required: ['address'],
    },
  },
  {
    name: 'x402_new_pools',
    description:
      'Get newly launched DEX pools pre-scored for rug risk ($0.003 USDC via x402 on Base).',
    inputSchema: {
      type: 'object',
      properties: {
        chain: { type: 'string', description: 'Target chain (default: base)' },
        limit: { type: 'string', description: 'Max pools (1-20, default: 10)' },
        xPaymentHeader: {
          type: 'string',
          description: 'Optional X-PAYMENT header if already signed for x402',
        },
      },
    },
  },
];

async function callOracle(path: string, xPaymentHeader?: string) {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (xPaymentHeader) {
    headers['X-PAYMENT'] = xPaymentHeader;
  }
  const res = await fetch(`${BASE_URL}${path}`, { headers });
  const body = await res.text();
  return { status: res.status, body };
}

async function handleRequest(req: JsonRpcRequest) {
  if (req.method === 'initialize') {
    return {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'x402-oracle-mcp', version: '0.1.0' },
    };
  }

  if (req.method === 'tools/list') {
    return { tools: TOOLS };
  }

  if (req.method === 'tools/call') {
    const params = (req.params ?? {}) as {
      name?: string;
      arguments?: Record<string, string>;
    };
    const args = params.arguments ?? {};
    let targetPath = '';

    if (params.name === 'x402_token_risk') {
      const chain = encodeURIComponent(args.chain || 'base');
      const addr = encodeURIComponent(args.address || '');
      targetPath = `/v1/token-risk?chain=${chain}&address=${addr}`;
    } else if (params.name === 'x402_gas_route') {
      targetPath = '/v1/gas-route';
    } else if (params.name === 'x402_wallet_pulse') {
      const addr = encodeURIComponent(args.address || '');
      targetPath = `/v1/wallet-pulse?address=${addr}`;
    } else if (params.name === 'x402_new_pools') {
      const chain = encodeURIComponent(args.chain || 'base');
      const limit = encodeURIComponent(args.limit || '10');
      targetPath = `/v1/new-pools?chain=${chain}&limit=${limit}`;
    } else {
      throw new Error(`Unknown tool: ${params.name}`);
    }

    const res = await callOracle(targetPath, args.xPaymentHeader);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ httpStatus: res.status, payload: JSON.parse(res.body) }, null, 2),
        },
      ],
      isError: res.status >= 400 && res.status !== 402,
    };
  }

  return {};
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let req: JsonRpcRequest;
  try {
    req = JSON.parse(trimmed) as JsonRpcRequest;
  } catch {
    return;
  }
  if (req.id === undefined) return;
  try {
    const result = await handleRequest(req);
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, result }) + '\n');
  } catch (err) {
    process.stdout.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32603, message: err instanceof Error ? err.message : 'Internal error' },
      }) + '\n',
    );
  }
});
