# x402-oracle

High-frequency on-chain oracle API for autonomous AI agents, monetized via **x402** (`USDC` on Base `eip155:8453`).

- **Live Base URL:** `https://x402-oracle.sunny-labana.workers.dev`
- **x402 Manifest:** `https://x402-oracle.sunny-labana.workers.dev/.well-known/x402.json`
- **Agent Card (A2A):** `https://x402-oracle.sunny-labana.workers.dev/.well-known/agent.json`
- **OpenAPI 3.1:** `https://x402-oracle.sunny-labana.workers.dev/openapi.json`
- **LLMs Guide:** `https://x402-oracle.sunny-labana.workers.dev/llms.txt`

## Paid Endpoints
| Endpoint | Price (USDC) | Description |
| :--- | :---: | :--- |
| `GET /v1/gas-route` | `$0.001` | Multi-chain EVM gas & cheapest execution chain oracle |
| `GET /v1/token-risk?chain=base&address=0x...` | `$0.002` | Aggregated DexScreener + GoPlus rug-risk & liquidity score |
| `GET /v1/new-pools?chain=base&limit=10` | `$0.003` | Newly launched DEX pools pre-scored for rug risk |
| `GET /v1/wallet-pulse?address=0x...` | `$0.005` | Base wallet ETH/USDC balance, tx count & activity tier |

## `awesome-x402` PR Entry (Copy-Paste)
```markdown
- [x402-oracle](https://x402-oracle.sunny-labana.workers.dev) - High-frequency on-chain oracle for AI agents: token rug-risk (`$0.002`), newly launched DEX pools (`$0.003`), multi-chain gas routing (`$0.001`), and Base wallet pulse (`$0.005`). ([x402.json](https://x402-oracle.sunny-labana.workers.dev/.well-known/x402.json))
```

## MCP Client Config
```json
{
  "mcpServers": {
    "x402-oracle": {
      "command": "npx",
      "args": ["-y", "x402-oracle-mcp"],
      "env": {
        "X402_ORACLE_URL": "https://x402-oracle.sunny-labana.workers.dev"
      }
    }
  }
}
```
