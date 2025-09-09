// @ts-ignore
import { connect } from 'cloudflare:sockets';

/**
 * User configuration and settings
 * To generate your own UUID: https://www.uuidgenerator.net/
 * Or: [Windows] Press "Win + R", input cmd and run: Powershell -NoExit -Command "[guid]::NewGuid()"
 */
let userID = 'd342d11e-d424-4583-b36e-524ab1f0afa4';

/**
 * Array of proxy server addresses with ports
 * // to find proxyIP: https://github.com/NiREvil/vless/blob/main/sub/ProxyIP.md
 * Format: ['hostname:port', 'hostname:port', 'hostname:port']
 * Format: ['ip:port', 'ip:port', 'ip:port']
 */
const proxyIPs = ['nima.nscl.ir:443'];

// Randomly select a proxy server from the pool
let proxyIP = proxyIPs[Math.floor(Math.random() * proxyIPs.length)];
let proxyPort = proxyIP.includes(':') ? proxyIP.split(':')[1] : '443';

/**
 * SOCKS5 proxy configuration
 * Format: 'username:password@host:port' or 'host:port'
 */
let socks5Address = '';

/**
 * SOCKS5 relay mode
 * When true: All traffic is proxied through SOCKS5
 * When false: Only Cloudflare IPs use SOCKS5
 */
let socks5Relay = false;

// Scamalytics API Configuration
let SCAMALYTICS_API_BASE_URL = "https://api11.scamalytics.com/v3/";
let DOH_ENDPOINT = "https://1.1.1.1/dns-query";

// Obfuscation helper placeholders (can be used to hide sensitive keywords in-source)
const TK_B64 = {
  vless: "dmxlc3M=", // vless
  ws: "d3M=",
  type: "dHlwZQ==",
  protocol: "cHJvdG9jb2w=",
  network: "bmV0d29yaw==",
  host: "aG9zdA==",
  sni: "c25p",
  tls: "dGxz",
  path: "cGF0aA==",
  encryption: "ZW5jcnlwdGlvbg==",
  none: "bm9uZQ=="
};
const TK = {};
for (const k in TK_B64) TK[k] = (typeof atob === "function") ? atob(TK_B64[k]) : TK_B64[k];


if (!isValidUUID(userID)) {
	throw new Error('uuid is not valid');
}

let parsedSocks5Address = {};
let enableSocks = false;

/**
 * Main handler for the Cloudflare Worker. Processes incoming requests and routes them appropriately.
 * @param {import("@cloudflare/workers-types").Request} request - The incoming request object
 * @param {Object} env - Environment variables containing configuration
 * @param {string} env.UUID - User ID for authentication
 * @param {string} env.PROXYIP - Proxy server IP address
 * @param {string} env.SOCKS5 - SOCKS5 proxy configuration
 * @param {string} env.SOCKS5_RELAY - SOCKS5 relay mode flag
 * @param {string} env.SCAMALYTICS_USERNAME - Your Scamalytics Username
 * @param {string} env.SCAMALYTICS_API_KEY - Your Scamalytics API Key
 * @returns {Promise<Response>} Response object
 */
export default {
	async fetch(request, env, _ctx) {
		try {
			const { UUID, PROXYIP, SOCKS5, SOCKS5_RELAY, SCAMALYTICS_USERNAME, SCAMALYTICS_API_KEY, SCAMALYTICS_API_BASE_URL:ENV_SCAMALYTICS_API_BASE_URL, SCAMALYTICS_USERNAME:ENV_SCAMALYTICS_USERNAME, SCAMALYTICS_API_KEY:ENV_SCAMALYTICS_API_KEY, DOH_ENDPOINT:ENV_DOH_ENDPOINT } = env;

			// Allow overriding of endpoints via Worker environment variables
			if (ENV_SCAMALYTICS_API_BASE_URL) SCAMALYTICS_API_BASE_URL = ENV_SCAMALYTICS_API_BASE_URL;
			if (ENV_DOH_ENDPOINT) DOH_ENDPOINT = ENV_DOH_ENDPOINT;
			// If env provides username/api key, prefer those
			if (ENV_SCAMALYTICS_USERNAME) SCAMALYTICS_USERNAME = ENV_SCAMALYTICS_USERNAME;
			if (ENV_SCAMALYTICS_API_KEY) SCAMALYTICS_API_KEY = ENV_SCAMALYTICS_API_KEY;

			const url = new URL(request.url);

			// Probe endpoint returning CF edge info - helps fill proxy IP / location / ISP without external calls
			if (url.pathname === "/probe") {
				const cf = request.cf || {};
				const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "";
				const asn = cf.asn || "";
				const isp = cf.asOrganization || cf.asnOrganization || "";
				const city = cf.city || "";
				const country = cf.country || "";
				const colo = cf.colo || "";
				return new Response(JSON.stringify({ ip, asn, isp, city, country, colo, doh: DOH_ENDPOINT, scamalytics_base: SCAMALYTICS_API_BASE_URL }, null, 2), {
					headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
				});
			}

			const requestConfig = {
				userID: UUID || userID,
				socks5Address: SOCKS5 || socks5Address,
				socks5Relay: SOCKS5_RELAY === 'true' || socks5Relay,
				proxyIP: null,
				proxyPort: null,
				enableSocks: false,
				parsedSocks5Address: {}
			};

			let urlPROXYIP = url.searchParams.get('proxyip');
			let urlSOCKS5 = url.searchParams.get('socks5');
			let urlSOCKS5_RELAY = url.searchParams.get('socks5_relay');

			if (!urlPROXYIP && !urlSOCKS5 && !urlSOCKS5_RELAY) {
				const encodedParams = parseEncodedQueryParams(url.pathname);
				urlPROXYIP = urlPROXYIP || encodedParams.proxyip;
				urlSOCKS5 = urlSOCKS5 || encodedParams.socks5;
				urlSOCKS5_RELAY = urlSOCKS5_RELAY || encodedParams.socks5_relay;
			}

			if (urlPROXYIP) {
				const proxyPattern = /^([a-zA-Z0-9][-a-zA-Z0-9.]*(\.[a-zA-Z0-9][-a-zA-Z0-9.]*)+|\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}|\[[0-9a-fA-F:]+\]):\d{1,5}$/;
				const proxyAddresses = urlPROXYIP.split(',').map(addr => addr.trim());
				const isValid = proxyAddresses.every(addr => proxyPattern.test(addr));
				if (!isValid) {
					console.warn('Invalid proxyip format:', urlPROXYIP);
					urlPROXYIP = null;
				}
			}

			if (urlSOCKS5) {
				const socks5Pattern = /^(([^:@]+:[^:@]+@)?[a-zA-Z0-9][-a-zA-Z0-9.]*(\.[a-zA-Z0-9][-a-zA-Z0-9.]*)+|\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):\d{1,5}$/;
				const socks5Addresses = urlSOCKS5.split(',').map(addr => addr.trim());
				const isValid = socks5Addresses.every(addr => socks5Pattern.test(addr));
				if (!isValid) {
					console.warn('Invalid socks5 format:', urlSOCKS5);
					urlSOCKS5 = null;
				}
			}

			requestConfig.socks5Address = urlSOCKS5 || requestConfig.socks5Address;
			requestConfig.socks5Relay = urlSOCKS5_RELAY === 'true' || requestConfig.socks5Relay;
			
			const proxyConfig = handleProxyConfig(urlPROXYIP || PROXYIP);
			requestConfig.proxyIP = proxyConfig.ip;
			requestConfig.proxyPort = proxyConfig.port;
			
			if (requestConfig.socks5Address) {
				try {
					const selectedSocks5 = selectRandomAddress(requestConfig.socks5Address);
					requestConfig.parsedSocks5Address = socks5AddressParser(selectedSocks5);
					requestConfig.enableSocks = true;
				} catch (err) {
					console.log(err.toString());
					requestConfig.enableSocks = false;
				}
			}

			const userIDs = requestConfig.userID.includes(',') ? requestConfig.userID.split(',').map(id => id.trim()) : [requestConfig.userID];
			const host = request.headers.get('Host');
			const requestedPath = url.pathname.substring(1); 
			const matchingUserID = userIDs.length === 1 ?
				(requestedPath === userIDs[0] ||
					requestedPath === `sub/${userIDs[0]}` ||
					requestedPath === `bestip/${userIDs[0]}` ? userIDs[0] : null) :
				userIDs.find(id => {
					const patterns = [id, `sub/${id}`, `bestip/${id}`];
					return patterns.some(pattern => requestedPath.startsWith(pattern));
				});

			if (request.headers.get('Upgrade') !== 'websocket') {
                // Endpoint for Scamalytics lookup
                if (url.pathname === "/scamalytics-lookup") {
                    const ipToLookup = url.searchParams.get("ip");
                    if (!ipToLookup) {
                        return new Response("Missing IP parameter", { status: 400 });
                    }
                    
                    // Show clients ip risk
                    const actualScamalyticsUsername = SCAMALYTICS_USERNAME || "dianaclk01";
                    const actualScamalyticsApiKey = SCAMALYTICS_API_KEY || "c57eb62bbde89f00742cb3f92d7127f96132c9cea460f18c08fd5e62530c5604";
					
                    if (!actualScamalyticsUsername || !actualScamalyticsApiKey) {
                        console.error("Scamalytics credentials not configured in Worker environment variables.");
                        return new Response("Scamalytics API credentials not configured on server.", { status: 500 });
                    }

                    const scamalyticsUrl = `${SCAMALYTICS_API_BASE_URL}${actualScamalyticsUsername}/?key=${actualScamalyticsApiKey}&ip=${ipToLookup}`;
                    
                    try {
                        const scamalyticsResponse = await fetch(scamalyticsUrl);
                        const responseBody = await scamalyticsResponse.json();
                        
                        const headers = new Headers({
                            "Content-Type": "application/json",
                            "Access-Control-Allow-Origin": "*",
                            "Access-Control-Allow-Methods": "GET, OPTIONS",
                            "Access-Control-Allow-Headers": "Content-Type",
                        });

                        return new Response(JSON.stringify(responseBody), { 
                            status: scamalyticsResponse.status, 
                            headers: headers 
                        });
                    } catch (apiError) {
                        console.error("Error fetching from Scamalytics API:", apiError);
                        return new Response(JSON.stringify({ error: "Failed to fetch from Scamalytics API", details: apiError.message }), { 
                            status: 502,
                            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
                        });
                    }
                }

				if (url.pathname === '/cf') {
					return new Response(JSON.stringify(request.cf, null, 4), {
						status: 200,
						headers: { "Content-Type": "application/json;charset=utf-8" },
					});
				}

				if (matchingUserID) {
					if (url.pathname === `/${matchingUserID}`) {
						const content = getBeautifulConfig(matchingUserID, host, `${requestConfig.proxyIP}:${requestConfig.proxyPort}`);
						return new Response(content, {
							status: 200,
							headers: { "Content-Type": "text/html; charset=utf-8" },
						});
					} else if (url.pathname === `/sub/${matchingUserID}`) {
						const proxyAddresses = PROXYIP ? PROXYIP.split(',').map(addr => addr.trim()) : [`${requestConfig.proxyIP}:${requestConfig.proxyPort}`];
						const content = GenSub(matchingUserID, host, proxyAddresses);
						return new Response(content, {
							status: 200,
							headers: { "Content-Type": "text/plain;charset=utf-8" },
						});
					} else if (url.pathname === `/bestip/${matchingUserID}`) {
						return fetch(`https://bestip.06151953.xyz/auto?host=${host}&uuid=${matchingUserID}&path=/`, { headers: request.headers });
					}
				}
				// Fallback to a default page if no other route matches
				return new Response("Not Found", { status: 404 });
			} else {
				return await ProtocolOverWSHandler(request, requestConfig);
			}
		} catch (err) {
			return new Response(err.toString(), { status: 500 });
		}
	},
};

