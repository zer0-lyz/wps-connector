import { moduleCatalog, moduleVersions } from "./moduleCatalog.js";

export const PRODUCT_NAME = "Connector Suite";
export const PRODUCT_VERSION = "0.2.1";
export const SHARED_VERSION = "0.2.0";
export const ADAPTER_PROTOCOL_VERSION = "connector-adapter-v1";

export const featureRegistry = [
  ...moduleCatalog.map((module) => ({
    id: module.id,
    version: module.version,
    layer: "feature-module",
    hosts: module.hosts,
    capabilities: module.ownership.capabilities,
    status: module.status,
    stateNamespace: module.state.namespace,
    viewId: module.ui.viewId,
  })),
  {
    id: "agent-source-metadata",
    version: "1",
    layer: "kernel",
    hosts: ["WPS", "Office"],
    capabilities: ["build", "parse", "route"],
  },
  {
    id: "unified-mcp",
    version: "1",
    layer: "platform",
    hosts: ["WPS", "Office"],
    capabilities: ["toolDiscovery", "trustedContext", "adapterRouting"],
  },
  {
    id: "suite-update",
    version: "1",
    layer: "platform",
    hosts: ["WPS", "Office"],
    capabilities: ["sync", "test", "deploy", "verify"],
  },
];

export function productManifest(adapters = []) {
  const normalizedAdapters = adapters.map((adapter) => ({
    id: adapter.id || "",
    connector: adapter.connector || "",
    name: adapter.name || "",
    version: adapter.version || "",
    productVersion: adapter.productVersion || "",
    sharedVersion: adapter.sharedVersion || "",
    protocolVersion: adapter.protocolVersion || "",
    compatible:
      adapter.productVersion === PRODUCT_VERSION
      && adapter.sharedVersion === SHARED_VERSION
      && adapter.protocolVersion === ADAPTER_PROTOCOL_VERSION,
  }));
  return {
    name: PRODUCT_NAME,
    productVersion: PRODUCT_VERSION,
    sharedVersion: SHARED_VERSION,
    adapterProtocolVersion: ADAPTER_PROTOCOL_VERSION,
    features: featureRegistry,
    modules: moduleCatalog,
    moduleVersions,
    adapters: normalizedAdapters,
    healthyAdapterCount: normalizedAdapters.filter((adapter) => adapter.compatible).length,
    compatible: normalizedAdapters.length > 0 && normalizedAdapters.every((adapter) => adapter.compatible),
  };
}
