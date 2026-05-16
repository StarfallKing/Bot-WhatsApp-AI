const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const pino = require('pino');

// Mengambil API Key dari Environment Variable
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

async function startBot() {
    // Menyimpan sesi login biar gak perlu scan/pairing terus saat server restart
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false, // Kita matikan QR karena pakai Pairing Code
        logger: pino({ level: "silent" }),
        browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

    // Fitur Pairing Code
    if (!sock.authState.creds.registered) {
        const phoneNumber = process.env.PHONE_NUMBER; 
        if (phoneNumber) {
            setTimeout(async () => {
                let code = await sock.requestPairingCode(phoneNumber);
                // Memformat kode jadi 8 digit dengan strip biar gampang dibaca
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                console.log(`\n================================`);
                console.log(`KODE PAIRING WA LU: ${code}`);
                console.log(`================================\n`);
            }, 3000);
        } else {
            console.log("Nomor HP belum diisi di Environment Variables!");
        }
    }

    // Simpan kredensial login setiap ada pembaruan
    sock.ev.on('creds.update', saveCreds);

    // Monitor koneksi WhatsApp
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Koneksi terputus, mencoba nyambung lagi...');
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('Bot WA berhasil terhubung dan siap balas chat!');
        }
    });

    // Menangani pesan masuk
    sock.ev.on('messages.upsert', async m => {
        const msg = m.messages[0];
        
        // Jangan balas pesan dari diri sendiri atau sistem
        if (!msg.message || msg.key.fromMe) return;

        const sender = msg.key.remoteJid;
        const textMessage = msg.message.conversation || msg.message.extendedTextMessage?.text;

        if (textMessage) {
            console.log(`Pesan masuk: ${textMessage}`);
            try {
                // Melempar pesan ke Gemini AI
                const result = await model.generateContent(textMessage);
                const response = result.response.text();

                // Balas ke WA dengan jeda 3 detik biar gak dianggap spam
                setTimeout(async () => {
                    await sock.sendMessage(sender, { text: response });
                }, 3000);
            } catch (error) {
                console.log("Waduh, Gemini error:", error);
            }
        }
    });
}

startBot();
