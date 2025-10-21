const { giftedId, removeFile } = require('../lib');
const express = require('express');
const fs = require('fs');
require('dotenv').config();
const path = require('path');
let router = express.Router();
const pino = require("pino");

const sessionStorage = new Map();

const {
    default: Gifted_Tech,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    DisconnectReason
} = require("@whiskeysockets/baileys");

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
        return credsBase64;
    } catch (e) {
        console.error('saveSessionLocallyFromPath error:', e.message);
        return null;
    }
}

async function sendWelcomeMessage(sessionId) {
    const sessionDir = path.join(__dirname, 'temp', `session_${giftedId()}`);
    let connection = null;

    try {
        // Decode the base64 session
        const decodedCreds = JSON.parse(Buffer.from(sessionId, 'base64').toString('utf8'));
        console.log('📦 Session decoded successfully');

        // Extract owner JID
        const ownerJid = decodedCreds?.me?.id;
        if (!ownerJid) {
            throw new Error('Owner JID not found in session data');
        }

        console.log('👤 Owner JID:', ownerJid);

        // Create temporary directory for this session
        if (!fs.existsSync(sessionDir)) {
            fs.mkdirSync(sessionDir, { recursive: true });
        }

        // Write credentials to file
        const credsPath = path.join(sessionDir, 'creds.json');
        fs.writeFileSync(credsPath, JSON.stringify(decodedCreds, null, 2));

        // Load auth state
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

        // Create connection
        connection = Gifted_Tech({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(
                    state.keys,
                    pino({ level: "silent" }).child({ level: "silent" })
                ),
            },
            printQRInTerminal: false,
            logger: pino({ level: "silent" }).child({ level: "silent" }),
            browser: Browsers.macOS("Safari"),
            getMessage: async (key) => {
                return { conversation: '' };
            }
        });

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Connection timeout'));
            }, 60000); // 1 minute timeout

            connection.ev.on('connection.update', async (update) => {
                const { connection: conn, lastDisconnect } = update;

                if (conn === 'open') {
                    console.log('✅ Connection established with decoded session');

                    try {
                        // Send welcome message
                        const welcomeMsg = `🎉 *GIFTED-MD CONNECTED SUCCESSFULLY!*

━━━━━━━━━━━━━━━━━━━
✨ Your bot is now active and ready to use!

📱 *Session Details:*
• Status: Active ✅
• Owner: ${decodedCreds.me?.name || 'User'}
• Number: ${ownerJid.split(':')[0]}

💡 *Quick Tips:*
• Keep your session ID secure
• Don't share it with anyone
• Restart bot if connection drops

━━━━━━━━━━━━━━━━━━━
_Powered by GIFTED-MD_
_Session created successfully!_`;

                        await connection.sendMessage(ownerJid, { text: welcomeMsg });
                        console.log('✅ Welcome message sent to:', ownerJid);

                        // Wait a bit for message delivery
                        await delay(3000);

                        clearTimeout(timeout);
                        resolve(true);

                    } catch (err) {
                        console.error('Error sending welcome message:', err.message);
                        reject(err);
                    } finally {
                        // Cleanup connection
                        if (connection?.ev) connection.ev.removeAllListeners();
                        if (connection?.ws && connection.ws.readyState === 1) {
                            await connection.ws.close();
                        }
                        // Clean up temp directory
                        if (fs.existsSync(sessionDir)) {
                            await removeFile(sessionDir);
                        }
                    }
                } else if (conn === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    console.log('Connection closed. Status:', statusCode);

                    clearTimeout(timeout);

                    // Cleanup
                    if (connection?.ev) connection.ev.removeAllListeners();
                    if (fs.existsSync(sessionDir)) {
                        await removeFile(sessionDir);
                    }

                    reject(new Error(`Connection closed with status: ${statusCode}`));
                }
            });

            connection.ev.on('creds.update', saveCreds);
        });

    } catch (err) {
        console.error('sendWelcomeMessage error:', err.message);

        // Cleanup on error
        if (connection?.ev) connection.ev.removeAllListeners();
        if (connection?.ws && connection.ws.readyState === 1) {
            await connection.ws.close();
        }
        if (fs.existsSync(sessionDir)) {
            await removeFile(sessionDir);
        }

        throw err;
    }
}

async function cleanup(Gifted, authDir, timers = []) {
    try {
        timers.forEach(t => clearTimeout(t));

        if (Gifted?.ev) {
            Gifted.ev.removeAllListeners();
        }

        if (Gifted?.ws && Gifted.ws.readyState === 1) {
            await Gifted.ws.close();
        }

        if (Gifted) {
            Gifted.authState = null;
        }

        sessionStorage.clear();

        if (fs.existsSync(authDir)) {
            await removeFile(authDir);
        }

        console.log('✅ Cleanup completed');
    } catch (err) {
        console.error('Error during cleanup:', err.message);
    }
}

