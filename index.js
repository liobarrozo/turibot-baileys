const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const http = require('http');
const fs = require('fs');

// =================================================================
// 1. SERVIDOR FANTASMA (Para que Railway no te mate)
// =================================================================
const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Turibot (Baileys): Online y ligero.');
});

server.listen(PORT, () => {
    console.log(`✅ [SERVER] Escuchando en puerto ${PORT}`);
});

// =================================================================
// 2. CONFIGURACIÓN Y DATOS
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

// =================================================================
// 3. LÓGICA DE CONEXIÓN (BAILEYS)
// =================================================================

async function connectToWhatsApp() {
    // Baileys guarda la sesión en una carpeta 'auth_info_baileys'
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true, 
        // Optimizaciones de red
        browser: ['Turibot', 'Chrome', '1.0.0'],
        syncFullHistory: false 
    });

    // Monitoreo de la conexión
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('⚠️ ESCANEA EL QR ARRIBA (Usa la vista Raw si se ve feo)');
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('❌ Conexión cerrada debido a:', lastDisconnect.error, ', reconectando:', shouldReconnect);
            
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('🚀 [BAILEYS] Conectado exitosamente!');
        }
    });

    // Guardar credenciales cuando cambian
    sock.ev.on('creds.update', saveCreds);

    // =================================================================
    // 4. LÓGICA DE MENSAJES
    // =================================================================
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];

        if (!msg.message) return; // Si no hay mensaje, salir
        if (msg.key.fromMe) return; // Ignorar mensajes propios

        // DETECTAR TIPO DE MENSAJE (Texto simple o Extendido)
        const tipo = Object.keys(msg.message)[0];
        
        // Ignorar estados (status@broadcast)
        if (msg.key.remoteJid === 'status@broadcast') return;

        // Extraer el texto real (Baileys es un poco más complejo aquí que WPPConnect)
        const text = msg.message.conversation || 
                     msg.message.extendedTextMessage?.text || 
                     msg.message.imageMessage?.caption ||
                     '';
        
        if (!text) return;

        const user = msg.key.remoteJid;
        const cleanText = text.toLowerCase().trim();
        
        console.log(`📩 [MSG] De: ${user} | Texto: ${cleanText}`);

        // --- FUNCIONES DE AYUDA PARA ENVIAR ---
        const sendText = async (jid, txt) => {
            await sock.sendMessage(jid, { text: txt });
        };

        // --- PING ---
        if (cleanText === '!ping') {
            await sendText(user, '🏓 Pong! (Baileys vLight)');
            return;
        }

        // --- GESTIÓN DE ESTADO ---
        if (!chatState[user]) chatState[user] = { mode: 'bot', step: 'MAIN_MENU' };

        if (cleanText === 'bot on') {
            chatState[user].mode = 'bot';
            chatState[user].step = 'MAIN_MENU';
            await sendText(user, '🤖 Turibot reactivado.');
            return;
        }

        if (chatState[user].mode === 'human') return;

        // --- COMANDO VOLVER ---
        if (['volver', 'menu', 'inicio', '0'].includes(cleanText)) {
            chatState[user].step = 'MAIN_MENU';
            await sendText(user, `🔙 *Menú Principal*\n\n1️⃣ Excursiones\n2️⃣ Ubicación\n3️⃣ Tips\n4️⃣ Asesor`);
            return;
        }

        // --- MENÚS ---

        // PASO 1: CATEGORÍAS
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

        // PASO 2: MENÚ PRINCIPAL
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
                
                // Alerta al dueño
                if (!OWNER_NUMBER.includes('XXXX')) {
                    const cleanPhone = user.split('@')[0];
                    await sendText(OWNER_NUMBER, `🔔 Alerta Humano: https://wa.me/${cleanPhone}`);
                }
                return;
            }
        }
    });
}

// Iniciar
connectToWhatsApp();