/**
 * Generates the beautiful configuration UI.
 * @param {string} userID - The user's UUID.
 * @param {string} hostName - The hostname of the worker.
 * @param {string} proxyIPWithPort - The selected proxy IP with port (e.g., '1.2.3.4:443').
 * @returns {string} The full HTML for the configuration page.
 */
function getBeautifulConfig(userID, hostName, proxyIPWithPort) {
	// Generate he configs
	const dreamConfig = `vless://${userID}@${hostName}:443?encryption=none&security=tls&sni=${hostName}&fp=chrome&type=ws&host=${hostName}&path=%2Fassets%2FapiDiana%3Fed%3D2560#${hostName}-XRAY`;
	const freedomConfig = `vless://${userID}@${hostName}:443?encryption=none&security=tls&sni=${hostName}&fp=firefox&type=ws&host=${hostName}&path=%2F%3Fed%3D2560#&eh=Sec-WebSocket-Protocol&ed=2560#${hostName}-SINGBOX`;

    // The special URLs for clients are generated
    const clashMetaFullUrl = `clash://install-config?url=${encodeURIComponent(`https://revil-sub.pages.dev/sub/clash-meta?url=${encodeURIComponent(freedomConfig)}&remote_config=&udp=false&ss_uot=false&show_host=false&forced_ws0rtt=true`)}`;
    const nekoBoxImportUrl = `https://sahar-km.github.io/arcane/${btoa(freedomConfig)}`;

	let html = `
	<!doctype html>
	<html lang="en">
	<head>
	  <meta charset="UTF-8" />
	  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
	  <title>VLESS Proxy Configuration</title>
	  <link rel="preconnect" href="https://fonts.googleapis.com">
	  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
	  <link href="https://fonts.googleapis.com/css2?family=Ibarra+Real+Nova:ital,wght@0,400..700;1,400..700&family=Fira+Code:wght@300..700&family=Inter:opsz,wght@14..32,100..900&family=Roboto+Mono:wght@100..700&display=swap" rel="stylesheet">
	  <style>
	    * {
	      margin: 0;
	      padding: 0;
	      box-sizing: border-box;
	    }
	
	    @font-face {
	      font-family: "Aldine 401 BT Web";
	      src: url("https://pub-7a3b428c76aa411181a0f4dd7fa9064b.r2.dev/Aldine401_Mersedeh.woff2") format("woff2");
	      font-weight: 400; font-style: normal; font-display: swap;
	    }
	
	    @font-face {
	      font-family: "Styrene B LC";
	      src: url("https://pub-7a3b428c76aa411181a0f4dd7fa9064b.r2.dev/StyreneBLC-Regular.woff2") format("woff2");
	      font-weight: 400; font-style: normal; font-display: swap;
	    }
	
	    @font-face {
	      font-family: "Styrene B LC";
	      src: url("https://pub-7a3b428c76aa411181a0f4dd7fa9064b.r2.dev/StyreneBLC-Medium.woff2") format("woff2");
	      font-weight: 500; font-style: normal; font-display: swap;
	    }
	
	    :root {
	      --background-primary: #2a2421;
	      --background-secondary: #35302c;
	      --background-tertiary: #413b35;
	      --border-color: #5a4f45;
	      --border-color-hover: #766a5f;
	      --text-primary: #e5dfd6;
	      --text-secondary: #b3a89d;
	      --text-accent: #ffffff;
	      --accent-primary: #be9b7b;
	      --accent-secondary: #d4b595;
	      --accent-tertiary: #8d6e5c;
	      --accent-primary-darker: #8a6f56;
	      --button-text-primary: #2a2421;
	      --button-text-secondary: var(--text-primary);
	      --shadow-color: rgba(0, 0, 0, 0.35);
	      --shadow-color-accent: rgba(190, 155, 123, 0.4);
	      --border-radius: 8px;
	      --transition-speed: 0.2s;
	      --transition-speed-fast: 0.1s;
	      --transition-speed-medium: 0.3s;
	      --transition-speed-long: 0.6s;
	      --status-success: #70b570;
	      --status-error: #e05d44;
	      --status-warning: #e0bc44; 
	      --status-info: #4f90c4;
	
	      --serif: "Aldine 401 BT Web", "Times New Roman", Times, Georgia, ui-serif, serif;
	      --sans-serif: "Styrene B LC", "Inter", -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, "Noto Color Emoji", sans-serif;
	      --mono-serif: "Fira Code", "Roboto Mono", Cantarell, Courier Prime, SFMono-Regular, monospace;
	    }
	
	    body {
	      font-family: var(--sans-serif);
	      font-size: 16px;
	      font-weight: 400;
	      font-style: normal;
	      background-color: var(--background-primary);
	      color: var(--text-primary);
	      padding: 3rem;
	      line-height: 1.5;
	      -webkit-font-smoothing: antialiased;
	      -moz-osx-font-smoothing: grayscale;
	    }
	
	    .container {
	      max-width: 768;
	      margin: 20px auto;
	      padding: 0 12px;
	      border-radius: var(--border-radius);
	      box-shadow:
	        0 6px 15px rgba(0, 0, 0, 0.2),
	        0 0 25px 8px var(--shadow-color-accent);
	      transition: box-shadow var(--transition-speed-medium) ease;
	    }
	
	    .container:hover {
	      box-shadow:
	        0 8px 20px rgba(0, 0, 0, 0.25),
	        0 0 35px 10px var(--shadow-color-accent);
	    }
	
	    .header {
	      text-align: center;
	      margin-bottom: 40px;
	      padding-top: 30px;
	    }
	
	    .header h1 {
	      font-family: var(--serif);
	      font-weight: 400;
	      font-size: 2rem;
	      color: var(--text-accent);
	      margin-top: 0px;
	      margin-bottom: 2px;
	    }
	
	    .header p {
	      color: var(--text-secondary);
	      font-size: 12px;
	      font-weight: 400;
	    }
	
	    .config-card {
	      background: var(--background-secondary);
	      border-radius: var(--border-radius);
	      padding: 20px;
	      margin-bottom: 24px;
	      border: 1px solid var(--border-color);
	      transition:
	        border-color var(--transition-speed) ease,
	        box-shadow var(--transition-speed) ease;
	    }
	    
	    .config-card:hover {
	      border-color: var(--border-color-hover);
	      box-shadow: 0 4px 8px var(--shadow-color);
	    }
	
	    .config-title {
	      font-family: var(--serif);
	      font-size: 22px;
	      font-weight: 400;
	      color: var(--accent-secondary);
	      margin-bottom: 16px;
	      padding-bottom: 12px;
	      border-bottom: 1px solid var(--border-color);
	      display: flex;
	      align-items: center;
	      justify-content: space-between;
	    }
	
	    .config-title .refresh-btn {
	      position: relative;
	      overflow: hidden;
	      display: flex;
	      align-items: center;
	      gap: 4px;
	      font-family: var(--serif);
	      font-size: 12px;
	      padding: 6px 12px;
	      border-radius: 6px;
	      color: var(--accent-secondary);
	      background-color: var(--background-tertiary);
	      border: 1px solid var(--border-color);
	      cursor: pointer;
	      
	      transition:
	        background-color var(--transition-speed) ease,
	        border-color var(--transition-speed) ease,
	        color var(--transition-speed) ease,
	        transform var(--transition-speed) ease,
	        box-shadow var(--transition-speed) ease;
	    }
	    
	    .config-title .refresh-btn::before {
	      content: "";
	      position: absolute;
	      top: 0;
	      left: 0;
	      width: 100%;
	      height: 100%;
	      background: linear-gradient(120deg, transparent, rgba(255, 255, 255, 0.2), transparent);
	      transform: translateX(-100%);
	      transition: transform var(--transition-speed-long) ease;
	      z-index: -1;
	    }
	    
	    .config-title .refresh-btn:hover {
	      letter-spacing: 0.5px;
	      font-weight: 600;
	      background-color: #4d453e;
	      color: var(--accent-primary);
	      border-color: var(--border-color-hover);
	      transform: translateY(-2px);
	      box-shadow: 0 4px 8px var(--shadow-color);
	    }
	    
	    .config-title .refresh-btn:hover::before {
	      transform: translateX(100%);
	    }
	    
	    .config-title .refresh-btn:active {
	      transform: translateY(0px) scale(0.98);
	      box-shadow: none;
	    }
	        
	    .refresh-icon {
	      width: 12px;
	      height: 12px;
	      stroke: currentColor;
	    }
	
	    .config-content {
	      position: relative;
	      background: var(--background-tertiary);
	      border-radius: var(--border-radius);
	      padding: 16px;
	      margin-bottom: 20px;
	      border: 1px solid var(--border-color);
	    }
	
	    .config-content pre {
	      overflow-x: auto;
	      font-family: var(--mono-serif);
	      font-size: 12px;
	      color: var(--text-primary);
	      margin: 0;
	      white-space: pre-wrap;
	      word-break: break-all;
	    }
	
	    .button {
	      display: inline-flex;
	      align-items: center;
	      justify-content: center;
	      gap: 8px;
	      padding: 8px 16px;
	      border-radius: var(--border-radius);
	      font-size: 13px;
	      font-weight: 500;
	      cursor: pointer;
	      border: 1px solid var(--border-color);
	      background-color: var(--background-tertiary);
	      color: var(--button-text-secondary);
	      transition:
	        background-color var(--transition-speed) ease,
	        border-color var(--transition-speed) ease,
	        color var(--transition-speed) ease,
	        transform var(--transition-speed) ease,
	        box-shadow var(--transition-speed) ease;
	      -webkit-tap-highlight-color: transparent;
	      touch-action: manipulation;
	      text-decoration: none;
	      overflow: hidden;
	      z-index: 1;
	    }
	
	    .button:focus-visible {
	      outline: 2px solid var(--accent-primary);
	      outline-offset: 2px;
	    }
	
	    .button:disabled {
	      opacity: 0.6;
	      cursor: not-allowed;
	      transform: none;
	      box-shadow: none;
	      transition: opacity var(--transition-speed) ease;
	    }
	
	    .button:not(.copy-buttons):not(.client-btn):hover {
	      background-color: #4d453e;
	      border-color: var(--border-color-hover);
	      transform: translateY(-1px);
	      box-shadow: 0 2px 4px var(--shadow-color);
	    }
	
	    .button:not(.copy-buttons):not(.client-btn):active {
	      transform: translateY(0px) scale(0.98);
	      box-shadow: none;
	    }
	
	    .copy-buttons {
	      position: relative;
	      display: flex;
	      gap: 4px;
	      overflow: hidden;
	      align-self: center;
	      font-family: var(--serif);
	      font-size: 12px;
	      padding: 6px 12px;
	      border-radius: 6px;
	      color: var(--accent-secondary);
	      border: 1px solid var(--border-color);
	      transition:
	        background-color var(--transition-speed) ease,
	        border-color var(--transition-speed) ease,
	        color var(--transition-speed) ease,
	        transform var(--transition-speed) ease,
	        box-shadow var(--transition-speed) ease;
	    }
	    
	    .copy-buttons::before,
	    .client-btn::before {
	      content: "";
	      position: absolute;
	      top: 0;
	      left: 0;
	      width: 100%;
	      height: 100%;
	      background: linear-gradient(120deg, transparent, rgba(255, 255, 255, 0.2), transparent);
	      transform: translateX(-100%);
	      transition: transform var(--transition-speed-long) ease;
	      z-index: -1;
	    }
	
	    .copy-buttons:hover::before,
	    .client-btn:hover::before {
	      transform: translateX(100%);
	    }
	
	    .copy-buttons:hover {
	      background-color: #4d453e;
	      letter-spacing: 0.5px;
	      font-weight: 600;
	      border-color: var(--border-color-hover);
	      transform: translateY(-2px);
	      box-shadow: 0 4px 8px var(--shadow-color);
	    }
	
	    .copy-buttons:active {
	      transform: translateY(0px) scale(0.98);
	      box-shadow: none;
	    }
	    
	    .copy-icon {
	      width: 12px;
	      height: 12px;
	      stroke: currentColor;
	    }
	    
	    .client-buttons {
	      display: grid;
	      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
	      gap: 12px;
	      margin-top: 16px;
	    }
	
	    .client-btn {
	      width: 100%;
	      background-color: var(--accent-primary);
	      color: var(--background-tertiary);
	      border-radius: 6px;
	      border-color: var(--accent-primary-darker);
	      position: relative;
	      overflow: hidden;
	      transition: all 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);
	      box-shadow: 0 2px 5px rgba(0, 0, 0, 0.15);
	    }
	
	    .client-btn::before {
	      left: -100%;
	      transition: transform 0.6s ease;
	      z-index: 1;
	    }
	
	    .client-btn::after {
	      content: "";
	      position: absolute;
	      bottom: -5px;
	      left: 0;
	      width: 100%;
	      height: 5px;
	      background: linear-gradient(90deg, var(--accent-tertiary), var(--accent-secondary));
	      opacity: 0;
	      transition: all 0.3s ease;
	      z-index: 0;
	    }
	
	    .client-btn:hover {
	      text-transform: uppercase; 
	      letter-spacing: 0.3px;
	      transform: translateY(-3px);
	      background-color: var(--accent-secondary);
	      color: var(--button-text-primary);
	      box-shadow: 0 5px 15px rgba(190, 155, 123, 0.5);
	      border-color: var(--accent-secondary);
	    }
	
	    .client-btn:hover::before {
	      transform: translateX(100%);
	    }
	
	    .client-btn:hover::after {
	      opacity: 1;
	      bottom: 0;
	    }
	
	    .client-btn:active {
	      transform: translateY(0) scale(0.98);
	      box-shadow: 0 2px 3px rgba(0, 0, 0, 0.2);
	      background-color: var(--accent-primary-darker);
	    }
	
	    .client-btn .client-icon {
	      position: relative;
	      z-index: 2;
	      transition: transform 0.3s ease;
	    }
	
	    .client-btn:hover .client-icon {
	      transform: rotate(15deg) scale(1.1);
	    }
	
	    .client-btn .button-text {
	      position: relative;
	      z-index: 2;
	      transition: letter-spacing 0.3s ease;
	    }
	
	    .client-btn:hover .button-text { letter-spacing: 0.5px; }
	    .client-icon { width: 18px; height: 18px; border-radius: 6px; background-color: var(--background-secondary); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
	    .client-icon svg { width: 14px; height: 14px; fill: var(--accent-secondary); }
	
	    .button.copied { background-color: var(--accent-secondary) !important; color: var(--background-tertiary) !important; }
	    .button.error { background-color: #c74a3b !important; color: var(--text-accent) !important; }
	
	    .footer { text-align: center; margin-top: 20px; padding-bottom: 40px; color: var(--text-secondary); font-size: 12px; }
	    .footer p { margin-bottom: 0px; }
	    
	    ::-webkit-scrollbar { width: 8px; height: 8px; }
	    ::-webkit-scrollbar-track { background: var(--background-primary); border-radius: 4px; }
	    ::-webkit-scrollbar-thumb { background: var(--border-color); border-radius: 4px; border: 2px solid var(--background-primary); }
	    ::-webkit-scrollbar-thumb:hover { background: var(--border-color-hover); }
	    * { scrollbar-width: thin; scrollbar-color: var(--border-color) var(--background-primary); }
	
	    .ip-info-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 24px; }
	    .ip-info-section { background-color: var(--background-tertiary); border-radius: var(--border-radius); padding: 16px; border: 1px solid var(--border-color); display: flex; flex-direction: column; gap: 20px; }
	    .ip-info-header { display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--border-color); padding-bottom: 10px; }
	    .ip-info-header svg { width: 20px; height: 20px; stroke: var(--accent-secondary); }
	    .ip-info-header h3 { font-family: var(--serif); font-size: 18px; font-weight: 400; color: var(--accent-secondary); margin: 0; }
	    .ip-info-content { display: flex; flex-direction: column; gap: 10px; }
	    .ip-info-item { display: flex; flex-direction: column; gap: 2px; }
	    .ip-info-item .label { font-size: 11px; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; }
	    .ip-info-item .value { font-size: 14px; color: var(--text-primary); word-break: break-all; line-height: 1.4; }
	
	    .badge { display: inline-flex; align-items: center; justify-content: center; padding: 3px 8px; border-radius: 12px; font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px; }
	    .badge-yes { background-color: rgba(112, 181, 112, 0.15); color: var(--status-success); border: 1px solid rgba(112, 181, 112, 0.3); }
	    .badge-no { background-color: rgba(224, 93, 68, 0.15); color: var(--status-error); border: 1px solid rgba(224, 93, 68, 0.3); }
	    .badge-neutral { background-color: rgba(79, 144, 196, 0.15); color: var(--status-info); border: 1px solid rgba(79, 144, 196, 0.3); }
	    .badge-warning { background-color: rgba(224, 188, 68, 0.15); color: var(--status-warning); border: 1px solid rgba(224, 188, 68, 0.3); }
	
	    .skeleton { display: block; background: linear-gradient(90deg, var(--background-tertiary) 25%, var(--background-secondary) 50%, var(--background-tertiary) 75%); background-size: 200% 100%; animation: loading 1.5s infinite; border-radius: 4px; height: 16px; }
	    @keyframes loading { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
	    .country-flag { display: inline-block; width: 18px; height: auto; max-height: 14px; margin-right: 6px; vertical-align: middle; border-radius: 2px; }
	
	     @media (max-width: 768px) {
	      body { padding: 20px; }
	      .container { padding: 0 14px; width: min(100%, 768px); }
	      .ip-info-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 18px; }
	      .header h1 { font-size: 1.8rem; }
	      .header p { font-size: 0.7rem }
	      .ip-info-section { padding: 14px; gap: 18px; }
	      .ip-info-header h3 { font-size: 16px; }
	      .ip-info-header { gap: 8px; }
	      .ip-info-content { gap: 8px; }
	      .ip-info-item .label { font-size: 11px; }
	      .ip-info-item .value { font-size: 13px; }
	      .config-card { padding: 16px; }
	      .config-title { font-size: 18px; }
	      .config-title .refresh-btn { font-size: 11px; }
	      .config-content pre { font-size: 12px; }
	      .client-buttons { grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
	      .button { font-size: 12px; }
	       .copy-buttons { font-size: 11px; }
	    }
	
	    @media (max-width: 480px) {
	      body { padding: 16px; }
	      .container { padding: 0 12px; width: min(100%, 390px); }
	      .header h1 { font-size: 20px; }
	      .header p { font-size: 8px; }
	      .ip-info-section { padding: 14px; gap: 16px; }
	      .ip-info-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; }
	      .ip-info-header h3 { font-size: 14px; }
	      .ip-info-header { gap: 6px; }
	      .ip-info-content { gap: 6px; }
	      .ip-info-header svg { width: 18px; height: 18px; }
	      .ip-info-item .label { font-size: 9px; }
	      .ip-info-item .value { font-size: 11px; }
	      .badge { padding: 2px 6px; font-size: 10px; border-radius: 10px; }
	      .config-card { padding: 10px; }
	      .config-title { font-size: 16px; }
	      .config-title .refresh-btn { font-size: 10px; }
	      .config-content { padding: 12px; }
	      .config-content pre { font-size: 10px; }
	      .client-buttons { grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); }
	      .button { padding: 4px 8px; font-size: 11px; }
	      .copy-buttons { font-size: 10px; }
	      .footer { font-size: 10px; }
	    }
	
	    @media (max-width: 359px) {
	      body { padding: 12px; font-size: 14px; }
	      .container { max-width: 100%; padding: 8px; }
	      .header h1 { font-size: 16px; }
	      .header p { font-size: 6px; }
	      .ip-info-section { padding: 12px; gap: 12px; }
	      .ip-info-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
	      .ip-info-header h3 { font-size: 13px; }
	      .ip-info-header { gap: 4px; }
	      .ip-info-content { gap: 4px; }
	      .ip-info-header svg { width: 16px; height: 16px; }
	      .ip-info-item .label { font-size: 8px; }
	      .ip-info-item .value { font-size: 10px; }
	      .badge { padding: 1px 4px; font-size: 9px; border-radius: 8px; }
	      .config-card { padding: 8px; }
	      .config-title { font-size: 13px; }
	      .config-title .refresh-btn { font-size: 9px; }
	      .config-content { padding: 8px; }
	      .config-content pre { font-size: 8px; }
	      .client-buttons { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); }
	      .button { padding: 3px 6px; font-size: 10px; }
	      .copy-buttons { font-size: 9px; }
	      .footer { font-size: 8px; }
	    }
	
	    @media (min-width: 360px) { .container { max-width: 95%; } }
	    @media (min-width: 480px) { .container { max-width: 90%; } }
	    @media (min-width: 640px) { .container { max-width: 600px; } }
	    @media (min-width: 768px) { .container { max-width: 720px; } }
	    @media (min-width: 1024px) { .container { max-width: 800px; } }
	  </style>
	</head>
	<body data-proxy-ip="{{PROXY_IP}}">
	  <div class="container">
	    <div class="header">
	      <h1>VLESS Proxy Configuration</h1>
	      <p>Copy the configuration or import directly into your client</p>
	    </div>
	
	    <div class="config-card">
	      <div class="config-title">
	        <span>Network Information</span>
	        <button id="refresh-ip-info" class="refresh-btn" aria-label="Refresh IP information">
	          <svg class="refresh-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
	            stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
	            <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
	          </svg>
	          Refresh
	        </button>
	      </div>
	
	      <div class="ip-info-grid">
	        <div class="ip-info-section">
	          <div class="ip-info-header">
	            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
	              <path d="M15.5 2H8.6c-.4 0-.8.2-1.1.5-.3.3-.5.7-.5 1.1v16.8c0 .4.2.8.5 1.1.3.3.7.5 1.1.5h6.9c.4 0 .8-.2 1.1-.5.3-.3.5-.7.5-1.1V3.6c0-.4-.2-.8-.5-1.1-.3-.3-.7-.5-1.1-.5z"/>
	              <circle cx="12" cy="18" r="1"/>
	            </svg>
	            <h3>Proxy Server</h3>
	          </div>
	          <div class="ip-info-content">
	            <div class="ip-info-item"> 
	              <span class="label">Proxy Host</span>
	              <span class="value" id="proxy-host"><span class="skeleton" style="width: 150px;"></span></span>
	            </div>
	            <div class="ip-info-item">
	              <span class="label">IP Address</span>
	              <span class="value" id="proxy-ip"><span class="skeleton" style="width: 120px;"></span></span>
	            </div>
	            <div class="ip-info-item">
	              <span class="label">Location</span>
	              <span class="value" id="proxy-location"><span class="skeleton" style="width: 100px;"></span></span>
	            </div>
	            <div class="ip-info-item">
	              <span class="label">ISP Provider</span>
	              <span class="value" id="proxy-isp"><span class="skeleton" style="width: 140px;"></span></span>
	            </div>
	          </div>
	        </div>
	
	        <div class="ip-info-section">
	          <div class="ip-info-header">
	            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
	              <path d="M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0 1.28 2.55a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45L4 16"/>
	            </svg>
	            <h3>Your Connection</h3>
	          </div>
	          <div class="ip-info-content">
	            <div class="ip-info-item">
	              <span class="label">Your IP</span>
	              <span class="value" id="client-ip"><span class="skeleton" style="width: 110px;"></span></span>
	            </div>
	            <div class="ip-info-item">
	              <span class="label">Location</span>
	              <span class="value" id="client-location"><span class="skeleton" style="width: 90px;"></span></span>
	            </div>
	            <div class="ip-info-item">
	              <span class="label">ISP Provider</span>
	              <span class="value" id="client-isp"><span class="skeleton" style="width: 130px;"></span></span>
	            </div>
	            <div class="ip-info-item">
	              <span class="label">Risk Score</span> 
	              <span class="value" id="client-proxy"> 
	                <span class="skeleton" style="width: 100px;"></span> 
	              </span>
	            </div>
	          </div>
	        </div>
	      </div>
	    </div>
	
	    <div class="config-card">
	      <div class="config-title">
	        <span>Xray Core Clients</span>
	        <button class="button copy-buttons" onclick="copyToClipboard(this, '{{DREAM_CONFIG}}')">
	          <svg class="copy-icon" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
	            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
	            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
	          </svg>
	          Copy
	        </button>
	      </div>
	      <div class="config-content">
	        <pre id="xray-config">{{DREAM_CONFIG}}</pre>
	      </div>
	      <div class="client-buttons">
	        <a href="hiddify://install-config?url={{FREEDOM_CONFIG_ENCODED}}" class="button client-btn">
	          <span class="client-icon"><svg viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" /></svg></span>
	          <span class="button-text">Import to Hiddify</span>
	        </a>
	        <a href="v2rayng://install-config?url={{DREAM_CONFIG_ENCODED}}" class="button client-btn">
	          <span class="client-icon"><svg viewBox="0 0 24 24"><path d="M12 2L4 5v6c0 5.5 3.5 10.7 8 12.3 4.5-1.6 8-6.8 8-12.3V5l-8-3z" /></svg></span>
	          <span class="button-text">Import to V2rayNG</span>
	        </a>
	      </div>
	    </div>
	
	    <div class="config-card">
	      <div class="config-title">
	        <span>Sing-Box Core Clients</span>
	        <button class="button copy-buttons" onclick="copyToClipboard(this, '{{FREEDOM_CONFIG}}')">
	          <svg class="copy-icon" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
	            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
	            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
	          </svg>
	          Copy
	        </button>
	      </div>
	      <div class="config-content">
	        <pre id="singbox-config">{{FREEDOM_CONFIG}}</pre>
	      </div>
	      <div class="client-buttons">
	        <a href="{{CLASH_META_URL}}" class="button client-btn">
	          <span class="client-icon"><svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" /></svg></span>
	          <span class="button-text">Import to Clash Meta</span>
	        </a>
	        <a href="{{NEKOBOX_URL}}" class="button client-btn">
	          <span class="client-icon"><svg viewBox="0 0 24 24"><path d="M20,8h-3V6c0-1.1-0.9-2-2-2H9C7.9,4,7,4.9,7,6v2H4C2.9,8,2,8.9,2,10v9c0,1.1,0.9,2,2,2h16c1.1,0,2-0.9,2-2v-9 C22,8.9,21.1,8,20,8z M9,6h6v2H9V6z M20,19H4v-2h16V19z M20,15H4v-5h3v1c0,0.55,0.45,1,1,1h1.5c0.28,0,0.5-0.22,0.5-0.5v-0.5h4v0.5 c0,0.28,0.22,0.5,0.5,0.5H16c0.55,0,1-0.45,1-1v-1h3V15z" /><circle cx="8.5" cy="13.5" r="1" /><circle cx="15.5" cy="13.5" r="1" /><path d="M12,15.5c-0.55,0-1-0.45-1-1h2C13,15.05,12.55,15.5,12,15.5z" /></svg></span>
	          <span class="button-text">Import to NekoBox</span>
	        </a>
	      </div>
	    </div>
	
	    <div class="footer">
	      <p>© <span id="current-year">{{YEAR}}</span> REvil - All Rights Reserved</p>
	      <p>Secure. Private. Fast.</p>
	    </div>
	  </div>
	
	  <script>
	    function copyToClipboard(button, text) {
	      const originalHTML = button.innerHTML;
	
	      navigator.clipboard.writeText(text).then(() => {
	        button.innerHTML = \`
	          <svg class="copy-icon" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
	            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
	            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
	          </svg>
	          Copied!
	        \`;
	        button.classList.add("copied");
	        button.disabled = true;
	
	        setTimeout(() => {
	          button.innerHTML = originalHTML;
	          button.classList.remove("copied");
	          button.disabled = false;
	        }, 1200);
	      }).catch(err => {
	        console.error("Failed to copy text: ", err);
	        const originalHTMLError = button.innerHTML;
	
	        button.innerHTML = \`
	          <svg class="copy-icon" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
	            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
	            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
	          </svg>
	          Error
	        \`; 
	        button.classList.add("error");
	        button.disabled = true;
	
	        setTimeout(() => {
	          button.innerHTML = originalHTMLError;
	          button.classList.remove("error");
	          button.disabled = false;
	        }, 1500);
	      });
	    }
	
	    /**
	     * Fetches the client's public IP address.
	     * @returns {Promise<string|null>} IP address string or null on error.
	     */
	    async function fetchClientPublicIP() {
	      try {
	        const response = await fetch('https://api.ipify.org?format=json');
	        if (!response.ok) {
	          throw new Error(\`HTTP error! status: \${response.status}\`);
	        }
	        const data = await response.json();
	        return data.ip;
	      } catch (error) {
	        console.error('Error fetching client IP:', error);
	        return null;
	      }
	    }
	    
	    /**
	     * Fetches client IP information from Scamalytics via the Cloudflare Worker.
	     * @param {string} clientIp - The client's IP address.
	     * @returns {Promise<object|null>} IP data or null on error.
	     */
	    async function fetchScamalyticsClientInfo(clientIp) {
	      if (!clientIp) return null;
	      try {
	        const workerLookupUrl = \`/scamalytics-lookup?ip=\${encodeURIComponent(clientIp)}\`; 
	        const response = await fetch(workerLookupUrl);
	    
	        if (!response.ok) {
	          let errorDetail = \`Worker request failed! status: \${response.status}\`;
	          try {
	            const errorData = await response.json(); 
	             if (errorData && errorData.error) {
	                errorDetail = errorData.error;
	                if(errorData.details) errorDetail += \` Details: \${errorData.details}\`;
	            } else if (errorData && errorData.scamalytics && errorData.scamalytics.error) {
	                 errorDetail = errorData.scamalytics.error;
	            } else if (response.statusText) {
	                errorDetail += \` - \${response.statusText}\`;
	            }
	          } catch (e) { 
	            errorDetail += \` - \${await response.text()}\`;
	          }
	          throw new Error(errorDetail);
	        }
	        const data = await response.json();
	        if (data.scamalytics && data.scamalytics.status === 'error') {
	            throw new Error(data.scamalytics.error || 'Scamalytics API error via Worker');
	        }
	        if (data.error && !data.scamalytics) {
	            throw new Error(data.error);
	        }
	        return data;
	      } catch (error) {
	        console.error('Error fetching from Scamalytics via Worker:', error);
	        return null;
	      }
	    }
	    
	    /**
	     * Updates the display for client IP information using data from Scamalytics.
	     * @param {object|null} data - IP data from Scamalytics.
	     */
	    function updateScamalyticsClientDisplay(data) {
	      const prefix = 'client';
	      // Check for a successful Scamalytics response structure
	      if (!data || !data.scamalytics || data.scamalytics.status !== 'ok') {
	        showError(prefix, (data && data.scamalytics && data.scamalytics.error) || 'Could not load client data from Scamalytics');
	        return;
	      }
	    
	      const sa = data.scamalytics;
	      const dbip = data.external_datasources?.dbip;
	    
	      const elements = {
	        ip: document.getElementById(\`\${prefix}-ip\`),
	        location: document.getElementById(\`\${prefix}-location\`),
	        isp: document.getElementById(\`\${prefix}-isp\`),
	        proxy: document.getElementById(\`\${prefix}-proxy\`)
	      };
	    
	      if (elements.ip) elements.ip.textContent = sa.ip || "N/A";
	    
	      if (elements.location) {
	        const city = dbip?.ip_city || ''; 
	        const countryName = dbip?.ip_country_name || ''; 
	        const countryCode = dbip?.ip_country_code ? dbip.ip_country_code.toLowerCase() : ''; 
	        let locationString = 'N/A';
	        let flagElementHtml = '';
	    
	        if (countryCode) {
	          flagElementHtml = \`<img src="https://flagcdn.com/w20/\${countryCode}.png" srcset="https://flagcdn.com/w40/\${countryCode}.png 2x" alt="\${dbip.ip_country_code || 'flag'}" class="country-flag"> \`;
	        }
	    
	        let textPart = '';
	        if (city && countryName) textPart = \`\${city}, \${countryName}\`;
	        else if (countryName) textPart = countryName;
	        else if (city) textPart = city;
	    
	        if (flagElementHtml.trim() || textPart.trim()) locationString = \`\${flagElementHtml}\${textPart}\`.trim();
	        elements.location.innerHTML = locationString || "N/A";
	      }
	    
	      if (elements.isp) {
	          elements.isp.textContent = sa.scamalytics_isp || dbip?.isp_name || "N/A"; 
	      }
	    
	      if (elements.proxy) { 
	        const score = sa.scamalytics_score; 
	        const risk = sa.scamalytics_risk;   
	        let riskText = "Unknown";
	        let badgeClass = "badge-neutral";
	    
	        if (risk !== undefined && score !== undefined && risk !== null && score !== null) {
	            riskText = \`\${score} - \${risk.charAt(0).toUpperCase() + risk.slice(1)}\`;
	            switch (risk.toLowerCase()) { 
	                case "low": badgeClass = "badge-yes"; break;
	                case "medium": badgeClass = "badge-warning"; break;
	                case "high": badgeClass = "badge-no"; break;
	                case "very high": badgeClass = "badge-no"; break; 
	                default: 
	                    badgeClass = "badge-neutral";
	                    riskText = \`Score \${score} - \${risk || 'Status Unknown'}\`;
	                    break;
	            }
	        } else if (score !== undefined && score !== null) {
	            riskText = \`Score \${score} - N/A\`; 
	        } else if (risk) {
	            riskText = risk.charAt(0).toUpperCase() + risk.slice(1);
	             switch (risk.toLowerCase()) {
	                case "low": badgeClass = "badge-yes"; break;
	                case "medium": badgeClass = "badge-warning"; break;
	                case "high": case "very high": badgeClass = "badge-no"; break;
	                default: badgeClass = "badge-neutral"; riskText="Status Unknown"; break;
	            }
	        }
	        elements.proxy.innerHTML = \`<span class="badge \${badgeClass}">\${riskText}</span>\`;
	      }
	    }
	    
	    /**
	     * Updates the display for Proxy Server IP information using data from ip-api.io
	     * @param {object | null} geo - IP data from ip-api.io.
	     * @param {string} prefix - 'proxy'.
	     * @param {string | null} originalHost - The original hostname or IP of the proxy.
	     */
	    function updateIpApiIoDisplay(geo, prefix, originalHost) {
	      const hostElement = document.getElementById(\`\${prefix}-host\`);
	      if (hostElement) {
	        hostElement.textContent = originalHost || "N/A";
	      }
	    
	      const ipElement = document.getElementById(\`\${prefix}-ip\`);
	      const locationElement = document.getElementById(\`\${prefix}-location\`);
	      const ispElement = document.getElementById(\`\${prefix}-isp\`);
	    
	      if (!geo) { 
	        if (ipElement) ipElement.textContent = "N/A";
	        if (locationElement) locationElement.innerHTML = "N/A";
	        if (ispElement) ispElement.textContent = "N/A";
	        return;
	      }
	    
	      if (ipElement) ipElement.textContent = geo.ip || "N/A";
	    
	      if (locationElement) {
	        const city = geo.city || '';
	        const countryName = geo.country_name || '';
	        const countryCode = geo.country_code ? geo.country_code.toLowerCase() : '';
	        let flagElementHtml = '';
	    
	        if (countryCode) {
	            flagElementHtml = \`<img src="https://flagcdn.com/w20/\${countryCode}.png" srcset="https://flagcdn.com/w40/\${countryCode}.png 2x" alt="\${geo.country_code || 'flag'}" class="country-flag"> \`;
	        } else if (geo.country_flag) { 
	            flagElementHtml = \`\${geo.country_flag} \`;
	        }
	    
	        let textPart = '';
	        if (city && countryName) textPart = \`\${city}, \${countryName}\`;
	        else if (countryName) textPart = countryName;
	        else if (city) textPart = city;
	    
	        let locationText = 'N/A';
	        if (flagElementHtml.trim() || textPart.trim()) {
	            locationText = \`\${flagElementHtml}\${textPart}\`.trim();
	        }
	        locationElement.innerHTML = locationText || "N/A";
	      }
	      if (ispElement) {
	        ispElement.textContent = geo.isp || geo.org || geo.as_name || geo.as || 'N/A';
	      }
	    }
	    
	    /**
	     * Fetches IP information from ip-api.io (for proxy server info)
	     * @param {string} ip - IP address to lookup.
	     * @returns {Promise<object|null>} IP data or null on error.
	     */
	    async function fetchIpApiIoInfo(ip) {
	      try {
	        const response = await fetch(\`https://ip-api.io/json/\${ip}\`);
	        if (!response.ok) {
	            const errorText = await response.text();
	            throw new Error(\`HTTP error! status: \${response.status}, message: \${errorText}\`);
	        }
	        return await response.json();
	      } catch (error) {
	        console.error('IP API Error (ip-api.io):', error);
	        return null;
	      }
	    }
	    
	    /**
	     * Shows error messages in the UI.
	     * @param {string} prefix - 'client' or 'proxy'.
	     * @param {string} message - Error message to log.
	     * @param {string|null} originalHostForProxy - Original host for proxy if applicable.
	     */
	    function showError(prefix, message = "Could not load data", originalHostForProxy = null) {
	      const errorMessage = "N/A";
	      if (prefix === 'proxy') {
	        const hostElement = document.getElementById('proxy-host');
	        const ipElement = document.getElementById('proxy-ip');
	        const locationElement = document.getElementById('proxy-location');
	        const ispElement = document.getElementById('proxy-isp');
	        if (hostElement) hostElement.textContent = originalHostForProxy || errorMessage;
	        if (ipElement) ipElement.textContent = errorMessage;
	        if (locationElement) locationElement.innerHTML = errorMessage;
	        if (ispElement) ispElement.textContent = errorMessage;
	      } else if (prefix === 'client') {
	        const ipElement = document.getElementById('client-ip');
	        const locationElement = document.getElementById('client-location');
	        const ispElement = document.getElementById('client-isp');
	        const riskScoreElement = document.getElementById('client-proxy');
	        if (ipElement) ipElement.textContent = errorMessage;
	        if (locationElement) locationElement.innerHTML = errorMessage;
	        if (ispElement) ispElement.textContent = errorMessage;
	        if (riskScoreElement) riskScoreElement.innerHTML = \`<span class="badge badge-neutral">N/A</span>\`;
	      }
	      console.warn(\`\${prefix} data loading failed: \${message}\`);
	    }
	    
	    /**
	     * Loads all network information.
	     */
	    async function loadNetworkInfo() {
	      try {
	        // --- Load Proxy Server Info (ip-api.io) ---
	        const proxyDomainOrIp = document.body.getAttribute('data-proxy-ip');
	        let resolvedProxyIp = proxyDomainOrIp; 
	        const proxyHostVal = (proxyDomainOrIp && proxyDomainOrIp !== "N/A" && proxyDomainOrIp.toLowerCase() !== "null" && proxyDomainOrIp.trim() !== "") 
	                               ? proxyDomainOrIp 
	                               : "N/A";
	    
	        const proxyHostEl = document.getElementById('proxy-host');
	        if(proxyHostEl) proxyHostEl.textContent = proxyHostVal;
	    
	        if (proxyHostVal !== "N/A") {
	          if (!/^\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}$/.test(proxyDomainOrIp)) { 
	            try {
	              const dnsRes = await fetch(\`https://dns.google/resolve?name=\${encodeURIComponent(proxyDomainOrIp)}&type=A\`);
	              if (dnsRes.ok) {
	                  const dnsData = await dnsRes.json();
	                  if (dnsData.Answer && dnsData.Answer.length > 0) {
	                    const ipAnswer = dnsData.Answer.find(a => a.type === 1); 
	                    if (ipAnswer) resolvedProxyIp = ipAnswer.data;
	                    else console.warn('No A record for proxy domain:', proxyDomainOrIp);
	                  } else console.warn('DNS lookup no answers for proxy domain:', proxyDomainOrIp);
	              } else {
	                console.error(\`DNS lookup failed for \${proxyDomainOrIp}: \${dnsRes.status}\`);
	                resolvedProxyIp = proxyDomainOrIp;
	              }
	            } catch (e) { 
	              console.error('DNS resolution for proxy failed:', e); 
	              resolvedProxyIp = proxyDomainOrIp;
	            }
	          }
	          const proxyGeoData = await fetchIpApiIoInfo(resolvedProxyIp); 
	          if (proxyGeoData && (proxyGeoData.ip || proxyGeoData.country_code)) { 
	            updateIpApiIoDisplay(proxyGeoData, 'proxy', proxyHostVal); 
	          } else {
	            showError('proxy', \`Could not load proxy geo data for \${resolvedProxyIp}.\`, proxyHostVal);
	          }
	        } else {
	          showError('proxy', 'Proxy Host not available', proxyHostVal);
	        }
	    
	        // Load Client Info (Scamalytics via Worker)
	        console.log('Fetching client public IP...');
	        const clientIp = await fetchClientPublicIP();
	        if (clientIp) {
	          const clientIpElement = document.getElementById('client-ip');
	          if(clientIpElement) clientIpElement.textContent = clientIp;
	    
	          console.log('Loading client info from Scamalytics (via Worker) for IP:', clientIp);
	          const scamalyticsData = await fetchScamalyticsClientInfo(clientIp);
	    
	          if (scamalyticsData) {
	            updateScamalyticsClientDisplay(scamalyticsData); 
	          } else {
	            // showError would have been called in fetchScamalyticsClientInfo on fetch failure
	            // or if response.ok was false. If it's null due to other reasons, call showError.
	             if (clientIpElement && clientIpElement.textContent === clientIp) { // only if not already N/A'd
	                 showError('client', 'Failed to get full details from Scamalytics. IP may be correct.');
	             } else if (!clientIpElement || clientIpElement.textContent.includes('skeleton')) { // if still skeleton
	                 showError('client', 'Failed to get details from Scamalytics.');
	             }
	          }
	        } else {
	          showError('client', 'Could not determine your IP address.');
	        }
	    
	      } catch (error) {
	        console.error('Overall network info loading failed:', error);
	        showError('proxy', \`Error: \${error.message}\`, document.body.getAttribute('data-proxy-ip') || "N/A");
	        showError('client', \`Error: \${error.message}\`);
	      }
	    }
	    
	    // Refresh button functionality
	    document.getElementById('refresh-ip-info')?.addEventListener('click', function() {
	      const button = this;
	      const icon = button.querySelector('.refresh-icon');
	      button.disabled = true;
	      if (icon) icon.style.animation = 'spin 1s linear infinite';
	    
	      const resetToSkeleton = (prefix) => {
	        const elementsToReset = ['ip', 'location', 'isp'];
	        if (prefix === 'proxy') elementsToReset.push('host'); 
	        if (prefix === 'client') elementsToReset.push('proxy');
	    
	        elementsToReset.forEach(elemKey => {
	          const element = document.getElementById(\`\${prefix}-\${elemKey}\`);
	          if (element) {
	            let skeletonWidth = "100px"; 
	            if (elemKey === 'isp') skeletonWidth = "130px";
	            else if (elemKey === 'location') skeletonWidth = "110px";
	            else if (elemKey === 'ip') skeletonWidth = "120px";
	            else if (elemKey === 'host' && prefix === 'proxy') skeletonWidth = "150px";
	            else if (elemKey === 'proxy' && prefix === 'client') skeletonWidth = "100px";
	            element.innerHTML = \`<span class="skeleton" style="width: \${skeletonWidth};"></span>\`;
	          }
	        });
	      };
	    
	      resetToSkeleton('proxy');
	      resetToSkeleton('client');
	      loadNetworkInfo().finally(() => setTimeout(() => {
	        button.disabled = false; if (icon) icon.style.animation = '';
	      }, 1000));
	    });
	    
	    const style = document.createElement('style');
	    style.textContent = \`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }\`;
	    document.head.appendChild(style);
	    
	    document.addEventListener('DOMContentLoaded', () => {
	      console.log('Page loaded, initializing network info...');
	      loadNetworkInfo();
	    });
	</script>
	</body>
	</html>
	`;
	
	// Replace all placeholders with actual values
	html = html
      .replace(/{{PROXY_IP}}/g, proxyIPWithPort)
      .replace(/{{DREAM_CONFIG}}/g, dreamConfig)
      .replace(/{{FREEDOM_CONFIG}}/g, freedomConfig)
      .replace(/{{DREAM_CONFIG_ENCODED}}/g, encodeURIComponent(dreamConfig))
	  .replace(/{{FREEDOM_CONFIG_ENCODED}}/g, encodeURIComponent(freedomConfig))
      .replace(/{{CLASH_META_URL}}/g, clashMetaFullUrl)
      .replace(/{{NEKOBOX_URL}}/g, nekoBoxImportUrl)
      .replace(/{{YEAR}}/g, new Date().getFullYear().toString());
	
	return html;
}

