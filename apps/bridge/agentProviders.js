import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const defaultZcodeCommand = join(homedir(), "Applications/ZCode.app/Contents/Frameworks/ZCode Helper.app/Contents/MacOS/ZCode Helper");
const macZcodeCommand = "/Applications/ZCode.app/Contents/Frameworks/ZCode Helper.app/Contents/MacOS/ZCode Helper";
const defaultZcodeScript = "/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs";
const defaultZcodeProviderId = "account:bigmodel-individual-coding-plan";
const defaultZcodeModelId = "GLM-5.3";

function findBuiltinConfigFiles(root) {
  if (!root || !existsSync(root)) return [];
  const files = [];
  const visit = (directory) => {
    let entries = [];
    try { entries = readdirSync(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && entry.name === "zcode-builtin.json") files.push(path);
    }
  };
  visit(root);
  return files;
}

function readBuiltinConfig(path) {
  if (!path || !existsSync(path)) return null;
  try {
    const config = JSON.parse(readFileSync(path, "utf8"));
    const models = new Set();
    const visit = (value, key = "") => {
      if (Array.isArray(value)) {
        if (key === "builtinModelIds") for (const item of value) if (typeof item === "string") models.add(item);
        for (const item of value) visit(item, key);
      } else if (value && typeof value === "object") {
        for (const [childKey, childValue] of Object.entries(value)) visit(childValue, childKey);
      }
    };
    visit(config);
    return { path, config, revision: String(config.revision || ""), models: [...models] };
  } catch {
    return null;
  }
}

export function zcodeBuiltinConfig(env = process.env) {
  const home = String(env.HOME || homedir());
  const explicit = String(env.WPS_CONNECTOR_ZCODE_BUILTIN_CONFIG || "").trim();
  const bundled = String(env.WPS_CONNECTOR_ZCODE_BUNDLED_CONFIG || "/Applications/ZCode.app/Contents/Resources/config/provider/zcode-builtin.json").trim();
  const runtimeFiles = findBuiltinConfigFiles(String(env.WPS_CONNECTOR_ZCODE_RUNTIME_PROVIDER_ROOT || join(home, ".zcode/v2/runtime/provider")))
    .sort((left, right) => {
      try { return statSync(right).mtimeMs - statSync(left).mtimeMs; } catch { return 0; }
    });
  const candidates = [...new Set([explicit, ...runtimeFiles, bundled].filter(Boolean))];
  for (const path of candidates) {
    const result = readBuiltinConfig(path);
    if (result) return result;
  }
  return { path: "", config: null, revision: "", models: [] };
}

function zcodeEnvironment(env = process.env) {
  const home = String(env.HOME || homedir());
  const builtinConfig = zcodeBuiltinConfig(env);
  const bundledConfig = String(env.WPS_CONNECTOR_ZCODE_BUNDLED_CONFIG || "/Applications/ZCode.app/Contents/Resources/config/provider/zcode-builtin.json");
  const personalConfig = String(env.WPS_CONNECTOR_ZCODE_PERSONAL_CONFIG || join(home, ".zcode/v2/provider_config.json"));
  return {
    ELECTRON_RUN_AS_NODE: "1",
    ELECTRON_NO_ATTACH_CONSOLE: "1",
    ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: builtinConfig.path || String(env.WPS_CONNECTOR_ZCODE_BUILTIN_CONFIG || bundledConfig),
    ZCODE_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE: bundledConfig,
    ZCODE_PERSONAL_PROVIDER_CONFIG_FILE: personalConfig,
    ZCODE_DATA_BASE_DIR: home,
    ZCODE_APP_VERSION: String(env.WPS_CONNECTOR_ZCODE_VERSION || "3.12.3"),
    ZCODE_ENV: "production",
    ZCODE_RUNTIME_ENV: "production",
    ZCODE_BASE_URL: String(env.ZCODE_BASE_URL || "https://zcode.z.ai"),
  };
}

function zcodeCredentialsPath(env = process.env) {
  const home = String(env.HOME || homedir());
  return String(env.WPS_CONNECTOR_ZCODE_CREDENTIALS || join(home, ".zcode/v2/credentials.json"));
}

function zcodeModelSelection(env = process.env) {
  const providerId = String(env.WPS_CONNECTOR_ZCODE_PROVIDER_ID || defaultZcodeProviderId).trim();
  const modelId = String(env.WPS_CONNECTOR_ZCODE_MODEL_ID || defaultZcodeModelId).trim();
  return providerId && modelId ? { providerId, modelId } : null;
}

export function zcodeHasCredential(env = process.env, providerId = zcodeModelSelection(env)?.providerId) {
  const path = zcodeCredentialsPath(env);
  if (!providerId || !existsSync(path)) return false;
  try {
    const credentials = JSON.parse(readFileSync(path, "utf8"));
    return Object.keys(credentials || {}).some((key) => key.includes(`:${providerId}:`) && key.endsWith(":api-key"));
  } catch {
    return false;
  }
}

