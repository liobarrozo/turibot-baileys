const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const http = require('http');


const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end('OK'); 
});

server.listen(PORT, () => {
    console.log(`✅ [SERVER] Puerto ${PORT}`);
});

// =================================================================
// 2. CONFIGURACIÓN
// =================================================================
const OWNER_NUMBER = '5492615997309@s.whatsapp.net'; 
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
    const cleanLimit = 4 * 60 * 60 * 1000; 
    let deletedCount = 0;

    for (const user in chatState) {
        if (now - chatState[user].lastSeen > cleanLimit) {
            delete chatState[user];
            deletedCount++;
        }
    }
    if (deletedCount > 0) console.log(`[MEMORIA] Se limpiaron ${deletedCount} usuarios inactivos.`);
}, 60 * 60 * 1000); 

// =================================================================
// 3. CONEXIÓN
// =================================================================

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }), 
        browser: ['Turibot', 'Chrome', '1.0.0'],
        syncFullHistory: false,
        generateHighQualityLinkPreview: false, 
        markOnlineOnConnect: false 
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('\n================ ESCANEA EL QR ================');
            qrcode.generate(qr, { small: true }); 
            console.log('===============================================\n');
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log(' Desconectado. Reconectando:', shouldReconnect);
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            console.log('[BAILEYS] Conectado y Optimizado.');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // =================================================================
    // 4. MENSAJES
    // =================================================================
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        const msg = messages[0];
        if (!msg.message) return; 
        if (msg.key.fromMe) return; 

        // Ignorar estados explícitamente
        if (msg.key.remoteJid === 'status@broadcast') return;

        const text = msg.message.conversation || 
                     msg.message.extendedTextMessage?.text || 
                     msg.message.imageMessage?.caption ||
                     '';
        
        if (!text) return;

        const user = msg.key.remoteJid;
        const cleanText = text.toLowerCase().trim();
        
        console.log(`${user.split('@')[0]}: ${cleanText.substring(0, 20)}`);

        const sendText = async (jid, txt) => {
            await sock.sendMessage(jid, { text: txt });
        };

        // --- PING ---
        if (cleanText === '!ping') {
            const memoryUsage = process.memoryUsage().rss / 1024 / 1024;
            await sendText(user, `🏓 Pong! RAM: ${memoryUsage.toFixed(2)} MB`);
            return;
        }

        // --- GESTIÓN DE ESTADO ---
        // ⚡ Actualizamos el timestamp 'lastSeen' para que el limpiador no lo borre
        if (!chatState[user]) {
            chatState[user] = { mode: 'bot', step: 'MAIN_MENU', lastSeen: Date.now() };
        } else {
            chatState[user].lastSeen = Date.now();
        }

        if (cleanText === 'bot on') {
            chatState[user].mode = 'bot';
            chatState[user].step = 'MAIN_MENU';
            await sendText(user, '🤖 Reactivado.');
            return;
        }

        if (chatState[user].mode === 'human') return;

        // --- NAVEGACIÓN ---
        if (['volver', 'menu', 'inicio', '0'].includes(cleanText)) {
            chatState[user].step = 'MAIN_MENU';
            await sendText(user, `🔙 *Menú Principal*\n\n1️⃣ Excursiones\n2️⃣ Ubicación\n3️⃣ Tips\n4️⃣ Asesor`);
            return;
        }

        // --- MENÚS (Resumido para ahorrar caracteres en memoria) ---
        if (chatState[user].step === 'SELECT_CATEGORY') {
            const selection = parseInt(cleanText);
            if (!isNaN(selection) && selection > 0 && selection <= CATEGORIES.length) {
                const cat = CATEGORIES[selection - 1];
                await sendText(user, `✅ *${cat.label}*\n📝 ${cat.description}\n🔗 ${WEB_URL}/?category=${cat.id}\n\n_0 para volver._`);
            } else {
                await sendText(user, '⚠️ Opción inválida. Usa números o "0".');
            }
            return;
        }

        if (chatState[user].step === 'MAIN_MENU') {
            if (['hola', 'buenas', 'turibot', 'menu'].some(w => cleanText.includes(w))) {
                await sendText(user, `👋 ¡Hola! *Wanderlust Turismo*.\n\n1️⃣ Excursiones\n2️⃣ Ubicación\n3️⃣ Tips\n4️⃣ Asesor`);
                return;
            }

            if (cleanText === '1' || cleanText.includes('excursiones')) {
                chatState[user].step = 'SELECT_CATEGORY';
                let menu = '🏔️ *Categorías:*\n';
                CATEGORIES.forEach((cat, i) => { menu += `${i + 1}. ${cat.label}\n`; });
                menu += '\nEnvía número o *0*.';
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
                await sendText(user, '👨‍💻 Asesor notificado.');
                if (!OWNER_NUMBER.includes('XXXX')) {
                    const cleanPhone = user.split('@')[0];
                    await sendText(OWNER_NUMBER, `🔔 Alerta: https://wa.me/${cleanPhone}`);
                }
                return;
            }
        }
    });
}
connectToWhatsApp();