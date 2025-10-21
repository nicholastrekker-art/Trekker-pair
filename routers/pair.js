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

async function sendWelcomeMessageWithRetry(sessionId, maxAttempts = 3) {
    const sessionDir = path.join(__dirname, 'temp', `welcome_${giftedId()}`);
    let connection = null;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            console.log(`\n🔄 [ATTEMPT ${attempt}/${maxAttempts}] Starting welcome message process...`);
            
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

            // Write credentials to creds.json
            const credsPath = path.join(sessionDir, 'creds.json');
            fs.writeFileSync(credsPath, JSON.stringify(decodedCreds, null, 2));
            console.log('💾 Credentials written to temp directory');

            // Wait for file to be written
            await delay(1500);

            // Load auth state from the directory
            const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
            console.log('🔑 Auth state loaded from directory');

            // Create new connection with the loaded credentials
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

            console.log('🔌 New connection instance created, waiting for connection...');

            const result = await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    console.error(`❌ [ATTEMPT ${attempt}] Connection timeout after 60 seconds`);
                    reject(new Error('Connection timeout'));
                }, 60000);

                const cleanup = async () => {
                    clearTimeout(timeout);
                    if (connection?.ev) {
                        connection.ev.removeAllListeners();
                    }
                    if (connection?.ws && connection.ws.readyState === 1) {
                        try {
                            await connection.ws.close();
                        } catch (e) {
                            console.warn('WS close error:', e.message);
                        }
                    }
                };

                connection.ev.on('connection.update', async (update) => {
                    const { connection: conn, lastDisconnect } = update;

                    console.log(`📡 [ATTEMPT ${attempt}] Connection update:`, conn);

                    if (conn === 'connecting') {
                        console.log(`⏳ [ATTEMPT ${attempt}] Connecting to WhatsApp...`);
                    }

                    if (conn === 'open') {
                        console.log(`✅ [ATTEMPT ${attempt}] Connection established successfully!`);

                        try {
                            // Wait for connection to stabilize
                            console.log(`⏳ [ATTEMPT ${attempt}] Waiting for connection to stabilize...`);
                            await delay(3000);

                            // Prepare welcome message
                            const welcomeMsg = `🎉 *GIFTED-MD CONNECTED SUCCESSFULLY!*

━━━━━━━━━━━━━━━━━━━
✨ Your bot is now active and ready to use!

📱 *Session Details:*
• Status: Active ✅
• Owner: ${decodedCreds.me?.name || 'User'}
• Number: ${ownerJid.split(':')[0]}
• Attempt: ${attempt}/${maxAttempts}

💡 *Quick Tips:*
• Keep your session ID secure
• Don't share it with anyone
• Restart bot if connection drops

━━━━━━━━━━━━━━━━━━━
_Powered by GIFTED-MD_
_Session created successfully!_`;

                            console.log(`📤 [ATTEMPT ${attempt}] Sending welcome message to:`, ownerJid);
                            
                            // Send the message
                            const sent = await connection.sendMessage(ownerJid, { 
                                text: welcomeMsg 
                            });

                            if (sent && sent.key && sent.key.id) {
                                console.log(`✅ [ATTEMPT ${attempt}] Welcome message sent successfully!`);
                                console.log(`📨 [ATTEMPT ${attempt}] Message ID:`, sent.key.id);
                                
                                // Wait longer to ensure message is delivered
                                console.log(`⏳ [ATTEMPT ${attempt}] Waiting for message delivery confirmation...`);
                                await delay(8000);
                                
                                await cleanup();
                                resolve({ success: true, attempt, messageId: sent.key.id });
                            } else {
                                throw new Error('Message send returned no key/id');
                            }

                        } catch (err) {
                            console.error(`❌ [ATTEMPT ${attempt}] Error sending welcome message:`, err.message);
                            console.error('Error stack:', err.stack);
                            await cleanup();
                            reject(err);
                        }
                        
                    } else if (conn === 'close') {
                        const statusCode = lastDisconnect?.error?.output?.statusCode;
                        const reason = lastDisconnect?.error?.output?.payload?.error;
                        
                        console.log(`❌ [ATTEMPT ${attempt}] Connection closed`);
                        console.log('Status code:', statusCode);
                        console.log('Reason:', reason);

                        await cleanup();
                        reject(new Error(`Connection closed: ${statusCode} - ${reason}`));
                    }
                });

                connection.ev.on('creds.update', async () => {
                    try {
                        await saveCreds();
                        console.log(`💾 [ATTEMPT ${attempt}] Credentials updated and saved`);
                    } catch (e) {
                        console.warn('Creds save error:', e.message);
                    }
                });

                connection.ev.on('connection.error', (err) => {
                    console.error(`⚠️ [ATTEMPT ${attempt}] Connection error event:`, err);
                });
            });

            // If we get here, message was sent successfully
            console.log(`\n✅ SUCCESS! Message delivered on attempt ${attempt}`);
            
            // Final cleanup of session directory
            if (fs.existsSync(sessionDir)) {
                try {
                    await removeFile(sessionDir);
                    console.log('🧹 Cleaned up welcome session directory');
                } catch (e) {
                    console.warn('Warning: Could not remove session directory:', e.message);
                }
            }
            
            return result;

        } catch (err) {
            console.error(`\n❌ [ATTEMPT ${attempt}/${maxAttempts}] Failed:`, err.message);
            
            // Cleanup connection
            if (connection?.ev) {
                connection.ev.removeAllListeners();
            }
            if (connection?.ws && connection.ws.readyState === 1) {
                try {
                    await connection.ws.close();
                } catch (e) {}
            }

            // If this is not the last attempt, wait before retrying
            if (attempt < maxAttempts) {
                const waitTime = attempt * 5000; // Increasing wait time: 5s, 10s, 15s
                console.log(`⏳ Waiting ${waitTime/1000} seconds before retry...`);
                await delay(waitTime);
            } else {
                // This was the last attempt, cleanup and throw
                console.error(`\n❌ ALL ${maxAttempts} ATTEMPTS FAILED`);
                
                if (fs.existsSync(sessionDir)) {
                    try {
                        await removeFile(sessionDir);
                    } catch (e) {}
                }
                
                throw new Error(`Failed to send welcome message after ${maxAttempts} attempts: ${err.message}`);
            }
        }
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

        console.log('✅ Main cleanup completed');
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

    // FIRST STEP: Clean up old temp directories
    const tempBaseDir = path.join(__dirname, 'temp');
    try {
        console.log('🧹 Cleaning old temp directories...');
        if (fs.existsSync(tempBaseDir)) {
            const tempDirs = fs.readdirSync(tempBaseDir);
            for (const dir of tempDirs) {
                const dirPath = path.join(tempBaseDir, dir);
                try {
                    if (fs.statSync(dirPath).isDirectory()) {
                        await removeFile(dirPath);
                        console.log(`✅ Removed old temp directory: ${dir}`);
                    }
                } catch (e) {
                    console.warn(`⚠️ Could not remove ${dir}:`, e.message);
                }
            }
        }
        console.log('✅ Temp cleanup completed');
    } catch (e) {
        console.warn('⚠️ Error during temp cleanup:', e.message);
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
                        message: "Enter this code in WhatsApp. You'll receive a welcome message once connected (may take up to 3 attempts)."
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
                    console.log('✅ Pairing connection established');

                    try {
                        console.log('⏳ Waiting for credentials to be fully saved...');
                        await delay(8000);

                        try {
                            await saveCreds();
                            console.log('💾 Final credentials save completed');
                        } catch (err) {
                            console.warn('Final saveCreds() failed:', err.message);
                        }

                        // Generate session ID
                        const sessionId = await saveSessionLocallyFromPath(authDir);
                        if (!sessionId) {
                            throw new Error('Failed to generate session ID');
                        }

                        console.log('✅ Session ID generated successfully');
                        console.log('🔌 Closing pairing connection...');

                        // Close the pairing connection properly
                        if (Gifted?.ev) {
                            Gifted.ev.removeAllListeners();
                        }
                        if (Gifted?.ws && Gifted.ws.readyState === 1) {
                            await Gifted.ws.close();
                        }
                        
                        // Wait for connection to fully close
                        await delay(3000);
                        console.log('✅ Pairing connection closed');

                        // Now establish new connection and send welcome message WITH RETRY
                        console.log('🚀 Starting welcome message sender with retry logic...');
                        const result = await sendWelcomeMessageWithRetry(sessionId, 3);
                        
                        console.log(`\n🎉 COMPLETE SUCCESS!`);
                        console.log(`✅ Welcome message delivered on attempt ${result.attempt}`);
                        console.log(`📨 Message ID: ${result.messageId}`);

                        // Final cleanup of pairing directory
                        await cleanup(Gifted, authDir, timers);

                    } catch (err) {
                        console.error('❌ Error in connection.open handler:', err.message);
                        console.error('Stack:', err.stack);
                        await cleanup(Gifted, authDir, timers);

                        if (!hasResponded) {
                            hasResponded = true;
                            res.status(500).json({ 
                                error: "Failed to send welcome message after multiple attempts. Session may still be valid." 
                            });
                        }
                    }

                } else if (connection === "close") {
                    console.log('⚠️ Pairing connection closed. Status code:', statusCode);

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
            console.error('❌ GIFTED_PAIR_CODE error:', err.message);
            console.error('Stack:', err.stack);
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