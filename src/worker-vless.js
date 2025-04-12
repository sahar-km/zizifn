// <!--GAMFC-->Last update: 2025-04-12 01:05:05 UTC - NiREvil - version base on commit c2760f84324654d5d2d4b8c82d1ad94655462d2a<!--GAMFC-END-->.
// @ts-nocheck
import { connect } from 'cloudflare:sockets';

// basic encoding/decoding utilities
function encodeSecure(str) {
  return btoa(str.split('').reverse().join(''));
}

function decodeSecure(encoded) {
  return atob(encoded).split('').reverse().join('');
}

// encoded constants
const ENCODED = {
  NETWORK: 'c3c=', // ws reversed + base64
  TYPE: 'YW5haWQ=', // diana reversed + base64
  STREAM: 'bWFlcnRz', // stream reversed + base64
  PROTOCOL: 'c3NlbHY=', // vless reversed + base64
};

//to generate your own UUID: https://www.uuidgenerator.net/
let userCode = '10e894da-61b1-4998-ac2b-e9ccb6af9d30';

// to find proxyIP: https://github.com/NiREvil/vless/blob/main/sub/ProxyIP.md
let proxyIP = 'turk.radicalization.ir'; // Or use 'nima.nscl.ir

if (!isValidUserCode(userCode)) {
  throw new Error('user code is not valid');
}

export default {
  /**
   * @param {import("@cloudflare/workers-types").Request} request
   * @param {{UUID: string, PROXYIP: string}} env
   * @param {import("@cloudflare/workers-types").ExecutionContext} ctx
   * @returns {Promise<Response>}
   */
  async fetch(request, env, ctx) {
    try {
      userCode = env.UUID || userCode;
      proxyIP = env.PROXYIP || proxyIP;
      const upgradeHeader = request.headers.get('Upgrade');
      if (!upgradeHeader || upgradeHeader !== 'websocket') {
        const url = new URL(request.url);
        switch (url.pathname) {
          case '/':
            return new Response(JSON.stringify(request.cf, null, 4), {
              status: 200,
              headers: { 'Content-Type': 'application/json;charset=utf-8' },
            });
          case `/${userCode}`: {
            const streamConfig = getDianaConfig(userCode, request.headers.get('Host'));
            return new Response(`${streamConfig}`, {
              status: 200,
              headers: { 'Content-Type': 'text/html;charset=utf-8' },
            });
          }
          default:
            return new Response('Not found', { status: 404 });
        }
      } else {
        return await streamOverWSHandler(request);
      }
    } catch (err) {
      let e = err;
      return new Response(e.toString());
    }
  },
};

/**
 *
 * @param {import("@cloudflare/workers-types").Request} request
 */
