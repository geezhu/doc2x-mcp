import type { BrowserFallbackPlan } from "./types.js";

export const DOC2X_WEB_ORIGIN = "https://doc2x.noedgeai.com";
export const DOC2X_V2C_ORIGIN = "https://v2c.doc2x.noedgeai.com";

export const OBSERVED_ROUTES = [
  "/",
  "/parse",
  "/translate",
  "/analysis",
  "/drawingBoard",
  "/drawing-board",
  "/ocr",
  "/tools",
  "/toolsUse",
  "/ppt-generator",
  "/ppt-generator/edit",
  "/parseDetail/:parseId",
  "/translateDetail/:translateId",
  "/local-detail/:objectId",
  "/local-parse-views",
  "/local-trans-compare",
  "/local-trans-fixed",
  "/local-img-views",
  "/markdownEdit",
  "/all-history",
  "/batch-operations",
  "/transactions/parse",
  "/transactions/translate",
  "/user/api",
  "/user/profile",
  "/user/preference",
  "/user/bill",
  "/user/historyPdf",
  "/user/translationGlossary",
  "/user/onlineSaveSetting",
  "/user/localStorageSettings",
  "/user/selectionWordSetting",
  "/user/screenshotShortcutSetting",
  "/pricing",
  "/order",
  "/login",
  "/oauth",
  "/privacy-policy",
  "/user-agreement",
  "/user-payment"
] as const;

export const REST_ENDPOINTS = {
  loginWithCode: { method: "POST", path: "/user/login" },
  loginWithPassword: { method: "POST", path: "/user/login/password" },
  logout: { method: "POST", path: "/user/logout" },
  sendSmsCode: { method: "POST", path: "/user/smscode" },
  refreshToken: { method: "POST", path: "/user/token/refresh" },
  profile: { method: "GET", path: "/user/profile" },
  quota: { method: "GET", path: "/user/quota" },
  subscription: { method: "GET", path: "/user/subscription" },
  checkin: { method: "POST", path: "/user/checkin" },
  checkinStatus: { method: "GET", path: "/user/checkin/status" },
  rebate: { method: "GET", path: "/user/rebate" },
  rebateOverview: { method: "GET", path: "/user/rebateOverview" },
  productList: { method: "GET", path: "/product/list" },
  payStatus: { method: "GET", path: "/pay/status" },
  payHistory: { method: "GET", path: "/pay/history" }
} as const;

export const TASK_GATEWAY_METHODS = {
  createUploadTask: "/gateway.v1.TaskService/CreateUploadTask",
  createParseTask: "/gateway.v1.TaskService/CreateParseTask",
  createTranslateTask: "/gateway.v1.TaskService/CreateTranslateTask",
  createParseImageTask: "/gateway.v1.TaskService/CreateParseImageTask",
  createTranslateImageTask: "/gateway.v1.TaskService/CreateTranslateImageTask",
  createExtraParseImageTask: "/gateway.v1.TaskService/CreateExtraParseImageTask",
  createConvertParseTask: "/gateway.v1.TaskService/CreateConvertParseTask",
  createConvertTranslateTask: "/gateway.v1.TaskService/CreateConvertTranslateTask",
  createExternalConvertTask: "/gateway.v1.TaskService/CreateExternalConvertTask",
  createExternalPdfMergeTask: "/gateway.v1.TaskService/CreateExternalPDFMergeTask",
  createLlmImageTask: "/gateway.v1.TaskService/CreateLLMImageTask",
  createEditImageTask: "/gateway.v1.TaskService/CreateEditImageTask",
  createInpaintImageTask: "/gateway.v1.TaskService/CreateInpaintImageTask",
  checkTranslatePoints: "/gateway.v1.TaskService/CheckTranslatePoints",
  getTaskStatus: "/gateway.v1.TaskService/GetTaskStatus",
  getConvertTaskStatus: "/gateway.v1.TaskService/GetConvertTaskStatus",
  getTaskList: "/gateway.v1.TaskService/GetTaskList"
} as const;

export const SPACE_GATEWAY_METHODS = {
  getObjectParse: "/gateway.v1.SpaceService/GetObjectParse",
  getObjectParseList: "/gateway.v1.SpaceService/GetObjectParseList",
  getObjectParseResult: "/gateway.v1.SpaceService/GetObjectParseResult",
  getObjectTranslate: "/gateway.v1.SpaceService/GetObjectTranslate",
  getObjectTranslateList: "/gateway.v1.SpaceService/GetObjectTranslateList",
  getObjectTranslateResult: "/gateway.v1.SpaceService/GetObjectTranslateResult",
  getSpaceObject: "/gateway.v1.SpaceService/GetSpaceObject",
  getSpaceObjectList: "/gateway.v1.SpaceService/GetSpaceObjectList",
  getSpaceObjectSource: "/gateway.v1.SpaceService/GetSpaceObjectSource",
  updateSpaceObject: "/gateway.v1.SpaceService/UpdateSpaceObject",
  deleteSpaceObject: "/gateway.v1.SpaceService/DeleteSpaceObject",
  deleteObjectTranslate: "/gateway.v1.SpaceService/DeleteObjectTranslate"
} as const;