async function ProtocolOverWSHandler(request, config = null) {
	if (!config) {
		config = {
			userID,
			socks5Address,
			socks5Relay,
			proxyIP,
			proxyPort,
			enableSocks,
			parsedSocks5Address
		};
	}
	const webSocketPair = new WebSocketPair();
	const [client, webSocket] = Object.values(webSocketPair);
	webSocket.accept();
	let address = '';
	let portWithRandomLog = '';
	const log = (info, event) => {
		console.log(`[${address}:${portWithRandomLog}] ${info}`, event || '');
	};
	const earlyDataHeader = request.headers.get('sec-websocket-protocol') || '';
	const readableWebSocketStream = MakeReadableWebSocketStream(webSocket, earlyDataHeader, log);
	let remoteSocketWapper = {
		value: null,
	};
	let isDns = false;
	readableWebSocketStream.pipeTo(new WritableStream({
		async write(chunk, controller) {
			if (isDns) {
				return await handleDNSQuery(chunk, webSocket, null, log);
			}
			if (remoteSocketWapper.value) {
				const writer = remoteSocketWapper.value.writable.getWriter()
				await writer.write(chunk);
				writer.releaseLock();
				return;
			}
			const {
				hasError,
				message,
				addressType,
				portRemote = 443,
				addressRemote = '',
				rawDataIndex,
				ProtocolVersion = new Uint8Array([0, 0]),
				isUDP,
			} = ProcessProtocolHeader(chunk, config.userID);
			address = addressRemote;
			portWithRandomLog = `${portRemote}--${Math.random()} ${isUDP ? 'udp ' : 'tcp '
				} `;
			if (hasError) {
				throw new Error(message); 
			}
			if (isUDP) {
				if (portRemote === 53) {
					isDns = true;
				} else {
					throw new Error('UDP proxy is only enabled for DNS (port 53)');
				}
				return;
			}
			const ProtocolResponseHeader = new Uint8Array([ProtocolVersion[0], 0]);
			const rawClientData = chunk.slice(rawDataIndex);
			if (isDns) {
				return handleDNSQuery(rawClientData, webSocket, ProtocolResponseHeader, log);
			}
			HandleTCPOutBound(remoteSocketWapper, addressType, addressRemote, portRemote, rawClientData, webSocket, ProtocolResponseHeader, log, config);
		},
		close() {
			log(`readableWebSocketStream is close`);
		},
		abort(reason) {
			log(`readableWebSocketStream is abort`, JSON.stringify(reason));
		},
	})).catch((err) => {
		log('readableWebSocketStream pipeTo error', err);
	});
	return new Response(null, {
		status: 101,
		webSocket: client,
	});
}

