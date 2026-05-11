import { open } from "node:fs/promises";
import path from "node:path";

import { Doc2xClient, Doc2xHttpError } from "./client.js";
import { DOC2X_WEB_ORIGIN, REST_ENDPOINTS } from "./endpoints.js";
import type { ResponseSnapshot } from "./types.js";

const PDF_SIGNATURE = "%PDF-";
const DEFAULT_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 1_500;
const MAX_NONE_POLLS = 5;
const SPACE_OBJECT_RETRY_LIMIT = 5;
const SPACE_OBJECT_RETRY_DELAY_MS = 600;
const CREATE_PARSE_TASK_RETRY_LIMIT = 10;
const CREATE_PARSE_TASK_RETRY_DELAY_MS = 1_000;

export const DOC2X_TASK_STATUS = {
  none: 0,
  pending: 1,
  success: 2,
  failed: 3
} as const;

export const DOC2X_PARSE_VERSION = {
  doc2xV2_2410: 0,
  doc2xV3_2509: 3
} as const;

export const DEFAULT_PARSE_VERSION = DOC2X_PARSE_VERSION.doc2xV3_2509;

export type NormalizedTaskStatus = "unknown" | "none" | "pending" | "success" | "failed";

export interface Doc2xParseWorkflowResult {
  ok: boolean;
  filePath?: string;
  fileName?: string;
  sourceId?: string;
  taskId?: string;
  parseId?: string;
  objectId?: string;
  parseVersion?: number;
  status: NormalizedTaskStatus;
  rawStatus?: number;
  progress?: number;
  timedOut: boolean;
  reason?: string;
  resultMeta?: Record<string, unknown>;
  raw: Record<string, unknown>;
}

interface UploadTaskPayload {
  url: string;
  formData: Record<string, string>;
  outputId: string;
}

interface ParsedTaskStatus {
  status: NormalizedTaskStatus;
  rawStatus?: number;
  progress?: number;
  reason?: string;
}

