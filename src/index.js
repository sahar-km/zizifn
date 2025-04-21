// Import static assets as raw text. The ?raw suffix is important.
// --- ADD PLACEHOLDERS ---
const panelTemplateHtml_PLACEHOLDER = "__PANEL_HTML_PLACEHOLDER__";
const panelCss_PLACEHOLDER = "__PANEL_CSS_PLACEHOLDER__";
const panelJs_PLACEHOLDER = "__PANEL_JS_PLACEHOLDER__";

// Import the connect API for creating outbound TCP sockets.
// This requires the 'connect' unsafe binding in wrangler.toml.
import { connect } from 'cloudflare:sockets';

// --- Constants ---
const VLESS_VERSION = 0; // VLESS protocol version
const VLESS_CMD = {
    TCP: 1,
    UDP: 2,
    MUX: 3, // Note: MUX is not supported in this script
};
const VLESS_ADDR_TYPE = {
    IPV4: 1,
    DOMAIN: 2,
    IPV6: 3,
};

const WS_READY_STATE = {
    CONNECTING: 0,
    OPEN: 1,
    CLOSING: 2,
    CLOSED: 3,
};

// --- Basic Encoding/Decoding Utilities ---
// Reverses the string and then applies base64 encoding.
function reverseBase64Encode(str) {
    try {
        return btoa(str.split('').reverse().join(''));
    } catch (e) {
        console.error("reverseBase64Encode failed:", e);
        return ""; // Return empty string on error
    }
}

// Decodes base64 and then reverses the string.
function reverseBase64Decode(encoded) {
    try {
        return atob(encoded).split('').reverse().join('');
    } catch (e) {
        console.error("reverseBase64Decode failed:", e);
        return ""; // Return empty string on error
    }
}

// Encoded constants using the reverse base64 functions
const ENCODED = {
    NETWORK: reverseBase64Encode('ws'),    // Should result in 'c3c='
    TYPE: reverseBase64Encode('diana'), // Should result in 'YW5haWQ='
    STREAM: reverseBase64Encode('stream'),// Should result in 'bWFlcnRz'
    PROTOCOL: reverseBase64Encode('vless'),// Should result in 'c3NlbHY='
};

// --- Configuration Variables ---
// These will be populated by getEnv() from environment variables or defaults.
let userID = 'DEFAULT_UUID';
let proxyIP = 'DEFAULT_PROXYIP';

// Default values (used if environment variables are not set)
const DEFAULT_UUID = '10e894da-61b1-4998-ac2b-e9ccb6af9d30'; // Your default UUID
const DEFAULT_PROXYIP = 'turk.radicalization.ir';         // Your default ProxyIP

// --- UUID Validation ---
/**
 * Checks if a string is a valid UUID v4.
 * @param {string} uuid The string to validate.
 * @returns {boolean} True if valid UUID v4, false otherwise.
 */
