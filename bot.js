require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { generateInsertOnly, generateReplaceOnly } = require('./generator');
const { runCheck } = require('./checker');
const { accountCount } = require('./tg-client');
const users = require('./users');

const BOT_TOKEN    = process.env.BOT_TOKEN;
const OWNER_ID     = parseInt(process.env.OWNER_ID, 10);
const DELAY_MS     = parseInt(process.env.DELAY_MS || '800', 10);
const UPDATE_EVERY = 20;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!BOT_TOKEN)                   { console.error('[!] BOT_TOKEN belum diset');  process.exit(1); }
if (!OWNER_ID || isNaN(OWNER_ID)) { console.error('[!] OWNER_ID belum diset');   process.exit(1); }

const bot = new Telegraf(BOT_TOKEN);

// ─── State ────────────────────────────────────────────────────────────────────
const states     = new Map(); // chatId → 'tamhur' | 'ganhur' | 'invite' | 'remove'
const activeJobs = new Map(); // chatId → AbortController

// ─── Auth ─────────────────────────────────────────────────────────────────────
bot.use((ctx, next) => {
  const id = ctx.from?.id;
  if (!id) return;
  if (id === OWNER_ID) return next();
  if (users.isActive(id)) return next();
  return ctx.reply(
    '⛔ <b>Akses Ditolak</b>\n\n' +
    'Kamu tidak memiliki akses ke bot ini atau masa langgananmu sudah habis.\n\n' +
    'Hubungi admin untuk mendapatkan akses.',
    { parse_mode: 'HTML' }
  );
});

// ─── Menu ─────────────────────────────────────────────────────────────────────
const ownerMenu = () => Markup.inlineKeyboard([
  [
    Markup.button.callback('➕ Tambah Huruf', 'do_tamhur'),
    Markup.button.callback('🔄 Ganti Huruf',  'do_ganhur'),
  ],
  [
    Markup.button.callback('👤 Undang Pengguna', 'do_invite'),
    Markup.button.callback('📋 Daftar',          'do_list'),
    Markup.button.callback('🗑 Hapus',            'do_remove'),
  ],
]);

const userMenu = () => Markup.inlineKeyboard([
  [
    Markup.button.callback('➕ Tambah Huruf', 'do_tamhur'),
    Markup.button.callback('🔄 Ganti Huruf',  'do_ganhur'),
  ],
]);

const menuFor = (id) => (id === OWNER_ID ? ownerMenu() : userMenu());

// ─── /start ───────────────────────────────────────────────────────────────────
bot.start((ctx) => {
  const isOwner = ctx.from.id === OWNER_ID;
  ctx.reply(
    `Halo${isOwner ? ', Admin' : ''}! 👋\n\n` +
    `Pilih mode pencarian username di bawah:\n\n` +
    `<b>➕ Tambah Huruf</b> — sisipkan 1 huruf di setiap posisi\n` +
    `<i>untuk semua bentuk username multichar, idol (termasuk aktor), dan 2D</i>\n\n` +
    `<b>🔄 Ganti Huruf</b> — ganti 1 huruf di setiap posisi\n` +
    `<i>untuk idol, pemeran film (aktor/aktris), dan 2D (anime/game/manga/manhwa/dll)</i>`,
    { parse_mode: 'HTML', ...menuFor(ctx.from.id) }
  );
});

// ─── /menu ────────────────────────────────────────────────────────────────────
bot.command('menu', (ctx) => {
  states.delete(ctx.chat.id);
  ctx.reply('Pilih menu:', menuFor(ctx.from.id));
});

// ─── /cancel ──────────────────────────────────────────────────────────────────
bot.command('cancel', (ctx) => {
  states.delete(ctx.chat.id);
  const job = activeJobs.get(ctx.chat.id);
  if (job) {
    job.abort();
    activeJobs.delete(ctx.chat.id);
    return ctx.reply('✅ Proses berhasil dihentikan.', menuFor(ctx.from.id));
  }
  ctx.reply('Tidak ada proses yang sedang berjalan.', menuFor(ctx.from.id));
});

