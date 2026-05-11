import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const REQUIRED_TOOLS = [
  "doc2x_surface_catalog",
  "doc2x_auth_browser",
  "doc2x_session_get",
  "doc2x_browser_fallback_plan",
  "doc2x_request",
  "doc2x_parse_pdf",
  "doc2x_get_parse_status",
  "doc2x_get_parse_markdown",
  "doc2x_export_parse_result"
];

function parseArgs(argv) {
  const parsed = {
    online: false,
    pdfPath: undefined,
    browserProfile: undefined,
    browserDebugPort: undefined
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

    if (arg === "--browser-profile") {
      const nextValue = argv[index + 1];
      if (!nextValue) {
        throw new Error("--browser-profile requires a directory path");
      }

      parsed.browserProfile = nextValue;
      index += 1;
      continue;
    }

    if (arg === "--browser-debug-port") {
      const nextValue = argv[index + 1];
      if (!nextValue) {
        throw new Error("--browser-debug-port requires a port number");
      }

      parsed.browserDebugPort = Number.parseInt(nextValue, 10);
      if (!Number.isInteger(parsed.browserDebugPort) || parsed.browserDebugPort <= 0) {
        throw new Error("--browser-debug-port must be a positive integer");
      }
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

function getNested(value, path, label) {
  let current = value;
  for (const segment of path) {
    assert.ok(current && typeof current === "object", `${label} must be present`);
    current = current[segment];
  }
  assert.notEqual(current, undefined, `${label} must be present`);
  return current;
}

async function callJsonTool(client, name, args = {}) {
  logStep(`Calling ${name}`);
  const result = await client.callTool({
    name,
    arguments: args
  });
  return parseToolResult(result);
}

async function callToolRaw(client, name, args = {}) {
  logStep(`Calling ${name}`);
  return client.callTool({
    name,
    arguments: args
  });
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

    const invalidBrowserAuthCall = await callToolRaw(client, "doc2x_auth_browser", {
      timeoutMs: 1000,
      executablePath: "/definitely/not/a/browser",
      profileDir: "/tmp/doc2x-invalid-auth-profile"
    });
    assert.equal(
      invalidBrowserAuthCall.isError,
      true,
      "browser auth tool should fail fast when the browser executable path is invalid"
    );

    if (args.online) {
      logStep("Running online checks");
      const browserProfile = args.browserProfile ?? "/tmp/doc2x-monitorable-profile";
      const browserAuth = await callJsonTool(client, "doc2x_auth_browser", {
        timeoutMs: 30000,
        profileDir: browserProfile,
        debugPort: args.browserDebugPort ?? 9222,
        notes: "verify-mcp online auth"
      });
      assert.equal(browserAuth.ok, true, "browser auth should succeed in online mode");
      assert.equal(browserAuth.authenticated, true, "browser auth should report authenticated=true");
      assert.equal(browserAuth.timedOut, false, "browser auth should not time out during silent reuse");
      assert.equal(typeof browserAuth.debugBaseUrl, "string", "browser auth should return debugBaseUrl");
      assert.equal(browserAuth.profileDir, browserProfile, "browser auth should echo the managed profile path");

      const sessionAfterAuth = await callJsonTool(client, "doc2x_session_get");
      assert.equal(sessionAfterAuth.hasBearerToken, true, "browser auth should persist a bearer token");

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

      const invalidParseVersionCall = await callToolRaw(client, "doc2x_parse_pdf", {
        filePath: "/tmp/does-not-matter.pdf",
        parseVersion: 2
      });
      assert.equal(
        invalidParseVersionCall.isError,
        true,
        "parse tool should reject unsupported parseVersion values"
      );

      if (args.pdfPath) {
        const parseCases = [
          {
            parseVersion: 0,
            expectedParseParamVersion: 0
          },
          {
            parseVersion: 3,
            expectedParseParamVersion: 3
          }
        ];

        let parseResult = null;
        for (const parseCase of parseCases) {
          const currentParseResult = await callJsonTool(client, "doc2x_parse_pdf", {
            filePath: args.pdfPath,
            timeoutMs: 180000,
            parseVersion: parseCase.parseVersion
          });
          assert.equal(currentParseResult.ok, true, `parseVersion=${parseCase.parseVersion} parse should succeed`);
          assert.equal(
            currentParseResult.status,
            "success",
            `parseVersion=${parseCase.parseVersion} parse should reach success status`
          );
          assert.equal(typeof currentParseResult.taskId, "string", "parse result should include taskId");
          assert.equal(
            currentParseResult.parseVersion,
            parseCase.parseVersion,
            `parseVersion=${parseCase.parseVersion} parse should echo requested parseVersion`
          );

          const parseListEntry = getObject(
            getNested(currentParseResult, ["resultMeta", "parseListEntry"], "parse result parseListEntry"),
            "parse result parseListEntry"
          );
          const parseParam = getObject(parseListEntry.parse_param, "parse result parse_param");
          assert.equal(
            parseParam.parse_version,
            parseCase.expectedParseParamVersion,
            `parseVersion=${parseCase.parseVersion} should match upstream parse_param.parse_version`
          );
          parseResult = currentParseResult;
        }

        const statusResult = await callJsonTool(client, "doc2x_get_parse_status", {
          taskId: parseResult.taskId
        });
        assert.equal(statusResult.ok, true, "status tool should succeed");
        assert.equal(statusResult.status, "success", "status tool should report success");

        const markdownOutputPath = "/tmp/doc2x-verify-output.md";
        await rm(markdownOutputPath, {
          force: true
        });
        const markdownResult = await callJsonTool(client, "doc2x_get_parse_markdown", {
          taskId: parseResult.taskId,
          outputPath: markdownOutputPath
        });
        assert.equal(markdownResult.ok, true, "markdown tool should succeed");
        assert.equal(markdownResult.status, "success", "markdown tool should report success");
        assert.equal(typeof markdownResult.markdown, "string", "markdown tool should return markdown text");
        assert.ok(markdownResult.markdown.length > 0, "markdown text should not be empty");
        const pages = getArray(markdownResult.pages, "markdown pages");
        assert.ok(pages.length > 0, "markdown pages should not be empty");
        assert.equal(markdownResult.wroteFile, true, "markdown tool should write the output file");
        assert.equal(markdownResult.outputPath, markdownOutputPath, "markdown tool should echo outputPath");
        const writtenMarkdown = await readFile(markdownOutputPath, "utf8");
        assert.equal(
          writtenMarkdown,
          markdownResult.markdown,
          "written markdown should match returned markdown exactly"
        );

        const exportCases = [
          {
            exportFormat: "markdown",
            outputPath: "/tmp/doc2x-verify-export.zip",
            contentType: "application/zip"
          },
          {
            exportFormat: "latex",
            outputPath: "/tmp/doc2x-verify-export-latex.zip",
            contentType: "application/zip"
          },
          {
            exportFormat: "word",
            outputPath: "/tmp/doc2x-verify-export-word.docx",
            contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          }
        ];

        for (const exportCase of exportCases) {
          await rm(exportCase.outputPath, {
            force: true
          });
          const exportResult = await callJsonTool(client, "doc2x_export_parse_result", {
            taskId: parseResult.taskId,
            exportFormat: exportCase.exportFormat,
            outputPath: exportCase.outputPath
          });
          assert.equal(exportResult.ok, true, `${exportCase.exportFormat} export should succeed`);
          assert.equal(exportResult.status, "success", `${exportCase.exportFormat} export should reach success status`);
          assert.equal(
            exportResult.exportFormat,
            exportCase.exportFormat,
            `${exportCase.exportFormat} export should report its format`
          );
          assert.equal(exportResult.wroteFile, true, `${exportCase.exportFormat} export should write the output file`);
          assert.equal(
            exportResult.outputPath,
            exportCase.outputPath,
            `${exportCase.exportFormat} export should echo outputPath`
          );
          assert.equal(
            exportResult.contentType,
            exportCase.contentType,
            `${exportCase.exportFormat} export should report verified content type`
          );
          assert.equal(typeof exportResult.downloadUrl, "string", `${exportCase.exportFormat} export should return downloadUrl`);
          assert.ok(exportResult.downloadUrl.length > 0, `${exportCase.exportFormat} downloadUrl should not be empty`);
          const writtenExport = await readFile(exportCase.outputPath);
          assert.ok(writtenExport.length > 0, `${exportCase.exportFormat} artifact should not be empty`);
          assert.equal(writtenExport[0], 0x50, `${exportCase.exportFormat} artifact should start with PK`);
          assert.equal(writtenExport[1], 0x4b, `${exportCase.exportFormat} artifact should start with PK`);
          assert.equal(
            exportResult.byteLength,
            writtenExport.length,
            `${exportCase.exportFormat} byteLength should match written file size`
          );
        }
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