async function streamOverWSHandler(request) {
  /** @type {import("@cloudflare/workers-types").WebSocket[]} */
  // @ts-ignore
  const webSocketPair = new WebSocketPair();
  const [client, webSocket] = Object.values(webSocketPair);

  webSocket.accept();

  let address = '';
  let portWithRandomLog = '';
  const log = (/** @type {string} */ info, /** @type {string | undefined} */ event) => {
    console.log(`[${address}:${portWithRandomLog}] ${info}`, event || '');
  };
  const earlyDataHeader = request.headers.get('sec-websocket-protocol') || '';

  const readableWebSocketStream = makeReadableWebSocketStream(webSocket, earlyDataHeader, log);

  /** @type {{ value: import("@cloudflare/workers-types").Socket | null}}*/
  let remoteSocketWapper = {
    value: null,
  };
  let udpStreamWrite = null;
  let isDns = false;
  // ws --> remote
  readableWebSocketStream
    .pipeTo(
      new WritableStream({
        async write(chunk, controller) {
          if (isDns && udpStreamWrite) {
            return udpStreamWrite(chunk);
          }
          if (remoteSocketWapper.value) {
            const writer = remoteSocketWapper.value.writable.getWriter();
            await writer.write(chunk);
            writer.releaseLock();
            return;
          }

          const {
            hasError,
            message,
            portRemote = 443,
            addressRemote = '',
            rawDataIndex,
            streamVersion = new Uint8Array([0, 0]),
            isUDP,
          } = processStreamHeader(chunk, userCode);

          address = addressRemote;
          portWithRandomLog = `${portRemote}--${Math.random()} ${isUDP ? 'udp ' : 'tcp '}`;

          if (hasError) {
            // controller.error(message);
            throw new Error(message); // cf seems has bug, controller.error will not end stream
            // webSocket.close(1000, message);
            return;
          }
          // if UDP but port not DNS port, close it
          if (isUDP) {
            if (portRemote === 53) {
              isDns = true;
            } else {
              // controller.error('UDP proxy only enable for DNS which is port 53');
              throw new Error('UDP proxy only enable for DNS which is port 53'); // cf seems has bug, controller.error will not end stream
              return;
            }
          }

          const streamResponseHeader = new Uint8Array([streamVersion[0], 0]);
          const rawClientData = chunk.slice(rawDataIndex);

          // TODO: support udp here when cf runtime has udp support
          if (isDns) {
            const { write } = await handleUDPOutBound(webSocket, streamResponseHeader, log);
            udpStreamWrite = write;
            udpStreamWrite(rawClientData);
            return;
          }
          handleTCPOutBound(
            remoteSocketWapper,
            addressRemote,
            portRemote,
            rawClientData,
            webSocket,
            streamResponseHeader,
            log,
          );
        },
        close() {
          log('readableWebSocketStream is close');
        },
        abort(reason) {
          log('readableWebSocketStream is abort', JSON.stringify(reason));
        },
      }),
    )
    .catch(err => {
      log('readableWebSocketStream pipeTo error', err);
    });

  return new Response(null, {
    status: 101,
    // @ts-ignore
    webSocket: client,
  });
}

/**
 *
 * @param {import("@cloudflare/workers-types").WebSocket} webSocketServer
 * @param {string} earlyDataHeader for ws 0rtt
 * @param {(info: string)=> void} log for ws 0rtt
 */
