import {
  buildLink,
  safeFetch,
  isInIgnoredRange,
  pick,
  CONST,
  SENS,
  buildMainDomains,
  buildSubscriptionHeaders,
  buildSettingsUrl,
} from "./core.js";
import panelB64 from "./panel.b64";
const panelBytes = Uint8Array.from(atob(panelB64), (c) => c.charCodeAt(0));
const panelHtml = new TextDecoder("utf-8").decode(panelBytes);

export async function handleIpSubscription(request, core, userID, hostName, ctx, enhanced = false) {
  const url = new URL(request.url);
  const subName = url.searchParams.get("name");

  const mainDomains = buildMainDomains(hostName);

  const httpsPorts = [443, 8443, 2053, 2083, 2087, 2096];
  const httpPorts = [80, 8080, 8880, 2052, 2082, 2086, 2095];
  let links = [];
  const isPagesDeployment = hostName.endsWith(".pages.dev");
  const includeTcp = (core === "sb" || (core === "xray" && enhanced)) && !isPagesDeployment;

  mainDomains.forEach((domain, i) => {
    links.push(
      buildLink({
        core,
        proto: "tls",
        userID,
        hostName,
        address: domain,
        port: pick(httpsPorts),
        tag: `Domain${i + 1}`,
        enhanced,
      }),
    );
  });

  try {
    const cache = caches.default;
    const cacheKey = new Request("https://cf-ip-cache.local");
    let response = await cache.match(cacheKey);
    if (!response) {
      const r = await safeFetch(
        "https://raw.githubusercontent.com/NiREvil/vless/refs/heads/main/Cloudflare-IPs.json",
        {},
        4000,
      );
      if (r.ok) {
        response = new Response(await r.text(), {
          headers: { "Cache-Control": "public, max-age=86400" },
        });
        ctx.waitUntil(cache.put(cacheKey, response.clone()));
      }
    }
    if (response) {
      const json = await response.json();
      const ips = [...(json.ipv4 || []), ...(json.ipv6 || [])]
        .map((x) => x.ip)
        .filter((ip) => !isInIgnoredRange(ip))
        .slice(0, 20);
      ips.forEach((ip, i) => {
        const formattedAddress = ip.includes(":") ? `[${ip}]` : ip;
        links.push(
          buildLink({
            core,
            proto: "tls",
            userID,
            hostName,
            address: formattedAddress,
            port: pick(httpsPorts),
            tag: `IP${i + 1}`,
            enhanced,
          }),
        );
        if (includeTcp) {
          links.push(
            buildLink({
              core,
              proto: "tcp",
              userID,
              hostName,
              address: formattedAddress,
              port: pick(httpPorts),
              tag: `IP${i + 1}`,
              enhanced,
            }),
          );
        }
      });
    }
  } catch (e) {
    console.error("Cached IP fetch failed", e);
  }

  const headers = {
    "Content-Type": "text/plain;charset=utf-8",
    ...buildSubscriptionHeaders(subName),
  };
  return new Response(btoa(links.join("\n")), { headers });
}

export async function handleMyConnection(request, env, ctx) {
  const clientIP = request.headers.get("CF-Connecting-IP") || "127.0.0.1";
  const cf = request.cf || {};
  let threatScore = 0;
  let risk = "Low";

  try {
    const harmonicaRes = await safeFetch(
      `https://api.harmonica.workers.dev/api/${clientIP}`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
          Accept: "application/json",
        },
      },
      4000,
    );
    if (harmonicaRes.ok) {
      const data = await harmonicaRes.json();
      if (data) {
        const targetObj = data.info || data;
        threatScore = targetObj.score ?? targetObj.fraud_score ?? targetObj.threatScore ?? 0;
        if (targetObj.risk) risk = targetObj.risk.charAt(0).toUpperCase() + targetObj.risk.slice(1);
      }
    }
  } catch (e) {}

  return new Response(
    JSON.stringify({
      ip: clientIP,
      country: cf.country || "N/A",
      city: cf.city || "",
      isp: cf.asOrganization || "N/A",
      threatScore,
      risk,
    }),
    { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } },
  );
}

export async function handleResolveDomain(request) {
  const url = new URL(request.url);
  const domain = url.searchParams.get("domain");
  if (!domain)
    return new Response(JSON.stringify({ error: "Missing domain" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });

  const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(domain)) {
    return new Response(JSON.stringify({ ip: domain }), { headers });
  }

  try {
    const dnsRes = await safeFetch(
      `https://1.1.1.1/dns-query?name=${encodeURIComponent(domain)}&type=A`,
      { headers: { accept: "application/dns-json" } },
      4000,
    );
    const dnsData = await dnsRes.json();
    const ipAnswer = dnsData.Answer?.find((a) => a.type === 1);
    return new Response(JSON.stringify({ ip: ipAnswer ? ipAnswer.data : null }), { headers });
  } catch (error) {
    return new Response(JSON.stringify({ ip: null, error: error.toString() }), { headers });
  }
}

export async function handleConfigPage(userID, hostName, proxyAddress, workerName) {
  const dream = buildLink({
    core: "xray",
    proto: "tls",
    userID,
    hostName,
    address: hostName,
    port: 443,
    tag: `${hostName}-Xray`,
  });
  const freedom = buildLink({
    core: "sb",
    proto: "tls",
    userID,
    hostName,
    address: hostName,
    port: 443,
    tag: `${hostName}-Singbox`,
  });

  const settingsUrl = buildSettingsUrl(workerName);
  const workerLabel = hostName.split(".")[0] || "INDEX";
  const encodedSubName = encodeURIComponent(workerLabel);
  const subXrayUrlH = `https://${hostName}/xray/${userID}?name=${encodedSubName}`;
  const subXrayUrlV = `https://${hostName}/xray/${userID}#${encodedSubName}`;
  const subXrayUrlVEnhanced = `https://${hostName}/xray-enhanced/${userID}#${encodedSubName}`;
  const subClashUrl = `https://${hostName}/clash/${userID}?name=${encodedSubName}`;
  const subSbUrl = `https://${hostName}/sb/${userID}?name=${encodedSubName}`;

  const finalHTML = panelHtml
  .replace(/{{PROXY_ADDRESS}}/g, proxyAddress)
  .replace(/{{CONFIG_DREAM}}/g, dream)
  .replace(/{{CONFIG_FREEDOM}}/g, freedom)
  .replace(/{{URL_WORKER_SETTINGS}}/g, settingsUrl)
  .replace(/{{URL_V2RAYNG_ENHANCED}}/g, `${SENS.v2rayng()}${subXrayUrlVEnhanced}`)
  .replace(/{{URL_V2RAYNG}}/g, `${SENS.v2rayng()}${subXrayUrlV}`)
  .replace(/{{URL_CLASH}}/g, `${SENS.clash()}${encodeURIComponent(subClashUrl)}`)
  .replace(/{{URL_HIDDIFY}}/g, `${SENS.hiddify()}${encodeURIComponent(subXrayUrlH)}`)
  .replace(/{{URL_EXCLAVE}}/g, `${SENS.exclave()}${encodeURIComponent(subSbUrl)}&name=${encodedSubName}`);

  return new Response(finalHTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
