#!/usr/bin/env bash
# 在另一台 Mac 的 ZCode 中注册 WPS Connector 插件。
# 前提：本机已部署 wps-connector runtime（bridge 运行于 127.0.0.1:40215）。
# 用法：bash zcode/setup-zcode-plugin-mac.sh
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MARKETPLACE_SRC="$REPO_DIR/zcode/marketplace"
DEST="$HOME/.zcode/local-marketplaces/wps-connector-marketplace"
CACHE="$HOME/.zcode/cli/plugins/cache/wps-connector-local/wps-connector/1.1.5"

echo "== 1/4 检查 bridge =="
if ! curl -sf -m 5 http://127.0.0.1:40215/api/health >/dev/null 2>&1; then
  echo "✗ bridge 未运行。请先完成 runtime 部署："
  echo "  git clone https://github.com/zer0-lyz/wps-connector.git \$HOME/.local/share/wps-connector/source"
  echo "  cd \$HOME/.local/share/wps-connector/source && npm install && npm run deploy && npm run launchd:install"
  exit 1
fi
echo "✓ bridge 健康"

echo "== 2/4 安装市场源（路径适配当前用户）=="
rm -rf "$DEST"
mkdir -p "$(dirname "$DEST")"
cp -R "$MARKETPLACE_SRC" "$DEST"
grep -rl "/Users/lin" "$DEST" 2>/dev/null | while read -r f; do sed -i '' "s|/Users/lin|$HOME|g" "$f"; done
echo "✓ 市场源就绪：$DEST"

echo "== 3/4 注册插件 =="
python3 - "$DEST" "$CACHE" <<'PYEOF'
import json, os, sys, time
dest, cache = sys.argv[1], os.path.expanduser(sys.argv[2])
ts = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
home = os.path.expanduser("~")
km_path = os.path.join(home, ".zcode/cli/plugins/known_marketplaces.json")
ip_path = os.path.join(home, ".zcode/cli/plugins/installed_plugins.json")
cfg_path = os.path.join(home, ".zcode/cli/config.json")
for p in (km_path, ip_path, cfg_path):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    if not os.path.exists(p) or os.path.getsize(p) == 0:
        seed = {"version": 1, "marketplaces": []} if p == km_path else {"version": 1, "plugins": []} if p == ip_path else {}
        with open(p, "w") as f:
            json.dump(seed, f, indent=2)
km = json.load(open(km_path))
if not any(m.get("id") == "wps-connector-local" for m in km.get("marketplaces", [])):
    km.setdefault("marketplaces", []).append({
        "id": "wps-connector-local",
        "source": {"source": "path", "path": dest},
        "name": "wps-connector-local",
        "description": "Personal local marketplace for the WPS Connector plugin.",
        "addedAt": ts,
        "pluginCount": 1,
    })
json.dump(km, open(km_path, "w"), ensure_ascii=False, indent=2)
ip = json.load(open(ip_path))
entry = {
    "id": "wps-connector@wps-connector-local",
    "name": "wps-connector",
    "marketplace": "wps-connector-local",
    "version": "1.1.5",
    "installPath": cache,
    "installedAt": ts,
    "updatedAt": ts,
    "scope": "user",
    "source": {"source": "path", "path": os.path.join(dest, "wps-connector")},
}
if not any(x.get("id") == entry["id"] for x in ip.get("plugins", [])):
    ip.setdefault("plugins", []).append(entry)
json.dump(ip, open(ip_path, "w"), ensure_ascii=False, indent=2)
cfg = json.load(open(cfg_path))
cfg.setdefault("plugins", {}).setdefault("enabledPlugins", {})["wps-connector@wps-connector-local"] = True
json.dump(cfg, open(cfg_path, "w"), ensure_ascii=False, indent=2)
print("✓ known_marketplaces / installed_plugins / config 已更新")
PYEOF

echo "== 4/4 写入插件缓存 =="
rm -rf "$CACHE"
mkdir -p "$(dirname "$CACHE")"
cp -R "$DEST/wps-connector/" "$CACHE/"
echo "✓ 插件缓存：$CACHE"

echo ""
echo "全部完成。重启 ZCode 后验证："
echo "  1. 插件市场 → 已安装/个人 出现 WPS Connector"
echo "  2. Settings → MCP 显示 wps-connector 已连接"
echo "  3. 打开 WPS 与 Connector 窗格，绑定文档后即可在 ZCode 里调用"
