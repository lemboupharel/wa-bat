const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    delay,
    jidNormalizedUser // ADDED
} = require("@whiskeysockets/baileys");
const fs = require('fs-extra');
const pino = require('pino');
const path = require('path');
const { Boom } = require("@hapi/boom");

const qrcode = require("qrcode-terminal");

// Handlers
const onceViewHandler = require('./src/handlers/onceView');
const autoReactionHandler = require('./src/handlers/autoReaction');
const autoResponseHandler = require('./src/handlers/autoResponse');

// Session directory
const SESSION_DIR = './session';
const CREDS_PATH = './creds.json';

// Store Setup (Manual Implementation)
const store = {
    messages: {},
    loadMessage: async (remoteJid, id) => {
        const normalizedJid = jidNormalizedUser(remoteJid);
        const chat = store.messages[normalizedJid] || [];
        let msg = chat.find(m => m.key.id === id);

        // Fallback: search in all chats if not found (needed for some cross-JID events)
        if (!msg) {
            console.log(`[Store] Message ${id} not found in ${normalizedJid}, searching globally...`);
            for (const jid in store.messages) {
                msg = store.messages[jid].find(m => m.key.id === id);
                if (msg) {
                    console.log(`[Store] Found message ${id} in ${jid} instead.`);
                    break;
                }
            }
        }
        return msg;
    },
    bind: (ev) => {
        // Handle New Messages
        ev.on('messages.upsert', ({ messages }) => {
            for (const msg of messages) {
                if (!msg.key.remoteJid) continue;
                const jid = jidNormalizedUser(msg.key.remoteJid);
                if (!store.messages[jid]) store.messages[jid] = [];
                store.messages[jid].push(msg);
                console.log(`[Store] Added message ${msg.key.id} from ${jid}`);
                if (store.messages[jid].length > 1000) store.messages[jid].shift();
            }
        });

        // Handle Message Updates (Decryption completed, etc.)
        ev.on('messages.update', (updates) => {
            for (const { key, update } of updates) {
                const jid = jidNormalizedUser(key.remoteJid);
                if (store.messages[jid]) {
                    const index = store.messages[jid].findIndex(m => m.key.id === key.id);
                    if (index !== -1) {
                        console.log(`[Store] Updating content for message ${key.id}`);
                        store.messages[jid][index] = { ...store.messages[jid][index], ...update };
                    }
                }
            }
        });

        // Handle History Sync (Priming the store)
        ev.on('messaging-history.set', ({ messages }) => {
            console.log(`[Store] Syncing history: ${messages.length} messages received.`);
            for (const msg of messages) {
                if (!msg.key.remoteJid) continue;
                const jid = jidNormalizedUser(msg.key.remoteJid);
                if (!store.messages[jid]) store.messages[jid] = [];
                store.messages[jid].push(msg);
                if (store.messages[jid].length > 2000) store.messages[jid].shift();
            }
        });
    }
};

// Keep track of the current socket instance to prevent multiple connections
let sockInstance = null;

async function startBot() {
    if (sockInstance) {
        console.log('Bot already running or connecting. Skipping startBot call.');
        return;
    }

    console.log('--- Elise-Bot Starting ---');

    // Ensure session directory exists
    if (!fs.existsSync(SESSION_DIR)) {
        fs.mkdirSync(SESSION_DIR, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    const { version } = await fetchLatestBaileysVersion();

    sockInstance = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
        },
        browser: ["Elise-Bot", "Chrome", "1.0.0"],
        syncFullHistory: false,
        shouldSyncHistoryMessage: () => false,
        connectTimeoutMs: 90000, // Increase to 90s for slower environments
        defaultQueryTimeoutMs: 0,
        keepAliveIntervalMs: 10000,
        retryRequestDelayMs: 5000,
        getMessage: async (key) => {
            if (store) {
                const msg = await store.loadMessage(key.remoteJid, key.id);
                return msg?.message || undefined;
            }
            return undefined;
        }
    });

    const sock = sockInstance;

    // Bind store to socket
    store.bind(sock.ev);

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.clear(); // Clear terminal to make QR visible
            console.log('--- NEW QR CODE GENERATED ---');
            qrcode.generate(qr, { small: true });
            console.log('Scan this with your mobile device (WhatsApp > Linked Devices).');
        }

        if (connection === 'close') {
            const statusCode = (lastDisconnect.error)?.output?.statusCode || lastDisconnect.error?.message;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

            console.log('Connection closed. Reason:', statusCode);

            if (statusCode === 401 || statusCode === 403) {
                console.log('Session expired or unauthorized. Clearing session...');
                await fs.remove(SESSION_DIR);
                if (fs.existsSync(CREDS_PATH)) await fs.remove(CREDS_PATH);
            }

            sockInstance = null;
            if (shouldReconnect) {
                console.log('Attempting to reconnect in 5 seconds...');
                setTimeout(startBot, 5000);
            } else {
                console.log('Logged out. Run "npm run clear" and restart.');
            }
        } else if (connection === 'open') {
            const userJid = jidNormalizedUser(sock.user.id);
            console.log(`Bot Connected Successfully! ✅ (User: ${userJid})`);
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages[0];
            if (!msg || !msg.message) return;
            if (msg.key.fromMe) return;

            // Auto Reaction
            await autoReactionHandler(msg, sock);

            // Auto Response
            await autoResponseHandler(msg, sock);

        } catch (err) {
            console.error('Error in messages.upsert', err);
        }
    });

    sock.ev.on('messages.reaction', async (reactions) => {
        // Wait a bit to ensure the message content is decrypted and stored
        await delay(2000);
        for (const reaction of reactions) {
            await onceViewHandler(reaction, sock, store);
        }
    });
}

// Start the bot automatically
startBot();

module.exports = { startBot, store };
