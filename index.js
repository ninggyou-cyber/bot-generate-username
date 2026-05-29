require('dotenv').config();
const axios = require('axios');
const chalk = require('chalk');
const readline = require('readline');
const fs = require('fs');
const { generateVariations } = require('./generator');

const BASE_URL = 'https://robynhood.parssms.info';
const API_KEY = process.env.ROBYNHOOD_API_KEY;
const PRODUCT_TYPE = process.env.PRODUCT_TYPE || 'stars';
const DELAY_MS = parseInt(process.env.DELAY_MS || '400');
const QUANTITY = process.env.QUANTITY || '50';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function checkUsername(username) {
  const body = {
    product_type: PRODUCT_TYPE,
    query: username,
  };

  if (PRODUCT_TYPE === 'stars') body.quantity = QUANTITY;
  else if (PRODUCT_TYPE === 'premium') body.months = '1';
  else if (PRODUCT_TYPE === 'ads') body.amount = '1';

  const res = await axios.post(`${BASE_URL}/api/search`, body, {
    headers: {
      'X-API-Key': API_KEY,
      'Content-Type': 'application/json',
    },
    timeout: 10000,
  });

  return res.data;
}

async function runChecker(baseUsername) {
  console.log(chalk.cyan(`\n[*] Base username : @${baseUsername}`));
  const variations = generateVariations(baseUsername);
  console.log(chalk.cyan(`[*] Variasi dibuat: ${variations.length}`));
  console.log(chalk.cyan(`[*] Delay per req : ${DELAY_MS}ms\n`));

  const available = [];
  const taken = [];
  const errors = [];
  let rateLimitHits = 0;

  for (let i = 0; i < variations.length; i++) {
    const username = variations[i];
    const progress = `[${i + 1}/${variations.length}]`;

    try {
      const data = await checkUsername(username);

      if (!data.ok || !data.found) {
        available.push(username);
        process.stdout.clearLine?.(0);
        process.stdout.cursorTo?.(0);
        console.log(chalk.green(`${progress} AVAILABLE  @${username}`));
      } else {
        process.stdout.clearLine?.(0);
        process.stdout.cursorTo?.(0);
        process.stdout.write(chalk.gray(`${progress} taken      @${username}`));
        taken.push(username);
      }
    } catch (err) {
      if (err.response?.status === 429) {
        rateLimitHits++;
        process.stdout.clearLine?.(0);
        process.stdout.cursorTo?.(0);
        console.log(chalk.yellow(`${progress} Rate limit hit, tunggu 6 detik...`));
        await sleep(6000);
        i--; // retry same index
        continue;
      }
      if (err.response?.status === 401) {
        console.log(chalk.red('\n[!] API Key invalid atau tidak diset. Cek file .env'));
        process.exit(1);
      }
      errors.push({ username, error: err.message });
      process.stdout.clearLine?.(0);
      process.stdout.cursorTo?.(0);
      process.stdout.write(chalk.red(`${progress} error      @${username} — ${err.message}`));
    }

    await sleep(DELAY_MS);
  }

  // Final summary
  process.stdout.clearLine?.(0);
  process.stdout.cursorTo?.(0);

  console.log(chalk.cyan('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(chalk.bold('HASIL AKHIR'));
  console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(`Total dicek  : ${variations.length}`);
  console.log(chalk.green(`Available    : ${available.length}`));
  console.log(chalk.gray(`Taken        : ${taken.length}`));
  console.log(chalk.red(`Errors       : ${errors.length}`));
  console.log(`Rate limits  : ${rateLimitHits}x`);

  if (available.length > 0) {
    console.log(chalk.green('\nUsername yang AVAILABLE:'));
    available.forEach((u) => console.log(chalk.green(`  @${u}`)));

    // Simpan ke file
    const outFile = `available_${baseUsername}_${Date.now()}.txt`;
    fs.writeFileSync(outFile, available.map((u) => `@${u}`).join('\n'));
    console.log(chalk.cyan(`\nDisimpan ke: ${outFile}`));
  } else {
    console.log(chalk.yellow('\nTidak ada username available yang ditemukan.'));
  }
}

async function promptInput() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(chalk.bold('Masukkan username base (contoh: notjrns): '), (ans) => {
      rl.close();
      resolve(ans.trim().toLowerCase());
    });
  });
}

async function main() {
  if (!API_KEY) {
    console.log(chalk.red('[!] API Key belum diset!'));
    console.log('    Buat file .env dan isi ROBYNHOOD_API_KEY=your_key');
    console.log('    Lihat .env.example untuk referensi');
    process.exit(1);
  }

  let baseUsername = process.argv[2]?.toLowerCase();

  if (!baseUsername) {
    baseUsername = await promptInput();
  }

  if (!baseUsername) {
    console.log(chalk.red('[!] Username tidak boleh kosong'));
    process.exit(1);
  }

  await runChecker(baseUsername);
}

main().catch((err) => {
  console.error(chalk.red('\n[!] Fatal error:'), err.message);
  process.exit(1);
});
