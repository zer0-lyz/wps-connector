import {
  ADAPTER_PROTOCOL_VERSION,
  PRODUCT_VERSION,
  SHARED_VERSION,
} from "../../vendor/connector-shared/featureRegistry.js";

const platformUrl = (process.env.CONNECTOR_PLATFORM_URL || "http://127.0.0.1:40315").replace(/\/$/, "");
const platformState = { ok: false, mode: "fallback", url: platformUrl, protocolVersion: "", version: "", lastCheckedAt: "", lastError: "" };
let heartbeatTimer = null;
function nowIso() { return new Date().toISOString(); }
function shouldRegisterConnectorPlatform() {
  if (process.env.CONNECTOR_PLATFORM_DISABLE_REGISTER === "1") return false;
  return String(process.env.WPS_CONNECTOR_PORT || "40215") === "40215";
}
export function connectorPlatformStatus() { return { ...platformState }; }
export async function registerConnectorPlatform(adapter = {}) {
  platformState.lastCheckedAt = nowIso();
  if (!shouldRegisterConnectorPlatform()) {
    platformState.ok = false;
    platformState.mode = "fallback";
    platformState.lastError = "connector-platform registration skipped for non-default test port";
    return connectorPlatformStatus();
  }
  try {
    const response = await fetch(`${platformUrl}/api/register-adapter`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: adapter.id || `wps-connector:${process.pid}`,
        connector: "WPS",
        name: "wps-connector",
        version: adapter.version || "0.2.1",
        protocolVersion: ADAPTER_PROTOCOL_VERSION,
        productVersion: PRODUCT_VERSION,
        sharedVersion: SHARED_VERSION,
        pid: process.pid,
        capabilities: ["sourceMetadata", "displayTextCleanup", "sourceLabel", "wpsAdapter", "agentChat"],
        endpoints: {
          bridge: `http://127.0.0.1:${process.env.WPS_CONNECTOR_PORT || 40215}`,
          toolSchema: `http://127.0.0.1:${process.env.WPS_CONNECTOR_PORT || 40215}/api/tools/schema`,
          toolBase: `http://127.0.0.1:${process.env.WPS_CONNECTOR_PORT || 40215}/api/tools`,
        },
        ...adapter,
      }),
    });
    const json = await response.json();
    if (!response.ok || !json.ok) throw new Error(json.error?.message || `HTTP ${response.status}`);
    platformState.ok = true;
    platformState.mode = "shared";
    platformState.protocolVersion = json.protocol?.protocolVersion || "";
    platformState.version = json.protocol?.version || "";
    platformState.lastError = "";
    return connectorPlatformStatus();
  } catch (error) {
    platformState.ok = false;
    platformState.mode = "fallback";
    platformState.lastError = error.message || String(error);
    return connectorPlatformStatus();
  }
}

export function startConnectorPlatformHeartbeat(adapter = {}, intervalMs = Number(process.env.CONNECTOR_PLATFORM_HEARTBEAT_MS || 60000)) {
  registerConnectorPlatform(adapter);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => registerConnectorPlatform(adapter), intervalMs);
  heartbeatTimer.unref?.();
}