function isValidUUID(uuid) {
    if (!uuid) return false;
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[4][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
}

// --- Environment Variable Handling ---
/**
 * Reads configuration from environment variables or uses defaults.
 * Populates the global userID and proxyIP variables.
 * @param {Record<string, string>} env The environment object from the Worker context.
 */
function getEnv(env) {
    userID = env.UUID || DEFAULT_UUID;
    proxyIP = env.PROXYIP || DEFAULT_PROXYIP;

    if (!isValidUUID(userID)) {
        console.error(`Invalid UUID configured. Received: "${userID}". Falling back to default.`);
        userID = DEFAULT_UUID;
        // Optionally, you could throw an error here to prevent the Worker from starting with an invalid config
        // throw new Error(`Configured UUID is invalid: ${userID}`);
    }
    // Basic check for proxyIP format (rudimentary)
    if (typeof proxyIP !== 'string' || proxyIP.length === 0) {
        console.error(`Invalid PROXYIP configured. Received: "${proxyIP}". Falling back to default.`);
        proxyIP = DEFAULT_PROXYIP;
    }
}


// --- Main Worker Logic ---
export default {
    /**
     * Handles incoming requests.
     * @param {import("@cloudflare/workers-types").Request} request
     * @param {Record<string, string>} env Environment variables (like UUID, PROXYIP)
     * @param {import("@cloudflare/workers-types").ExecutionContext} ctx Execution context
     * @returns {Promise<Response>}
     */
    async fetch(request, env, ctx) {
        // Read configuration at the start of each request
        getEnv(env);

        try {
            const upgradeHeader = request.headers.get('Upgrade');

            if (upgradeHeader && upgradeHeader.toLowerCase() === 'websocket') {
                // Handle WebSocket upgrade requests
                console.log(`[WebSocket] Upgrading request from ${request.headers.get('CF-Connecting-IP')}`);
                return await handleWebSocketRequest(request);
            } else {
                // Handle regular HTTP requests (panel, info)
                const url = new URL(request.url);
                switch (url.pathname) {
                    case '/':
                        // Return Cloudflare request info and current config
                        const info = {
                            requestInfo: {
                                cf: request.cf,
                                headers: Object.fromEntries(request.headers),
                            },
                            workerConfig: {
                                userID: userID,
                                proxyIP: proxyIP,
                                encodedConstants: ENCODED
                            }
                        };
                        return new Response(JSON.stringify(info, null, 2), {
                            status: 200,
                            headers: { 'Content-Type': 'application/json;charset=utf-8' },
                        });

                    case `/${userID}`:
                        // Serve the configuration panel
                        const host = request.headers.get('Host') || proxyIP; // Use Host header or fallback to proxyIP
                        console.log(`[Panel] Serving panel for host: ${host}, UserID path matched.`);
                        const panelHtml = generateConfigPanel(userID, host, proxyIP);
                        return new Response(panelHtml, {
                            status: 200,
                            headers: { 'Content-Type': 'text/html;charset=utf-8' },
                        });

                    default:
                        console.log(`[HTTP] Not Found: ${url.pathname}`);
                        return new Response('Not found. Visit /<UUID> for config panel.', { status: 404 });
                }
            }
        } catch (err) {
            console.error("[Fetch Error] An error occurred:", err.stack || err);
            return new Response(err.message || 'Internal Server Error', { status: 500 });
        }
    },
};

// --- WebSocket Handling ---
/**
 * Handles the WebSocket connection after upgrade.
 * @param {import("@cloudflare/workers-types").Request} request The incoming request.
 * @returns {Promise<Response>} Response for the WebSocket upgrade.
 */
async function handleWebSocketRequest(request) {
    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);

    server.accept();
    console.log("[WebSocket] Accepted WebSocket connection.");

    let remoteSocketContext = {
        address: '',
        port: '',
        socket: null, // Holds the TCP socket
        webSocket: server, // Reference to the server WebSocket
        earlyData: null,
        streamId: Math.random().toString(36).substring(2, 8), // Simple random ID for logging
    };

    const log = (level, message, event = '') => {
        const time = new Date().toISOString();
        const addr = remoteSocketContext.address ? ` ${remoteSocketContext.address}:${remoteSocketContext.port}` : '';
        console.log(`[${time}] [${remoteSocketContext.streamId}${addr}] [${level}] ${message}`, event);
    };

    log('info', 'WebSocket stream initiated.');

    // Handle potential early data included in the upgrade request
    const earlyDataHeader = request.headers.get('sec-websocket-protocol') || '';
    try {
        const { earlyData, error } = decodeBase64ToArrayBuffer(earlyDataHeader);
        if (error) {
            log('warn', 'Failed to decode early data header:', error);
        } else if (earlyData) {
            remoteSocketContext.earlyData = earlyData;
            log('info', `Processed ${earlyData.byteLength} bytes of early data.`);
        }
    } catch (e) {
        log('error', 'Error processing early data header:', e);
    }


    const readableStream = createReadableWebSocketStream(server, remoteSocketContext.earlyData, log);

    let remoteConnection = {
        value: null // To hold the established TCP or UDP connection/handler
    };
    let udpWrite = null;
    let isDns = false;

    readableStream
        .pipeTo(new WritableStream({
            async write(chunk, controller) {
                try {
                    if (isDns && udpWrite) {
                        log('debug', `Forwarding UDP chunk (${chunk.byteLength} bytes) to DNS handler.`);
                        return udpWrite(chunk);
                    }

                    if (remoteConnection.value) {
                        log('debug', `Forwarding TCP chunk (${chunk.byteLength} bytes) to remote.`);
                        const writer = remoteConnection.value.writable.getWriter();
                        await writer.write(chunk);
                        writer.releaseLock();
                        return;
                    }

                    // First chunk processing: VLESS header
                    log('debug', `Processing first chunk (${chunk.byteLength} bytes) for VLESS header.`);
                    const {
                        hasError,
                        errorMsg = 'Unknown error processing header',
                        addressRemote = '',
                        portRemote = 443,
                        rawDataIndex = 0,
                        vlessVersion = new Uint8Array([VLESS_VERSION, 0]), // Use VLESS_VERSION constant
                        isUDP,
                    } = processVlessHeader(chunk, userID);

                    if (hasError) {
                        log('error', `VLESS Header Error: ${errorMsg}. Closing WebSocket.`);
                        server.close(1008, `VLESS Header Error: ${errorMsg}`);
                        throw new Error(errorMsg); // Abort the stream
                    }

                    remoteSocketContext.address = addressRemote;
                    remoteSocketContext.port = portRemote;
                    const connectionType = isUDP ? 'UDP' : 'TCP';
                    log('info', `Header processed: Target ${addressRemote}:${portRemote} (${connectionType})`);

                    if (isUDP) {
                        if (portRemote === 53) {
                            isDns = true;
                            log('info', 'UDP target is port 53. Initializing DNS handler.');
                        } else {
                            const msg = 'UDP proxying is only enabled for DNS (port 53).';
                            log('warn', msg);
                            server.close(1008, msg);
                            throw new Error(msg); // Abort the stream
                        }
                    }

                    // Prepare VLESS response header (Version: 0, No Error)
                    const vlessResponseHeader = new Uint8Array([vlessVersion[0], 0]);
                    const rawClientData = chunk.slice(rawDataIndex);
                    log('debug', `Sliced ${rawClientData.byteLength} bytes of initial client data.`);

                    if (isDns) {
                        // Handle UDP (DNS only)
                        const { write } = await handleUdpProxy(server, vlessResponseHeader, log);
                        udpWrite = write; // Assign the write function for subsequent UDP chunks
                        if (rawClientData.byteLength > 0) {
                             log('debug', `Writing initial UDP data (${rawClientData.byteLength} bytes) to DNS handler.`);
                             udpWrite(rawClientData); // Write initial data if any
                        }
                        // No remoteConnection.value is set for UDP
                    } else {
                        // Handle TCP
                        log('info', `Establishing TCP connection to ${addressRemote}:${portRemote}`);
                        await handleTcpProxy(
                            remoteConnection, // Pass the wrapper object
                            addressRemote,
                            portRemote,
                            rawClientData,
                            server,
                            vlessResponseHeader,
                            log
                        );
                         log('debug', 'TCP handler initiated.');
                    }

                } catch (err) {
                     log('error', 'Error in WritableStream write:', err.stack || err);
                     controller.error(err); // Propagate the error to abort the stream
                     safeCloseWebSocket(server, 1011, 'Internal stream error');
                }
            },
            close() {
                log('info', 'Client WebSocket stream closed.');
                // Ensure remote connection is closed if it exists
                 if (remoteConnection.value && remoteConnection.value.close) {
                    log('debug', 'Closing remote TCP socket due to client stream close.');
                    remoteConnection.value.close().catch(e => log('warn', 'Error closing remote TCP socket on client close:', e));
                }
            },
            abort(reason) {
                log('warn', 'Client WebSocket stream aborted:', reason);
                // Ensure remote connection is closed if it exists
                if (remoteConnection.value && remoteConnection.value.abort) {
                    log('debug', 'Aborting remote TCP socket due to client stream abort.');
                    remoteConnection.value.abort(reason).catch(e => log('warn', 'Error aborting remote TCP socket on client abort:', e));
                }
            },
        }),
        { signal: createAbortControllerOnClose(server, log).signal } // Abort pipe if WebSocket closes unexpectedly
    )
    .catch(err => {
        log('error', 'WebSocket readableStream pipeTo error:', err.stack || err);
        safeCloseWebSocket(server, 1011, 'Pipe error');
    });

    // Return the response upgrading the connection
    return new Response(null, {
        status: 101,
        webSocket: client, // Return the client side of the pair to the runtime
    });
}


