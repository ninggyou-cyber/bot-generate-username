// Jalankan sekali: node login.js
// Setelah berhasil, session tersimpan otomatis ke session.txt

require('dotenv').config();
const { TelegramClient } = require('telegram');
const { StringSession }  = require('telegram/sessions');
const readline = require('readline');
const fs = require('fs');

const apiId   = parseInt(process.env.TG_API_ID,  10);
const apiHash = process.env.TG_API_HASH;

if (!apiId || !apiHash) {
  console.error('[!] TG_API_ID dan TG_API_HASH belum diset di .env');
  process.exit(1);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((res) => rl.question(q, res));

async function main() {
  console.log('\n=== LOGIN AKUN TELEGRAM ===\n');

  const client = new TelegramClient(new StringSession(''), apiId, apiHash, {
    connectionRetries: 3,
  });

  await client.start({
    phoneNumber:  async () => ask('Nomor HP (format +62xxx): '),
    phoneCode:    async () => ask('Kode OTP yang diterima : '),
    password:     async () => ask('Password 2FA (Enter jika tidak ada): '),
    onError:      (err) => console.error('Error:', err.message),
  });

  const session = client.session.save();
  fs.writeFileSync('session.txt', session, 'utf8');

  console.log('\n✅ Login berhasil! Session disimpan ke session.txt');
  console.log('   Sekarang jalankan: npm start\n');

  await client.disconnect();
  rl.close();
}

main().catch((err) => {
  console.error('[!] Login gagal:', err.message);
  rl.close();
  process.exit(1);
});