export const PAY_GATEWAY_METHODS = {
  getParseConsumeHistory: "/gateway.v1.PayService/GetParseConsumeHistory",
  getTranslateConsumeHistory: "/gateway.v1.PayService/GetTranslateConsumeHistory",
  getRefundHistory: "/gateway.v1.PayService/GetRefundHistory",
  submitRefund: "/gateway.v1.PayService/SubmitRefund",
  transformUserAvailablePoints: "/gateway.v1.PayService/TransformUserAvailablePoints",
  getInvoiceList: "/gateway.v1.InvoiceService/GetInvoiceList",
  createInvoiceRequest: "/gateway.v1.InvoiceService/CreateInvoiceRequest"
} as const;

export const USER_GATEWAY_METHODS = {
  changePhoneBinding: "/gateway.v1.UserService/ChangePhoneBinding",
  checkPhoneChangeAllowed: "/gateway.v1.UserService/CheckPhoneChangeAllowed",
  loginWithOauth: "/gateway.v1.UserService/LoginWithOAuth",
  sendUserSmsCode: "/gateway.v1.UserService/SendUserSmsCode",
  unbindUserWechat: "/gateway.v1.UserService/UnbindUserWeChat",
  createUserUnregister: "/gateway.v1.UserService/CreateUserUnregister",
  deleteUserUnregister: "/gateway.v1.UserService/DeleteUserUnregister"
} as const;

export const UTIL_GATEWAY_METHODS = {
  getLatestChangeLog: "/gateway.v1.UtilService/GetLatestChangeLog",
  listActiveAnnouncements: "/gateway.v1.UtilService/ListActiveAnnouncements",
  listChangelogs: "/gateway.v1.UtilService/ListChangelogs",
  createTransferRecords: "/gateway.v1.UtilService/CreateTransferRecords",
  listTransferRecords: "/gateway.v1.UtilService/ListTransferRecords"
} as const;

export const V2C_ENDPOINTS = {
  modelsTranslate: "/models/translate",
  modelsTranslateV2: "/v2/models/translate",
  modelsMultimodal: "/models/multimodal",
  modelsChat: "/models/chat",
  chatCompletion: "/chat.v1.ChatService/Completion",
  chatStreamCompletion: "/chat.v1.ChatService/StreamCompletion"
} as const;

export const OBSERVED_CAPABILITIES = [
  "PDF parsing",
  "Document translation",
  "Image parsing and translation",
  "Task upload / polling / history",
  "Space object parse / translate result retrieval",
  "OCR views and local image views",
  "Billing, refund, and invoice flows",
  "Glossary and account settings",
  "Batch operations",
  "Markdown editor",
  "PPT generator and drawing board",
  "Online save integrations (Notion / FlowUs, plus docs mention WebDAV and NotebookLM)",
  "Local storage and browser-side caches"
] as const;

const FALLBACK_NOTES = [
  "Browser login and captcha can issue verification headers that are easier to capture from an interactive browser session.",
  "Some flows store local project state in IndexedDB or local browser storage, so HTTP alone cannot fully reproduce them.",
  "PPT generator, drawing-board editing, and browser cache recovery are best treated as mixed HTTP + browser workflows."
];

export function getBrowserFallbackPlan(flow: string): BrowserFallbackPlan {
  const normalized = flow.trim().toLowerCase();

  if (["login", "captcha", "sms", "oauth"].includes(normalized)) {
    return {
      flow,
      recommendedMode: "browser",
      reason: "These flows can trigger Aliyun captcha and interactive verification headers.",
      suggestedInputs: ["cookie header", "bearer token", "captured X-Doc2x-Verify header if present"],
      notes: FALLBACK_NOTES
    };
  }

  if (["ppt", "ppt-generator", "drawing-board", "drawingboard", "local-storage", "indexeddb"].includes(normalized)) {
    return {
      flow,
      recommendedMode: "mixed",
      reason: "These flows appear to depend on browser-local project caches and interactive editing state.",
      suggestedInputs: ["browser cookies", "local storage / IndexedDB export", "captured network requests"],
      notes: FALLBACK_NOTES
    };
  }

  if (["notion", "flowus", "webdav", "online-save"].includes(normalized)) {
    return {
      flow,
      recommendedMode: "mixed",
      reason: "Third-party save flows often start with HTTP APIs but may require browser OAuth handoff.",
      suggestedInputs: ["session cookies", "OAuth callback parameters", "captured save request payloads"],
      notes: FALLBACK_NOTES
    };
  }

  return {
    flow,
    recommendedMode: "http",
    reason: "Most query, task, history, and result-retrieval flows can be driven through observed REST or gateway endpoints.",
    suggestedInputs: ["session cookies or bearer token", "endpoint payload JSON"],
    notes: FALLBACK_NOTES
  };
}