interface ParseArtifacts {
  parseId?: string;
  objectId?: string;
  resultMeta?: Record<string, unknown>;
  raw: Record<string, unknown>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function getNestedValue(
  value: unknown,
  pathSegments: ReadonlyArray<string | number>
): unknown {
  let current = value;
  for (const segment of pathSegments) {
    if (typeof segment === "number") {
      const currentArray = asArray(current);
      if (!currentArray || segment >= currentArray.length) {
        return undefined;
      }
      current = currentArray[segment];
      continue;
    }

    const currentRecord = asRecord(current);
    if (!currentRecord || !(segment in currentRecord)) {
      return undefined;
    }
    current = currentRecord[segment];
  }

  return current;
}

function firstString(value: unknown, candidatePaths: ReadonlyArray<ReadonlyArray<string | number>>): string | undefined {
  for (const pathSegments of candidatePaths) {
    const candidate = getNestedValue(value, pathSegments);
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }

  return undefined;
}

function firstNumber(value: unknown, candidatePaths: ReadonlyArray<ReadonlyArray<string | number>>): number | undefined {
  for (const pathSegments of candidatePaths) {
    const candidate = getNestedValue(value, pathSegments);
    if (typeof candidate === "number") {
      return candidate;
    }
  }

  return undefined;
}

function getGatewayBody(snapshot: ResponseSnapshot): Record<string, unknown> | undefined {
  return asRecord(snapshot.body);
}

function getGatewayData(snapshot: ResponseSnapshot): Record<string, unknown> | undefined {
  return asRecord(getNestedValue(snapshot.body, ["data"]));
}

function getGatewayMessage(snapshot: ResponseSnapshot): string | undefined {
  return firstString(snapshot.body, [
    ["message"],
    ["msg"],
    ["error"],
    ["error", "message"],
    ["data", "message"],
    ["data", "msg"],
    ["code"]
  ]);
}

function gatewayIndicatesSuccess(snapshot: ResponseSnapshot): boolean {
  const okValue = getNestedValue(snapshot.body, ["ok"]);
  if (typeof okValue === "boolean") {
    return okValue;
  }

  const codeValue = getNestedValue(snapshot.body, ["code"]);
  if (typeof codeValue === "string") {
    return codeValue === "success";
  }

  return snapshot.ok;
}

function normalizeTaskStatus(rawStatus: number | undefined): NormalizedTaskStatus {
  switch (rawStatus) {
    case DOC2X_TASK_STATUS.none:
      return "none";
    case DOC2X_TASK_STATUS.pending:
      return "pending";
    case DOC2X_TASK_STATUS.success:
      return "success";
    case DOC2X_TASK_STATUS.failed:
      return "failed";
    default:
      return "unknown";
  }
}

function parseTaskStatus(snapshot: ResponseSnapshot): ParsedTaskStatus {
  const rawStatus = firstNumber(snapshot.body, [["data", "status"], ["status"]]);
  const progress = firstNumber(snapshot.body, [["data", "progress"], ["progress"]]);
  return {
    status: normalizeTaskStatus(rawStatus),
    rawStatus,
    progress,
    reason: gatewayIndicatesSuccess(snapshot) ? undefined : getGatewayMessage(snapshot) ?? "Task status request returned ok=false"
  };
}

function isNotFoundGatewayBody(body: unknown): boolean {
  const code = firstString(body, [["code"]]);
  const message = firstString(body, [["msg"], ["message"]]);
  return code === "not_found" || message === "未找到";
}

function toFailureResult(input: {
  status?: NormalizedTaskStatus;
  rawStatus?: number;
  progress?: number;
  reason: string;
  timedOut?: boolean;
  filePath?: string;
  fileName?: string;
  sourceId?: string;
  taskId?: string;
  parseId?: string;
  objectId?: string;
  parseVersion?: number;
  resultMeta?: Record<string, unknown>;
  raw: Record<string, unknown>;
}): Doc2xParseWorkflowResult {
  return {
    ok: false,
    filePath: input.filePath,
    fileName: input.fileName,
    sourceId: input.sourceId,
    taskId: input.taskId,
    parseId: input.parseId,
    objectId: input.objectId,
    parseVersion: input.parseVersion,
    status: input.status ?? "unknown",
    rawStatus: input.rawStatus,
    progress: input.progress,
    timedOut: input.timedOut ?? false,
    reason: input.reason,
    resultMeta: input.resultMeta,
    raw: input.raw
  };
}

function toSuccessResult(input: {
  filePath?: string;
  fileName?: string;
  sourceId?: string;
  taskId?: string;
  parseId?: string;
  objectId?: string;
  parseVersion?: number;
  status?: NormalizedTaskStatus;
  rawStatus?: number;
  progress?: number;
  resultMeta?: Record<string, unknown>;
  raw: Record<string, unknown>;
}): Doc2xParseWorkflowResult {
  return {
    ok: true,
    filePath: input.filePath,
    fileName: input.fileName,
    sourceId: input.sourceId,
    taskId: input.taskId,
    parseId: input.parseId,
    objectId: input.objectId,
    parseVersion: input.parseVersion,
    status: input.status ?? "success",
    rawStatus: input.rawStatus,
    progress: input.progress,
    timedOut: false,
    resultMeta: input.resultMeta,
    raw: input.raw
  };
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Doc2xHttpError) {
    return {
      name: error.name,
      message: error.message,
      response: error.response
    };
  }

  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message
    };
  }

  return {
    message: "Unknown error",
    detail: error
  };
}

function isRetryableCreateParseError(error: unknown): boolean {
  return error instanceof Doc2xHttpError && error.response.status === 404 && isNotFoundGatewayBody(error.response.body);
}

function extractUploadTaskPayload(snapshot: ResponseSnapshot): UploadTaskPayload | undefined {
  const url = firstString(snapshot.body, [["data", "url"]]);
  const outputId = firstString(snapshot.body, [["data", "outputId"], ["data", "output_id"]]);
  const rawFormData =
    getNestedValue(snapshot.body, ["data", "formData"]) ??
    getNestedValue(snapshot.body, ["data", "form_data"]);
  const formDataRecord = asRecord(rawFormData);

  if (!url || !outputId || !formDataRecord) {
    return undefined;
  }

  const formData: Record<string, string> = {};
  for (const [key, value] of Object.entries(formDataRecord)) {
    if (typeof value === "string") {
      formData[key] = value;
    } else if (typeof value === "number" || typeof value === "boolean") {
      formData[key] = String(value);
    }
  }

  return {
    url,
    outputId,
    formData
  };
}

