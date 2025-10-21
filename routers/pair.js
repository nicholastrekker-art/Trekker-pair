const { giftedId, removeFile } = require('../lib');
const express = require('express');
const fs = require('fs');
require('dotenv').config();
const path = require('path');
const pino = require("pino");
const { Boom } = require('@hapi/boom');

let router = express.Router();

// Session storage for tracking active sessions
const sessionStorage = new Map();

// Import Baileys modules
const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    DisconnectReason,
    fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");

// Create logger with silent level for production
const logger = pino({ level: "silent" });

/**
 * Saves session credentials locally and returns base64 encoded session ID
 */
async function saveSessionLocallyFromPath(authDir) {
    const authPath = path.join(authDir, 'creds.json');
    try {
        if (!fs.existsSync(authPath)) {
            throw new Error(`Credentials file not found at: ${authPath}`);
        }

        const rawData = fs.readFileSync(authPath, 'utf8');
        const credsData = JSON.parse(rawData);
        const credsBase64 = Buffer.from(JSON.stringify(credsData)).toString('base64');

        const now = new Date();
        sessionStorage.set(credsBase64, {
            sessionId: credsBase64,
            credsData: credsBase64,
            createdAt: now,
            updatedAt: now
        });

        console.log('✅ Session saved to storage');
        return credsBase64;
    } catch (e) {
        console.error('❌ saveSessionLocallyFromPath error:', e.message);
        return null;
    }
}

/**
 * Sends welcome message with retry logic using a fresh socket connection
 * sendMessage is a FUNCTION on the socket object, not an event
 */
