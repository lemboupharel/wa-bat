const fs = require('fs-extra');
const path = require('path');

async function cleanReset() {
    console.log('--- Elise-Bot Hard Reset ---');
    const sessionDir = './session';
    const credsFile = './creds.json';

    try {
        // Stop potential child processes or just warn
        console.log('Ensure the bot is NOT running before running this script.');

        if (fs.existsSync(sessionDir)) {
            console.log(`Deleting ${sessionDir}...`);
            await fs.remove(sessionDir);
        }
        if (fs.existsSync(credsFile)) {
            console.log(`Deleting ${credsFile}...`);
            await fs.remove(credsFile);
        }
        console.log('All session data cleared! ✅');
        console.log('Next steps:');
        console.log('1. Scan the new QR code in your terminal when you restart.');
        console.log('2. React to a NEW View Once message (old ones cannot be decrypted after reset).');
    } catch (err) {
        console.error('Error during reset:', err.message);
    }
}

cleanReset();