function zcodeCredentialStatus(env = process.env, providerId = zcodeModelSelection(env)?.providerId) {
  const path = zcodeCredentialsPath(env);
  if (!providerId || !existsSync(path)) return { present: false, encrypted: false };
  try {
    const credentials = JSON.parse(readFileSync(path, "utf8"));
    const key = Object.keys(credentials || {}).find((item) => item.includes(`:${providerId}:`) && item.endsWith(":api-key"));
    if (!key) return { present: false, encrypted: false };
    return { present: true, encrypted: String(credentials[key] || "").startsWith("enc:v1:") };
  } catch {
    return { present: false, encrypted: false };
  }
}

export function normalizeAgentProvider(value) {
  const provider = String(value || "").trim().toLowerCase();
  return provider === "zcode" ? "zcode" : "codex";
}

export function zcodeLaunchConfig(env = process.env) {
  const command = String(env.WPS_CONNECTOR_ZCODE_COMMAND || (existsSync(macZcodeCommand) ? macZcodeCommand : defaultZcodeCommand)).trim();
  const script = String(env.WPS_CONNECTOR_ZCODE_SCRIPT || defaultZcodeScript).trim();
  let args = [script, "app-server", "--stdio", "--surface", "desktop"];
  if (env.WPS_CONNECTOR_ZCODE_ARGS) {
    try {
      const parsed = JSON.parse(env.WPS_CONNECTOR_ZCODE_ARGS);
      if (Array.isArray(parsed) && parsed.length) args = parsed.map(String);
    } catch {
      // Keep the known-good ZCode app-server command when the override is invalid.
    }
  }
  const builtinConfig = zcodeBuiltinConfig(env);
  const model = zcodeModelSelection(env);
  const credential = zcodeCredentialStatus(env, model?.providerId);
  const explicitApiKey = String(env.WPS_CONNECTOR_ZCODE_API_KEY || "").trim();
  const executable = Boolean(command && existsSync(command) && args[0] && existsSync(args[0]));
  const configured = executable && Boolean(model) && Boolean(builtinConfig.path) && (credential.present || explicitApiKey);
  return {
    command,
    args,
    env: zcodeEnvironment(env),
    model,
    builtinConfig,
    credential,
    credentialMode: explicitApiKey ? "explicit-api-key" : credential.encrypted ? "encrypted-gui-store" : credential.present ? "local-store" : "missing",
    standaloneReady: executable && Boolean(model) && Boolean(builtinConfig.path) && Boolean(explicitApiKey),
    credentialsPath: zcodeCredentialsPath(env),
    available: executable,
    configured,
  };
}

export function zcodeAccountProviderConfig(env = process.env, launch = zcodeLaunchConfig(env)) {
  const providerId = launch.model?.providerId || defaultZcodeProviderId;
  const modelIds = launch.builtinConfig?.models?.length ? launch.builtinConfig.models : [defaultZcodeModelId, "GLM-5.3-Flash"];
  const templateRules = launch.builtinConfig?.config?.config?.providerConfigRules?.templateRules || [];
  const template = templateRules.find((item) => item.templateId === "bigmodel-api")?.config || {};
  return {
    revision: `connector-zcode-${launch.builtinConfig?.revision || "unknown"}-${providerId}`,
    basedOnZCodeBuiltinRevision: launch.builtinConfig?.revision || "unknown",
    providers: {
      [providerId]: {
        ...template,
        access: { type: "zhipu-account", mode: "start-plan", entitled: true },
        builtinModelIds: modelIds,
      },
    },
    states: {
      [providerId]: { availability: "available", entitled: true, current: true },
    },
  };
}

export function configuredAgentProviders(env = process.env) {
  const zcode = zcodeLaunchConfig(env);
  return [
    { id: "codex", label: "Codex", configured: true, available: true, mode: "desktop-shared", description: "使用当前 Codex Desktop 对话" },
    { id: "zcode", label: "ZCode", installed: zcode.available, configured: zcode.configured, standaloneReady: zcode.standaloneReady, executable: zcode.standaloneReady, available: zcode.available, mode: "app-server", status: zcode.standaloneReady ? "ready" : zcode.configured ? "gui-configured" : zcode.available ? "needs-configuration" : "not-installed", description: zcode.standaloneReady ? "使用本机 ZCode Agent；可选择项目和对话" : zcode.configured ? "可选择项目和对话；发送前需配置独立 Agent 凭据" : zcode.available ? "已检测到 ZCode，但尚未检测到可用模型登录态" : "未检测到本机 ZCode Agent" },
  ];
}
