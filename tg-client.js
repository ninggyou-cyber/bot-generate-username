require('dotenv').config();
const { TelegramClient } = require('telegram');
const { StringSession }  = require('telegram/sessions');
const { Api }            = require('telegram');
const { Logger }         = require('telegram/extensions/Logger');
const fs   = require('fs');
const path = require('path');

const SESSION_FILE = path.join(__dirname, 'session.txt');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const apiId   = parseInt(process.env.TG_API_ID, 10);
const apiHash = process.env.TG_API_HASH;

// Jeda antar-cek Fase 2 (global). Rotasi akun yang jaga tiap akun tidak kebanjiran.
const CHECK_DELAY = parseInt(process.env.TG_CHECK_DELAY_MS || '1200', 10);
// Maks auto-tunggu per username saat SEMUA akun lagi limit (ms). Lewat ini → uncertain.
const MAX_WAIT_MS = parseInt(process.env.TG_MAX_WAIT_MS || '300000', 10);

// ── Kumpulkan semua sesi akun ────────────────────────────────────────────────
// Sumber: TG_SESSION, TG_SESSION_2..TG_SESSION_20, atau satu var dipisah , ; newline.
// Fallback ke file session.txt (lokal) kalau env kosong.
function collectSessions() {
  const out = [];
  const add = (v) => {
    if (!v) return;
    String(v).split(/[\n,;]+/).forEach((s) => { const t = s.trim(); if (t) out.push(t); });
  };
  add(process.env.TG_SESSION);
  for (let i = 2; i <= 50; i++) add(process.env[`TG_SESSION_${i}`]);
  if (out.length === 0 && fs.existsSync(SESSION_FILE)) add(fs.readFileSync(SESSION_FILE, 'utf8'));
  return [...new Set(out)];
}

const accounts = collectSessions().map((session, i) => ({
  id: i + 1,
  session,
  client: null,
  connecting: null,
  cooldownUntil: 0, // epoch ms — akun tidak dipakai sampai waktu ini
  lastUsed: 0,
  disabled: false,  // session mati/revoked → jangan dipakai lagi
}));

function assertReady() {
  if (!apiId || !apiHash)    throw new Error('TG_API_ID / TG_API_HASH belum diset');
  if (accounts.length === 0) throw new Error('Session belum ada — set TG_SESSION atau jalankan: npm run login');
}

async function connect(acc) {
  if (acc.client?.connected) return acc.client;
  if (acc.connecting)        return acc.connecting;
  acc.connecting = (async () => {
    if (acc.client) { try { await acc.client.disconnect(); } catch (_) {} }
    const c = new TelegramClient(new StringSession(acc.session), apiId, apiHash, {
      connectionRetries: Infinity, // jangan pernah menyerah reconnect
      autoReconnect:     true,
      retryDelay:        2000,
      timeout:           20000,
      useWSS:            false,
      baseLogger:        new Logger('none'),
    });
    await c.connect();
    acc.client = c;
    return c;
  })();
  try { return await acc.connecting; }
  finally { acc.connecting = null; }
}

// Ambil durasi FloodWait (detik) dari error, kalau ada
function floodSeconds(err) {
  if (typeof err?.seconds === 'number') return err.seconds;
  const m = String(err?.errorMessage || err?.message || '').match(/FLOOD_WAIT_(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

const isDeadSession = (msg) =>
  /AUTH_KEY|SESSION_REVOKED|SESSION_EXPIRED|USER_DEACTIVATED|UNAUTHORIZED/i.test(msg);

// Pilih akun yang siap (cooldown lewat & tidak disabled), round-robin paling nganggur
function pickReady() {
  const now = Date.now();
  const ready = accounts.filter((a) => !a.disabled && a.cooldownUntil <= now);
  if (ready.length === 0) return null;
  ready.sort((a, b) => a.lastUsed - b.lastUsed);
  return ready[0];
}

// Cek satu username → 'available' | 'taken' | 'invalid'.
// Rotasi akun otomatis saat kena limit; auto-tunggu kalau semua akun limit.
// Throw hanya kalau benar-benar gagal (→ pemanggil masukkan ke bucket 'uncertain').
async function resolveUsername(username, opts = {}) {
  assertReady();
  const onWait = typeof opts.onWait === 'function' ? opts.onWait : null;
  let waited = 0;
  let connErrors = 0;

  while (true) {
    const acc = pickReady();

    // ── Semua akun lagi dingin → auto-tunggu sampai yang tercepat bebas ──────
    if (!acc) {
      const live = accounts.filter((a) => !a.disabled);
      if (live.length === 0) throw new Error('Semua akun verifikasi mati/diblokir');
      const soonest = Math.min(...live.map((a) => a.cooldownUntil));
      const wait    = Math.max(1000, soonest - Date.now());
      if (waited + wait > MAX_WAIT_MS) throw new Error('Limit Telegram terlalu lama di semua akun');
      onWait?.(Math.ceil(wait / 1000));
      await sleep(wait);
      waited += wait;
      continue;
    }

    acc.lastUsed = Date.now();
    try {
      const ok = await (await connect(acc)).invoke(new Api.account.CheckUsername({ username }));
      return ok ? 'available' : 'taken';
    } catch (err) {
      const msg = String(err?.errorMessage || err?.message || '');
      if (msg.includes('USERNAME_INVALID'))            return 'invalid';
      if (msg.includes('USERNAME_PURCHASE_AVAILABLE')) return 'available';

      if (isDeadSession(msg)) {
        acc.disabled = true;
        console.error(`[tg] Akun #${acc.id} dinonaktifkan (${msg.slice(0, 40)})`);
        continue; // coba akun lain
      }

      const fw = floodSeconds(err);
      if (fw != null) {
        acc.cooldownUntil = Date.now() + (fw + 1) * 1000; // dinginkan akun ini
        continue;                                          // username dicoba akun lain / ditunggu
      }

      // error koneksi → dinginkan sebentar akun ini, coba akun lain
      connErrors++;
      acc.cooldownUntil = Date.now() + 3000;
      if (connErrors > Math.max(4, accounts.length * 2)) throw err; // gagal terus → uncertain
    }
  }
}

const getBaseDelay = () => CHECK_DELAY;
const accountCount = () => accounts.filter((a) => !a.disabled).length;

module.exports = { resolveUsername, getBaseDelay, accountCount };