// --- WebSocket Stream Utilities ---

/**
 * Creates an AbortController that automatically aborts when the WebSocket closes or errors.
 * @param {WebSocket} webSocket The WebSocket instance.
 * @param {Function} log Logging function.
 * @returns {AbortController}
 */
function createAbortControllerOnClose(webSocket, log) {
    const abortController = new AbortController();
    const listenerOptions = { once: true, passive: true };

    const onCloseOrError = (event) => {
        const reason = event instanceof CloseEvent ? `WebSocket closed: code=${event.code}, reason=${event.reason}` : `WebSocket error: ${event.message || 'Unknown error'}`;
        log('debug', `AbortController triggered due to WebSocket ${event.type}:`, reason);
        abortController.abort(new Error(reason));
        // Remove the other listener to avoid race conditions or double logs
        webSocket.removeEventListener('close', onCloseOrError);
        webSocket.removeEventListener('error', onCloseOrError);
    };

    webSocket.addEventListener('close', onCloseOrError, listenerOptions);
    webSocket.addEventListener('error', onCloseOrError, listenerOptions);

    return abortController;
}


/**
 * Creates a ReadableStream from a WebSocket server connection.
 * Handles incoming messages, close, and error events.
 * Includes optional early data.
 * @param {import("@cloudflare/workers-types").WebSocket} webSocketServer The server-side WebSocket.
 * @param {ArrayBuffer | null} earlyData Optional early data to enqueue first.
 * @param {(level: string, message: string, event?: any) => void} log Logging function.
 * @returns {ReadableStream<Uint8Array>}
 */
