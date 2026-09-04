export function deriveDesktopSyncStatus({
  transport = {},
  desktopRunning = false,
  privateAppServerActive = false,
  launchSettingEnabled = false,
} = {}) {
  if (!transport.desktopSyncRequired) {
    return {
      ...transport,
      ready: true,
      desktopRunning: false,
      privateAppServerActive: false,
      launchSettingEnabled,
      restartRequired: false,
    };
  }

  const sharedTransportConnected = transport.mode === "shared-daemon"
    && transport.connected === true;
  const desktopUsesSharedDaemon = desktopRunning
    && launchSettingEnabled
    && !privateAppServerActive;
  return {
    ...transport,
    ready: sharedTransportConnected && desktopUsesSharedDaemon,
    desktopRunning,
    privateAppServerActive,
    launchSettingEnabled,
    desktopUsesSharedDaemon,
    desktopTransport: !desktopRunning
      ? "not-running"
      : privateAppServerActive
        ? "private-stdio"
        : desktopUsesSharedDaemon
          ? "shared-daemon"
          : "unknown",
    configurationRequired: desktopRunning && !launchSettingEnabled,
    restartRequired: desktopRunning
      && launchSettingEnabled
      && privateAppServerActive,
  };
}