async function HandleTCPOutBound(remoteSocket, addressType, addressRemote, portRemote, rawClientData, webSocket, protocolResponseHeader, log, config = null) {
	if (!config) {
		config = {
			userID,
			socks5Address,
			socks5Relay,
			proxyIP,
			proxyPort,
			enableSocks,
			parsedSocks5Address
		};
	}
	async function connectAndWrite(address, port, socks = false) {
		let tcpSocket;
		if (config.socks5Relay) {
			tcpSocket = await socks5Connect(addressType, address, port, log, config.parsedSocks5Address)
		} else {
			tcpSocket = socks ? await socks5Connect(addressType, address, port, log, config.parsedSocks5Address)
				: connect({
					hostname: address,
					port: port,
				});
		}
		remoteSocket.value = tcpSocket;
		log(`connected to ${address}:${port}`);
		const writer = tcpSocket.writable.getWriter();
		await writer.write(rawClientData);
		writer.releaseLock();
		return tcpSocket;
	}
	async function retry() {
		let tcpSocket;
		if (config.enableSocks) {
			tcpSocket = await connectAndWrite(addressRemote, portRemote, true);
		} else {
			tcpSocket = await connectAndWrite(config.proxyIP || addressRemote, config.proxyPort || portRemote, false);
		}
		tcpSocket.closed.catch(error => {
			console.log('retry tcpSocket closed error', error);
		}).finally(() => {
			safeCloseWebSocket(webSocket);
		})
		RemoteSocketToWS(tcpSocket, webSocket, protocolResponseHeader, null, log);
	}
	let tcpSocket = await connectAndWrite(addressRemote, portRemote);
	RemoteSocketToWS(tcpSocket, webSocket, protocolResponseHeader, retry, log);
}

