const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const http = require('http');
const fs = require('fs');

const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Turibot: Online');
});
server.listen(PORT, () => console.log(`✅ Server en ${PORT}`));

const OWNER_NUMBER = '5492615543675@s.whatsapp.net'; 
const WEB_URL = 'https://wanderlust.turisuite.com';

const CATEGORIES = [
    { id: 'rutas-del-vino', label: '🍷 Rutas del Vino', description: 'Degustaciones premium.' },
    { id: 'potrerillos', label: '🏔️ Potrerillos', description: 'Dique y montaña.' },
    { id: 'experiencias-autor', label: '🌟 Experiencias', description: 'Actividades exclusivas.' },
    { id: 'programas', label: '📋 Programas', description: 'Paquetes completos.' }
];


const chatState = {}; 

setInterval(() => {
    const now = Date.now();
    const LIMIT = 30 * 60 * 1000; 
    let deletedCount = 0;

    Object.keys(chatState).forEach(user => {
        if (now - chatState[user].lastInteraction > LIMIT) {
            delete chatState[user];
            deletedCount++;
        }
    });
    
    if (deletedCount > 0) {
        if (global.gc) { global.gc(); } 
        console.log(`🧹 [GC] Se eliminaron ${deletedCount} usuarios inactivos de la memoria.`);
    }
}, 30 * 60 * 1000);

// =================================================================
// 3. LÓGICA DE CONEXIÓN
// =================================================================

const msgRetryCounterCache = new Map();

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        // OPTIMIZACIÓN 3: Configuraciones de bajo consumo
        syncFullHistory: false,      // Ya lo tenías, vital.
        generateHighQualityLinkPreview: false, // AHORRA MUCHA RAM
        markOnlineOnConnect: false,  // Ahorra un poco de proceso
        msgRetryCounterCache,        // Gestión eficiente de reintentos
        browser: ['Turibot_Lite', 'Chrome', '1.0.0'], 
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('\n================ ESCANEA EL QR ================\n');
            qrcode.generate(qr, { small: true }); 
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('❌ Desconectado. Reconectando:', shouldReconnect);
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            console.log('🚀 [BAILEYS] Conectado y optimizado.');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // =================================================================
    // 4. LÓGICA DE MENSAJES
    // =================================================================
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;
        if (msg.key.remoteJid === 'status@broadcast') return;

        const text = msg.message.conversation || 
                     msg.message.extendedTextMessage?.text || 
                     msg.message.imageMessage?.caption || '';
        
        if (!text) return;

        const user = msg.key.remoteJid;
        const cleanText = text.toLowerCase().trim();
        
        // ACTUALIZAR ESTADO Y TIMESTAMP
        // Si no existe, lo crea. Si existe, actualiza el tiempo.
        if (!chatState[user]) {
            chatState[user] = { mode: 'bot', step: 'MAIN_MENU', lastInteraction: Date.now() };
        } else {
            chatState[user].lastInteraction = Date.now();
        }

        const sendText = async (jid, txt) => {
            await sock.sendMessage(jid, { text: txt });
        };

        // --- COMANDOS ---

        if (cleanText === '!ping') {
            // Monitor de memoria RAM en tiempo real
            const used = process.memoryUsage().rss / 1024 / 1024;
            await sendText(user, `🏓 Pong!\n🧠 RAM: ${Math.round(used * 100) / 100} MB`);
            return;
        }

        if (cleanText === 'bot on') {
            chatState[user].mode = 'bot';
            chatState[user].step = 'MAIN_MENU';
            await sendText(user, '🤖 Turibot reactivado.');
            return;
        }

        if (chatState[user].mode === 'human') return;

        if (['volver', 'menu', 'inicio', '0'].includes(cleanText)) {
            chatState[user].step = 'MAIN_MENU';
            await sendText(user, `🔙 *Menú Principal*\n\n1️⃣ Excursiones\n2️⃣ Ubicación\n3️⃣ Tips\n4️⃣ Asesor`);
            return;
        }

        // --- FLUJO DEL BOT ---
        if (chatState[user].step === 'SELECT_CATEGORY') {
            const selection = parseInt(cleanText);
            if (!isNaN(selection) && selection > 0 && selection <= CATEGORIES.length) {
                const cat = CATEGORIES[selection - 1];
                await sendText(user, `✅ *${cat.label}*\n📝 ${cat.description}\n🔗 ${WEB_URL}/?category=${cat.id}\n\n_0 para volver._`);
            } else {
                await sendText(user, '⚠️ Opción inválida. Envía el número o "0".');
            }
            return;
        }

        if (chatState[user].step === 'MAIN_MENU') {
            if (['hola', 'buenas', 'turibot', 'menu'].some(w => cleanText.includes(w))) {
                await sendText(user, `👋 ¡Hola! Bienvenido a *Wanderlust*.\n\n1️⃣ Excursiones\n2️⃣ Ubicación\n3️⃣ Tips\n4️⃣ Asesor`);
                return;
            }

            if (cleanText === '1' || cleanText.includes('excursiones')) {
                chatState[user].step = 'SELECT_CATEGORY';
                let menu = '🏔️ *Categorías:*\n';
                CATEGORIES.forEach((cat, i) => { menu += `${i + 1}. ${cat.label}\n`; });
                menu += '\nEnvía el número o *0* para volver.';
                await sendText(user, menu);
                return;
            }

            if (cleanText === '2') {
                await sendText(user, `📍 Av. San Martín 123, Mendoza.`);
                return;
            }

            if (cleanText === '3') {
                await sendText(user, `🎒 Tips: Agua, gorra y abrigo.`);
                return;
            }

            if (cleanText === '4') {
                chatState[user].mode = 'human';
                await sendText(user, '👨‍💻 He notificado a un asesor.');
                
                if (!OWNER_NUMBER.includes('XXXX')) {
                    const cleanPhone = user.split('@')[0];
                    await sendText(OWNER_NUMBER, `🔔 Alerta Humano: https://wa.me/${cleanPhone}`);
                }
                return;
            }
        }
    });
}

connectToWhatsApp();