function createReadableWebSocketStream(webSocketServer, earlyData, log) {
    let streamCancelled = false;
    const stream = new ReadableStream({
        start(controller) {
            log('debug', 'ReadableWebSocketStream started.');

            // Enqueue early data if available
            if (earlyData) {
                log('debug', `Enqueuing ${earlyData.byteLength} bytes of early data into stream.`);
                controller.enqueue(new Uint8Array(earlyData));
            }

            webSocketServer.addEventListener('message', (event) => {
                if (streamCancelled) {
                    log('debug', 'Stream cancelled, ignoring incoming WebSocket message.');
                    return;
                }
                const message = event.data;
                log('debug', `WebSocket message received (${message.byteLength || message.length} bytes), enqueuing.`);
                // Ensure data is ArrayBuffer or Uint8Array
                if (message instanceof ArrayBuffer) {
                    controller.enqueue(new Uint8Array(message));
                } else if (typeof message === 'string') {
                     // This shouldn't happen with VLESS, but handle just in case
                     log('warn', 'Received string message, encoding to Uint8Array.');
                     controller.enqueue(new TextEncoder().encode(message));
                } else if (message instanceof Blob) {
                    // If Cloudflare ever sends Blobs, handle them
                    log('debug', 'Received Blob message, converting to ArrayBuffer.');
                    message.arrayBuffer().then(buffer => {
                         if (!streamCancelled) controller.enqueue(new Uint8Array(buffer));
                    }).catch(err => {
                         log('error', 'Error converting Blob message to ArrayBuffer:', err);
                         controller.error(err);
                         safeCloseWebSocket(webSocketServer, 1011, 'Blob processing error');
                    });
                } else {
                     log('warn', 'Received unexpected message type:', typeof message);
                     controller.enqueue(new Uint8Array(message)); // Try enqueuing anyway
                }
            });

            webSocketServer.addEventListener('close', (event) => {
                log('info', `WebSocket closed by client: code=${event.code}, reason=${event.reason}`);
                safeCloseWebSocket(webSocketServer); // Ensure our side is closed too
                if (!streamCancelled) {
                    log('debug', 'Closing readable stream due to WebSocket close.');
                    controller.close();
                }
            });

            webSocketServer.addEventListener('error', (err) => {
                log('error', 'WebSocket error event:', err);
                if (!streamCancelled) {
                    controller.error(err);
                }
                // No need to call safeCloseWebSocket here, 'close' event usually follows 'error'
            });
        },

        pull(controller) {
            // Implement backpressure if needed and possible with WebSockets
            log('debug', 'ReadableStream pull requested.');
        },

        cancel(reason) {
            log('warn', `ReadableStream cancelled. Reason: ${reason}`);
            streamCancelled = true;
            // WebSocket might already be closing/closed, but ensure it is.
            safeCloseWebSocket(webSocketServer, 1001, 'Stream cancelled');
        },
    });

    return stream;
}


// --- VLESS Protocol Processing ---
/**
 * Processes the VLESS header from the initial data chunk.
 * @param {ArrayBuffer} chunk The data chunk containing the header.
 * @param {string} expectedUserID The expected UUID string.
 * @returns {object} Parsed header information or error status.
 */
function processVlessHeader(chunk, expectedUserID) {
    const buffer = new Uint8Array(chunk);
    const dataView = new DataView(buffer.buffer);

    // Minimum length: 1 (version) + 16 (UUID) + 1 (opt len) + 1 (cmd) + 2 (port) + 1 (addr type) + 1 (addr len/min addr)
    if (buffer.byteLength < 23) {
        return { hasError: true, errorMsg: `Invalid VLESS header length: ${buffer.byteLength}` };
    }

    // 1. Version (1 byte)
    const version = buffer.slice(0, 1);
    if (version[0] !== VLESS_VERSION) {
         // Allow only VLESS_VERSION (0) for now
         // You could potentially support other versions if needed.
        return { hasError: true, errorMsg: `Unsupported VLESS version: ${version[0]}` };
    }

    // 2. User ID (16 bytes)
    let userIDBytes;
    try {
        userIDBytes = buffer.slice(1, 17);
        const userIDString = uuidBytesToString(userIDBytes);
        if (userIDString.toLowerCase() !== expectedUserID.toLowerCase()) {
            return { hasError: true, errorMsg: 'Invalid User ID' };
        }
    } catch (err) {
         return { hasError: true, errorMsg: `Failed to parse User ID: ${err.message}` };
    }


    // 3. AddonOptions Length (1 byte)
    const addonLen = buffer[17];
    let currentIndex = 18 + addonLen; // Skip addons for now

    if (currentIndex + 1 > buffer.byteLength) {
        return { hasError: true, errorMsg: 'Invalid header: insufficient length after addons' };
    }

    // 4. Command (1 byte)
    const command = buffer[currentIndex];
    let isUDP = false;
    if (command === VLESS_CMD.TCP) {
        // TCP request
    } else if (command === VLESS_CMD.UDP) {
        isUDP = true;
    } else if (command === VLESS_CMD.MUX) {
        return { hasError: true, errorMsg: 'MUX command (0x03) is not supported' };
    } else {
        return { hasError: true, errorMsg: `Unsupported command: ${command}` };
    }
    currentIndex++;

    // 5. Port (2 bytes, Big Endian)
    if (currentIndex + 2 > buffer.byteLength) {
        return { hasError: true, errorMsg: 'Invalid header: insufficient length for port' };
    }
    const portRemote = dataView.getUint16(currentIndex, false); // false = Big Endian
    currentIndex += 2;

    // 6. Address Type (1 byte)
    if (currentIndex + 1 > buffer.byteLength) {
        return { hasError: true, errorMsg: 'Invalid header: insufficient length for address type' };
    }
    const addressType = buffer[currentIndex];
    currentIndex++;

    // 7. Address
    let addressRemote = '';
    let addressLength = 0;

    try {
        switch (addressType) {
            case VLESS_ADDR_TYPE.IPV4: // IPv4
                addressLength = 4;
                if (currentIndex + addressLength > buffer.byteLength) throw new Error('Insufficient length for IPv4 address');
                addressRemote = buffer.slice(currentIndex, currentIndex + addressLength).join('.');
                break;
            case VLESS_ADDR_TYPE.DOMAIN: // Domain name
                if (currentIndex + 1 > buffer.byteLength) throw new Error('Insufficient length for domain length');
                addressLength = buffer[currentIndex]; // Length of domain
                currentIndex++;
                if (currentIndex + addressLength > buffer.byteLength) throw new Error('Insufficient length for domain name');
                addressRemote = new TextDecoder().decode(buffer.slice(currentIndex, currentIndex + addressLength));
                break;
            case VLESS_ADDR_TYPE.IPV6: // IPv6
                addressLength = 16;
                if (currentIndex + addressLength > buffer.byteLength) throw new Error('Insufficient length for IPv6 address');
                const ipv6Bytes = buffer.slice(currentIndex, currentIndex + addressLength);
                const ipv6Segments = [];
                for (let i = 0; i < 8; i++) {
                    ipv6Segments.push(dataView.getUint16(currentIndex + i * 2, false).toString(16));
                }
                addressRemote = ipv6Segments.join(':');
                // Note: Cloudflare connect() API expects IPv6 without brackets
                break;
            default:
                return { hasError: true, errorMsg: `Invalid address type: ${addressType}` };
        }
    } catch (err) {
        return { hasError: true, errorMsg: `Error parsing address: ${err.message}` };
    }


    currentIndex += addressLength;

    if (!addressRemote) {
        return { hasError: true, errorMsg: 'Parsed address is empty' };
    }

    return {
        hasError: false,
        addressRemote,
        portRemote,
        addressType,
        rawDataIndex: currentIndex, // Index where the actual payload data starts
        vlessVersion: version,
        isUDP,
    };
}