async function sendWelcomeMessageWithRetry(sessionId, maxAttempts = 3) {
    const sessionDir = path.join(__dirname, 'temp', `welcome_${giftedId()}`);
    let sock = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            console.log(`\n🔄 [ATTEMPT ${attempt}/${maxAttempts}] Starting welcome message delivery...`);

            // Decode session credentials
            const decodedCreds = JSON.parse(Buffer.from(sessionId, 'base64').toString('utf8'));
            console.log('📦 Session decoded successfully');

            // Extract owner JID
            const ownerJid = decodedCreds?.me?.id;
            if (!ownerJid) {
                throw new Error('Owner JID not found in credentials');
            }

            console.log('👤 Owner JID:', ownerJid);

            // Create temporary directory
            if (!fs.existsSync(sessionDir)) {
                fs.mkdirSync(sessionDir, { recursive: true });
            }

            // Write credentials to file
            const credsPath = path.join(sessionDir, 'creds.json');
            fs.writeFileSync(credsPath, JSON.stringify(decodedCreds, null, 2));
            console.log('💾 Credentials written to temp directory');

            await delay(2000);

            // Load auth state
            const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
            console.log('🔑 Auth state loaded');

            // Fetch latest Baileys version for compatibility
            const { version, isLatest } = await fetchLatestBaileysVersion();
            console.log(`📡 Using WA version: ${version.join('.')}, isLatest: ${isLatest}`);

            // Create WebSocket connection
            sock = makeWASocket({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, logger),
                },
                printQRInTerminal: false,
                logger,
                browser: Browsers.macOS("Safari"),
                markOnlineOnConnect: true,
                syncFullHistory: false,
                retryRequestDelayMs: 250,
                getMessage: async (key) => {
                    return { conversation: '' };
                },
                defaultQueryTimeoutMs: 60000,
            });

            console.log('🔌 Socket instance created, waiting for connection...');

            // Promise to handle connection lifecycle
            const result = await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    console.error(`❌ [ATTEMPT ${attempt}] Connection timeout`);
                    reject(new Error('Connection timeout'));
                }, 60000);

                const cleanup = () => {
                    clearTimeout(timeout);

                    // Remove all event listeners first to prevent new events
                    if (sock?.ev) {
                        try {
                            sock.ev.removeAllListeners();
                            console.log('✅ Event listeners removed');
                        } catch (e) {
                            console.warn('Event listener removal warning:', e.message);
                        }
                    }

                    // Then close the WebSocket connection
                    if (sock?.ws) {
                        try {
                            sock.ws.close();
                            console.log('✅ WebSocket closed');
                        } catch (e) {
                            console.warn('WebSocket close warning:', e.message);
                        }
                    }

                    // Clear socket reference
                    sock = null;
                };

                // EVENT: Listen to connection updates
                sock.ev.on('connection.update', async (update) => {
                    const { connection, lastDisconnect } = update;

                    console.log(`📡 [ATTEMPT ${attempt}] Connection status: ${connection}`);

                    if (connection === 'open') {
                        console.log(`✅ [ATTEMPT ${attempt}] Connection established!`);

                        try {
                            // Wait for connection to stabilize
                            await delay(5000);

                            // Prepare welcome message
                            const phoneNumber = ownerJid.split('@')[0] || ownerJid.split(':')[0];
                            const welcomeMsg = `🎉 *GIFTED-MD CONNECTED SUCCESSFULLY!*

━━━━━━━━━━━━━━━━━━━
✨ Your WhatsApp bot is now active!

📱 *Session Details:*
• Status: ✅ Active
• Owner: ${decodedCreds.me?.name || 'User'}
• Number: ${phoneNumber}
• Platform: ${decodedCreds.platform || 'Unknown'}

🔐 *Security:*
• Session created at: ${new Date().toLocaleString()}
• Keep your session ID secure
• Never share credentials

💡 *Next Steps:*
• Deploy your session ID to your bot
• Configure your bot settings
• Start using your bot features

━━━━━━━━━━━━━━━━━━━
_Powered by GIFTED-MD_
_Baileys v7.0 | WhatsApp Multi-Device_`;

                            console.log(`📤 [ATTEMPT ${attempt}] Calling sendMessage FUNCTION...`);

                            // FUNCTION CALL: sock.sendMessage is a function, not an event
                            const sent = await sock.sendMessage(ownerJid, { 
                                text: welcomeMsg 
                            });

                            if (sent?.key?.id) {
                                console.log(`✅ [ATTEMPT ${attempt}] Message sent! ID: ${sent.key.id}`);

                                // Wait for WhatsApp to process the message completely
                                let messageDelivered = false;
                                let credsSaved = false;
                                const messageId = sent.key.id;

                                // Track message delivery status
                                const statusHandler = (updates) => {
                                    for (const update of updates) {
                                        if (update.key.id === messageId) {
                                            console.log(`📨 Message status: ${update.update.status || 'pending'}`);
                                            // Status 2 = delivered to server, 3 = delivered to device
                                            if (update.update.status >= 2) {
                                                messageDelivered = true;
                                            }
                                        }
                                    }
                                };

                                // Track credential updates (important for encryption key changes)
                                const credsHandler = async () => {
                                    try {
                                        await saveCreds();
                                        credsSaved = true;
                                        console.log('🔐 Session credentials saved after message');
                                    } catch (e) {
                                        console.warn('Creds save warning:', e.message);
                                    }
                                };

                                sock.ev.on('messages.update', statusHandler);
                                sock.ev.on('creds.update', credsHandler);

                                // Wait for message delivery confirmation with timeout
                                const waitStart = Date.now();
                                const maxWait = 30000; // 30 seconds max wait

                                while (!messageDelivered && (Date.now() - waitStart) < maxWait) {
                                    await delay(1000);
                                    
                                    // If creds were saved, that's a good sign the message is being processed
                                    if (credsSaved && (Date.now() - waitStart) > 10000) {
                                        console.log('✅ Credentials updated, message processing complete');
                                        break;
                                    }
                                }

                                if (messageDelivered) {
                                    console.log(`✅ Message confirmed delivered to WhatsApp servers`);
                                } else {
                                    console.log(`⏱️ Message sent, waiting for final confirmation...`);
                                }

                                // Critical: Give WhatsApp extra time to complete encryption updates
                                // This prevents "Connection Closed" errors during prekey updates
                                console.log('⏳ Finalizing session encryption...');
                                await delay(10000);

                                // Now safely cleanup
                                try {
                                    sock.ev.off('messages.update', statusHandler);
                                    sock.ev.off('creds.update', credsHandler);
                                    sock.ev.removeAllListeners('connection.update');
                                    console.log('✅ Event listeners cleaned up');
                                } catch (e) {
                                    console.warn('Listener cleanup warning:', e.message);
                                }

                                // Close socket gracefully
                                try {
                                    if (sock?.ws?.readyState === 1) { // 1 = OPEN
                                        sock.ws.close();
                                        console.log('✅ Socket closed gracefully');
                                    }
                                } catch (e) {
                                    console.warn('Socket close warning:', e.message);
                                }
                                
                                sock = null;
                                
                                resolve({ 
                                    success: true, 
                                    attempt, 
                                    messageId,
                                    sessionId,
                                    delivered: messageDelivered
                                });
                            } else {
                                throw new Error('Message sent but no message ID returned');
                            }

                        } catch (err) {
                            console.error(`❌ [ATTEMPT ${attempt}] Send error:`, err.message);
                            cleanup();
                            reject(err);
                        }

                    } else if (connection === 'close') {
                        const statusCode = (lastDisconnect?.error instanceof Boom) 
                            ? lastDisconnect.error.output.statusCode 
                            : 500;

                        console.log(`❌ [ATTEMPT ${attempt}] Connection closed: ${statusCode}`);

                        cleanup();
                        reject(new Error(`Connection closed with status: ${statusCode}`));
                    }
                });

                // EVENT: Handle credentials update
                sock.ev.on('creds.update', async () => {
                    try {
                        await saveCreds();
                        console.log(`💾 [ATTEMPT ${attempt}] Credentials updated`);
                    } catch (e) {
                        console.warn('Creds update warning:', e.message);
                    }
                });
            });

            // Success - cleanup temp directory
            console.log(`\n✅ SUCCESS! Message delivered on attempt ${attempt}`);

            if (fs.existsSync(sessionDir)) {
                try {
                    await removeFile(sessionDir);
                    console.log('🧹 Cleaned up temp directory');
                } catch (e) {
                    console.warn('Cleanup warning:', e.message);
                }
            }

            return result;

        } catch (err) {
            console.error(`\n❌ [ATTEMPT ${attempt}/${maxAttempts}] Failed: ${err.message}`);

            // Cleanup on error
            if (sock?.ev) {
                sock.ev.removeAllListeners();
            }
            if (sock?.ws) {
                try {
                    sock.ws.close();
                } catch (e) {}
            }

            // Retry logic
            if (attempt < maxAttempts) {
                const waitTime = attempt * 5000;
                console.log(`⏳ Waiting ${waitTime/1000}s before retry...`);
                await delay(waitTime);
            } else {
                console.error(`\n❌ ALL ${maxAttempts} ATTEMPTS FAILED`);

                if (fs.existsSync(sessionDir)) {
                    try {
                        await removeFile(sessionDir);
                    } catch (e) {}
                }

                throw new Error(`Failed after ${maxAttempts} attempts: ${err.message}`);
            }
        }
    }
}

