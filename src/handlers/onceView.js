const { downloadMediaMessage, jidNormalizedUser } = require('@whiskeysockets/baileys');
const fs = require('fs-extra');
const path = require('path');

module.exports = async (reaction, sock, store) => {
    try {
        const { key } = reaction;
        const remoteJid = key.remoteJid;

        console.log(`[Reaction] Received reaction for message ${key.id} in ${remoteJid}`);

        // 1. Retrieve message from store (With Retry for decryption/sync)
        let msg = null;
        for (let i = 0; i < 5; i++) {
            msg = await store.loadMessage(remoteJid, key.id);
            // Check if msg exists AND has non-empty message content
            if (msg && msg.message && Object.keys(msg.message).length > 0) break;

            console.log(`[Store] Message ${key.id} not found or content empty, retrying... (${i + 1}/5)`);
            await new Promise(res => setTimeout(res, 2000));
        }

        if (!msg || !msg.message || Object.keys(msg.message).length === 0) {
            console.log(`[Error] Message ${key.id} content still missing in store after retries.`);
            return;
        }

        // 2. PsychoBot-V2 "Unpacking" Logic
        let content = msg.message;

        // Sequential peeling of wrappers
        if (content.ephemeralMessage) content = content.ephemeralMessage.message;
        if (content.viewOnceMessage) content = content.viewOnceMessage.message;
        if (content.viewOnceMessageV2) content = content.viewOnceMessageV2.message;
        if (content.viewOnceMessageV2Extension) content = content.viewOnceMessageV2Extension.message;

        const msgType = Object.keys(content)[0];
        const mediaMsg = content[msgType];

        const isMedia = ['imageMessage', 'videoMessage', 'audioMessage'].includes(msgType);

        if (!isMedia) {
            console.log("[Error] Reacted message is not a recognized media type.");
            console.log("[Debug] Unpacked keys:", JSON.stringify(Object.keys(content || {})));
            return;
        }

        console.log(`[Extract] ${msgType.replace('Message', '').toUpperCase()} (Psycho-Logic) detected! Downloading...`);

        // 3. Download using downloadMediaMessage (PsychoBot Primitive)
        try {
            const buffer = await downloadMediaMessage(
                msg,
                'buffer',
                {},
                {
                    logger: console,
                    reuploadRequest: sock.updateMediaMessage
                }
            );

            if (buffer && buffer.length > 0) {
                const ownerJid = jidNormalizedUser(sock.user.id);
                const destination = ownerJid;

                let options = {};
                const sender = key.participant || remoteJid;
                const caption = `🔓 *Psycho-Extract: ViewOnce Extracted*\n\n*From:* @${sender.split('@')[0]}\n*Type:* ${msgType.replace('Message', '').toUpperCase()}`;

                if (msgType === 'imageMessage') {
                    options = { image: buffer, caption, mentions: [sender] };
                } else if (msgType === 'videoMessage') {
                    options = { video: buffer, caption, mentions: [sender] };
                } else if (msgType === 'audioMessage') {
                    options = { audio: buffer, mimetype: mediaMsg.mimetype || 'audio/ogg', ptt: mediaMsg.ptt };
                } else {
                    options = { document: buffer, mimetype: mediaMsg.mimetype, fileName: mediaMsg.fileName || 'extracted_media' };
                }

                await sock.sendMessage(destination, options);
                console.log(`[Success] ViewOnce extracted and sent to ${destination}`);
            } else {
                console.log("[Error] Downloaded buffer is empty or failed.");
            }
        } catch (downloadErr) {
            console.error('[EXTRACT] Download Error:', downloadErr.message);
        }

    } catch (err) {
        console.error('[EXTRACT] Critical Error:', err);
    }
};