function MakeReadableWebSocketStream(webSocketServer, earlyDataHeader, log) {
	let readableStreamCancel = false;
	const stream = new ReadableStream({
		start(controller) {
			webSocketServer.addEventListener('message', (event) => {
				const message = event.data;
				controller.enqueue(message);
			});
			webSocketServer.addEventListener('close', () => {
				safeCloseWebSocket(webSocketServer);
				controller.close();
			});
			webSocketServer.addEventListener('error', (err) => {
				log('webSocketServer has error');
				controller.error(err);
			});
			const { earlyData, error } = base64ToArrayBuffer(earlyDataHeader);
			if (error) {
				controller.error(error);
			} else if (earlyData) {
				controller.enqueue(earlyData);
			}
		},
		pull(_controller) {},
		cancel(reason) {
			log(`ReadableStream was canceled, due to ${reason}`)
			readableStreamCancel = true;
			safeCloseWebSocket(webSocketServer);
		}
	});
	return stream;
}

function ProcessProtocolHeader(protocolBuffer, userID) {
	if (protocolBuffer.byteLength < 24) {
		return { hasError: true, message: 'invalid data' };
	}
	const dataView = new DataView(protocolBuffer);
	const version = dataView.getUint8(0);
	const slicedBufferString = stringify(new Uint8Array(protocolBuffer.slice(1, 17)));
	const uuids = userID.includes(',') ? userID.split(",") : [userID];
	const isValidUser = uuids.some(uuid => slicedBufferString === uuid.trim()) ||
		(uuids.length === 1 && slicedBufferString === uuids[0].trim());
	console.log(`userID: ${slicedBufferString}`);
	if (!isValidUser) {
		return { hasError: true, message: 'invalid user' };
	}
	const optLength = dataView.getUint8(17);
	const command = dataView.getUint8(18 + optLength);
	if (command !== 1 && command !== 2) {
		return { hasError: true, message: `command ${command} is not supported, command 01-tcp,02-udp,03-mux` };
	}
	const portIndex = 18 + optLength + 1;
	const portRemote = dataView.getUint16(portIndex);
	const addressType = dataView.getUint8(portIndex + 2);
	let addressValue, addressLength, addressValueIndex;
	switch (addressType) {
		case 1:
			addressLength = 4;
			addressValueIndex = portIndex + 3;
			addressValue = new Uint8Array(protocolBuffer.slice(addressValueIndex, addressValueIndex + addressLength)).join('.');
			break;
		case 2:
			addressLength = dataView.getUint8(portIndex + 3);
			addressValueIndex = portIndex + 4;
			addressValue = new TextDecoder().decode(protocolBuffer.slice(addressValueIndex, addressValueIndex + addressLength));
			break;
		case 3:
			addressLength = 16;
			addressValueIndex = portIndex + 3;
			addressValue = Array.from({ length: 8 }, (_, i) => dataView.getUint16(addressValueIndex + i * 2).toString(16)).join(':');
			break;
		default:
			return { hasError: true, message: `invalid addressType: ${addressType}` };
	}
	if (!addressValue) {
		return { hasError: true, message: `addressValue is empty, addressType is ${addressType}` };
	}
	return {
		hasError: false,
		addressRemote: addressValue,
		addressType,
		portRemote,
		rawDataIndex: addressValueIndex + addressLength,
		protocolVersion: new Uint8Array([version]),
		isUDP: command === 2
	};
}