// --- TCP Proxying ---
/**
 * Handles TCP proxying: connects to the target, pipes data between WebSocket and TCP socket.
 * @param {object} remoteConnectionWrapper Wrapper object to store the TCP socket.
 * @param {string} addressRemote Target address.
 * @param {number} portRemote Target port.
 * @param {Uint8Array} initialClientData Initial data from the client.
 * @param {import("@cloudflare/workers-types").WebSocket} webSocket Client WebSocket.
 * @param {Uint8Array} vlessResponseHeader Header to send back on successful connection.
 * @param {(level: string, message: string, event?: any) => void} log Logging function.
 */
async function handleTcpProxy(
    remoteConnectionWrapper,
    addressRemote,
    portRemote,
    initialClientData,
    webSocket,
    vlessResponseHeader,
    log
) {
    let tcpSocket;

    /** Connects to the target and writes initial data. */
    async function connectAndWrite(address, port, isRetry = false) {
        const target = `${address}:${port}`;
        log('info', `${isRetry ? '[Retry] ' : ''}Attempting TCP connection to ${target}`);

        try {
            /** @type {import("@cloudflare/workers-types").Socket} */
            const socket = connect({ hostname: address, port: port });
            log('info', `${isRetry ? '[Retry] ' : ''}Successfully initiated TCP connection to ${target}`);
            remoteConnectionWrapper.value = socket; // Store the socket in the wrapper
            
            // Pipe data from TCP socket back to WebSocket
            pipeRemoteSocketToWebSocket(socket, webSocket, vlessResponseHeader, log);

             // Write initial client data (if any)
             if (initialClientData && initialClientData.byteLength > 0) {
                 log('debug', `Writing initial ${initialClientData.byteLength} bytes to ${target}`);
                 const writer = socket.writable.getWriter();
                 await writer.write(initialClientData);
                 writer.releaseLock();
                 log('debug', 'Initial data written successfully.');
             } else {
                 log('debug', 'No initial client data to write.');
             }
             
            return socket; // Return the established socket

        } catch (error) {
            log('error', `${isRetry ? '[Retry] ' : ''}TCP connection to ${target} failed:`, error.message || error);
            throw error; // Re-throw to be caught by the caller
        }
    }

    /** Pipes data from the remote TCP socket back to the client WebSocket. */
    async function pipeRemoteSocketToWebSocket(socket, ws, header, logger) {
        let headerSent = false;
        const remoteReader = socket.readable.getReader();
        const abortController = createAbortControllerOnClose(ws, logger); // Abort if WebSocket closes

        logger('debug', 'Starting pipe from remote TCP to WebSocket.');

        while (true) {
            if (abortController.signal.aborted) {
                 logger('warn', 'WebSocket closed or errored, aborting TCP read loop.');
                 remoteReader.cancel('WebSocket closed').catch(e => logger('warn', 'Error cancelling remote reader:', e));
                 break;
            }
            
            try {
                const { done, value } = await remoteReader.read();
                if (done) {
                    logger('info', 'Remote TCP connection closed by peer.');
                    break; // Exit loop, the writable stream below will handle closing the WS if needed
                }

                if (ws.readyState === WS_READY_STATE.OPEN) {
                    if (!headerSent && header) {
                        logger('debug', `Sending VLESS response header (${header.byteLength} bytes) and first data chunk (${value.byteLength} bytes).`);
                        ws.send(await new Blob([header, value]).arrayBuffer());
                        headerSent = true;
                    } else {
                         logger('debug', `Sending data chunk (${value.byteLength} bytes) from remote to WebSocket.`);
                        ws.send(value);
                    }
                } else {
                    logger('warn', `WebSocket is not open (state: ${ws.readyState}), cannot send data from remote. Aborting read loop.`);
                    remoteReader.cancel('WebSocket not open').catch(e => logger('warn', 'Error cancelling remote reader:', e));
                    break;
                }
            } catch (error) {
                logger('error', 'Error reading from remote TCP socket:', error.stack || error);
                safeCloseWebSocket(ws, 1011, 'Remote read error');
                remoteReader.cancel('Read error').catch(e => logger('warn', 'Error cancelling remote reader:', e));
                break;
            }
        }
        logger('debug', 'Finished pipe from remote TCP to WebSocket.');
        // Don't close the WebSocket here, let the client close it or the other pipe handle it.
    }

    // --- Retry Logic ---
    // Define the retry mechanism if the initial connection doesn't receive data quickly.
    // This is a specific strategy; adjust timeouts and conditions as needed.
    // Note: This retry logic based on *receiving* data might not always be the best approach.
    // A simpler approach might be to just try proxyIP if the initial connection fails.
    async function attemptConnectionWithRetry() {
        try {
            tcpSocket = await connectAndWrite(addressRemote, portRemote);

            // Optional: Implement a timeout to check for incoming data
            // This adds complexity. Consider if it's truly necessary.
            // For simplicity, the current implementation doesn't explicitly wait/timeout for data.
            // The pipeRemoteSocketToWebSocket function handles sending the header with the first data chunk.

        } catch (initialError) {
            log('warn', `Initial connection to ${addressRemote}:${portRemote} failed. Trying proxyIP: ${proxyIP}.`);
            if (proxyIP && proxyIP.toLowerCase() !== addressRemote.toLowerCase()) {
                try {
                    tcpSocket = await connectAndWrite(proxyIP, portRemote, true); // isRetry = true
                } catch (retryError) {
                    log('error', `Retry connection to proxyIP ${proxyIP}:${portRemote} also failed. Closing WebSocket.`);
                    safeCloseWebSocket(webSocket, 1011, 'Connection failed');
                    throw retryError; // Propagate the final error
                }
            } else {
                 log('error', 'No valid proxyIP to retry or proxyIP is the same as target. Closing WebSocket.');
                 safeCloseWebSocket(webSocket, 1011, 'Connection failed');
                 throw initialError; // Propagate the initial error
            }
        }
    }

    // Execute the connection attempt (with potential retry logic)
    await attemptConnectionWithRetry();
}