// ─── Tombol: Tambah / Ganti ────────────────────────────────────────────────────
bot.action('do_tamhur', async (ctx) => {
  await ctx.answerCbQuery();
  if (activeJobs.has(ctx.chat.id)) return ctx.reply('⏳ Masih ada proses yang berjalan. Ketik /cancel untuk menghentikannya.');
  states.set(ctx.chat.id, 'tamhur');
  ctx.reply(
    '➕ <b>Tambah Huruf</b>\n\n' +
    '<i>Untuk semua bentuk username multichar, idol (termasuk aktor), dan 2D.</i>\n\n' +
    'Ketik kata dasar. Bot akan menyisipkan setiap huruf (a–z) di setiap posisi:\n' +
    '<i>Contoh: @username → @ausername, @uasername, @usernamea, ...</i>',
    { parse_mode: 'HTML' }
  );
});

bot.action('do_ganhur', async (ctx) => {
  await ctx.answerCbQuery();
  if (activeJobs.has(ctx.chat.id)) return ctx.reply('⏳ Masih ada proses yang berjalan. Ketik /cancel untuk menghentikannya.');
  states.set(ctx.chat.id, 'ganhur');
  ctx.reply(
    '🔄 <b>Ganti Huruf</b>\n\n' +
    '<i>Untuk idol, pemeran film (aktor/aktris), dan 2D (anime/game/manga/manhwa/dll).</i>\n\n' +
    'Ketik kata dasar. Bot akan mengganti setiap huruf dengan huruf lain (a–z):\n' +
    '<i>Contoh: @username → @asername, @uaername, @usernama, ...</i>',
    { parse_mode: 'HTML' }
  );
});

// ─── Tombol: Undang ───────────────────────────────────────────────────────────
bot.action('do_invite', async (ctx) => {
  await ctx.answerCbQuery();
  states.set(ctx.chat.id, 'invite');
  ctx.reply(
    '👤 <b>Undang Pengguna</b>\n\n' +
    'Kirim Telegram ID orang yang ingin diberi akses:\n' +
    '<i>Cara cek ID: minta mereka kirim pesan ke @userinfobot</i>',
    { parse_mode: 'HTML' }
  );
});

// ─── Tombol: Daftar Pengguna ──────────────────────────────────────────────────
bot.action('do_list', async (ctx) => {
  await ctx.answerCbQuery();
  const all = users.getAll();
  if (all.length === 0) {
    return ctx.reply('Belum ada pengguna yang diundang.', menuFor(ctx.from.id));
  }
  const now = Date.now();
  const lines = all.map((u, i) => {
    const exp   = new Date(u.expiresAt);
    const days  = Math.ceil((u.expiresAt - now) / 86400000);
    const badge = days <= 0 ? '❌ Kedaluwarsa' : days <= 2 ? `⚠️ ${days} hari lagi` : `✅ ${days} hari lagi`;
    return `${i + 1}. ID: <code>${u.telegramId}</code>\n   Berakhir: ${exp.toLocaleDateString('id-ID')}  ·  ${badge}`;
  }).join('\n\n');
  ctx.reply(
    `👥 <b>Daftar Pengguna</b>  (${all.length})\n\n${lines}`,
    { parse_mode: 'HTML', ...menuFor(ctx.from.id) }
  );
});

// ─── Tombol: Hapus Pengguna ───────────────────────────────────────────────────
bot.action('do_remove', async (ctx) => {
  await ctx.answerCbQuery();
  states.set(ctx.chat.id, 'remove');
  ctx.reply(
    '🗑 <b>Hapus Pengguna</b>\n\n' +
    'Kirim Telegram ID pengguna yang ingin dihapus aksesnya:',
    { parse_mode: 'HTML' }
  );
});