/**
 * Cleanup function for socket and directories
 */
async function cleanup(sock, authDir, timers = []) {
    try {
        // Clear all timers
        timers.forEach(t => clearTimeout(t));

        // Remove event listeners
        if (sock?.ev) {
            sock.ev.removeAllListeners();
        }

        // Close WebSocket
        if (sock?.ws) {
            try {
                sock.ws.close();
            } catch (e) {
                console.warn('WS close error:', e.message);
            }
        }

        // Clear auth state
        if (sock) {
            sock.authState = null;
        }

        // Clear session storage
        sessionStorage.clear();

        // Remove temp directory
        if (fs.existsSync(authDir)) {
            await removeFile(authDir);
        }

        console.log('✅ Cleanup completed');
    } catch (err) {
        console.error('⚠️ Cleanup error:', err.message);
    }
}

/**
 * Main pairing endpoint
 */
router.get('/', async (req, res) => {
    const id = giftedId();
    let num = req.query.number;

    if (!num) {
        return res.status(400).json({ 
            error: "Phone number is required",
            usage: "?number=1234567890" 
        });
    }

    // Clean old temp directories
    const tempBaseDir = path.join(__dirname, 'temp');
    try {
        console.log('🧹 Cleaning old temp directories...');
        if (fs.existsSync(tempBaseDir)) {
            const tempDirs = fs.readdirSync(tempBaseDir);
            for (const dir of tempDirs) {
                const dirPath = path.join(tempBaseDir, dir);
                try {
                    const stat = fs.statSync(dirPath);
                    if (stat.isDirectory()) {
                        // Remove directories older than 1 hour
                        const age = Date.now() - stat.mtimeMs;
                        if (age > 3600000) {
                            await removeFile(dirPath);
                            console.log(`✅ Removed old directory: ${dir}`);
                        }
                    }
                } catch (e) {
                    console.warn(`⚠️ Could not check ${dir}:`, e.message);
                }
            }
        }
    } catch (e) {
        console.warn('⚠️ Temp cleanup warning:', e.message);
    }

    const authDir = path.join(__dirname, 'temp', id);
    let sock = null;
    let timers = [];
    let hasResponded = false;
    let connectionEstablished = false;
    let retryCount = 0;
    const MAX_RETRIES = 2;

    // Global timeout (5 minutes)
    const globalTimeout = setTimeout(async () => {
        if (!connectionEstablished && !hasResponded) {
            console.log('⏱️ Global timeout reached');
            await cleanup(sock, authDir, timers);
            hasResponded = true;
            res.status(408).json({ 
                error: "Connection timeout. Please try again.",
                timeout: "5 minutes"
            });
        }
    }, 5 * 60 * 1000);

    timers.push(globalTimeout);

    /**
     * Pairing code generation function
     */
    async function GIFTED_PAIR_CODE() {
        try {
            // Create auth directory
            if (!fs.existsSync(authDir)) {
                fs.mkdirSync(authDir, { recursive: true });
            }

            // Initialize auth state
            const { state, saveCreds } = await useMultiFileAuthState(authDir);

            // Fetch latest version
            const { version, isLatest } = await fetchLatestBaileysVersion();
            console.log(`📡 Using WA version: ${version.join('.')}, isLatest: ${isLatest}`);

            // Create socket for pairing
            sock = makeWASocket({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, logger),
                },
                printQRInTerminal: false,
                logger,
                browser: Browsers.macOS("Safari"),
                markOnlineOnConnect: false,
                generateHighQualityLinkPreview: true,
                syncFullHistory: false,
                getMessage: async (key) => {
                    return { conversation: '' };
                }
            });

            // FUNCTION CALL: requestPairingCode is a function on the socket
            if (!sock.authState.creds.registered) {
                await delay(1500);
                num = num.replace(/[^0-9]/g, '');

                console.log('📱 Requesting pairing code for:', num);
                const code = await sock.requestPairingCode(num);
                console.log('✅ Pairing code generated:', code);

                if (!hasResponded) {
                    hasResponded = true;
                    res.json({ 
                        code,
                        message: "Enter this code in WhatsApp (Linked Devices > Link a Device > Link with phone number instead)",
                        number: num,
                        expiresIn: "60 seconds"
                    });
                }
            }

            // EVENT: Listen for credential updates
            sock.ev.on('creds.update', async () => {
                try {
                    await saveCreds();
                    console.log('💾 Credentials updated');
                } catch (err) {
                    console.warn('Creds save warning:', err.message);
                }
            });

            // EVENT: Handle connection updates
            sock.ev.on("connection.update", async (update) => {
                const { connection, lastDisconnect } = update;
                const statusCode = lastDisconnect?.error instanceof Boom
                    ? lastDisconnect.error.output.statusCode
                    : 500;

                if (connection === "open") {
                    connectionEstablished = true;
                    console.log('✅ Pairing connection established');

                    try {
                        // Wait for full authentication
                        console.log('⏳ Waiting for authentication to complete...');
                        await delay(8000);

                        // Save credentials
                        await saveCreds();
                        console.log('💾 Final credentials saved');

                        // Generate session ID
                        const sessionId = await saveSessionLocallyFromPath(authDir);
                        if (!sessionId) {
                            throw new Error('Failed to generate session ID');
                        }

                        console.log('✅ Session ID generated');
                        
                        // Wait longer before closing to allow pending acknowledgments
                        await delay(5000);
                        
                        console.log('🔌 Closing pairing connection...');

                        // Gracefully close pairing connection
                        if (sock?.ev) {
                            sock.ev.removeAllListeners();
                        }
                        if (sock?.ws) {
                            try {
                                sock.ws.close();
                            } catch (e) {
                                console.warn('Socket close warning:', e.message);
                            }
                        }

                        await delay(3000);
                        console.log('✅ Pairing connection closed');

                        // Send welcome message with retry
                        console.log('🚀 Initiating welcome message delivery...');
                        const result = await sendWelcomeMessageWithRetry(sessionId, 3);

                        console.log(`\n🎉 COMPLETE SUCCESS!`);
                        console.log(`✅ Message delivered on attempt ${result.attempt}`);
                        console.log(`📨 Message ID: ${result.messageId}`);
                        console.log(`🔑 Session ID: ${result.sessionId.substring(0, 30)}...`);

                        // Final cleanup
                        await cleanup(sock, authDir, timers);

                    } catch (err) {
                        console.error('❌ Connection.open error:', err.message);
                        await cleanup(sock, authDir, timers);

                        if (!hasResponded) {
                            hasResponded = true;
                            res.status(500).json({ 
                                error: "Failed to send welcome message",
                                details: err.message,
                                note: "Session may still be valid. Check your WhatsApp."
                            });
                        }
                    }

                } else if (connection === "close") {
                    console.log('⚠️ Pairing connection closed. Status:', statusCode);

                    // Check if logged out
                    if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                        console.log('⚠️ Device logged out or unauthorized');
                        await cleanup(sock, authDir, timers);

                        if (!hasResponded) {
                            hasResponded = true;
                            res.status(401).json({ 
                                error: "Authentication failed",
                                reason: "Device logged out or unauthorized"
                            });
                        }
                        return;
                    }

                    // Retry logic
                    if (!connectionEstablished && retryCount < MAX_RETRIES) {
                        retryCount++;
                        console.log(`🔄 Retrying (${retryCount}/${MAX_RETRIES})...`);
                        await delay(5000);
                        GIFTED_PAIR_CODE().catch(err => {
                            console.error('Retry error:', err);
                        });
                    } else if (!connectionEstablished) {
                        console.log('❌ Max retries reached or connection failed');
                        await cleanup(sock, authDir, timers);

                        if (!hasResponded) {
                            hasResponded = true;
                            res.status(500).json({ 
                                error: "Connection failed after retries",
                                reason: "Could not establish connection"
                            });
                        }
                    }
                }
            });
        } catch (error) {
            console.error('❌ Pairing error:', error);
            await cleanup(sock, authDir, timers);

            if (!hasResponded) {
                hasResponded = true;
                res.status(500).json({ 
                    error: "Pairing failed",
                    details: error.message 
                });
            }
        }
    }

    // Call the pairing function
    await GIFTED_PAIR_CODE();
});

module.exports = router;