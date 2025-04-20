var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.js
import panelTemplateHtml from "./c668bc5a9ce9f06e35c03efdff137a50b4787eeb-panel.html?raw";
import panelCss from "./e63217ce30b4461b1f718e731fca17378731907c-style.css?raw";
import panelJs from "./f02a93f95ae0db5e4f1797a7b7e92bc8b4183974-script.js?raw";
import { connect } from "cloudflare:sockets";
var VLESS_VERSION = 0;
var VLESS_CMD = {
  TCP: 1,
  UDP: 2,
  MUX: 3
  // Note: MUX is not supported in this script
};
var VLESS_ADDR_TYPE = {
  IPV4: 1,
  DOMAIN: 2,
  IPV6: 3
};
var WS_READY_STATE = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3
};
function reverseBase64Encode(str) {
  try {
    return btoa(str.split("").reverse().join(""));
  } catch (e) {
    console.error("reverseBase64Encode failed:", e);
    return "";
  }
}
__name(reverseBase64Encode, "reverseBase64Encode");
function reverseBase64Decode(encoded) {
  try {
    return atob(encoded).split("").reverse().join("");
  } catch (e) {
    console.error("reverseBase64Decode failed:", e);
    return "";
  }
}
__name(reverseBase64Decode, "reverseBase64Decode");
var ENCODED = {
  NETWORK: reverseBase64Encode("ws"),
  // Should result in 'c3c='
  TYPE: reverseBase64Encode("diana"),
  // Should result in 'YW5haWQ='
  STREAM: reverseBase64Encode("stream"),
  // Should result in 'bWFlcnRz'
  PROTOCOL: reverseBase64Encode("vless")
  // Should result in 'c3NlbHY='
};
var userID = "DEFAULT_UUID";
var proxyIP = "DEFAULT_PROXYIP";
var DEFAULT_UUID = "10e894da-61b1-4998-ac2b-e9ccb6af9d30";
var DEFAULT_PROXYIP = "turk.radicalization.ir";
function isValidUUID(uuid) {
  if (!uuid)
    return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[4][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}
__name(isValidUUID, "isValidUUID");
function getEnv(env) {
  userID = env.UUID || DEFAULT_UUID;
  proxyIP = env.PROXYIP || DEFAULT_PROXYIP;
  if (!isValidUUID(userID)) {
    console.error(`Invalid UUID configured. Received: "${userID}". Falling back to default.`);
    userID = DEFAULT_UUID;
  }
  if (typeof proxyIP !== "string" || proxyIP.length === 0) {
    console.error(`Invalid PROXYIP configured. Received: "${proxyIP}". Falling back to default.`);
    proxyIP = DEFAULT_PROXYIP;
  }
}
__name(getEnv, "getEnv");
var src_default = {
  /**
   * Handles incoming requests.
   * @param {import("@cloudflare/workers-types").Request} request
   * @param {Record<string, string>} env Environment variables (like UUID, PROXYIP)
   * @param {import("@cloudflare/workers-types").ExecutionContext} ctx Execution context
   * @returns {Promise<Response>}
   */
  async fetch(request, env, ctx) {
    getEnv(env);
    try {
      const upgradeHeader = request.headers.get("Upgrade");
      if (upgradeHeader && upgradeHeader.toLowerCase() === "websocket") {
        console.log(`[WebSocket] Upgrading request from ${request.headers.get("CF-Connecting-IP")}`);
        return await handleWebSocketRequest(request);
      } else {
        const url = new URL(request.url);
        switch (url.pathname) {
          case "/":
            const info = {
              requestInfo: {
                cf: request.cf,
                headers: Object.fromEntries(request.headers)
              },
              workerConfig: {
                userID,
                proxyIP,
                encodedConstants: ENCODED
              }
            };
            return new Response(JSON.stringify(info, null, 2), {
              status: 200,
              headers: { "Content-Type": "application/json;charset=utf-8" }
            });
          case `/${userID}`:
            const host = request.headers.get("Host") || proxyIP;
            console.log(`[Panel] Serving panel for host: ${host}, UserID path matched.`);
            const panelHtml = generateConfigPanel(userID, host, proxyIP);
            return new Response(panelHtml, {
              status: 200,
              headers: { "Content-Type": "text/html;charset=utf-8" }
            });
          default:
            console.log(`[HTTP] Not Found: ${url.pathname}`);
            return new Response("Not found. Visit /<UUID> for config panel.", { status: 404 });
        }
      }
    } catch (err) {
      console.error("[Fetch Error] An error occurred:", err.stack || err);
      return new Response(err.message || "Internal Server Error", { status: 500 });
    }
  }
};
async function handleWebSocketRequest(request) {
  const webSocketPair = new WebSocketPair();
  const [client, server] = Object.values(webSocketPair);
  server.accept();
  console.log("[WebSocket] Accepted WebSocket connection.");
  let remoteSocketContext = {
    address: "",
    port: "",
    socket: null,
    // Holds the TCP socket
    webSocket: server,
    // Reference to the server WebSocket
    earlyData: null,
    streamId: Math.random().toString(36).substring(2, 8)
    // Simple random ID for logging
  };
  const log = /* @__PURE__ */ __name((level, message, event = "") => {
    const time = (/* @__PURE__ */ new Date()).toISOString();
    const addr = remoteSocketContext.address ? ` ${remoteSocketContext.address}:${remoteSocketContext.port}` : "";
    console.log(`[${time}] [${remoteSocketContext.streamId}${addr}] [${level}] ${message}`, event);
  }, "log");
  log("info", "WebSocket stream initiated.");
  const earlyDataHeader = request.headers.get("sec-websocket-protocol") || "";
  try {
    const { earlyData, error } = decodeBase64ToArrayBuffer(earlyDataHeader);
    if (error) {
      log("warn", "Failed to decode early data header:", error);
    } else if (earlyData) {
      remoteSocketContext.earlyData = earlyData;
      log("info", `Processed ${earlyData.byteLength} bytes of early data.`);
    }
  } catch (e) {
    log("error", "Error processing early data header:", e);
  }
  const readableStream = createReadableWebSocketStream(server, remoteSocketContext.earlyData, log);
  let remoteConnection = {
    value: null
    // To hold the established TCP or UDP connection/handler
  };
  let udpWrite = null;
  let isDns = false;
  readableStream.pipeTo(
    new WritableStream({
      async write(chunk, controller) {
        try {
          if (isDns && udpWrite) {
            log("debug", `Forwarding UDP chunk (${chunk.byteLength} bytes) to DNS handler.`);
            return udpWrite(chunk);
          }
          if (remoteConnection.value) {
            log("debug", `Forwarding TCP chunk (${chunk.byteLength} bytes) to remote.`);
            const writer = remoteConnection.value.writable.getWriter();
            await writer.write(chunk);
            writer.releaseLock();
            return;
          }
          log("debug", `Processing first chunk (${chunk.byteLength} bytes) for VLESS header.`);
          const {
            hasError,
            errorMsg = "Unknown error processing header",
            addressRemote = "",
            portRemote = 443,
            rawDataIndex = 0,
            vlessVersion = new Uint8Array([VLESS_VERSION, 0]),
            // Use VLESS_VERSION constant
            isUDP
          } = processVlessHeader(chunk, userID);
          if (hasError) {
            log("error", `VLESS Header Error: ${errorMsg}. Closing WebSocket.`);
            server.close(1008, `VLESS Header Error: ${errorMsg}`);
            throw new Error(errorMsg);
          }
          remoteSocketContext.address = addressRemote;
          remoteSocketContext.port = portRemote;
          const connectionType = isUDP ? "UDP" : "TCP";
          log("info", `Header processed: Target ${addressRemote}:${portRemote} (${connectionType})`);
          if (isUDP) {
            if (portRemote === 53) {
              isDns = true;
              log("info", "UDP target is port 53. Initializing DNS handler.");
            } else {
              const msg = "UDP proxying is only enabled for DNS (port 53).";
              log("warn", msg);
              server.close(1008, msg);
              throw new Error(msg);
            }
          }
          const vlessResponseHeader = new Uint8Array([vlessVersion[0], 0]);
          const rawClientData = chunk.slice(rawDataIndex);
          log("debug", `Sliced ${rawClientData.byteLength} bytes of initial client data.`);
          if (isDns) {
            const { write } = await handleUdpProxy(server, vlessResponseHeader, log);
            udpWrite = write;
            if (rawClientData.byteLength > 0) {
              log("debug", `Writing initial UDP data (${rawClientData.byteLength} bytes) to DNS handler.`);
              udpWrite(rawClientData);
            }
          } else {
            log("info", `Establishing TCP connection to ${addressRemote}:${portRemote}`);
            await handleTcpProxy(
              remoteConnection,
              // Pass the wrapper object
              addressRemote,
              portRemote,
              rawClientData,
              server,
              vlessResponseHeader,
              log
            );
            log("debug", "TCP handler initiated.");
          }
        } catch (err) {
          log("error", "Error in WritableStream write:", err.stack || err);
          controller.error(err);
          safeCloseWebSocket(server, 1011, "Internal stream error");
        }
      },
      close() {
        log("info", "Client WebSocket stream closed.");
        if (remoteConnection.value && remoteConnection.value.close) {
          log("debug", "Closing remote TCP socket due to client stream close.");
          remoteConnection.value.close().catch((e) => log("warn", "Error closing remote TCP socket on client close:", e));
        }
      },
      abort(reason) {
        log("warn", "Client WebSocket stream aborted:", reason);
        if (remoteConnection.value && remoteConnection.value.abort) {
          log("debug", "Aborting remote TCP socket due to client stream abort.");
          remoteConnection.value.abort(reason).catch((e) => log("warn", "Error aborting remote TCP socket on client abort:", e));
        }
      }
    }),
    { signal: createAbortControllerOnClose(server, log).signal }
    // Abort pipe if WebSocket closes unexpectedly
  ).catch((err) => {
    log("error", "WebSocket readableStream pipeTo error:", err.stack || err);
    safeCloseWebSocket(server, 1011, "Pipe error");
  });
  return new Response(null, {
    status: 101,
    webSocket: client
    // Return the client side of the pair to the runtime
  });
}
__name(handleWebSocketRequest, "handleWebSocketRequest");
function createAbortControllerOnClose(webSocket, log) {
  const abortController = new AbortController();
  const listenerOptions = { once: true, passive: true };
  const onCloseOrError = /* @__PURE__ */ __name((event) => {
    const reason = event instanceof CloseEvent ? `WebSocket closed: code=${event.code}, reason=${event.reason}` : `WebSocket error: ${event.message || "Unknown error"}`;
    log("debug", `AbortController triggered due to WebSocket ${event.type}:`, reason);
    abortController.abort(new Error(reason));
    webSocket.removeEventListener("close", onCloseOrError);
    webSocket.removeEventListener("error", onCloseOrError);
  }, "onCloseOrError");
  webSocket.addEventListener("close", onCloseOrError, listenerOptions);
  webSocket.addEventListener("error", onCloseOrError, listenerOptions);
  return abortController;
}
__name(createAbortControllerOnClose, "createAbortControllerOnClose");
function createReadableWebSocketStream(webSocketServer, earlyData, log) {
  let streamCancelled = false;
  const stream = new ReadableStream({
    start(controller) {
      log("debug", "ReadableWebSocketStream started.");
      if (earlyData) {
        log("debug", `Enqueuing ${earlyData.byteLength} bytes of early data into stream.`);
        controller.enqueue(new Uint8Array(earlyData));
      }
      webSocketServer.addEventListener("message", (event) => {
        if (streamCancelled) {
          log("debug", "Stream cancelled, ignoring incoming WebSocket message.");
          return;
        }
        const message = event.data;
        log("debug", `WebSocket message received (${message.byteLength || message.length} bytes), enqueuing.`);
        if (message instanceof ArrayBuffer) {
          controller.enqueue(new Uint8Array(message));
        } else if (typeof message === "string") {
          log("warn", "Received string message, encoding to Uint8Array.");
          controller.enqueue(new TextEncoder().encode(message));
        } else if (message instanceof Blob) {
          log("debug", "Received Blob message, converting to ArrayBuffer.");
          message.arrayBuffer().then((buffer) => {
            if (!streamCancelled)
              controller.enqueue(new Uint8Array(buffer));
          }).catch((err) => {
            log("error", "Error converting Blob message to ArrayBuffer:", err);
            controller.error(err);
            safeCloseWebSocket(webSocketServer, 1011, "Blob processing error");
          });
        } else {
          log("warn", "Received unexpected message type:", typeof message);
          controller.enqueue(new Uint8Array(message));
        }
      });
      webSocketServer.addEventListener("close", (event) => {
        log("info", `WebSocket closed by client: code=${event.code}, reason=${event.reason}`);
        safeCloseWebSocket(webSocketServer);
        if (!streamCancelled) {
          log("debug", "Closing readable stream due to WebSocket close.");
          controller.close();
        }
      });
      webSocketServer.addEventListener("error", (err) => {
        log("error", "WebSocket error event:", err);
        if (!streamCancelled) {
          controller.error(err);
        }
      });
    },
    pull(controller) {
      log("debug", "ReadableStream pull requested.");
    },
    cancel(reason) {
      log("warn", `ReadableStream cancelled. Reason: ${reason}`);
      streamCancelled = true;
      safeCloseWebSocket(webSocketServer, 1001, "Stream cancelled");
    }
  });
  return stream;
}
__name(createReadableWebSocketStream, "createReadableWebSocketStream");
function processVlessHeader(chunk, expectedUserID) {
  const buffer = new Uint8Array(chunk);
  const dataView = new DataView(buffer.buffer);
  if (buffer.byteLength < 23) {
    return { hasError: true, errorMsg: `Invalid VLESS header length: ${buffer.byteLength}` };
  }
  const version = buffer.slice(0, 1);
  if (version[0] !== VLESS_VERSION) {
    return { hasError: true, errorMsg: `Unsupported VLESS version: ${version[0]}` };
  }
  let userIDBytes;
  try {
    userIDBytes = buffer.slice(1, 17);
    const userIDString = uuidBytesToString(userIDBytes);
    if (userIDString.toLowerCase() !== expectedUserID.toLowerCase()) {
      return { hasError: true, errorMsg: "Invalid User ID" };
    }
  } catch (err) {
    return { hasError: true, errorMsg: `Failed to parse User ID: ${err.message}` };
  }
  const addonLen = buffer[17];
  let currentIndex = 18 + addonLen;
  if (currentIndex + 1 > buffer.byteLength) {
    return { hasError: true, errorMsg: "Invalid header: insufficient length after addons" };
  }
  const command = buffer[currentIndex];
  let isUDP = false;
  if (command === VLESS_CMD.TCP) {
  } else if (command === VLESS_CMD.UDP) {
    isUDP = true;
  } else if (command === VLESS_CMD.MUX) {
    return { hasError: true, errorMsg: "MUX command (0x03) is not supported" };
  } else {
    return { hasError: true, errorMsg: `Unsupported command: ${command}` };
  }
  currentIndex++;
  if (currentIndex + 2 > buffer.byteLength) {
    return { hasError: true, errorMsg: "Invalid header: insufficient length for port" };
  }
  const portRemote = dataView.getUint16(currentIndex, false);
  currentIndex += 2;
  if (currentIndex + 1 > buffer.byteLength) {
    return { hasError: true, errorMsg: "Invalid header: insufficient length for address type" };
  }
  const addressType = buffer[currentIndex];
  currentIndex++;
  let addressRemote = "";
  let addressLength = 0;
  try {
    switch (addressType) {
      case VLESS_ADDR_TYPE.IPV4:
        addressLength = 4;
        if (currentIndex + addressLength > buffer.byteLength)
          throw new Error("Insufficient length for IPv4 address");
        addressRemote = buffer.slice(currentIndex, currentIndex + addressLength).join(".");
        break;
      case VLESS_ADDR_TYPE.DOMAIN:
        if (currentIndex + 1 > buffer.byteLength)
          throw new Error("Insufficient length for domain length");
        addressLength = buffer[currentIndex];
        currentIndex++;
        if (currentIndex + addressLength > buffer.byteLength)
          throw new Error("Insufficient length for domain name");
        addressRemote = new TextDecoder().decode(buffer.slice(currentIndex, currentIndex + addressLength));
        break;
      case VLESS_ADDR_TYPE.IPV6:
        addressLength = 16;
        if (currentIndex + addressLength > buffer.byteLength)
          throw new Error("Insufficient length for IPv6 address");
        const ipv6Bytes = buffer.slice(currentIndex, currentIndex + addressLength);
        const ipv6Segments = [];
        for (let i = 0; i < 8; i++) {
          ipv6Segments.push(dataView.getUint16(currentIndex + i * 2, false).toString(16));
        }
        addressRemote = ipv6Segments.join(":");
        break;
      default:
        return { hasError: true, errorMsg: `Invalid address type: ${addressType}` };
    }
  } catch (err) {
    return { hasError: true, errorMsg: `Error parsing address: ${err.message}` };
  }
  currentIndex += addressLength;
  if (!addressRemote) {
    return { hasError: true, errorMsg: "Parsed address is empty" };
  }
  return {
    hasError: false,
    addressRemote,
    portRemote,
    addressType,
    rawDataIndex: currentIndex,
    // Index where the actual payload data starts
    vlessVersion: version,
    isUDP
  };
}
__name(processVlessHeader, "processVlessHeader");
async function handleTcpProxy(remoteConnectionWrapper, addressRemote, portRemote, initialClientData, webSocket, vlessResponseHeader, log) {
  let tcpSocket;
  async function connectAndWrite(address, port, isRetry = false) {
    const target = `${address}:${port}`;
    log("info", `${isRetry ? "[Retry] " : ""}Attempting TCP connection to ${target}`);
    try {
      const socket = connect({ hostname: address, port });
      log("info", `${isRetry ? "[Retry] " : ""}Successfully initiated TCP connection to ${target}`);
      remoteConnectionWrapper.value = socket;
      pipeRemoteSocketToWebSocket(socket, webSocket, vlessResponseHeader, log);
      if (initialClientData && initialClientData.byteLength > 0) {
        log("debug", `Writing initial ${initialClientData.byteLength} bytes to ${target}`);
        const writer = socket.writable.getWriter();
        await writer.write(initialClientData);
        writer.releaseLock();
        log("debug", "Initial data written successfully.");
      } else {
        log("debug", "No initial client data to write.");
      }
      return socket;
    } catch (error) {
      log("error", `${isRetry ? "[Retry] " : ""}TCP connection to ${target} failed:`, error.message || error);
      throw error;
    }
  }
  __name(connectAndWrite, "connectAndWrite");
  async function pipeRemoteSocketToWebSocket(socket, ws, header, logger) {
    let headerSent = false;
    const remoteReader = socket.readable.getReader();
    const abortController = createAbortControllerOnClose(ws, logger);
    logger("debug", "Starting pipe from remote TCP to WebSocket.");
    while (true) {
      if (abortController.signal.aborted) {
        logger("warn", "WebSocket closed or errored, aborting TCP read loop.");
        remoteReader.cancel("WebSocket closed").catch((e) => logger("warn", "Error cancelling remote reader:", e));
        break;
      }
      try {
        const { done, value } = await remoteReader.read();
        if (done) {
          logger("info", "Remote TCP connection closed by peer.");
          break;
        }
        if (ws.readyState === WS_READY_STATE.OPEN) {
          if (!headerSent && header) {
            logger("debug", `Sending VLESS response header (${header.byteLength} bytes) and first data chunk (${value.byteLength} bytes).`);
            ws.send(await new Blob([header, value]).arrayBuffer());
            headerSent = true;
          } else {
            logger("debug", `Sending data chunk (${value.byteLength} bytes) from remote to WebSocket.`);
            ws.send(value);
          }
        } else {
          logger("warn", `WebSocket is not open (state: ${ws.readyState}), cannot send data from remote. Aborting read loop.`);
          remoteReader.cancel("WebSocket not open").catch((e) => logger("warn", "Error cancelling remote reader:", e));
          break;
        }
      } catch (error) {
        logger("error", "Error reading from remote TCP socket:", error.stack || error);
        safeCloseWebSocket(ws, 1011, "Remote read error");
        remoteReader.cancel("Read error").catch((e) => logger("warn", "Error cancelling remote reader:", e));
        break;
      }
    }
    logger("debug", "Finished pipe from remote TCP to WebSocket.");
  }
  __name(pipeRemoteSocketToWebSocket, "pipeRemoteSocketToWebSocket");
  async function attemptConnectionWithRetry() {
    try {
      tcpSocket = await connectAndWrite(addressRemote, portRemote);
    } catch (initialError) {
      log("warn", `Initial connection to ${addressRemote}:${portRemote} failed. Trying proxyIP: ${proxyIP}.`);
      if (proxyIP && proxyIP.toLowerCase() !== addressRemote.toLowerCase()) {
        try {
          tcpSocket = await connectAndWrite(proxyIP, portRemote, true);
        } catch (retryError) {
          log("error", `Retry connection to proxyIP ${proxyIP}:${portRemote} also failed. Closing WebSocket.`);
          safeCloseWebSocket(webSocket, 1011, "Connection failed");
          throw retryError;
        }
      } else {
        log("error", "No valid proxyIP to retry or proxyIP is the same as target. Closing WebSocket.");
        safeCloseWebSocket(webSocket, 1011, "Connection failed");
        throw initialError;
      }
    }
  }
  __name(attemptConnectionWithRetry, "attemptConnectionWithRetry");
  await attemptConnectionWithRetry();
}
__name(handleTcpProxy, "handleTcpProxy");
async function handleUdpProxy(webSocket, vlessResponseHeader, log) {
  let isHeaderSent = false;
  const dohEndpoint = "https://1.1.1.1/dns-query";
  log("info", `Initializing UDP proxy via DoH endpoint: ${dohEndpoint}`);
  const processUdpFrame = /* @__PURE__ */ __name(async (chunk) => {
    let currentIndex = 0;
    while (currentIndex < chunk.byteLength) {
      if (currentIndex + 2 > chunk.byteLength) {
        log("warn", `Incomplete UDP length header received. Remainder: ${chunk.byteLength - currentIndex} bytes.`);
        break;
      }
      const dataView = new DataView(chunk.buffer, chunk.byteOffset);
      const udpPayloadLength = dataView.getUint16(currentIndex, false);
      currentIndex += 2;
      if (currentIndex + udpPayloadLength > chunk.byteLength) {
        log("warn", `Incomplete UDP payload data. Expected: ${udpPayloadLength}, Available: ${chunk.byteLength - currentIndex}.`);
        break;
      }
      const udpPayload = chunk.slice(currentIndex, currentIndex + udpPayloadLength);
      currentIndex += udpPayloadLength;
      log("debug", `Processing UDP frame. Payload size: ${udpPayloadLength} bytes.`);
      try {
        log("info", `Sending DNS query (${udpPayload.byteLength} bytes) to ${dohEndpoint}`);
        const response = await fetch(dohEndpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/dns-message",
            "Accept": "application/dns-message"
          },
          body: udpPayload
        });
        if (!response.ok) {
          log("error", `DoH query failed: ${response.status} ${response.statusText}`);
          continue;
        }
        const dohResult = await response.arrayBuffer();
        log("info", `Received DoH response (${dohResult.byteLength} bytes).`);
        if (webSocket.readyState === WS_READY_STATE.OPEN) {
          const resultLength = dohResult.byteLength;
          const lengthBuffer = new Uint8Array(2);
          const lengthView = new DataView(lengthBuffer.buffer);
          lengthView.setUint16(0, resultLength, false);
          const messageParts = [];
          if (!isHeaderSent) {
            messageParts.push(vlessResponseHeader);
            isHeaderSent = true;
            log("debug", "Sending VLESS UDP response header.");
          }
          messageParts.push(lengthBuffer);
          messageParts.push(new Uint8Array(dohResult));
          const messageToSend = await new Blob(messageParts).arrayBuffer();
          log("debug", `Sending UDP response frame to client (${messageToSend.byteLength} bytes total).`);
          webSocket.send(messageToSend);
        } else {
          log("warn", "WebSocket closed before DNS response could be sent.");
          break;
        }
      } catch (error) {
        log("error", "Error during DoH request or processing:", error.stack || error);
      }
    }
  }, "processUdpFrame");
  return {
    /**
     * Writes a chunk of data received from the WebSocket (expected to contain VLESS UDP frames).
     * @param {Uint8Array} chunk Data chunk from WebSocket.
     */
    write: async (chunk) => {
      await processUdpFrame(chunk);
    }
  };
}
__name(handleUdpProxy, "handleUdpProxy");
function generateConfigPanel(currentUserID, hostName, currentProxyIP) {
  const protocol = reverseBase64Decode(ENCODED.PROTOCOL);
  const networkType = reverseBase64Decode(ENCODED.NETWORK);
  if (!protocol || !networkType) {
    console.error("Failed to decode protocol or network type constants.");
    return "<html><body>Error generating configuration: Invalid constants.</body></html>";
  }
  const baseUrl = `${protocol}://${currentUserID}@${hostName}:443`;
  const commonParams = `encryption=none&host=${encodeURIComponent(hostName)}&type=${networkType}&security=tls&sni=${encodeURIComponent(hostName)}`;
  const freedomConfig = `${baseUrl}?path=/assets&encryption=none&security=tls&sni=${encodeURIComponent(hostName)}&fp=chrome&type=ws&host=${encodeURIComponent(hostName)}&alpn=h3#${encodeURIComponent(hostName)}`;
  const dreamConfig = `${baseUrl}?path=/api/v8?ed=2560&${commonParams}&fp=randomized&alpn=h2,http/1.1#${encodeURIComponent(hostName)}`;
  const freedomConfigEncoded = encodeURIComponent(freedomConfig);
  const dreamConfigEncoded = encodeURIComponent(dreamConfig);
  const clashMetaConverterBase = "https://sub.victoriacross.ir/sub/clash-meta";
  const clashMetaParams = new URLSearchParams({
    url: freedomConfig,
    // Pass the raw VLESS URL
    remote_config: "",
    udp: "true",
    ss_uot: "false",
    show_host: "false",
    forced_ws0rtt: "false"
    // Assuming 0rtt is handled by ed parameter? Check converter logic.
  });
  const clashMetaFullUrl = `clash://install-config?url=${encodeURIComponent(`${clashMetaConverterBase}?${clashMetaParams.toString()}`)}`;
  const nekoBoxConverterBase = "https://sahar-km.github.io/arcane/";
  const nekoBoxImportUrl = `${nekoBoxConverterBase}${btoa(freedomConfig)}`;
  const hiddifyImportUrl = `hiddify://install-config?url=${freedomConfigEncoded}`;
  const v2rayNGImportUrl = `v2rayng://install-config?url=${dreamConfigEncoded}`;
  let finalHtml = panelTemplateHtml.replace(/{{PROXY_IP}}/g, currentProxyIP || "N/A").replace(/{{HOST_NAME}}/g, hostName || "N/A").replace(/{{USER_ID}}/g, currentUserID).replace(/{{DREAM_CONFIG}}/g, dreamConfig).replace(/{{FREEDOM_CONFIG}}/g, freedomConfig).replace(/'{{DREAM_CONFIG_RAW}}'/g, `'${dreamConfig.replace(/'/g, "\\'")}'`).replace(/'{{FREEDOM_CONFIG_RAW}}'/g, `'${freedomConfig.replace(/'/g, "\\'")}'`).replace(/{{HIDDIFY_URL}}/g, hiddifyImportUrl).replace(/{{V2RAYNG_URL}}/g, v2rayNGImportUrl).replace(/{{CLASH_META_URL}}/g, clashMetaFullUrl).replace(/{{NEKOBOX_URL}}/g, nekoBoxImportUrl).replace(/{{YEAR}}/g, (/* @__PURE__ */ new Date()).getFullYear());
  const fullHtml = `
<!doctype html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@300..700&family=Ibarra+Real+Nova:wght@700&family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap" rel="stylesheet">
    <title>VLESS Proxy Configuration</title>
    <style>
${panelCss}
    </style>
</head>
<body>
${panelBodyContent}
    <script>
${panelJs}
    <\/script>
</body>
</html>
`;
  return fullHtml.trim();
}
__name(generateConfigPanel, "generateConfigPanel");
function safeCloseWebSocket(socket, code = 1e3, reason = "Closing") {
  try {
    if (socket && (socket.readyState === WS_READY_STATE.OPEN || socket.readyState === WS_READY_STATE.CLOSING)) {
      console.log(`[WebSocket] Closing WebSocket: code=${code}, reason=${reason}`);
      socket.close(code, reason);
    }
  } catch (error) {
    console.error("[WebSocket] Error closing WebSocket:", error);
  }
}
__name(safeCloseWebSocket, "safeCloseWebSocket");
function decodeBase64ToArrayBuffer(base64Str) {
  if (!base64Str) {
    return { earlyData: null, error: null };
  }
  try {
    let base64 = base64Str.replace(/-/g, "+").replace(/_/g, "/");
    while (base64.length % 4) {
      base64 += "=";
    }
    const decodedStr = atob(base64);
    const buffer = new Uint8Array(decodedStr.length);
    for (let i = 0; i < decodedStr.length; i++) {
      buffer[i] = decodedStr.charCodeAt(i);
    }
    return { earlyData: buffer.buffer, error: null };
  } catch (error) {
    console.error("decodeBase64ToArrayBuffer failed:", error);
    return { earlyData: null, error };
  }
}
__name(decodeBase64ToArrayBuffer, "decodeBase64ToArrayBuffer");
var byteToHex = [];
for (let i = 0; i < 256; ++i) {
  byteToHex.push((i + 256).toString(16).slice(1));
}
function uuidBytesToString(arr, offset = 0) {
  if (arr.byteLength !== 16) {
    throw new TypeError(`Input array must be 16 bytes long, got ${arr.byteLength}`);
  }
  const uuid = (byteToHex[arr[offset + 0]] + byteToHex[arr[offset + 1]] + byteToHex[arr[offset + 2]] + byteToHex[arr[offset + 3]] + "-" + byteToHex[arr[offset + 4]] + byteToHex[arr[offset + 5]] + "-" + byteToHex[arr[offset + 6]] + byteToHex[arr[offset + 7]] + "-" + byteToHex[arr[offset + 8]] + byteToHex[arr[offset + 9]] + "-" + byteToHex[arr[offset + 10]] + byteToHex[arr[offset + 11]] + byteToHex[arr[offset + 12]] + byteToHex[arr[offset + 13]] + byteToHex[arr[offset + 14]] + byteToHex[arr[offset + 15]]).toLowerCase();
  if (!isValidUUID(uuid)) {
    throw new TypeError("Converted byte array resulted in an invalid UUID format");
  }
  return uuid;
}
__name(uuidBytesToString, "uuidBytesToString");
export {
  src_default as default
};
//# sourceMappingURL=index.js.map