// --- UDP Proxying (DNS Only) ---
/**
 * Handles UDP proxying specifically for DNS queries over DoH.
 * @param {import("@cloudflare/workers-types").WebSocket} webSocket Client WebSocket.
 * @param {Uint8Array} vlessResponseHeader Header to send back with the first response.
 * @param {(level: string, message: string, event?: any) => void} log Logging function.
 * @returns {Promise<{write: function(Uint8Array): Promise<void>}>} Returns an object with a write function.
 */
async function handleUdpProxy(webSocket, vlessResponseHeader, log) {
    let isHeaderSent = false;
    const dohEndpoint = 'https://1.1.1.1/dns-query'; // Or make this configurable via env var

    log('info', `Initializing UDP proxy via DoH endpoint: ${dohEndpoint}`);

    // The VLESS UDP protocol frames each UDP packet with a 2-byte length prefix.
    // We need to parse these frames.
    const processUdpFrame = async (chunk) => {
        // Assume chunk contains one or more complete VLESS UDP frames
        // Format: [2-byte length][UDP payload][2-byte length][UDP payload]...
        let currentIndex = 0;
        while (currentIndex < chunk.byteLength) {
            if (currentIndex + 2 > chunk.byteLength) {
                log('warn', `Incomplete UDP length header received. Remainder: ${chunk.byteLength - currentIndex} bytes.`);
                break; // Not enough data for length
            }
            const dataView = new DataView(chunk.buffer, chunk.byteOffset);
            const udpPayloadLength = dataView.getUint16(currentIndex, false); // Big Endian
            currentIndex += 2;

            if (currentIndex + udpPayloadLength > chunk.byteLength) {
                log('warn', `Incomplete UDP payload data. Expected: ${udpPayloadLength}, Available: ${chunk.byteLength - currentIndex}.`);
                // Handle partial data if necessary (e.g., buffer it) - complex!
                // For now, we assume full frames per WebSocket message.
                break;
            }

            const udpPayload = chunk.slice(currentIndex, currentIndex + udpPayloadLength);
            currentIndex += udpPayloadLength;

            log('debug', `Processing UDP frame. Payload size: ${udpPayloadLength} bytes.`);

            // Send DNS query via DoH
            try {
                 log('info', `Sending DNS query (${udpPayload.byteLength} bytes) to ${dohEndpoint}`);
                 const response = await fetch(dohEndpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/dns-message',
                        'Accept': 'application/dns-message',
                    },
                    body: udpPayload,
                });

                if (!response.ok) {
                    log('error', `DoH query failed: ${response.status} ${response.statusText}`);
                    // Decide how to handle DoH errors - maybe close or ignore?
                    continue; // Process next frame if any
                }

                const dohResult = await response.arrayBuffer();
                log('info', `Received DoH response (${dohResult.byteLength} bytes).`);

                if (webSocket.readyState === WS_READY_STATE.OPEN) {
                    const resultLength = dohResult.byteLength;
                    const lengthBuffer = new Uint8Array(2);
                    const lengthView = new DataView(lengthBuffer.buffer);
                    lengthView.setUint16(0, resultLength, false); // Big Endian

                    const messageParts = [];
                    if (!isHeaderSent) {
                        messageParts.push(vlessResponseHeader);
                        isHeaderSent = true;
                        log('debug', 'Sending VLESS UDP response header.');
                    }
                    messageParts.push(lengthBuffer); // Add length prefix
                    messageParts.push(new Uint8Array(dohResult)); // Add payload

                    const messageToSend = await new Blob(messageParts).arrayBuffer();
                     log('debug', `Sending UDP response frame to client (${messageToSend.byteLength} bytes total).`);
                    webSocket.send(messageToSend);

                } else {
                    log('warn', 'WebSocket closed before DNS response could be sent.');
                    break; // Stop processing frames if WS is closed
                }

            } catch (error) {
                log('error', 'Error during DoH request or processing:', error.stack || error);
                // Decide how to handle fetch errors
            }
        }
    };

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


