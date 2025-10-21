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
    Browsers
} = require("@whiskeysockets/baileys");

async function saveSessionLocallyFromPath(authDir, id) {
    const authPath = path.join(authDir, 'creds.json');
    try {
        if (!fs.existsSync(authPath)) throw new Error(`Credentials file not found at: ${authPath}`);
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

function waitForMessageAck(Gifted, messageKey, timeoutMs = 8000) {
    return new Promise((resolve) => {
        let resolved = false;
        const timer = setTimeout(() => {
            if (!resolved) {
                resolved = true;
                Gifted.ev.off('messages.update', handler);
                resolve(false);
            }
        }, timeoutMs);
        const handler = (updates) => {
            const arr = Array.isArray(updates) ? updates : [updates];
            for (const u of arr) {
                const key = u.key || u;
                if (key && messageKey && key.id === messageKey.id && key.remoteJid === messageKey.remoteJid) {
                    if (!resolved) {
                        resolved = true;
                        clearTimeout(timer);
                        Gifted.ev.off('messages.update', handler);
                        resolve(true);
                        return;
                    }
                }
            }
        };
        Gifted.ev.on('messages.update', handler);
    });
}

router.get('/', async (req, res) => {
    const id = giftedId();
    let num = req.query.number;
    if (!num) return res.status(400).send({ error: "Phone number is required" });

    async function GIFTED_PAIR_CODE() {
        const authDir = path.join(__dirname, 'temp', id);
        let Gifted = null;

        const forceCleanupTimer = setTimeout(async () => {
            try {
                if (Gifted) {
                    if (Gifted.ev) Gifted.ev.removeAllListeners();
                    if (Gifted.ws && Gifted.ws.readyState === 1) await Gifted.ws.close();
                    Gifted.authState = null;
                }
                sessionStorage.clear();
                if (fs.existsSync(authDir)) await removeFile(authDir);
                console.log('Forced cleanup executed.');
            } catch (err) {
                console.error('Error during forced cleanup:', err.message);
            }
        }, 4 * 60 * 1000);

        try {
            if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

            const { state, saveCreds } = await useMultiFileAuthState(authDir);

            Gifted = Gifted_Tech({
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                printQRInTerminal: false,
                logger: pino({ level: "fatal" }).child({ level: "fatal" }),
                browser: Browsers.macOS("Safari")
            });

            const getRecipientId = () => {
                if (Gifted?.user?.id) return Gifted.user.id;
                if (state?.creds?.me?.id) return state.creds.me.id;
                return null;
            };

            if (!Gifted.authState.creds.registered) {
                await delay(1500);
                num = num.replace(/[^0-9]/g, '');
                const code = await Gifted.requestPairingCode(num);
                if (!res.headersSent) res.send({ code });
            }

            Gifted.ev.on('creds.update', async () => {
                try {
                    if (fs.existsSync(authDir)) await saveCreds();
                } catch (err) {
                    console.warn('saveCreds on creds.update failed:', err.message);
                }
            });

            Gifted.ev.on("connection.update", async (update) => {
                const { connection, lastDisconnect } = update;

                if (connection === "open") {
                    try {
                        const recipient = getRecipientId();
                        console.log('Waiting 10 seconds to ensure credentials are saved...');
                        await delay(10000);
                        try {
                            await saveCreds();
                        } catch (err) {
                            console.warn('saveCreds() failed:', err.message);
                        }

                        const sessionId = await saveSessionLocallyFromPath(authDir, id);
                        if (!sessionId) {
                            if (recipient)
                                await Gifted.sendMessage(recipient, { text: '❌ Failed to generate session ID. Try again.' });
                            throw new Error('Session generation failed');
                        }

                        // ⚡ Send only the session ID
                        const recipientId = getRecipientId();
                        if (!recipientId) throw new Error('Recipient id not found to send session ID');

                        const sent = await Gifted.sendMessage(recipientId, { text: sessionId });
                        console.log('✅ Session ID sent successfully');
                        
                        // Wait a bit for message to be delivered
                        await delay(3000);

                        // 🚨 Close connection and cleanup
                        if (Gifted.ev) Gifted.ev.removeAllListeners();
                        if (Gifted.ws && Gifted.ws.readyState === 1) await Gifted.ws.close();
                        Gifted.authState = null;
                        sessionStorage.clear();
                        if (fs.existsSync(authDir)) await removeFile(authDir);
                        clearTimeout(forceCleanupTimer);
                        console.log('✅ Connection closed after sending session ID.');
                    } catch (err) {
                        console.error('connection.open error:', err.message);
                        try {
                            if (Gifted.ev) Gifted.ev.removeAllListeners();
                            if (Gifted.ws && Gifted.ws.readyState === 1) await Gifted.ws.close();
                            if (fs.existsSync(authDir)) await removeFile(authDir);
                        } catch {}
                    }
                } else if (connection === "close" && lastDisconnect?.error?.output?.statusCode !== 401) {
                    await delay(10000);
                    GIFTED_PAIR_CODE().catch(err => console.error('Restart error:', err));
                }
            });
        } catch (err) {
            console.error('Outer error:', err.message);
            clearTimeout(forceCleanupTimer);
            sessionStorage.clear();
            try {
                if (Gifted?.ev) Gifted.ev.removeAllListeners();
                if (Gifted?.ws && Gifted.ws.readyState === 1) await Gifted.ws.close();
                Gifted.authState = null;
            } catch {}
            removeFile(authDir).catch(() => {});
            if (!res.headersSent) res.status(500).send({ error: "Service Unavailable" });
        }
    }

    await GIFTED_PAIR_CODE();
});

module.exports = router;
