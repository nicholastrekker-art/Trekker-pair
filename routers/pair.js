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
                        
                        // Send welcome message NOW while pairing connection is still active
                        console.log('📤 Sending welcome message via active pairing connection...');
                        
                        try {
                            const phoneNumber = sock.user.id.split('@')[0] || sock.user.id.split(':')[0];
                            const welcomeMsg = `🎉 *GIFTED-MD CONNECTED SUCCESSFULLY!*

━━━━━━━━━━━━━━━━━━━
✨ Your WhatsApp bot is now active!

📱 *Session Details:*
• Status: ✅ Active
• Owner: ${sock.user.name || 'User'}
• Number: ${phoneNumber}
• Platform: Web

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

                            const sent = await sock.sendMessage(sock.user.id, { 
                                text: welcomeMsg 
                            });

                            if (sent?.key?.id) {
                                console.log(`✅ Welcome message sent! ID: ${sent.key.id}`);
                                
                                // Wait for message to be processed
                                await delay(5000);
                                
                                console.log(`🎉 COMPLETE SUCCESS!`);
                                console.log(`📨 Message ID: ${sent.key.id}`);
                                console.log(`🔑 Session ID: ${sessionId.substring(0, 30)}...`);
                            }
                        } catch (msgErr) {
                            console.warn('⚠️ Welcome message failed (session still valid):', msgErr.message);
                        }
                        
                        // Now close the pairing connection
                        console.log('🔌 Closing pairing connection...');
                        await delay(3000);

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