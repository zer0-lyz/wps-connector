import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const host = process.env.WPS_CONNECTOR_ADDIN_HOST || "127.0.0.1";
const port = Number(process.env.WPS_CONNECTOR_ADDIN_PORT || 3891);
const rootDir = join(process.cwd(), "apps/wps-addin");

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function contentType(pathname) {
  const ext = pathname.includes(".") ? pathname.slice(pathname.lastIndexOf(".")) : ".html";
  return mimeTypes[ext] || "text/plain; charset=utf-8";
}

async function sendAsset(res, relPath) {
  const isBinary = relPath.endsWith(".png");
  const body = await readFile(join(rootDir, relPath), isBinary ? undefined : "utf8");
  res.writeHead(200, { "content-type": contentType(relPath), "access-control-allow-origin": "*" });
  if (res.req?.method === "HEAD") return res.end();
  res.end(body);
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || `${host}:${port}`}`);
  const pathname = url.pathname;
  try {
    const safeMethod = req.method === "GET" || req.method === "HEAD";
    if (safeMethod && (pathname === "/" || pathname === "/index.html" || pathname === "/pane.html")) return sendAsset(res, "pane.html");
    if (safeMethod && pathname === "/main.js") return sendAsset(res, "main.js");
    if (safeMethod && pathname === "/ribbon.xml") return sendAsset(res, "ribbon.xml");
    if (safeMethod && pathname === "/icon.png") return sendAsset(res, "icon.png");
    if (safeMethod && pathname === "/images/connector.svg") return sendAsset(res, "images/connector.svg");
    if (safeMethod && pathname === "/images/js-debug.svg") return sendAsset(res, "images/js-debug.svg");
    if (req.method === "GET" && pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" });
      return res.end(JSON.stringify({ ok: true, name: "wps-connector-addin", time: new Date().toISOString() }, null, 2));
    }
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8", "access-control-allow-origin": "*" });
    res.end("Not Found");
  } catch (error) {
    res.writeHead(500, { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" });
    res.end(JSON.stringify({ ok: false, error: error.message }, null, 2));
  }
}

createServer(handle).listen(port, host, () => {
  console.error(`wps-connector addin server listening on http://${host}:${port}`);
});
