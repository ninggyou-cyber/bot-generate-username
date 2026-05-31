// Login BANYAK akun sekaligus: node login-multi.js
// Semua sesi dikumpulkan ke file sessions.env dalam format siap-paste:
//   TG_SESSION=...
//   TG_SESSION_2=...
//   TG_SESSION_3=...
// Tinggal buka sessions.env → copy semua → paste ke Railway → Variables → Raw Editor.

require('dotenv').config();
const { TelegramClient } = require('telegram');
const { StringSession }  = require('telegram/sessions');
const readline = require('readline');
const fs = require('fs');

const apiId   = parseInt(process.env.TG_API_ID, 10);
const apiHash = process.env.TG_API_HASH;
const OUT     = 'sessions.env';

if (!apiId || !apiHash) {
  console.error('[!] TG_API_ID dan TG_API_HASH belum diset di .env');
  process.exit(1);
}

const rl  = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((res) => rl.question(q, res));

async function loginOne(n) {
  console.log(`\n=== LOGIN AKUN #${n} ===`);
  const client = new TelegramClient(new StringSession(''), apiId, apiHash, { connectionRetries: 3 });
  await client.start({
    phoneNumber: async () => ask(`[#${n}] Nomor HP (+62...)            : `),
    phoneCode:   async () => ask(`[#${n}] Kode OTP                     : `),
    password:    async () => ask(`[#${n}] Password 2FA (Enter jika -)  : `),
    onError:     (err) => console.error('   Error:', err.message),
  });
  const s = client.session.save();
  await client.disconnect();
  return s;
}

function writeOut(sessions) {
  const lines = sessions.map((s, i) => (i === 0 ? `TG_SESSION=${s}` : `TG_SESSION_${i + 1}=${s}`));
  fs.writeFileSync(OUT, lines.join('\n') + '\n', 'utf8');
}

async function main() {
  console.log('\n=== LOGIN BANYAK AKUN TELEGRAM ===');
  console.log('Login akun satu per satu. Jawab "n" saat ditanya lanjut untuk berhenti.\n');

  const sessions = [];
  while (true) {
    if (sessions.length > 0) {
      const cont = (await ask(`\nLanjut login akun ke-${sessions.length + 1}? (y/n): `)).trim().toLowerCase();
      if (cont === 'n' || cont === 'no') break;
    }
    try {
      sessions.push(await loginOne(sessions.length + 1));
      writeOut(sessions); // simpan progres tiap akun (aman kalau berhenti di tengah)
      console.log(`✅ Akun #${sessions.length} berhasil & tersimpan ke ${OUT}`);
    } catch (e) {
      console.error(`❌ Akun #${sessions.length + 1} gagal: ${e.message}`);
      const retry = (await ask('   Coba akun ini lagi? (y/n): ')).trim().toLowerCase();
      if (retry === 'n' || retry === 'no') break;
    }
  }

  if (sessions.length === 0) { console.log('\nTidak ada akun yang berhasil.'); rl.close(); return; }

  console.log(`\n✅ Selesai — ${sessions.length} akun tersimpan di ${OUT}`);
  console.log('   Buka file itu, copy SEMUA isinya, paste ke Railway → Variables → Raw Editor.');
  console.log('   (hapus dulu baris TG_SESSION lama di Railway sebelum paste yang baru)');
  rl.close();
}

main().catch((err) => { console.error('[!]', err.message); rl.close(); process.exit(1); });