function extractOutputId(snapshot: ResponseSnapshot): string | undefined {
  return firstString(snapshot.body, [
    ["data", "outputId"],
    ["data", "output_id"],
    ["outputId"],
    ["output_id"]
  ]);
}

function extractFirstObjectIdFromSpaceList(snapshot: ResponseSnapshot): string | undefined {
  return firstString(snapshot.body, [
    ["data", "spaceObjectList", 0, "objectId"],
    ["data", "spaceObjectList", 0, "object_id"],
    ["data", "space_object_list", 0, "objectId"],
    ["data", "space_object_list", 0, "object_id"],
    ["data", "list", 0, "objectId"]
  ]);
}

function extractParseList(snapshot: ResponseSnapshot): Record<string, unknown>[] {
  const list =
    getNestedValue(snapshot.body, ["data", "objectParseList"]) ??
    getNestedValue(snapshot.body, ["data", "object_parse_list"]);
  const records = asArray(list) ?? [];
  return records.flatMap((item) => {
    const record = asRecord(item);
    return record ? [record] : [];
  });
}

function extractParseIdFromParseListEntry(entry: Record<string, unknown> | undefined): string | undefined {
  if (!entry) {
    return undefined;
  }

  const parseId = entry.parseId;
  if (typeof parseId === "string" && parseId.length > 0) {
    return parseId;
  }

  const snakeParseId = entry.parse_id;
  if (typeof snakeParseId === "string" && snakeParseId.length > 0) {
    return snakeParseId;
  }

  return undefined;
}

function extractObjectIdFromParseDetail(snapshot: ResponseSnapshot): string | undefined {
  return firstString(snapshot.body, [
    ["data", "objectId"],
    ["data", "object_id"],
    ["data", "objectParse", "objectId"],
    ["data", "objectParse", "object_id"],
    ["data", "object_parse", "objectId"],
    ["data", "object_parse", "object_id"],
    ["data", "parse", "objectId"],
    ["data", "parse", "object_id"],
    ["data", "object", "objectId"],
    ["data", "object", "object_id"]
  ]);
}

function extractParseIdFromParseDetail(snapshot: ResponseSnapshot): string | undefined {
  return firstString(snapshot.body, [
    ["data", "parseId"],
    ["data", "parse_id"],
    ["data", "objectParse", "parseId"],
    ["data", "objectParse", "parse_id"],
    ["data", "object_parse", "parseId"],
    ["data", "object_parse", "parse_id"],
    ["data", "parse", "parseId"],
    ["data", "parse", "parse_id"]
  ]);
}

function extractObjectIdFromSpaceObject(snapshot: ResponseSnapshot): string | undefined {
  return firstString(snapshot.body, [
    ["data", "objectId"],
    ["data", "object_id"],
    ["data", "spaceObject", "objectId"]
  ]);
}

async function assertLocalPdf(filePath: string): Promise<{ filePath: string; fileName: string }> {
  const resolvedPath = path.resolve(filePath);
  const fileHandle = await open(resolvedPath, "r");

  try {
    const signatureBuffer = Buffer.alloc(PDF_SIGNATURE.length);
    const { bytesRead } = await fileHandle.read(signatureBuffer, 0, signatureBuffer.length, 0);
    const signature = signatureBuffer.subarray(0, bytesRead).toString("utf8");
    if (signature !== PDF_SIGNATURE) {
      throw new Error(`File is not a PDF: expected ${PDF_SIGNATURE} header`);
    }
  } finally {
    await fileHandle.close();
  }

  return {
    filePath: resolvedPath,
    fileName: path.basename(resolvedPath)
  };
}