// ─── Handler teks (input setelah tombol ditekan) ──────────────────────────────
bot.on('text', async (ctx) => {
  const chatId = ctx.chat.id;
  const text   = ctx.message.text.trim();
  if (text.startsWith('/')) return;

  const state = states.get(chatId);
  if (!state) return;
  states.delete(chatId);

  // ── Mode pencarian ────────────────────────────────────────────────────────
  if (state === 'tamhur' || state === 'ganhur') {
    const input = text.toLowerCase().replace(/^@/, '').replace(/[^a-z]/g, '');
    if (!input || input.length < 3 || input.length > 30) {
      return ctx.reply(
        '❌ Kata dasar tidak valid.\n\nHarus terdiri dari minimal 3 huruf a–z tanpa spasi atau simbol.',
        menuFor(ctx.from.id)
      );
    }
    const modeMap = {
      tamhur: { fn: generateInsertOnly,  label: 'Tambah Huruf' },
      ganhur: { fn: generateReplaceOnly, label: 'Ganti Huruf'  },
    };
    const { fn, label } = modeMap[state];
    return startCheck(ctx, input, fn, label);
  }

  // ── Undang pengguna ───────────────────────────────────────────────────────
  if (state === 'invite') {
    const targetId = text.replace(/\s/g, '');
    if (!/^\d+$/.test(targetId)) {
      return ctx.reply('❌ ID tidak valid. Masukkan angka Telegram ID.', menuFor(ctx.from.id));
    }
    if (parseInt(targetId) === OWNER_ID) {
      return ctx.reply('❌ Tidak bisa mengundang diri sendiri.', menuFor(ctx.from.id));
    }
    const u   = users.invite(targetId);
    const exp = new Date(u.expiresAt);
    return ctx.reply(
      `✅ <b>Pengguna Berhasil Diundang!</b>\n\n` +
      `ID          : <code>${targetId}</code>\n` +
      `Mulai akses : ${new Date(u.invitedAt).toLocaleDateString('id-ID')}\n` +
      `Berakhir    : <b>${exp.toLocaleDateString('id-ID')}</b> pukul ${exp.toLocaleTimeString('id-ID')}\n` +
      `Durasi      : 30 hari`,
      { parse_mode: 'HTML', ...menuFor(ctx.from.id) }
    );
  }

  // ── Hapus pengguna ────────────────────────────────────────────────────────
  if (state === 'remove') {
    const targetId = text.replace(/\s/g, '');
    if (!/^\d+$/.test(targetId)) {
      return ctx.reply('❌ ID tidak valid.', menuFor(ctx.from.id));
    }
    users.remove(targetId);
    return ctx.reply(
      `🗑 <b>Akses Dicabut</b>\n\nPengguna <code>${targetId}</code> sudah dihapus dari daftar.`,
      { parse_mode: 'HTML', ...menuFor(ctx.from.id) }
    );
  }
});

