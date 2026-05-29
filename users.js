const fs = require('fs');
const path = require('path');

const DB = path.join(__dirname, 'users.json');

function load() {
  try { return JSON.parse(fs.readFileSync(DB, 'utf8')); }
  catch { return {}; }
}

function save(data) {
  fs.writeFileSync(DB, JSON.stringify(data, null, 2));
}

function invite(telegramId) {
  const data = load();
  const now = Date.now();
  const expiresAt = now + 30 * 24 * 60 * 60 * 1000;
  data[String(telegramId)] = {
    telegramId: String(telegramId),
    invitedAt: now,
    expiresAt,
    notifiedH2: false,
  };
  save(data);
  return data[String(telegramId)];
}

function isActive(telegramId) {
  const u = load()[String(telegramId)];
  return u ? Date.now() < u.expiresAt : false;
}

function getAll() {
  return Object.values(load());
}

function remove(telegramId) {
  const data = load();
  delete data[String(telegramId)];
  save(data);
}

// Return users expiring within `hours` from now that haven't been notified yet
function getExpiringIn(hours) {
  const now = Date.now();
  const cutoff = now + hours * 60 * 60 * 1000;
  return Object.values(load()).filter(
    (u) => !u.notifiedH2 && u.expiresAt > now && u.expiresAt <= cutoff
  );
}

function markNotified(telegramId) {
  const data = load();
  if (data[String(telegramId)]) {
    data[String(telegramId)].notifiedH2 = true;
    save(data);
  }
}

module.exports = { invite, isActive, getAll, remove, getExpiringIn, markNotified };
