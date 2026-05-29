require('dotenv').config();
const { TelegramClient } = require('telegram');
const { StringSession }  = require('telegram/sessions');
const { Api }            = require('telegram');
const { Logger }         = require('telegram/extensions/Logger');
const fs   = require('fs');
const path = require('path');

const SESSION_FILE = path.join(__dirname, 'session.txt');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let client      = null;
let connectingP = null;

// Adaptive throttle: mulai dari TG_CHECK_DELAY_MS, naik otomatis kalau kena FloodWait
let baseDelay   = parseInt(process.env.TG_CHECK_DELAY_MS || '800', 10);
const MAX_DELAY = 3500;

async function getClient() {
  if (client?.connected) return client;
  if (connectingP) return connectingP;

  connectingP = (async () => {
    const apiId   = parseInt(process.env.TG_API_ID, 10);
    const apiHash = process.env.TG_API_HASH;
    // Prioritas: env TG_SESSION (untuk Railway/hosting) → file session.txt (lokal)
    const session = (process.env.TG_SESSION || (fs.existsSync(SESSION_FILE)
      ? fs.readFileSync(SESSION_FILE, 'utf8')
      : '')).trim();

    if (!apiId || !apiHash) throw new Error('TG_API_ID / TG_API_HASH belum diset di .env');
    if (!session)           throw new Error('Session belum ada — set TG_SESSION atau jalankan: npm run login');

    client = new TelegramClient(new StringSession(session), apiId, apiHash, {
      connectionRetries: Infinity, // jangan pernah menyerah reconnect
      autoReconnect:     true,
      retryDelay:        2000,
      timeout:           20000,
      useWSS:            false,
      baseLogger:        new Logger('none'), // matikan spam log gramJS
    });

    await client.connect();
    connectingP = null;
    return client;
  })();

  return connectingP;
}

// Ambil durasi FloodWait (detik) dari error, kalau ada
function floodSeconds(err) {
  if (typeof err?.seconds === 'number') return err.seconds;
  const m = String(err?.errorMessage || err?.message || '').match(/FLOOD_WAIT_(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

// Sekali cek → 'available' | 'taken' | 'invalid'
// Lempar error hanya untuk kasus yang layak retry (FloodWait / koneksi)
async function checkOnce(username) {
  const c = await getClient();
  try {
    const ok = await c.invoke(new Api.account.CheckUsername({ username }));
    return ok ? 'available' : 'taken';
  } catch (err) {
    const msg = String(err?.errorMessage || err?.message || '');
    if (msg.includes('USERNAME_INVALID'))            return 'invalid';
    if (msg.includes('USERNAME_PURCHASE_AVAILABLE')) return 'available';
    throw err; // flood / koneksi → biar dihandle resolveUsername
  }
}

// Cek dengan retry. Hanya throw kalau benar-benar gagal setelah semua usaha
// (→ pemanggil masukkan ke bucket 'uncertain', bukan 'taken')
async function resolveUsername(username, maxRetries = 4) {
  let attempt = 0;
  while (true) {
    try {
      return await checkOnce(username);
    } catch (err) {
      const fw = floodSeconds(err);

      if (fw != null) {
        // FloodWait terlalu lama → menyerah, biar jadi 'uncertain'
        if (fw > 300) throw new Error(`FLOOD_WAIT ${fw}s (terlalu lama)`);
        // naikkan delay dasar biar batch berikutnya lebih aman
        baseDelay = Math.min(baseDelay + 300, MAX_DELAY);
        await sleep((fw + 1) * 1000);
        continue; // flood = bukan kegagalan, retry tanpa nambah attempt
      }

      attempt++;
      if (attempt > maxRetries) throw err; // koneksi gagal terus → uncertain
      await sleep(1200 * attempt);         // backoff untuk error koneksi
    }
  }
}

const getBaseDelay = () => baseDelay;

module.exports = { resolveUsername, getBaseDelay };