async function RemoteSocketToWS(remoteSocket, webSocket, protocolResponseHeader, retry, log) {
	let hasIncomingData = false;
	try {
		await remoteSocket.readable.pipeTo(
			new WritableStream({
				async write(chunk) {
					if (webSocket.readyState !== WS_READY_STATE_OPEN) {
						throw new Error('WebSocket is not open');
					}
					hasIncomingData = true;
					if (protocolResponseHeader) {
						webSocket.send(await new Blob([protocolResponseHeader, chunk]).arrayBuffer());
						protocolResponseHeader = null;
					} else {
						webSocket.send(chunk);
					}
				},
				close() {
					log(`Remote connection readable closed. Had incoming data: ${hasIncomingData}`);
				},
				abort(reason) {
					console.error(`Remote connection readable aborted:`, reason);
				},
			})
		);
	} catch (error) {
		console.error(`RemoteSocketToWS error:`, error.stack || error);
		safeCloseWebSocket(webSocket);
	}
	if (!hasIncomingData && retry) {
		log(`No incoming data, retrying`);
		await retry();
	}
}

function base64ToArrayBuffer(base64Str) {
	if (!base64Str) {
		return { earlyData: null, error: null };
	}
	try {
		base64Str = base64Str.replace(/-/g, '+').replace(/_/g, '/');
		const binaryStr = atob(base64Str);
		const buffer = new ArrayBuffer(binaryStr.length);
		const view = new Uint8Array(buffer);
		for (let i = 0; i < binaryStr.length; i++) {
			view[i] = binaryStr.charCodeAt(i);
		}
		return { earlyData: buffer, error: null };
	} catch (error) {
		return { earlyData: null, error };
	}
}