async function fetchLatestObjectId(client: Doc2xClient): Promise<{
  objectId?: string;
  snapshot?: ResponseSnapshot;
}> {
  let lastSnapshot: ResponseSnapshot | undefined;

  for (let attempt = 0; attempt < SPACE_OBJECT_RETRY_LIMIT; attempt += 1) {
    const snapshot = await client.spaceOperation("getSpaceObjectList", {
      cursorId: null,
      cursor_id: null,
      limit: 1,
      fileType: null,
      file_type: null,
      expand: false
    });

    lastSnapshot = snapshot;
    const objectId = extractFirstObjectIdFromSpaceList(snapshot);
    if (objectId) {
      return {
        objectId,
        snapshot
      };
    }

    if (attempt < SPACE_OBJECT_RETRY_LIMIT - 1) {
      await sleep(SPACE_OBJECT_RETRY_DELAY_MS);
    }
  }

  return {
    snapshot: lastSnapshot
  };
}

async function enrichParseArtifacts(
  client: Doc2xClient,
  input: {
    taskId?: string;
    parseId?: string;
    objectId?: string;
  }
): Promise<ParseArtifacts> {
  const raw: Record<string, unknown> = {};
  const enrichmentErrors: Record<string, unknown>[] = [];
  let parseId = input.parseId ?? input.taskId;
  let objectId = input.objectId;
  let parseDetailSnapshot: ResponseSnapshot | undefined;
  let parseListSnapshot: ResponseSnapshot | undefined;
  let spaceObjectSnapshot: ResponseSnapshot | undefined;
  let parseResultSnapshot: ResponseSnapshot | undefined;

  if (parseId) {
    try {
      parseDetailSnapshot = await client.spaceOperation("getObjectParse", {
        parseId,
        parse_id: parseId
      });
      raw.parseDetail = parseDetailSnapshot;
      objectId = objectId ?? extractObjectIdFromParseDetail(parseDetailSnapshot);
      parseId = extractParseIdFromParseDetail(parseDetailSnapshot) ?? parseId;
    } catch (error) {
      enrichmentErrors.push({
        step: "getObjectParse",
        error: serializeError(error)
      });
    }
  }

  if (!objectId) {
    try {
      const latestObject = await fetchLatestObjectId(client);
      if (latestObject.snapshot) {
        raw.latestSpaceObjectList = latestObject.snapshot;
      }
      objectId = latestObject.objectId;
    } catch (error) {
      enrichmentErrors.push({
        step: "getSpaceObjectList",
        error: serializeError(error)
      });
    }
  }

  if (objectId) {
    try {
      spaceObjectSnapshot = await client.spaceOperation("getSpaceObject", {
        objectId,
        object_id: objectId
      });
      raw.spaceObject = spaceObjectSnapshot;
      objectId = extractObjectIdFromSpaceObject(spaceObjectSnapshot) ?? objectId;
    } catch (error) {
      enrichmentErrors.push({
        step: "getSpaceObject",
        error: serializeError(error)
      });
    }

    try {
      parseListSnapshot = await client.spaceOperation("getObjectParseList", {
        objectId,
        object_id: objectId
      });
      raw.parseList = parseListSnapshot;
      const parseList = extractParseList(parseListSnapshot);
      parseId = parseId ?? extractParseIdFromParseListEntry(parseList[0]);
    } catch (error) {
      enrichmentErrors.push({
        step: "getObjectParseList",
        error: serializeError(error)
      });
    }
  }

  if (!parseDetailSnapshot && parseId) {
    try {
      parseDetailSnapshot = await client.spaceOperation("getObjectParse", {
        parseId,
        parse_id: parseId
      });
      raw.parseDetail = parseDetailSnapshot;
      objectId = objectId ?? extractObjectIdFromParseDetail(parseDetailSnapshot);
      parseId = extractParseIdFromParseDetail(parseDetailSnapshot) ?? parseId;
    } catch (error) {
      enrichmentErrors.push({
        step: "getObjectParse:retry",
        error: serializeError(error)
      });
    }
  }

  if (parseId) {
    try {
      parseResultSnapshot = await client.spaceOperation("getObjectParseResult", {
        parseId,
        parse_id: parseId
      });
      raw.parseResult = parseResultSnapshot;
    } catch (error) {
      enrichmentErrors.push({
        step: "getObjectParseResult",
        error: serializeError(error)
      });
    }
  }

  if (enrichmentErrors.length > 0) {
    raw.enrichmentErrors = enrichmentErrors;
  }

  const parseList = parseListSnapshot ? extractParseList(parseListSnapshot) : [];
  const parseListEntry = parseList[0];
  const resultMeta: Record<string, unknown> = {};
  if (spaceObjectSnapshot) {
    resultMeta.spaceObject = getGatewayData(spaceObjectSnapshot) ?? getGatewayBody(spaceObjectSnapshot);
  }
  if (parseDetailSnapshot) {
    resultMeta.parseDetail = getGatewayData(parseDetailSnapshot) ?? getGatewayBody(parseDetailSnapshot);
  }
  if (parseResultSnapshot) {
    resultMeta.parseResult = getGatewayData(parseResultSnapshot) ?? getGatewayBody(parseResultSnapshot);
  }
  if (parseListEntry) {
    resultMeta.parseListEntry = parseListEntry;
  }
  if (parseList.length > 0) {
    resultMeta.parseListCount = parseList.length;
  }

  return {
    parseId,
    objectId,
    resultMeta: Object.keys(resultMeta).length > 0 ? resultMeta : undefined,
    raw
  };
}

