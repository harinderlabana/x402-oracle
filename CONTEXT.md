# x402-oracle

- **Goal:** Zero-upfront, 100% automated, non-custodial x402 paid micro-API on Base USDC for AI agents.
- **Stack:** Cloudflare Workers, Hono, `@x402/hono`, TypeScript, Vitest.
- **Entrypoint:** `src/index.ts` (Worker) and `mcp/index.ts` (MCP wrapper).
- **Discovery:** `/.well-known/x402.json`, `/openapi.json`, and x402 Bazaar extensions.
- **Run local:** `npm run dev`
- **Verify:** `./verify.sh`
- **Deploy:** `npx wrangler deploy` (set `PAYEE_WALLET` in `wrangler.toml` or secret).