function isValidUUID(uuid) {
	const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
	return uuidRegex.test(uuid);
}

const WS_READY_STATE_OPEN = 1;
const WS_READY_STATE_CLOSING = 2;

function safeCloseWebSocket(socket) {
	try {
		if (socket.readyState === WS_READY_STATE_OPEN || socket.readyState === WS_READY_STATE_CLOSING) {
			socket.close();
		}
	} catch (error) {
		console.error('safeCloseWebSocket error:', error);
	}
}

const byteToHex = Array.from({ length: 256 }, (_, i) => (i + 0x100).toString(16).slice(1));

function unsafeStringify(arr, offset = 0) {
	return [
		byteToHex[arr[offset]],
		byteToHex[arr[offset + 1]],
		byteToHex[arr[offset + 2]],
		byteToHex[arr[offset + 3]],
		'-',
		byteToHex[arr[offset + 4]],
		byteToHex[arr[offset + 5]],
		'-',
		byteToHex[arr[offset + 6]],
		byteToHex[arr[offset + 7]],
		'-',
		byteToHex[arr[offset + 8]],
		byteToHex[arr[offset + 9]],
		'-',
		byteToHex[arr[offset + 10]],
		byteToHex[arr[offset + 11]],
		byteToHex[arr[offset + 12]],
		byteToHex[arr[offset + 13]],
		byteToHex[arr[offset + 14]],
		byteToHex[arr[offset + 15]]
	].join('').toLowerCase();
}