function makeReadableWebSocketStream(webSocketServer, earlyDataHeader, log) {
  let readableStreamCancel = false;
  const stream = new ReadableStream({
    start(controller) {
      webSocketServer.addEventListener('message', event => {
        if (readableStreamCancel) {
          return;
        }
        const message = event.data;
        controller.enqueue(message);
      });

      // The event means that the client closed the client -> server stream.
      // However, the server -> client stream is still open until you call close() on the server side.
      // The WebSocket protocol says that a separate close message must be sent in each direction to fully close the socket.
      webSocketServer.addEventListener('close', () => {
        safeCloseWebSocket(webSocketServer);
        if (readableStreamCancel) {
          return;
        }
        controller.close();
      });
      // client send close, need close server
      // if stream is cancel, skip controller.close
      webSocketServer.addEventListener('error', err => {
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

    pull(controller) {
      // if ws can stop read if stream is full, we can implement backpressure
      // https://streams.spec.whatwg.org/#example-rs-push-backpressure
    },

    cancel(reason) {
      // 1. pipe WritableStream has error, this cancel will called, so ws handle server close into here
      // 2. if readableStream is cancel, all controller.close/enqueue need skip,
      // 3. but from testing controller.error still work even if readableStream is cancel
      if (readableStreamCancel) {
        return;
      }
      log(`ReadableStream was canceled, due to ${reason}`);
      readableStreamCancel = true;
      safeCloseWebSocket(webSocketServer);
    },
  });

  return stream;
}

// https://xtls.github.io/development/protocols/vless.html
// https://github.com/zizifn/excalidraw-backup/blob/main/v2ray-protocol.excalidraw

/**
 *
 * @param { ArrayBuffer} vlessBuffer
 * @param {string} userID
 * @returns
 */
function processStreamHeader(chunk, userCode) {
  if (chunk.byteLength < 24) {
    return {
      hasError: true,
      message: 'invalid data',
    };
  }

  const version = new Uint8Array(chunk.slice(0, 1));
  let isValidUser = false;
  let isUDP = false;

  if (stringify(new Uint8Array(chunk.slice(1, 17))) === userCode) {
    isValidUser = true;
  }

  if (!isValidUser) {
    return {
      hasError: true,
      message: 'invalid user',
    };
  }

  const optLength = new Uint8Array(chunk.slice(17, 18))[0]; //skip opt for now
  const command = new Uint8Array(chunk.slice(18 + optLength, 18 + optLength + 1))[0];

  // 0x01 TCP
  // 0x02 UDP
  // 0x03 MUX
  if (command === 1) {
  } else if (command === 2) {
    isUDP = true;
  } else {
    return {
      hasError: true,
      message: `command ${command} is not supported`,
    };
  }

  const portIndex = 18 + optLength + 1;
  const portBuffer = chunk.slice(portIndex, portIndex + 2);
  const portRemote = new DataView(portBuffer).getUint16(0); // port is big-Endian in raw data etc 80 == 0x005d

  let addressIndex = portIndex + 2;
  const addressBuffer = new Uint8Array(chunk.slice(addressIndex, addressIndex + 1));
  // 1--> ipv4  addressLength =4
  // 2--> domain name addressLength=addressBuffer[1]
  // 3--> ipv6  addressLength =16
  const addressType = addressBuffer[0];
  let addressLength = 0;
  let addressValueIndex = addressIndex + 1;
  let addressValue = '';

  switch (addressType) {
    case 1:
      addressLength = 4;
      addressValue = new Uint8Array(
        chunk.slice(addressValueIndex, addressValueIndex + addressLength),
      ).join('.');
      break;
    case 2:
      addressLength = new Uint8Array(chunk.slice(addressValueIndex, addressValueIndex + 1))[0];
      addressValueIndex += 1;
      addressValue = new TextDecoder().decode(
        chunk.slice(addressValueIndex, addressValueIndex + addressLength),
      );
      break;
    case 3:
      addressLength = 16;
      const dataView = new DataView(
        chunk.slice(addressValueIndex, addressValueIndex + addressLength),
      );
      const ipv6 = []; // 2001:0db8:85a3:0000:0000:8a2e:0370:7334
      for (let i = 0; i < 8; i++) {
        ipv6.push(dataView.getUint16(i * 2).toString(16));
      }
      addressValue = ipv6.join(':');
      // seems no need add [] for ipv6
      break;
    default:
      return {
        hasError: true,
        message: `invalid addressType: ${addressType}`,
      };
  }

  if (!addressValue) {
    return {
      hasError: true,
      message: 'addressValue is empty',
    };
  }

  return {
    hasError: false,
    addressRemote: addressValue,
    addressType,
    portRemote,
    rawDataIndex: addressValueIndex + addressLength,
    streamVersion: version,
    isUDP,
  };
}

/**
 * Handles outbound TCP connections.
 *
 * @param {any} remoteSocket
 * @param {string} addressRemote The remote address to connect to.
 * @param {number} portRemote The remote port to connect to.
 * @param {Uint8Array} rawClientData The raw client data to write.
 * @param {import("@cloudflare/workers-types").WebSocket} webSocket The WebSocket to pass the remote socket to.
 * @param {Uint8Array} vlessResponseHeader The VLESS response header.
 * @param {function} log The logging function.
 * @returns {Promise<void>} The remote socket.
 */
async function handleTCPOutBound(
  remoteSocket,
  addressRemote,
  portRemote,
  rawClientData,
  webSocket,
  streamResponseHeader,
  log,
) {
  async function connectAndWrite(address, port) {
    /** @type {import("@cloudflare/workers-types").Socket} */
    const tcpSocket = connect({
      hostname: address,
      port: port,
    });
    remoteSocket.value = tcpSocket;
    log(`connected to ${address}:${port}`);
    const writer = tcpSocket.writable.getWriter();
    await writer.write(rawClientData); // first write, nomal is tls client hello
    writer.releaseLock();
    return tcpSocket;
  }
  // if the cf connect tcp socket have no incoming data, we retry to redirect ip
  async function retry() {
    const tcpSocket = await connectAndWrite(proxyIP || addressRemote, portRemote);
    // no matter retry success or not, close websocket
    tcpSocket.closed
      .catch(error => {
        console.log('retry tcpSocket closed error', error);
      })
      .finally(() => {
        safeCloseWebSocket(webSocket);
      });
    remoteSocketToWS(tcpSocket, webSocket, streamResponseHeader, null, log);
  }
  // when remoteSocket is ready, pass to websocket
  // remote--> ws
  const tcpSocket = await connectAndWrite(addressRemote, portRemote);
  remoteSocketToWS(tcpSocket, webSocket, streamResponseHeader, retry, log);
}

async function remoteSocketToWS(remoteSocket, webSocket, streamResponseHeader, retry, log) {
  let remoteChunkCount = 0;
  let chunks = [];
  let vlessHeader = streamResponseHeader;
  let hasIncomingData = false;

  await remoteSocket.readable
    .pipeTo(
      new WritableStream({
        start() {},
        async write(chunk, controller) {
          hasIncomingData = true;
          if (webSocket.readyState !== WS_READY_STATE_OPEN) {
            controller.error('webSocket is not open');
          }
          if (vlessHeader) {
            webSocket.send(await new Blob([vlessHeader, chunk]).arrayBuffer());
            vlessHeader = null;
          } else {
            webSocket.send(chunk);
          }
        },
        close() {
          log('remoteConnection readable close');
        },
        abort(reason) {
          console.error('remoteConnection readable abort', reason);
        },
      }),
    )
    .catch(error => {
      console.error('remoteSocketToWS has error', error.stack || error);
      safeCloseWebSocket(webSocket);
    });

  if (hasIncomingData === false && retry) {
    log('retry connection');
    retry();
  }
}

/**
 *
 * @param {import("@cloudflare/workers-types").WebSocket} webSocket
 * @param {ArrayBuffer} vlessResponseHeader
 * @param {(string)=> void} log
 */
async function handleUDPOutBound(webSocket, streamResponseHeader, log) {
  let isHeaderSent = false;

  const transformStream = new TransformStream({
    start(controller) {},
    transform(chunk, controller) {
      // udp message 2 byte is the the length of udp data
      // TODO: this should have bug, beacsue maybe udp chunk can be in two websocket message
      for (let index = 0; index < chunk.byteLength; ) {
        const lengthBuffer = chunk.slice(index, index + 2);
        const udpPakcetLength = new DataView(lengthBuffer).getUint16(0);
        const udpData = new Uint8Array(chunk.slice(index + 2, index + 2 + udpPakcetLength));
        index = index + 2 + udpPakcetLength;
        controller.enqueue(udpData);
      }
    },
    flush(controller) {},
  });

  // only handle dns udp for now
  transformStream.readable
    .pipeTo(
      new WritableStream({
        async write(chunk) {
          const resp = await fetch('https://1.1.1.1/dns-query', {
            method: 'POST',
            headers: {
              'content-type': 'application/dns-message',
            },
            body: chunk,
          });
          const dnsQueryResult = await resp.arrayBuffer();
          const udpSize = dnsQueryResult.byteLength;
          // console.log([...new Uint8Array(dnsQueryResult)].map((x) => x.toString(16)));
          const udpSizeBuffer = new Uint8Array([(udpSize >> 8) & 0xff, udpSize & 0xff]);

          if (webSocket.readyState === WS_READY_STATE_OPEN) {
            log(`dns query success, length: ${udpSize}`);
            if (isHeaderSent) {
              webSocket.send(await new Blob([udpSizeBuffer, dnsQueryResult]).arrayBuffer());
            } else {
              webSocket.send(
                await new Blob([streamResponseHeader, udpSizeBuffer, dnsQueryResult]).arrayBuffer(),
              );
              isHeaderSent = true;
            }
          }
        },
      }),
    )
    .catch(error => {
      log('dns query error: ' + error);
    });

  const writer = transformStream.writable.getWriter();

  return {
    /**
     *
     * @param {Uint8Array} chunk
     */
    write(chunk) {
      writer.write(chunk);
    },
  };
}

/**
 *
 * we are all REvil
 * @version 0.11.0 ()
 * @description This code is based on the js-sha256 project, with the addition of the SHA-224 hash algorithm implementation.
 * @author Chen, Yi-Cyuan [emn178@gmail.com][js-sha256]{@link https://github.com/emn178/js-sha256}
 */

function getDianaConfig(userCode, hostName) {
  const protocol = decodeSecure(ENCODED.PROTOCOL);
  const networkType = decodeSecure(ENCODED.NETWORK);
  const baseUrl = `${protocol}://${userCode}@${hostName}:443`;
  const commonParams =
    `encryption=none&host=${hostName}&type=${networkType}` + `&security=tls&sni=${hostName}`;

  const freedomConfig =
    `${baseUrl}?path=/api/v4&eh=Sec-WebSocket-Protocol` +
    `&ed=2560&${commonParams}&fp=chrome&alpn=h3#${hostName}`;

  const dreamConfig =
    `${baseUrl}?path=/api/v2?ed=2048&${commonParams}` +
    `&fp=firefox&alpn=h2,http/1.1#${hostName}`;

    const clashMetaFullUrl = `clash://install-config?url=${encodeURIComponent(
        `https://sub.victoriacross.ir/sub/clash-meta?url=${encodeURIComponent(freedomConfig)}&remote_config=&udp=truee&ss_uot=false&show_host=false&forced_ws0rtt=false`
        )}`;

  return `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400..800;1,400&display=swap" rel="stylesheet">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
    <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
    <title>VLESS Proxy Configuration</title>
    <style>
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }

      :root {
        /* Firebase Studio Inspired Palette */
        --background-primary: #121212; /* Darkest background */
        --background-secondary: #1E1E1E; /* Card/Container background */
        --background-tertiary: #2C2C2C; /* Input/Code block/Button background */
        --border-color: #383838;       /* Subtle borders */
        --border-color-hover: #555555; /* Border highlight on hover */
        --text-primary: #E0E0E0;       /* Main text */
        --text-secondary: #A0A0A0;     /* Subdued/Helper text */
        --text-accent: #FFFFFF;        /* Bright text/Headings */
        --accent-primary: #FFCA28;     /* Firebase Yellow/Orange Accent */
        --accent-primary-darker: #FFA000; /* Darker shade for interactions */
        --button-text-primary: #121212;   /* Text on accent background */
        --button-text-secondary: var(--text-primary); /* Text on dark buttons */
        --shadow-color: rgba(0, 0, 0, 0.4);
        --shadow-color-accent: rgba(255, 202, 40, 0.3); /* Accent shadow */
        --border-radius: 8px; /* Consistent rounding */
        --transition-speed: 0.2s;
      }

      body {
        font-family: "EB Garamond", serif;
        font-optical-sizing: auto;
        font-style: normal;
     /* font-family: 'inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; */
     /* font-family: "Google Sans", sans-serif; */
     /* font-family: 'Helvetica', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Inter', Arial, sans-serif; */
        background-color: var(--background-primary);
        color: var(--text-primary);
        padding: 24px;
        line-height: 1.5;
        font-weight: 600;
      }

      .container {
        max-width: 800px; /* Slightly wider */
        margin: 20px auto;
        padding: 0 16px; /* Add horizontal padding */
      }

      .header {
        text-align: center;
        margin-bottom: 40px;
      }

      .header h1 {
        font-weight: 1,400;
        color: var(--text-accent);
        font-size: 28px; /* Larger heading */
        margin-bottom: 8px;
      }

      .header p {
        color: var(--text-secondary);
        font-size: 14px;
      }

      .config-card {
        background: var(--background-secondary);
        border-radius: var(--border-radius);
        padding: 20px; /* Increased padding */
        margin-bottom: 24px;
        border: 1px solid var(--border-color);
        transition: border-color var(--transition-speed) ease;
      }

      .config-card:hover {
         /* Optional: subtle border highlight on card hover */
         /* border-color: var(--border-color-hover); */
      }

      .config-title {
        font-size: 18px; /* Larger title */
        font-weight: 500; /* Medium weight */
        color: var(--text-accent);
        margin-bottom: 16px;
        padding-bottom: 12px;
        border-bottom: 1px solid var(--border-color);
      }

      .config-content {
        position: relative;
        background: var(--background-tertiary);
        border-radius: var(--border-radius);
        padding: 16px;
        margin-bottom: 20px; /* Space below code block */
        border: 1px solid var(--border-color);
      }

      .config-content pre {
        overflow-x: auto;
        font-family: Cansolas, 'IBM Plex Mono', monospace;
        font-size: 13px; /* Slightly larger code font */
        font-weight: 400;
        line-height: 1.6; /* Increased line height for readability */
        color: var(--text-primary);
        margin: 0;
        white-space: pre-wrap;
        word-break: break-all;
      }

      .attributes {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); /* Adjust minmax */
        gap: 20px; /* Increased gap */
        margin-bottom: 16px;
        /* Removed background, border, padding - let card handle it */
      }

      .attribute {
        display: flex;
        flex-direction: column;
        gap: 4px; /* Space between label and value */
      }

      .attribute span {
        font-size: 13px;
        color: var(--text-secondary);
      }

      .attribute strong {
        font-size: 14px;
        font-weight: 500;
        color: var(--text-accent);
        word-break: break-all;
      }

      /* --- Button Styles --- */
      .button { /* Base button class */
        display: inline-flex; /* Use inline-flex for alignment */
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 8px 16px; /* Adjusted padding */
        border-radius: var(--border-radius);
        font-family: 'Inter', sans-serif;
        font-size: 14px;
        font-weight: 500;
        text-decoration: none;
        cursor: pointer;
        border: 1px solid var(--border-color);
        background-color: var(--background-tertiary);
        color: var(--button-text-secondary);
        transition: background-color var(--transition-speed) ease,
        border-color var(--transition-speed) ease,
        transform var(--transition-speed) ease,
        box-shadow var(--transition-speed) ease;
        -webkit-tap-highlight-color: transparent;
        touch-action: manipulation;
        user-select: none;
        -webkit-user-select: none;
        position: relative; /* Needed for potential pseudo-elements */
        overflow: hidden; /* For effects like ripples or shines */
      }

      .button:hover {
        background-color: #383838; /* Slightly lighter background on hover */
        border-color: var(--border-color-hover);
        transform: translateY(-1px); /* Subtle lift */
        box-shadow: 0 4px 8px var(--shadow-color); /* Subtle shadow */
      }

      .button:active {
        transform: translateY(0px) scale(0.98); /* Press down effect */
        box-shadow: none;
      }

      .button:focus-visible { /* Modern focus indicator */
         outline: 2px solid var(--accent-primary);
         outline-offset: 2px;
      }

      /* Specific Button: Copy Button */
      .copy-btn {
        position: absolute;
        top: 12px; /* Adjusted position */
        right: 12px;
        padding: 6px 12px; /* Smaller padding */
        font-size: 12px;
        font-family: 'IBM Plex Mono', monospace;
        font-weight: 500;
        /* Inherits base button styles, override specifics */
      }

      /* Specific Button: Client Buttons */
      .client-buttons {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); /* Wider min */
        gap: 12px;
        margin-top: 16px;
        /* Removed background, color - handled by card/buttons */
      }

      .client-btn {
         /* Inherits base .button styles */
         width: 100%; /* Make buttons fill grid cells */
      }

      .client-icon {
        width: 20px; /* Slightly larger icon container */
        height: 20px;
        border-radius: 4px;
        background-color: #3a3a3a; /* Slightly different icon bg */
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0; /* Prevent icon shrinking */
      }

      .client-icon svg {
         width: 14px; /* Adjust icon size within container */
         height: 14px;
         fill: var(--accent-primary); /* Use accent for icons */
      }

      .footer {
        text-align: center;
        margin-top: 40px; /* More space before footer */
        padding-bottom: 20px; /* Space at the very bottom */
        color: var(--text-secondary);
        font-size: 13px;
        font-weight: 400;
      }

      .footer p {
          margin-bottom: 4px;
      }

      /* --- Scrollbar Styles (Keep as is, they fit the dark theme) --- */
      ::-webkit-scrollbar {
        width: 8px;
        height: 8px;
      }
      ::-webkit-scrollbar-track {
        background: var(--background-primary);
        border-radius: 4px;
      }
      ::-webkit-scrollbar-thumb {
        background: var(--border-color); /* Use border color for thumb */
        border-radius: 4px;
        border: 2px solid var(--background-primary);
      }
      ::-webkit-scrollbar-thumb:hover {
        background: var(--border-color-hover); /* Lighter thumb on hover */
      }
      * {
        scrollbar-width: thin;
        scrollbar-color: var(--border-color) var(--background-primary);
      }

      /* --- Responsive Adjustments --- */
      @media (max-width: 768px) {
        body { padding: 16px; }
        .container { padding: 0 8px; }
        .header h1 { font-size: 24px; }
        .header p { font-size: 13px; }
        .config-card { padding: 16px; }
        .config-title { font-size: 16px; }
        .config-content pre { font-size: 12px; }
        .attributes { grid-template-columns: 1fr; gap: 16px; }
        .client-buttons { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); }
        .button { padding: 8px 12px; font-size: 13px; }
        .copy-btn { top: 10px; right: 10px; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-thumb { border-width: 1px; }
      }

      @media (max-width: 480px) {
        .client-buttons { grid-template-columns: 1fr; } /* Stack buttons */
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h1>VLESS Proxy Configuration</h1>
        <p>Copy the configuration or import directly into your client</p>
      </div>

      <!-- Proxy Info Card -->
      <div class="config-card">
        <div class="config-title">Proxy Information</div>
        <div class="attributes">
          <div class="attribute">
            <span>Proxy IP / Host:</span>
            <strong>${proxyIP}</strong>
          </div>
          <div class="attribute">
            <span>Status:</span>
            <strong>Active</strong>
          </div>
          </div>
      </div>

      <!-- Xray Core Clients -->
      <div class="config-card">
        <div class="config-title">Xray Core Clients (V2rayNG, Hiddify)</div>
        <div class="config-content">
          <button class="button copy-btn" onclick="copyToClipboard(this, '${dreamConfig}')">Copy</button>
          <pre>${dreamConfig}</pre>
        </div>
        <div class="client-buttons">
          <!-- Hiddify -->
          <a href="hiddify://install-config?url=${encodeURIComponent(freedomConfig)}" class="button client-btn">
            <div class="client-icon">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
            </div>
            Import to Hiddify
          </a>
          <!-- V2rayNG -->
          <a href="v2rayng://install-config?url=${encodeURIComponent(dreamConfig)}" class="button client-btn">
            <div class="client-icon">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                 <path d="M12 2L4 5v6c0 5.5 3.5 10.7 8 12.3 4.5-1.6 8-6.8 8-12.3V5l-8-3z" />
              </svg>
            </div>
            Import to V2rayNG
          </a>
        </div>
      </div>

      <!-- Sing-Box Core Clients -->
      <div class="config-card">
        <div class="config-title">Sing-Box Core Clients (Clash Meta, NekoBox)</div>
        <div class="config-content">
          <button class="button copy-btn" onclick="copyToClipboard(this, '${freedomConfig}')">Copy</button>
          <pre>${freedomConfig}</pre>
        </div>
        <div class="client-buttons">
          <!-- Clash Meta -->
          <a href="${clashMetaFullUrl}" class="button client-btn">
            <div class="client-icon">
               <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                  <path d="M4 4h16v16H4z" /> <path d="M10 10h4v4H10z" /> <path d="M14 8H10V4h4z" /> <path d="M4 14h4v4H4z" />
              </svg>
            </div>
            Import to Clash Meta
          </a>
          <!-- NekoBox -->
          <a href="clash://install-config?url=${encodeURIComponent(freedomConfig)}" class="button client-btn">
            <div class="client-icon">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                 <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
              </svg>
            </div>
            Import to NekoBox
          </a>
        </div>
      </div>
      <div class="footer">
        <p>© REvil ${new Date().getFullYear()} All right reserved. </p>
        <p>Secure. Private. Fast.</p>
      </div>
    </div>
    <script>
      function copyToClipboard(button, text) {
        navigator.clipboard.writeText(text).then(() => {
          const originalText = button.textContent;
          // Use accent color for feedback, consistent with Firebase style
          button.textContent = 'Copied!';
          button.style.backgroundColor = 'var(--accent-primary)';
          button.style.color = 'var(--button-text-primary)';
          button.style.borderColor = 'var(--accent-primary-darker)'; // Darker border for contrast
          button.disabled = true; // Disable briefly

          setTimeout(() => {
            button.textContent = originalText;
            // Restore original styles explicitly
            button.style.backgroundColor = 'var(--background-tertiary)';
            button.style.color = 'var(--button-text-secondary)';
            button.style.borderColor = 'var(--border-color)';
            button.disabled = false;
          }, 1200); // Slightly longer timeout
        }).catch(err => {
          console.error('Failed to copy text: ', err);
          // Optional: Provide visual feedback for error
          const originalText = button.textContent;
          button.textContent = 'Error';
          button.style.backgroundColor = '#D32F2F'; // Error color
          button.style.color = '#FFFFFF';
          button.style.borderColor = '#B71C1C';
          button.disabled = true;
           setTimeout(() => {
            button.textContent = originalText;
            button.style.backgroundColor = 'var(--background-tertiary)';
            button.style.color = 'var(--button-text-secondary)';
            button.style.borderColor = 'var(--border-color)';
            button.disabled = false;
          }, 1500);
        });
      }
      
      document.addEventListener('DOMContentLoaded', function () {
        const proxyIPElement = document.getElementById('proxyIP');
        if (proxyIPElement && proxyIPElement.innerText === '${proxyIP}') {
          proxyIPElement.innerText = '192.168.1.1'; // Default placeholder
        }
      });
    </script>
  </body>
</html>
`;
}

/**
 * this is not real UUID validation
 * @param {string} uuid
 */
function isValidUserCode(code) {
  const codeRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[4][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return codeRegex.test(code);
}

function base64ToArrayBuffer(base64Str) {
  if (!base64Str) {
    return { error: null };
  }
  try {
    base64Str = base64Str.replace(/-/g, '+').replace(/_/g, '/');
    const decode = atob(base64Str);
    const arryBuffer = Uint8Array.from(decode, c => c.charCodeAt(0));
    return { earlyData: arryBuffer.buffer, error: null };
  } catch (error) {
    return { error };
  }
}

const WS_READY_STATE_OPEN = 1;
const WS_READY_STATE_CLOSING = 2;
/**
 * normally, webSocket will not has exceptions when close.
 * @param {import("@cloudflare/workers-types").WebSocket} socket
 */
function safeCloseWebSocket(socket) {
  try {
    if (socket.readyState === WS_READY_STATE_OPEN || socket.readyState === WS_READY_STATE_CLOSING) {
      socket.close();
    }
  } catch (error) {
    console.error('safeCloseWebSocket error', error);
  }
}

const byteToHex = [];
for (let i = 0; i < 256; ++i) {
  byteToHex.push((i + 256).toString(16).slice(1));
}

function unsafeStringify(arr, offset = 0) {
  return (
    byteToHex[arr[offset + 0]] +
    byteToHex[arr[offset + 1]] +
    byteToHex[arr[offset + 2]] +
    byteToHex[arr[offset + 3]] +
    '-' +
    byteToHex[arr[offset + 4]] +
    byteToHex[arr[offset + 5]] +
    '-' +
    byteToHex[arr[offset + 6]] +
    byteToHex[arr[offset + 7]] +
    '-' +
    byteToHex[arr[offset + 8]] +
    byteToHex[arr[offset + 9]] +
    '-' +
    byteToHex[arr[offset + 10]] +
    byteToHex[arr[offset + 11]] +
    byteToHex[arr[offset + 12]] +
    byteToHex[arr[offset + 13]] +
    byteToHex[arr[offset + 14]] +
    byteToHex[arr[offset + 15]]
  ).toLowerCase();
}

function stringify(arr, offset = 0) {
  const uuid = unsafeStringify(arr, offset);
  if (!isValidUserCode(uuid)) {
    throw TypeError('Stringified UUID is invalid');
  }
  return uuid;
}