// --- Panel Generation ---
/**
 * Generates the HTML content for the configuration panel.
 * @param {string} currentUserID The active User ID.
 * @param {string} hostName The requested hostname.
 * @param {string} currentProxyIP The active Proxy IP.
 * @returns {string} The full HTML page content.
 */

function generateConfigPanel(currentUserID, hostName, currentProxyIP) {
    // --- Get the raw content placeholders ---
    const panelCss = panelCss_PLACEHOLDER;
    const panelJs = panelJs_PLACEHOLDER;
    const panelTemplateHtml = panelTemplateHtml_PLACEHOLDER; // Raw body HTML

    // Basic check if placeholders were replaced by the build script
    if (panelCss.startsWith("__PANEL_") || panelJs.startsWith("__PANEL_") || panelTemplateHtml.startsWith("__PANEL_")) {
        console.error("ERROR: Panel content placeholders were not replaced during build!");
        return "<html><body>Internal Server Error: Panel build failed.</body></html>";
    }

    // --- Prepare the dynamic values (Configs, URLs, etc.) ---
    const protocol = reverseBase64Decode(ENCODED.PROTOCOL);
    const networkType = reverseBase64Decode(ENCODED.NETWORK);
    if (!protocol || !networkType) {
        console.error("Failed to decode protocol or network type constants.");
        return "<html><body>Error generating configuration: Invalid constants.</body></html>";
    }

    const baseUrl = `${protocol}://${currentUserID}@${hostName}:443`;

    // Common parameters, ensure hostName is URL-encoded if it contains special chars, though unlikely for a host.
    const commonParams = `encryption=none&host=${encodeURIComponent(hostName)}&type=${networkType}&security=tls&sni=${encodeURIComponent(hostName)}`;

    // Config for Sing-Box core clients (e.g., Hiddify, NekoBox, Exclave, Husi, Nekoray)
    // ed=2560 and path=/assets are examples, adjust if needed
    const freedomConfig = `${baseUrl}?path=/assets&encryption=none&security=tls&sni=${encodeURIComponent(hostName)}&fp=chrome&type=ws&host=${encodeURIComponent(hostName)}&alpn=h3#${encodeURIComponent(hostName)}`;

    // Config for Xray core clients (e.g., v2rayNG, Mahsa/NikaNG, Streisand, v2rayN pro)
    // path=/api/v8?ed=2560 are examples, adjust if needed
    const dreamConfig = `${baseUrl}?path=/api/v8?ed=2560&${commonParams}&fp=randomized&alpn=h2,http/1.1#${encodeURIComponent(hostName)}`;
    
    // URL encode the full config for use in URLs
    const freedomConfigEncoded = encodeURIComponent(freedomConfig);
    const dreamConfigEncoded = encodeURIComponent(dreamConfig);

    // Construct URLs for client import links
    const clashMetaConverterBase = 'https://sub.victoriacross.ir/sub/clash-meta'; // project source: https://github.com/sahar-km/EdgeSub
    const clashMetaParams = new URLSearchParams({
        url: freedomConfig, // Pass the raw VLESS URL
        remote_config: '',
        udp: 'true',
        ss_uot: 'false',
        show_host: 'false',
        forced_ws0rtt: 'false', // Assuming 0rtt is handled by ed parameter? Check converter logic.
    });
    const clashMetaFullUrl = `clash://install-config?url=${encodeURIComponent(`${clashMetaConverterBase}?${clashMetaParams.toString()}`)}`;
    
    const nekoBoxConverterBase = 'https://sahar-km.github.io/arcane/'; // project source: https://github.com/sahar-km/Arcane
    const nekoBoxImportUrl = `${nekoBoxConverterBase}${btoa(freedomConfig)}`; // Base64 encode the VLESS URL

    const hiddifyImportUrl = `hiddify://install-config?url=${freedomConfigEncoded}`;
    const v2rayNGImportUrl = `v2rayng://install-config?url=${dreamConfigEncoded}`;


    // --- Process the body HTML (Replace placeholders in the raw body template) ---
    // Perform ALL replacements on the panelTemplateHtml and store in processedPanelBody
    let processedPanelBody = panelTemplateHtml // Start with the raw body HTML content
        .replace(/{{PROXY_IP}}/g, currentProxyIP || 'N/A')
        .replace(/{{HOST_NAME}}/g, hostName || 'N/A')
        .replace(/{{USER_ID}}/g, currentUserID)
        .replace(/{{DREAM_CONFIG}}/g, dreamConfig) // For display in <pre>
        .replace(/{{FREEDOM_CONFIG}}/g, freedomConfig) // For display in <pre>
        // For JS copy function, escape potential single quotes in configs
        .replace(/'{{DREAM_CONFIG_RAW}}'/g, `'${dreamConfig.replace(/'/g, "\\'")}'`)
        .replace(/'{{FREEDOM_CONFIG_RAW}}'/g, `'${freedomConfig.replace(/'/g, "\\'")}'`)
        // URLs for import buttons
        .replace(/{{HIDDIFY_URL}}/g, hiddifyImportUrl)
        .replace(/{{V2RAYNG_URL}}/g, v2rayNGImportUrl)
        .replace(/{{CLASH_META_URL}}/g, clashMetaFullUrl)
        .replace(/{{NEKOBOX_URL}}/g, nekoBoxImportUrl)
        .replace(/{{YEAR}}/g, new Date().getFullYear());

    // --- Construct the Full HTML Document ---
    // Inject the CSS, the *processed* body content, and the JS
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
${processedPanelBody} {/* <--- USE processedPanelBody HERE */}
    <script>
${panelJs}
    </script>
</body>
</html>
`;
    return fullHtml.trim();
}

// ... (Rest of your code: export default, handleWebSocketRequest, etc.) ...

// --- Helper Functions ---

/**
 * Safely closes a WebSocket connection.
 * @param {import("@cloudflare/workers-types").WebSocket} socket The WebSocket to close.
 * @param {number} [code=1000] The close code.
 * @param {string} [reason='Closing'] The close reason.
 */
function safeCloseWebSocket(socket, code = 1000, reason = 'Closing') {
    try {
        if (socket && (socket.readyState === WS_READY_STATE.OPEN || socket.readyState === WS_READY_STATE.CLOSING)) {
            console.log(`[WebSocket] Closing WebSocket: code=${code}, reason=${reason}`);
            socket.close(code, reason);
        }
    } catch (error) {
        console.error('[WebSocket] Error closing WebSocket:', error);
    }
}

/**
 * Decodes a base64 string (URL-safe variants allowed) to an ArrayBuffer.
 * @param {string} base64Str The base64 string.
 * @returns {{earlyData: ArrayBuffer | null, error: Error | null}}
 */
function decodeBase64ToArrayBuffer(base64Str) {
    if (!base64Str) {
        return { earlyData: null, error: null };
    }
    try {
        // Replace URL-safe characters with standard base64 characters
        let base64 = base64Str.replace(/-/g, '+').replace(/_/g, '/');
        // Pad string with '=' to make its length a multiple of 4
        while (base64.length % 4) {
             base64 += '=';
        }
        const decodedStr = atob(base64);
        const buffer = new Uint8Array(decodedStr.length);
        for (let i = 0; i < decodedStr.length; i++) {
            buffer[i] = decodedStr.charCodeAt(i);
        }
        return { earlyData: buffer.buffer, error: null };
    } catch (error) {
        console.error("decodeBase64ToArrayBuffer failed:", error);
        return { earlyData: null, error: error };
    }
}


// --- UUID Byte Conversion ---
const byteToHex = [];
for (let i = 0; i < 256; ++i) {
    byteToHex.push((i + 256).toString(16).slice(1));
}

/**
 * Converts UUID bytes (Uint8Array) to a string format.
 * Performs basic validation after conversion.
 * @param {Uint8Array} arr UUID bytes (must be 16 bytes).
 * @param {number} [offset=0] Offset in the array.
 * @returns {string} The UUID string.
 * @throws {TypeError} If the input array is not 16 bytes or the resulting string is not a valid UUID.
 */
function uuidBytesToString(arr, offset = 0) {
     if (arr.byteLength !== 16) {
         throw new TypeError(`Input array must be 16 bytes long, got ${arr.byteLength}`);
     }
    // String conversion logic based on original code
    const uuid = (
        byteToHex[arr[offset + 0]] + byteToHex[arr[offset + 1]] + byteToHex[arr[offset + 2]] + byteToHex[arr[offset + 3]] + '-' +
        byteToHex[arr[offset + 4]] + byteToHex[arr[offset + 5]] + '-' +
        byteToHex[arr[offset + 6]] + byteToHex[arr[offset + 7]] + '-' +
        byteToHex[arr[offset + 8]] + byteToHex[arr[offset + 9]] + '-' +
        byteToHex[arr[offset + 10]] + byteToHex[arr[offset + 11]] + byteToHex[arr[offset + 12]] + byteToHex[arr[offset + 13]] + byteToHex[arr[offset + 14]] + byteToHex[arr[offset + 15]]
    ).toLowerCase();

    // Validate the generated string format
    if (!isValidUUID(uuid)) {
        // This indicates an issue with the input bytes or the conversion logic
        throw new TypeError('Converted byte array resulted in an invalid UUID format');
    }
    return uuid;
}