router.get('/', async (req, res) => {
    const id = giftedId();
    let num = req.query.number;

    if (!num) {
        return res.status(400).json({ error: "Phone number is required" });
    }

    const authDir = path.join(__dirname, 'temp', id);
    let Gifted = null;
    let timers = [];
    let hasResponded = false;
    let connectionEstablished = false;
    let retryCount = 0;
    const MAX_RETRIES = 2;

    const globalTimeout = setTimeout(async () => {
        if (!connectionEstablished) {
            console.log('⏱️ Global timeout reached');
            await cleanup(Gifted, authDir, timers);
            if (!hasResponded) {
                hasResponded = true;
                res.status(408).json({ error: "Connection timeout. Please try again." });
            }
        }
    }, 5 * 60 * 1000);

    timers.push(globalTimeout);

    async function GIFTED_PAIR_CODE() {
        try {
            if (!fs.existsSync(authDir)) {
                fs.mkdirSync(authDir, { recursive: true });
            }

            const { state, saveCreds } = await useMultiFileAuthState(authDir);

            Gifted = Gifted_Tech({
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(
                        state.keys, 
                        pino({ level: "fatal" }).child({ level: "fatal" })
                    ),
                },
                printQRInTerminal: false,
                logger: pino({ level: "fatal" }).child({ level: "fatal" }),
                browser: Browsers.macOS("Safari")
            });

            if (!Gifted.authState.creds.registered) {
                await delay(1500);
                num = num.replace(/[^0-9]/g, '');
                const code = await Gifted.requestPairingCode(num);

                if (!hasResponded) {
                    hasResponded = true;
                    res.json({ 
                        code,
                        message: "Enter this code in WhatsApp. You'll receive a welcome message once connected."
                    });
                }
            }

            Gifted.ev.on('creds.update', async () => {
                try {
                    await saveCreds();
                } catch (err) {
                    console.warn('saveCreds on creds.update failed:', err.message);
                }
            });

            Gifted.ev.on("connection.update", async (update) => {
                const { connection, lastDisconnect } = update;
                const statusCode = lastDisconnect?.error?.output?.statusCode;

                if (connection === "open") {
                    connectionEstablished = true;
                    console.log('✅ Connection established');

                    try {
                        console.log('⏳ Waiting for credentials to save...');
                        await delay(10000);

                        try {
                            await saveCreds();
                        } catch (err) {
                            console.warn('Final saveCreds() failed:', err.message);
                        }

                        // Generate session ID
                        const sessionId = await saveSessionLocallyFromPath(authDir);
                        if (!sessionId) {
                            throw new Error('Failed to generate session ID');
                        }

                        console.log('📝 Session ID generated, establishing connection to send message...');

                        // Close the pairing connection first
                        if (Gifted?.ev) Gifted.ev.removeAllListeners();
                        if (Gifted?.ws && Gifted.ws.readyState === 1) {
                            await Gifted.ws.close();
                        }
                        await delay(2000);

                        // Use the session to send welcome message
                        await sendWelcomeMessage(sessionId);

                        console.log('✅ Session created and welcome message sent');

                        // Final cleanup
                        await cleanup(Gifted, authDir, timers);

                    } catch (err) {
                        console.error('Error in connection.open handler:', err.message);
                        await cleanup(Gifted, authDir, timers);

                        if (!hasResponded) {
                            hasResponded = true;
                            res.status(500).json({ error: "Failed to generate session" });
                        }
                    }

                } else if (connection === "close") {
                    console.log('Connection closed. Status code:', statusCode);

                    if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                        console.log('⚠️ Logged out or unauthorized');
                        await cleanup(Gifted, authDir, timers);

                        if (!hasResponded) {
                            hasResponded = true;
                            res.status(401).json({ error: "Authentication failed" });
                        }
                        return;
                    }

                    if (!connectionEstablished && retryCount < MAX_RETRIES) {
                        retryCount++;
                        console.log(`🔄 Retrying connection (${retryCount}/${MAX_RETRIES})...`);
                        await delay(5000);
                        GIFTED_PAIR_CODE().catch(err => {
                            console.error('Retry error:', err.message);
                        });
                    } else {
                        console.log('❌ Max retries reached or connection was established');
                        await cleanup(Gifted, authDir, timers);
                    }
                }
            });

        } catch (err) {
            console.error('GIFTED_PAIR_CODE error:', err.message);
            await cleanup(Gifted, authDir, timers);

            if (!hasResponded) {
                hasResponded = true;
                res.status(500).json({ error: "Service unavailable. Please try again." });
            }
        }
    }

    await GIFTED_PAIR_CODE();
});

module.exports = router;