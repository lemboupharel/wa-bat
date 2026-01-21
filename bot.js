const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    delay
} = require("@whiskeysockets/baileys");
const fs = require('fs-extra');
const pino = require('pino');
const path = require('path');
const { Boom } = require("@hapi/boom");

// Handlers
const onceViewHandler = require('./src/handlers/onceView');
const autoReactionHandler = require('./src/handlers/autoReaction');
const autoResponseHandler = require('./src/handlers/autoResponse');

// Session directory
const SESSION_DIR = './session';
const CREDS_PATH = './creds.json';

// Minimal Store Setup
const store = {
    messages: {},
    loadMessage: async (jid, id) => {
        const list = store.messages[jid] || [];
        return list.find(m => m.key.id === id);
    },
    bind: (ev) => {
        ev.on('messages.upsert', ({ messages }) => {
            for (const msg of messages) {
                const jid = msg.key.remoteJid;
                if (!store.messages[jid]) store.messages[jid] = [];
                store.messages[jid].push(msg);
                // Keep last 100 messages per chat to save RAM
                if (store.messages[jid].length > 100) store.messages[jid].shift();
            }
        });
    }
};

async function startBot() {
    console.log('Starting Bot...');

    // Ensure session directory exists and has creds
    if (!fs.existsSync(SESSION_DIR)) {
        fs.mkdirSync(SESSION_DIR);
    }

    // If creds.json exists in root but not in session, copy it
    if (fs.existsSync(CREDS_PATH) && !fs.existsSync(path.join(SESSION_DIR, 'creds.json'))) {
        console.log('Found creds.json in root, copying to session folder...');
        fs.copySync(CREDS_PATH, path.join(SESSION_DIR, 'creds.json'));
    }

    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: true, // Should not happen if creds exist
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
        },
        browser: ["Elise-Bot", "Chrome", "1.0.0"],
        generateHighQualityLinkPreview: true,
    });

    sock.ev.on('creds.update', saveCreds);

    // Bind store to socket
    store.bind(sock.ev);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed due to ', lastDisconnect.error, ', reconnecting ', shouldReconnect);
            if (shouldReconnect) {
                startBot();
            } else {
                console.log('Logged out. Please re-pair.');
            }
        } else if (connection === 'open') {
            console.log('Bot Connected Successfully!');
        }
    });

    // Event Listeners for Features

    // 1. Once View & 2. Auto Reaction & 3. Auto Response
    // We can listen to upsert for text/reaction

    sock.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages[0];
            if (!msg.message) return;
            if (msg.key.fromMe) return; // Don't react to self? Or maybe we do for some features? 
            // User requested "auto reations on messages in every chats". Maybe even self?
            // Usually bots don't react to self to avoid loops.

            // Auto Reaction
            await autoReactionHandler(msg, sock);

            // Auto Response
            await autoResponseHandler(msg, sock);

        } catch (err) {
            console.error('Error in messages.upsert', err);
        }
    });

    sock.ev.on('messages.reaction', async (reactions) => {
        // Once View Extraction (Triggered by reaction)
        // reactions is an array
        for (const reaction of reactions) {
            await onceViewHandler(reaction, sock, store);
        }
    });
}

// Check if we can start
if (fs.existsSync(CREDS_PATH) || fs.existsSync(path.join(SESSION_DIR, 'creds.json'))) {
    startBot();
} else {
    console.log('No credentials found. Please pair first.');
}

module.exports = startBot;