export async function parsePdfViaHttp(
  client: Doc2xClient,
  input: {
    filePath: string;
    timeoutMs?: number;
    parseVersion?: number;
  }
): Promise<Doc2xParseWorkflowResult> {
  const { filePath, fileName } = await assertLocalPdf(input.filePath);
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const parseVersion = input.parseVersion ?? DEFAULT_PARSE_VERSION;
  const raw: Record<string, unknown> = {};

  raw.preflightProfile = await client.request({
    method: REST_ENDPOINTS.profile.method,
    path: REST_ENDPOINTS.profile.path,
    target: REST_ENDPOINTS.profile.target
  });

  const createUploadTaskSnapshot = await client.taskOperation("createUploadTask", {
    filename: fileName
  });
  raw.createUploadTask = createUploadTaskSnapshot;

  if (!gatewayIndicatesSuccess(createUploadTaskSnapshot)) {
    return toFailureResult({
      filePath,
      fileName,
      parseVersion,
      status: "failed",
      reason: getGatewayMessage(createUploadTaskSnapshot) ?? "CreateUploadTask returned ok=false",
      raw
    });
  }

  const uploadTask = extractUploadTaskPayload(createUploadTaskSnapshot);
  if (!uploadTask) {
    return toFailureResult({
      filePath,
      fileName,
      parseVersion,
      status: "failed",
      reason: "CreateUploadTask response did not include url, formData, and outputId",
      raw
    });
  }

  const uploadSnapshot = await client.request({
    target: "absolute",
    absoluteUrl: uploadTask.url,
    method: "POST",
    filePath,
    fileFieldName: "file",
    fileContentType: "application/pdf",
    formFields: uploadTask.formData,
    includeSessionAuth: false,
    includeSessionCookies: false,
    allowRefresh: false,
    originOverride: DOC2X_WEB_ORIGIN,
    refererOverride: `${DOC2X_WEB_ORIGIN}/parse`
  });
  raw.upload = uploadSnapshot;

  const createParsePayload: Record<string, unknown> = {
    sourceId: uploadTask.outputId,
    source_id: uploadTask.outputId
  };
  if (parseVersion !== DOC2X_PARSE_VERSION.doc2xV2_2410) {
    createParsePayload.parseVersion = parseVersion;
    createParsePayload.parse_version = parseVersion;
  }

  const createParseTaskAttempts: unknown[] = [];
  raw.createParseTaskAttempts = createParseTaskAttempts;
  let createParseTaskSnapshot: ResponseSnapshot | undefined;

  for (let attempt = 0; attempt < CREATE_PARSE_TASK_RETRY_LIMIT; attempt += 1) {
    try {
      createParseTaskSnapshot = await client.taskOperation("createParseTask", createParsePayload);
      createParseTaskAttempts.push(createParseTaskSnapshot);
      break;
    } catch (error) {
      createParseTaskAttempts.push(serializeError(error));
      if (isRetryableCreateParseError(error) && attempt < CREATE_PARSE_TASK_RETRY_LIMIT - 1) {
        await sleep(CREATE_PARSE_TASK_RETRY_DELAY_MS);
        continue;
      }

      throw error;
    }
  }

  if (!createParseTaskSnapshot) {
    return toFailureResult({
      filePath,
      fileName,
      sourceId: uploadTask.outputId,
      parseVersion,
      status: "failed",
      reason: "CreateParseTask did not return a successful response",
      raw
    });
  }

  raw.createParseTask = createParseTaskSnapshot;

  if (!gatewayIndicatesSuccess(createParseTaskSnapshot)) {
    return toFailureResult({
      filePath,
      fileName,
      sourceId: uploadTask.outputId,
      parseVersion,
      status: "failed",
      reason: getGatewayMessage(createParseTaskSnapshot) ?? "CreateParseTask returned ok=false",
      raw
    });
  }

  const taskId = extractOutputId(createParseTaskSnapshot);
  if (!taskId) {
    return toFailureResult({
      filePath,
      fileName,
      sourceId: uploadTask.outputId,
      parseVersion,
      status: "failed",
      reason: "CreateParseTask response did not include outputId",
      raw
    });
  }

  const taskStatusPolls: ResponseSnapshot[] = [];
  raw.taskStatusPolls = taskStatusPolls;
  let noneStatusCount = 0;
  let lastTaskStatus: ParsedTaskStatus = {
    status: "unknown"
  };
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    const taskStatusSnapshot = await client.taskOperation("getTaskStatus", {
      outputId: taskId,
      output_id: taskId
    });
    taskStatusPolls.push(taskStatusSnapshot);
    lastTaskStatus = parseTaskStatus(taskStatusSnapshot);

    if (!gatewayIndicatesSuccess(taskStatusSnapshot)) {
      return toFailureResult({
        filePath,
        fileName,
        sourceId: uploadTask.outputId,
        taskId,
        parseId: taskId,
        parseVersion,
        status: lastTaskStatus.status,
        rawStatus: lastTaskStatus.rawStatus,
        progress: lastTaskStatus.progress,
        reason: lastTaskStatus.reason ?? "GetTaskStatus returned ok=false",
        raw
      });
    }

    if (lastTaskStatus.status === "success") {
      const artifacts = await enrichParseArtifacts(client, {
        taskId,
        parseId: taskId
      });
      Object.assign(raw, artifacts.raw);
      return toSuccessResult({
        filePath,
        fileName,
        sourceId: uploadTask.outputId,
        taskId,
        parseId: artifacts.parseId ?? taskId,
        objectId: artifacts.objectId,
        parseVersion,
        status: lastTaskStatus.status,
        rawStatus: lastTaskStatus.rawStatus,
        progress: lastTaskStatus.progress,
        resultMeta: artifacts.resultMeta,
        raw
      });
    }

    if (lastTaskStatus.status === "failed") {
      return toFailureResult({
        filePath,
        fileName,
        sourceId: uploadTask.outputId,
        taskId,
        parseId: taskId,
        parseVersion,
        status: lastTaskStatus.status,
        rawStatus: lastTaskStatus.rawStatus,
        progress: lastTaskStatus.progress,
        reason: lastTaskStatus.reason ?? "Parse task reached failed status",
        raw
      });
    }

    if (lastTaskStatus.status === "none") {
      noneStatusCount += 1;
      if (noneStatusCount >= MAX_NONE_POLLS) {
        try {
          const fallbackParseDetail = await client.spaceOperation("getObjectParse", {
            parseId: taskId,
            parse_id: taskId
          });
          raw.noneStatusFallbackParseDetail = fallbackParseDetail;
          if (gatewayIndicatesSuccess(fallbackParseDetail)) {
            const artifacts = await enrichParseArtifacts(client, {
              taskId,
              parseId: taskId
            });
            Object.assign(raw, artifacts.raw);
            return toSuccessResult({
              filePath,
              fileName,
              sourceId: uploadTask.outputId,
              taskId,
              parseId: artifacts.parseId ?? taskId,
              objectId: artifacts.objectId ?? extractObjectIdFromParseDetail(fallbackParseDetail),
              parseVersion,
              status: "success",
              rawStatus: lastTaskStatus.rawStatus,
              progress: lastTaskStatus.progress,
              resultMeta: artifacts.resultMeta,
              raw
            });
          }
        } catch (error) {
          raw.noneStatusFallbackError = serializeError(error);
        }
      }
    } else {
      noneStatusCount = 0;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  return toFailureResult({
    filePath,
    fileName,
    sourceId: uploadTask.outputId,
    taskId,
    parseId: taskId,
    parseVersion,
    status: lastTaskStatus.status,
    rawStatus: lastTaskStatus.rawStatus,
    progress: lastTaskStatus.progress,
    timedOut: true,
    reason: `Parse task did not reach a terminal state within ${timeoutMs}ms`,
    raw
  });
}

export async function getParseStatusViaHttp(
  client: Doc2xClient,
  input: {
    taskId?: string;
    objectId?: string;
  }
): Promise<Doc2xParseWorkflowResult> {
  if (!input.taskId && !input.objectId) {
    throw new Error("taskId or objectId is required");
  }

  const raw: Record<string, unknown> = {};
  let parseId = input.taskId;
  let objectId = input.objectId;
  let taskStatus: ParsedTaskStatus = {
    status: "unknown"
  };

  if (input.taskId) {
    const taskStatusSnapshot = await client.taskOperation("getTaskStatus", {
      outputId: input.taskId,
      output_id: input.taskId
    });
    raw.taskStatus = taskStatusSnapshot;
    taskStatus = parseTaskStatus(taskStatusSnapshot);

    if (!gatewayIndicatesSuccess(taskStatusSnapshot)) {
      return toFailureResult({
        taskId: input.taskId,
        parseId,
        objectId,
        status: taskStatus.status,
        rawStatus: taskStatus.rawStatus,
        progress: taskStatus.progress,
        reason: taskStatus.reason ?? "GetTaskStatus returned ok=false",
        raw
      });
    }
  }

  const shouldEnrich =
    Boolean(objectId) ||
    Boolean(parseId) ||
    taskStatus.status === "success" ||
    taskStatus.status === "failed";

  if (shouldEnrich) {
    const artifacts = await enrichParseArtifacts(client, {
      taskId: input.taskId,
      parseId,
      objectId
    });
    Object.assign(raw, artifacts.raw);
    parseId = artifacts.parseId ?? parseId;
    objectId = artifacts.objectId ?? objectId;

    if (taskStatus.status === "success" || (!input.taskId && artifacts.resultMeta)) {
      return toSuccessResult({
        taskId: input.taskId,
        parseId,
        objectId,
        status: input.taskId ? taskStatus.status : "success",
        rawStatus: taskStatus.rawStatus,
        progress: taskStatus.progress,
        resultMeta: artifacts.resultMeta,
        raw
      });
    }

    if (taskStatus.status === "failed") {
      return toFailureResult({
        taskId: input.taskId,
        parseId,
        objectId,
        status: taskStatus.status,
        rawStatus: taskStatus.rawStatus,
        progress: taskStatus.progress,
        reason: taskStatus.reason ?? "Parse task is failed",
        resultMeta: artifacts.resultMeta,
        raw
      });
    }

    return {
      ok: false,
      taskId: input.taskId,
      parseId,
      objectId,
      status: input.taskId ? taskStatus.status : artifacts.resultMeta ? "success" : "unknown",
      rawStatus: taskStatus.rawStatus,
      progress: taskStatus.progress,
      timedOut: false,
      reason:
        input.taskId
          ? "Parse task is not complete yet"
          : artifacts.resultMeta
            ? undefined
            : "Parse metadata is not available yet",
      resultMeta: artifacts.resultMeta,
      raw
    };
  }

  return {
    ok: false,
    taskId: input.taskId,
    parseId,
    objectId,
    status: taskStatus.status,
    rawStatus: taskStatus.rawStatus,
    progress: taskStatus.progress,
    timedOut: false,
    reason: "Parse task is not complete yet",
    raw
  };
}
