import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const REQUIRED_TOOLS = [
  "doc2x_surface_catalog",
  "doc2x_session_get",
  "doc2x_browser_fallback_plan",
  "doc2x_request",
  "doc2x_parse_pdf",
  "doc2x_get_parse_status"
];

function parseArgs(argv) {
  const parsed = {
    online: false,
    pdfPath: undefined
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--online") {
      parsed.online = true;
      continue;
    }

    if (arg === "--pdf") {
      const nextValue = argv[index + 1];
      if (!nextValue) {
        throw new Error("--pdf requires a file path");
      }

      parsed.pdfPath = nextValue;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

function logStep(message) {
  console.log(`[verify-mcp] ${message}`);
}

function extractJsonText(text) {
  const boundary = text.indexOf("\n\n");
  return boundary >= 0 ? text.slice(boundary + 2) : text;
}

function parseToolResult(result) {
  assert.equal(result?.isError, false, "Tool call returned isError=true");
  const firstText = result?.content?.find((item) => item.type === "text" && typeof item.text === "string");
  assert.ok(firstText?.text, "Tool result did not contain text content");
  return JSON.parse(extractJsonText(firstText.text));
}

function getObject(value, label) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return value;
}

function getArray(value, label) {
  assert.ok(Array.isArray(value), `${label} must be an array`);
  return value;
}

async function callJsonTool(client, name, args = {}) {
  logStep(`Calling ${name}`);
  const result = await client.callTool({
    name,
    arguments: args
  });
  return parseToolResult(result);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = process.cwd();
  const serverModulePath = path.join(projectRoot, "dist", "server.js");
  const serverModuleUrl = pathToFileURL(serverModulePath).href;
  const { createServer } = await import(serverModuleUrl);
  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const client = new Client(
    {
      name: "doc2x-mcp-verifier",
      version: "0.1.0"
    },
    {
      capabilities: {}
    }
  );

  try {
    logStep("Connecting in-memory MCP client and server");
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    logStep("Listing tools");
    const toolsResult = await client.listTools();
    const toolNames = toolsResult.tools.map((tool) => tool.name).sort();
    for (const toolName of REQUIRED_TOOLS) {
      assert.ok(toolNames.includes(toolName), `Missing required tool: ${toolName}`);
    }
    logStep(`Found ${toolNames.length} tools`);

    const surfaceCatalog = await callJsonTool(client, "doc2x_surface_catalog");
    const routes = getArray(surfaceCatalog.routes, "surface catalog routes");
    assert.ok(routes.length > 0, "surface catalog should expose routes");
    const capabilities = getArray(surfaceCatalog.capabilities, "surface catalog capabilities");
    assert.ok(capabilities.length > 0, "surface catalog should expose capabilities");

    const fallbackPlan = await callJsonTool(client, "doc2x_browser_fallback_plan", {
      flow: "ppt-generator"
    });
    assert.equal(fallbackPlan.recommendedMode, "mixed", "ppt-generator should recommend mixed mode");

    const sessionSummary = await callJsonTool(client, "doc2x_session_get");
    assert.equal(typeof sessionSummary.hasBearerToken, "boolean", "session summary should expose hasBearerToken");
    assert.equal(typeof sessionSummary.hasRefreshToken, "boolean", "session summary should expose hasRefreshToken");

    if (args.online) {
      logStep("Running online checks");
      const requestProbe = await callJsonTool(client, "doc2x_request", {
        target: "v2c",
        path: "/v2/user/profile",
        method: "GET"
      });
      assert.equal(requestProbe.ok, true, "raw request probe should succeed in online mode");

      const accountBundle = await callJsonTool(client, "doc2x_get_account_bundle");
      const profile = getObject(accountBundle.profile, "account bundle profile");
      assert.equal(profile.ok, true, "profile request should succeed");
      const subscription = getObject(accountBundle.subscription, "account bundle subscription");
      assert.equal(subscription.ok, true, "subscription request should succeed");

      if (args.pdfPath) {
        const parseResult = await callJsonTool(client, "doc2x_parse_pdf", {
          filePath: args.pdfPath,
          timeoutMs: 180000
        });
        assert.equal(parseResult.ok, true, "parse tool should succeed");
        assert.equal(parseResult.status, "success", "parse tool should reach success status");
        assert.equal(typeof parseResult.taskId, "string", "parse result should include taskId");

        const statusResult = await callJsonTool(client, "doc2x_get_parse_status", {
          taskId: parseResult.taskId
        });
        assert.equal(statusResult.ok, true, "status tool should succeed");
        assert.equal(statusResult.status, "success", "status tool should report success");
      } else {
        logStep("Skipping online parse check because no --pdf argument was provided");
      }
    } else {
      logStep("Online checks skipped. Pass --online to verify session-backed APIs.");
    }

    logStep("Verification passed");
  } catch (error) {
    throw error;
  } finally {
    await clientTransport.close();
  }
}

main().catch((error) => {
  console.error("[verify-mcp] Verification failed");
  console.error(error);
  process.exit(1);
});
