import process from "node:process";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createServer } from "./server.js";

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("doc2x-subscription-mcp ready");
}

main().catch((error) => {
  console.error("doc2x-subscription-mcp failed", error);
  process.exit(1);
});
