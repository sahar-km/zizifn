const decodeSecure = (encoded) => atob(encoded);

export const CONST = {
  ED_PARAMS: { ed: 2560, eh: "Sec-WebSocket-Protocol" },
  AT_SYMBOL: "@",
  VLESS_PROTOCOL: decodeSecure("dmxlc3M="),
  WS_READY_STATE_OPEN: 1,
  WS_READY_STATE_CLOSING: 2,
  CIPHER_SUITES:
    "TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:TLS_AES_128_GCM_SHA256:TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384:TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384:TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256:TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256:TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256:TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256:TLS_ECDHE_ECDSA_WITH_AES_256_CBC_SHA:TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA:TLS_ECDHE_ECDSA_WITH_AES_128_CBC_SHA256:TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA256",
  FINAL_MASK: JSON.stringify({
    tcp: [
      {
        type: "fragment",
        settings: { packets: "tlshello", lengths: ["5", "94", "1"], delays: ["0"], maxSplit: "0" },
      },
      {
        type: "fragment",
        settings: { packets: "1-1", lengths: ["109", "1"], delays: ["1"], maxSplit: "355" },
      },
    ],
  }),
};

export const Config = {
  userID: "be0ff9df-1468-41a0-8865-796d1c6800db",
  proxyIPs: ["di.nscl.ir:443", "tr.diam4.ggff.net:443"],
  fromEnv(env) {
    const pool = env.PROXYIP
      ? [env.PROXYIP, ...this.proxyIPs.filter((ip) => ip !== env.PROXYIP)]
      : this.proxyIPs;
    return {
      userID: env.UUID || this.userID,
      proxyPool: pool,
      proxyAddress: pool[0],
    };
  },
};

export async function safeFetch(url, options = {}, timeout = 4000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

export function generateRandomPath(length = 28, query = "") {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `/${result}${query ? `?${query}` : ""}`;
}

export const CORE_PRESETS = {
  xray: {
    tls: {
      path: () => generateRandomPath(12, "ed=2048"),
      security: "tls",
      fp: "chrome",
      alpn: "http/1.1",
      extra: {},
    },
    tcp: {
      path: () => generateRandomPath(12, "ed=2048"),
      security: "none",
      fp: "chrome",
      alpn: "http/1.1",
      extra: {},
    },
  },
  sb: {
    tls: {
      path: () => generateRandomPath(18),
      security: "tls",
      fp: "chrome",
      alpn: "http/1.1",
      extra: CONST.ED_PARAMS,
    },
};

export function makeName(tag, proto) {
  return `${tag}-${proto.toUpperCase()}`;
}

export function createVlessLink({
  userID, address, port, host, path, security, sni, fp, alpn, extra = {}, enhanced = false, name,
}) {
  const params = new URLSearchParams({ type: decodeSecure("d3M="), host, path });
  if (security) params.set("security", security);
  if (sni) params.set("sni", sni);
  if (fp) params.set("fp", fp);
  if (alpn) params.set("alpn", alpn);
  if (enhanced) {
    if (security === "tls") params.set("cs", CONST.CIPHER_SUITES);
    params.set("fm", CONST.FINAL_MASK);
  }
  for (const [k, v] of Object.entries(extra)) params.set(k, v);
  return `${CONST.VLESS_PROTOCOL}://${userID}@${address}:${port}?${params.toString()}#${encodeURIComponent(name)}`;
}

export function buildLink({ core, proto, userID, hostName, address, port, tag, enhanced = false }) {
  const p = CORE_PRESETS[core][proto];
  return createVlessLink({
    userID, address, port, host: hostName, path: p.path(), security: p.security,
    sni: p.security === "tls" ? hostName : undefined,
    fp: enhanced && p.security === "tls" ? "unsafe" : p.fp,
    alpn: p.alpn, extra: p.extra, enhanced,
    name: makeName(tag, proto) + (enhanced ? "-Enhanced" : ""),
  });
}

export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function isInIgnoredRange(ip) {
  return ip.startsWith("198.41.208.");
}