// ─── Logika pengecekan ────────────────────────────────────────────────────────
async function startCheck(ctx, input, genFn, modeLabel) {
  const chatId = ctx.chat.id;
  const userId = ctx.from.id;

  if (activeJobs.has(chatId)) return ctx.reply('⏳ Masih ada proses yang berjalan.');

  const variations = genFn(input);
  const total      = variations.length;
  const estMin     = Math.ceil((total * DELAY_MS) / 60000);
  const estSec     = Math.ceil((total * DELAY_MS) / 1000);

  const statusMsg = await ctx.reply(
    `🔍 <b>@${input}</b>  ·  ${modeLabel}\n\n` +
    `${total} variasi akan diperiksa\n` +
    `Estimasi: ~${estMin > 0 ? estMin + ' menit' : estSec + ' detik'}\n\n` +
    `⏳ Memulai pemeriksaan...`,
    { parse_mode: 'HTML' }
  );

  const msgId      = statusMsg.message_id;
  const controller = new AbortController();
  activeJobs.set(chatId, controller);

  const buyableList       = [];
  const unclaimedList     = [];
  const telegramTakenList = [];
  const uncertainList     = [];
  let lastEdit    = Date.now();
  let fase2Total  = 0;
  let fase2Retry  = false;

  // ── Fase 1: progress Fragment ──────────────────────────────────────────────
  const editFragmentProgress = async (checked, extraLine = '') => {
    const pct    = Math.round((checked / total) * 100);
    const filled = Math.floor(pct / 10);
    const bar    = '█'.repeat(filled) + '░'.repeat(10 - filled);
    const text   =
      `🔍 <b>@${input}</b>  ·  ${modeLabel}\n\n` +
      `Fase 1 — Memeriksa Fragment\n` +
      `${bar}  <b>${pct}%</b>  (${checked}/${total})\n` +
      (extraLine ? `\n${extraLine}\n` : '') +
      (buyableList.length > 0 ? `\n🟢 Bisa dibeli  <b>${buyableList.length}</b>` : '');
    try { await bot.telegram.editMessageText(chatId, msgId, undefined, text, { parse_mode: 'HTML' }); } catch (_) {}
  };

  // ── Fase 2: progress GramJS ────────────────────────────────────────────────
  const editGramJSProgress = async (checked) => {
    const pct    = fase2Total > 0 ? Math.round((checked / fase2Total) * 100) : 0;
    const filled = Math.floor(pct / 10);
    const bar    = '█'.repeat(filled) + '░'.repeat(10 - filled);
    const text   =
      `🔍 <b>@${input}</b>  ·  ${modeLabel}\n\n` +
      `Fase 1 — Fragment  ✓\n` +
      `Fase 2 — Verifikasi via Telegram${fase2Retry ? ' (cek ulang)' : ''}\n` +
      `${bar}  <b>${pct}%</b>  (${checked}/${fase2Total})\n` +
      (buyableList.length   > 0 ? `\n🟢 Bisa dibeli   <b>${buyableList.length}</b>`   : '') +
      (unclaimedList.length > 0 ? `\n✅ Bebas         <b>${unclaimedList.length}</b>` : '') +
      (uncertainList.length > 0 ? `\n⚠️ Perlu ulang   <b>${uncertainList.length}</b>` : '');
    try { await bot.telegram.editMessageText(chatId, msgId, undefined, text, { parse_mode: 'HTML' }); } catch (_) {}
  };

  setImmediate(async () => { try {
    const { buyable, unclaimed, telegramTaken, uncertain, errors } = await runCheck({
      variations,
      delayMs: DELAY_MS,
      signal: controller.signal,
      onBuyable:       (r) => buyableList.push(r),
      onUnclaimed:     (u) => unclaimedList.push(u),
      onTelegramTaken: (u) => telegramTakenList.push(u),
      onUncertain:     (u) => uncertainList.push(u),
      onPhase2Start:   (n) => { fase2Total = n; editGramJSProgress(0); },
      onPhase2Progress: async (checked) => { await editGramJSProgress(checked); },
      onPhase2Retry:   (n) => { fase2Retry = true; fase2Total = n; uncertainList.length = 0; editGramJSProgress(0); },
      onPhase2Wait: async (sec) => {
        try {
          await bot.telegram.editMessageText(
            chatId, msgId, undefined,
            `🔍 <b>@${input}</b>  ·  ${modeLabel}\n\n` +
            `Fase 2 — Verifikasi via Telegram\n` +
            `⏳ Semua akun lagi kena limit Telegram.\n` +
            `Nunggu ~${sec}s, lanjut otomatis… (nggak perlu rerun)`,
            { parse_mode: 'HTML' }
          );
        } catch (_) {}
      },
      onProgress: async (checked, _t, _u, _r, flag) => {
        const now = Date.now();
        if (flag === 'ratelimit') {
          await editFragmentProgress(checked, '⚠️ Terlalu banyak permintaan, menunggu sebentar...');
          return;
        }
        if (checked % UPDATE_EVERY === 0 || now - lastEdit > 4000) {
          lastEdit = now;
          await editFragmentProgress(checked);
        }
      },
    });

    activeJobs.delete(chatId);
    if (controller.signal.aborted) return;

    await editFragmentProgress(total);

    // ── Tidak ada hasil sama sekali ───────────────────────────────────────────
    if (buyable.length === 0 && unclaimed.length === 0 && telegramTaken.length === 0 && uncertain.length === 0) {
      await bot.telegram.sendMessage(
        chatId,
        `Tidak ada hasil untuk <b>@${input}</b>.\n\nSemua variasi sudah digunakan oleh orang lain.`,
        { parse_mode: 'HTML' }
      );
    }

    // ── Bisa dibeli di Fragment ───────────────────────────────────────────────
    if (buyable.length > 0) {
      await bot.telegram.sendMessage(
        chatId,
        `🟢 <b>BISA DIBELI DI FRAGMENT  (${buyable.length})</b>\n\n` +
        `Username berikut tersedia di Fragment dan bisa dilelang atau dibeli langsung.`,
        { parse_mode: 'HTML' }
      );
      for (const r of buyable) {
        await bot.telegram.sendMessage(chatId, formatBuyable(r), {
          parse_mode: 'HTML',
          link_preview_options: { url: r.url },
        });
        await sleep(350);
      }
    }

    // ── Bebas & siap dipakai (100% verified via GramJS) ──────────────────────
    if (unclaimed.length > 0) {
      await bot.telegram.sendMessage(
        chatId,
        `✅ <b>BEBAS & SIAP DIPAKAI  (${unclaimed.length})</b>\n\n` +
        `Sudah diverifikasi langsung via Telegram — username ini benar-benar bisa digunakan.`,
        { parse_mode: 'HTML' }
      );
      for (const u of unclaimed) {
        const url = `https://fragment.com/username/${u}`;
        await bot.telegram.sendMessage(
          chatId,
          `<a href="${url}"><b>@${u}</b></a>`,
          { parse_mode: 'HTML', link_preview_options: { url } }
        );
        await sleep(350);
      }
    }

    // ── Tidak bisa dipakai ────────────────────────────────────────────────────
    if (telegramTaken.length > 0) {
      const lines  = telegramTaken.map((u) => `· @${u}`).join('\n');
      const header =
        `❌ <b>TIDAK BISA DIPAKAI  (${telegramTaken.length})</b>\n\n` +
        `Sudah digunakan, dibekukan, atau direservasi oleh Telegram.\n\n`;
      for (const chunk of splitMessage(header + lines)) {
        await bot.telegram.sendMessage(chatId, chunk, { parse_mode: 'HTML' });
      }
    }

    // ── Perlu cek ulang (gagal diverifikasi setelah retry) ────────────────────
    if (uncertain.length > 0) {
      const lines  = uncertain.map((u) => `· @${u}`).join('\n');
      const header =
        `⚠️ <b>PERLU CEK ULANG  (${uncertain.length})</b>\n\n` +
        `Belum berhasil diverifikasi (jaringan/limit Telegram). ` +
        `Jalankan pengecekan lagi untuk username ini — <b>belum tentu taken</b>.\n\n`;
      for (const chunk of splitMessage(header + lines)) {
        await bot.telegram.sendMessage(chatId, chunk, { parse_mode: 'HTML' });
      }
    }

    // ── Ringkasan & menu ──────────────────────────────────────────────────────
    if (errors.length > 0) {
      const lines  = errors.map((e) => `· @${e.username}`).join('\n');
      const header =
        `🌐 <b>GAGAL DICEK DI FRAGMENT  (${errors.length})</b>\n\n` +
        `Gangguan jaringan saat Fase 1 — status belum diketahui (<b>belum tentu taken</b>). ` +
        `Jalankan ulang untuk username ini.\n\n`;
      for (const chunk of splitMessage(header + lines)) {
        await bot.telegram.sendMessage(chatId, chunk, { parse_mode: 'HTML' });
      }
    }

    await bot.telegram.sendMessage(
      chatId,
      `✅ <b>Selesai!</b>\n\n` +
      `Kata dasar  : <b>@${input}</b>  (${modeLabel})\n` +
      `Total dicek : ${total} variasi\n\n` +
      (buyable.length       > 0 ? `🟢 Bisa dibeli di Fragment : ${buyable.length}\n`       : '') +
      (unclaimed.length     > 0 ? `✅ Bebas & siap dipakai    : ${unclaimed.length}\n`     : '') +
      (telegramTaken.length > 0 ? `❌ Tidak bisa dipakai      : ${telegramTaken.length}\n` : '') +
      (uncertain.length     > 0 ? `⚠️ Perlu cek ulang        : ${uncertain.length}\n`     : '') +
      (errors.length        > 0 ? `🌐 Gagal dicek (jaringan)  : ${errors.length}\n`       : '') +
      `\n<i>Σ ${buyable.length + unclaimed.length + telegramTaken.length + uncertain.length + errors.length} / ${total} terlapor</i>`,
      { parse_mode: 'HTML', ...menuFor(userId) }
    );

  } catch (err) {
    activeJobs.delete(chatId);
    await bot.telegram.sendMessage(
      chatId,
      `❌ <b>Terjadi Kesalahan</b>\n\n<code>${err.message}</code>`,
      { parse_mode: 'HTML' }
    );
  } });
}

