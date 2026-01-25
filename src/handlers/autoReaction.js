const { proto } = require("@whiskeysockets/baileys");

module.exports = async (msg, sock) => {
    try {
        if (!msg.message) return;
        if (msg.key.fromMe) return;

        // 1. Get text content from various possible message types
        let text = "";
        const m = msg.message;

        text = m.conversation ||
            m.extendedTextMessage?.text ||
            m.imageMessage?.caption ||
            m.videoMessage?.caption ||
            m.documentMessage?.caption ||
            m.viewOnceMessage?.message?.imageMessage?.caption ||
            m.viewOnceMessage?.message?.videoMessage?.caption ||
            m.viewOnceMessageV2?.message?.imageMessage?.caption ||
            m.viewOnceMessageV2?.message?.videoMessage?.caption ||
            "";

        if (!text) return;

        // 2. Extract first emoji
        // Using a more comprehensive regex for emojis
        const emojiRegex = /[\u{1F300}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F1E6}-\u{1F1FF}]/u;
        const match = text.match(emojiRegex);

        if (match) {
            const emoji = match[0];
            await sock.sendMessage(msg.key.remoteJid, {
                react: {
                    text: emoji,
                    key: msg.key
                }
            });
            console.log(`Auto-reacted with ${emoji} to ${msg.key.id}`);
        }
    } catch (error) {
        console.error("Error in autoReaction handler:", error);
    }
};
