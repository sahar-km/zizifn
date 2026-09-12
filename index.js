import init, { processVlessHeader } from "./pkg/zr_wasm.js";
import wasm from "./pkg/zr_wasm_bg.wasm";
import { Config } from "./src/core.js";
import { handleClashConfig } from "./src/clash.js";
import { ProtocolOverWSHandler } from "./src/network.js";
import { handleConfigPage, handleIpSubscription, handleMyConnection, handleResolveDomain } from "./src/routes.js";

let wasmReady = null;
function ensureWasm() {
  if (!wasmReady) wasmReady = init(wasm);
  return wasmReady;
}

export default {
  async fetch(request, env, ctx) {
    try {
      const cfg = Config.fromEnv(env);
      const url = new URL(request.url);
      const upgradeHeader = request.headers.get("Upgrade");

      if (upgradeHeader && upgradeHeader.toLowerCase() === "websocket") {
        await ensureWasm();
        return ProtocolOverWSHandler(request, {
          userID: cfg.userID,
          proxyPool: cfg.proxyPool,
        });
      }

      if (url.pathname === "/resolve-domain") return handleResolveDomain(request);
      if (url.pathname === "/my-connection") return handleMyConnection(request, env, ctx);
      if (url.pathname.startsWith(`/xray-enhanced/${cfg.userID}`))
        return handleIpSubscription(request, "xray", cfg.userID, url.hostname, ctx, true);
      if (url.pathname.startsWith(`/xray/${cfg.userID}`))
        return handleIpSubscription(request, "xray", cfg.userID, url.hostname, ctx, false);
      if (url.pathname.startsWith(`/sb/${cfg.userID}`))
        return handleIpSubscription(request, "sb", cfg.userID, url.hostname, ctx);
      if (url.pathname.startsWith(`/clash/${cfg.userID}`))
        return handleClashConfig(request, cfg.userID, url.hostname, ctx);
      if (url.pathname.startsWith(`/${cfg.userID}`))
        return handleConfigPage(cfg.userID, url.hostname, cfg.proxyAddress);

      return new Response("UUID not found. Please set the UUID environment variable.", { status: 404 });
    } catch (err) {
      return new Response(`Worker Logic Error: ${err.message}\n${err.stack}`, {
        status: 500,
        headers: { "Content-Type": "text/plain" },
      });
    }
  },
};