function stringify(arr, offset = 0) {
	const uuid = unsafeStringify(arr, offset);
	if (!isValidUUID(uuid)) {
		throw new TypeError("Stringified UUID is invalid");
	}
	return uuid;
}

async function handleDNSQuery(udpChunk, webSocket, protocolResponseHeader, log) {
	try {
		const dnsServer = 'https://1.1.1.1/dns-query';
		const dnsPort = 53;
		let vlessHeader = protocolResponseHeader;
		const tcpSocket = connect({
			hostname: dnsServer,
			port: dnsPort,
		});
		log(`connected to ${dnsServer}:${dnsPort}`);
		const writer = tcpSocket.writable.getWriter();
		await writer.write(udpChunk);
		writer.releaseLock();
		await tcpSocket.readable.pipeTo(new WritableStream({
			async write(chunk) {
				if (webSocket.readyState === WS_READY_STATE_OPEN) {
					if (vlessHeader) {
						webSocket.send(await new Blob([vlessHeader, chunk]).arrayBuffer());
						vlessHeader = null;
					} else {
						webSocket.send(chunk);
					}
				}
			},
			close() {
				log(`dns server(${dnsServer}) tcp is close`);
			},
			abort(reason) {
				console.error(`dns server(${dnsServer}) tcp is abort`, reason);
			},
		}));
	} catch (error) {
		console.error(
			`handleDNSQuery have exception, error: ${error.message}`
		);
	}
}

async function socks5Connect(addressType, addressRemote, portRemote, log, parsedSocks5Addr = null) {
	const { username, password, hostname, port } = parsedSocks5Addr || parsedSocks5Address;
	const socket = connect({
		hostname,
		port,
	});
	const socksGreeting = new Uint8Array([5, 2, 0, 2]);
	const writer = socket.writable.getWriter();
	await writer.write(socksGreeting);
	log('sent socks greeting');
	const reader = socket.readable.getReader();
	const encoder = new TextEncoder();
	let res = (await reader.read()).value;
	if (res[0] !== 0x05) {
		log(`socks server version error: ${res[0]} expected: 5`);
		return;
	}
	if (res[1] === 0xff) {
		log("no acceptable methods");
		return;
	}
	if (res[1] === 0x02) {
		log("socks server needs auth");
		if (!username || !password) {
			log("please provide username/password");
			return;
		}
		const authRequest = new Uint8Array([
			1,
			username.length,
			...encoder.encode(username),
			password.length,
			...encoder.encode(password)
		]);
		await writer.write(authRequest);
		res = (await reader.read()).value;
		if (res[0] !== 0x01 || res[1] !== 0x00) {
			log("fail to auth socks server");
			return;
		}
	}
	let DSTADDR;
	switch (addressType) {
		case 1:
			DSTADDR = new Uint8Array(
				[1, ...addressRemote.split('.').map(Number)]
			);
			break;
		case 2:
			DSTADDR = new Uint8Array(
				[3, addressRemote.length, ...encoder.encode(addressRemote)]
			);
			break;
		case 3:
			DSTADDR = new Uint8Array(
				[4, ...addressRemote.split(':').flatMap(x => [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2), 16)])]
			);
			break;
		default:
			log(`invild  addressType is ${addressType}`);
			return;
	}
	const socksRequest = new Uint8Array([5, 1, 0, ...DSTADDR, portRemote >> 8, portRemote & 0xff]);
	await writer.write(socksRequest);
	log('sent socks request');
	res = (await reader.read()).value;
	if (res[1] === 0x00) {
		log("socks connection opened");
	} else {
		log("fail to open socks connection");
		return;
	}
	writer.releaseLock();
	reader.releaseLock();
	return socket;
}

function socks5AddressParser(address) {
	let [latter, former] = address.split("@").reverse();
	let username, password, hostname, port;
	if (former) {
		const formers = former.split(":");
		if (formers.length !== 2) {
			throw new Error('Invalid SOCKS address format');
		}
		[username, password] = formers;
	}
	const latters = latter.split(":");
	port = Number(latters.pop());
	if (isNaN(port)) {
		throw new Error('Invalid SOCKS address format');
	}
	hostname = latters.join(":");
	const regex = /^\[.*\]$/;
	if (hostname.includes(":") && !regex.test(hostname)) {
		throw new Error('Invalid SOCKS address format');
	}
	return {
		username,
		password,
		hostname,
		port,
	}
}

const at = 'QA==';
const pt = 'dmxlc3M=';
const ed = 'RUR0dW5uZWw=';

function GenSub(userID_path, hostname, proxyIP) {
	const mainDomains = new Set([
		hostname,
		'creativecommons.org',
		'speed.cloudflare.com',
		'www.speedtedt.net',
		'sky.rethinkdns.com',
		'go.inmobi.com',
		...proxyIPs,
	]);
	const HttpPort = new Set([80, 8080, 8880, 2052, 2082, 2086, 2095]);
	const HttpsPort = new Set([443, 8443, 2053, 2083, 2087, 2096]);
	const userIDArray = userID_path.includes(',') ? userID_path.split(",") : [userID_path];
	const proxyIPArray = Array.isArray(proxyIP) ? proxyIP : (proxyIP ? (proxyIP.includes(',') ? proxyIP.split(',') : [proxyIP]) : proxyIPs);
	const randomPath = () => '/' + Math.random().toString(36).substring(2, 15) + '?ed=2056';
	const commonUrlPartHttp = `?encryption=none&security=none&fp=firefox&type=ws&host=${hostname}&path=${encodeURIComponent(randomPath())}#`;
	const commonUrlPartHttps = `?encryption=none&security=tls&sni=${hostname}&fp=chrome&type=ws&host=${hostname}&path=${encodeURIComponent(randomPath())}#`;
	const result = userIDArray.flatMap((userID) => {
		let allUrls = [];
		if (!hostname.includes('pages.dev')) {
			mainDomains.forEach(domain => {
				Array.from(HttpPort).forEach((port) => {
					const urlPart = `${hostname.split('.')[0]}-${domain}-HTTP-${port}`;
					const mainProtocolHttp = atob(pt) + '://' + userID + atob(at) + domain + ':' + port + commonUrlPartHttp + urlPart;
					allUrls.push(mainProtocolHttp);
				});
			});
		}
		mainDomains.forEach(domain => {
			Array.from(HttpsPort).forEach((port) => {
				const urlPart = `${hostname.split('.')[0]}-${domain}-HTTPS-${port}`;
				const mainProtocolHttps = atob(pt) + '://' + userID + atob(at) + domain + ':' + port + commonUrlPartHttps + urlPart;
				allUrls.push(mainProtocolHttps);
			});
		});
		proxyIPArray.forEach((proxyAddr) => {
			const [proxyHost, proxyPort = '443'] = proxyAddr.split(':');
			const urlPart = `${hostname.split('.')[0]}-${proxyHost}-HTTPS-${proxyPort}`;
			const secondaryProtocolHttps = atob(pt) + '://' + userID + atob(at) + proxyHost + ':' + proxyPort + commonUrlPartHttps + urlPart + '-' + atob(ed);
			allUrls.push(secondaryProtocolHttps);
		});
		return allUrls;
	});
	return btoa(result.join('\n'));
}

function handleProxyConfig(PROXYIP) {
	if (PROXYIP) {
		const proxyAddresses = PROXYIP.split(',').map(addr => addr.trim());
		const selectedProxy = selectRandomAddress(proxyAddresses);
		const [ip, port = '443'] = selectedProxy.split(':');
		return { ip, port };
	} else {
		const port = proxyIP.includes(':') ? proxyIP.split(':')[1] : '443';
		const ip = proxyIP.split(':')[0];
		return { ip, port };
	}
}

function selectRandomAddress(addresses) {
	const addressArray = typeof addresses === 'string' ?
		addresses.split(',').map(addr => addr.trim()) :
		addresses;
	return addressArray[Math.floor(Math.random() * addressArray.length)];
}

function parseEncodedQueryParams(pathname) {
	const params = {};
	if (pathname.includes('%3F')) {
		const encodedParamsMatch = pathname.match(/%3F(.+)$/);
		if (encodedParamsMatch) {
			const encodedParams = encodedParamsMatch[1];
			const paramPairs = encodedParams.split('&');
			for (const pair of paramPairs) {
				const [key, value] = pair.split('=');
				if (value) params[key] = decodeURIComponent(value);
			}
		}
	}
	return params;
}