// ─── Format hasil buyable ─────────────────────────────────────────────────────
function formatBuyable(r) {
  const label = {
    available:  'Tersedia · Bisa dilelang',
    for_sale:   'Dijual langsung',
    on_auction: 'Sedang dilelang',
  }[r.status] ?? r.status;
  return `<a href="${r.url}"><b>@${r.username}</b></a>\n<i>${label}</i>`;
}

// ─── Pecah pesan panjang ──────────────────────────────────────────────────────
function splitMessage(text, limit = 4000) {
  const chunks = [];
  while (text.length > limit) {
    let cut = text.lastIndexOf('\n', limit);
    if (cut <= 0) cut = limit;
    chunks.push(text.slice(0, cut));
    text = text.slice(cut).replace(/^\n/, '');
  }
  chunks.push(text);
  return chunks;
}

// ─── Notifikasi kedaluwarsa (H-2) ────────────────────────────────────────────
async function checkExpiry() {
  const expiring = users.getExpiringIn(48);
  for (const u of expiring) {
    const exp  = new Date(u.expiresAt);
    const days = Math.ceil((u.expiresAt - Date.now()) / 86400000);
    await bot.telegram.sendMessage(
      OWNER_ID,
      `⚠️ <b>Langganan Akan Berakhir</b>\n\n` +
      `ID Pengguna : <code>${u.telegramId}</code>\n` +
      `Berakhir    : <b>${exp.toLocaleDateString('id-ID')}</b> pukul ${exp.toLocaleTimeString('id-ID')}\n` +
      `Sisa        : <b>${days} hari</b>\n\n` +
      `Perpanjang akses mereka jika diperlukan.`,
      { parse_mode: 'HTML' }
    );
    users.markNotified(u.telegramId);
  }
}

setTimeout(() => {
  checkExpiry();
  setInterval(checkExpiry, 6 * 60 * 60 * 1000);
}, 5000);

// ─── Pengaman global: jangan biarkan error apa pun mematikan proses ────────────
bot.catch((err, ctx) => {
  console.error(`[bot.catch] ${ctx?.updateType || '?'}:`, err?.message || err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason?.message || reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err?.message || err);
});

// ─── Jalankan bot (auto-retry kalau gagal start, mis. jaringan belum siap) ─────
(function launch(attempt = 1) {
  bot.launch();
  console.log(`[✓] Bot berjalan`);
  console.log(`[✓] Owner ID         : ${OWNER_ID}`);
  console.log(`[✓] Delay Fragment   : ${DELAY_MS}ms per variasi`);
  console.log(`[✓] Akun verifikasi  : ${accountCount()}`);
})();

process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
