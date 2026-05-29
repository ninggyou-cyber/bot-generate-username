const { checkFragmentUsername }       = require('./fragment');
const { resolveUsername, getBaseDelay } = require('./tg-client');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Dua fase:
//   Fase 1 — Fragment (sequential) → buyable | not_found | owned(skip)
//   Fase 2 — GramJS account.checkUsername (sequential + adaptive throttle)
//             not_found → unclaimed | telegramTaken | uncertain
//
// Prinsip: tidak ada username yang "hilang". Yang gagal dicek setelah retry
// masuk bucket `uncertain` (bukan diam-diam dibuang ke taken).

async function runCheck({
  variations, delayMs = 500,
  onProgress, onBuyable, onUnclaimed, onTelegramTaken, onUncertain,
  onPhase2Start, onPhase2Progress, onPhase2Retry,
  signal,
}) {
  const buyable  = [];
  const toVerify = []; // semua yang BUKAN buyable: not_found, taken, unavailable, sold, unknown
  const errors   = [];

  // ── Fase 1: Fragment ─────────────────────────────────────────────────────────
  for (let i = 0; i < variations.length; i++) {
    if (signal?.aborted) break;
    const username = variations[i];

    try {
      const result = await checkFragmentUsername(username);
      if (['available', 'for_sale', 'on_auction'].includes(result.status)) {
        buyable.push(result);
        onBuyable?.(result);
      } else {
        // not_found / taken / unavailable / sold / unknown → verifikasi ulang ke Telegram (Fase 2).
        // Tidak ada yang dibuang diam-diam: status "taken di Fragment" pun tetap dicek ke Telegram.
        toVerify.push(username);
      }
      onProgress?.(i + 1, variations.length, username, result, null);
    } catch (err) {
      if (err.response?.status === 429 || err.code === 'ECONNRESET') {
        onProgress?.(i + 1, variations.length, username, null, 'ratelimit');
        await sleep(8000);
        i--;
        continue;
      }
      errors.push({ username, error: err.message });
      onProgress?.(i + 1, variations.length, username, null, 'error');
    }
    await sleep(delayMs);
  }

  const unclaimed     = [];
  const telegramTaken = [];
  let   uncertain     = [];

  if (signal?.aborted) return { buyable, unclaimed, telegramTaken, uncertain, errors };

  // ── Fase 2: verifikasi via Telegram (sequential, pelan & aman) ───────────────
  const classify = (u, status) => {
    if (status === 'available') { unclaimed.push(u); onUnclaimed?.(u); }
    else                        { telegramTaken.push(u); onTelegramTaken?.(u); } // taken | invalid
  };

  if (toVerify.length > 0) {
    onPhase2Start?.(toVerify.length);
    let checked = 0;

    for (const u of toVerify) {
      if (signal?.aborted) break;
      try {
        classify(u, await resolveUsername(u));
      } catch (_) {
        uncertain.push(u);
        onUncertain?.(u);
      }
      checked++;
      onPhase2Progress?.(checked, toVerify.length);
      await sleep(getBaseDelay());
    }

    // ── Retry pass: coba ulang yang uncertain sekali lagi, lebih pelan ─────────
    if (uncertain.length > 0 && !signal?.aborted) {
      const retryList = uncertain;
      uncertain = [];
      onPhase2Retry?.(retryList.length);

      for (const u of retryList) {
        if (signal?.aborted) { uncertain.push(u); continue; }
        try {
          classify(u, await resolveUsername(u, 6));
        } catch (_) {
          uncertain.push(u); // tetap gagal → benar-benar uncertain
        }
        await sleep(getBaseDelay() + 600);
      }
    }
  }

  return { buyable, unclaimed, telegramTaken, uncertain, errors };
}

module.exports = { runCheck };
