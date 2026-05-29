const CHARS   = 'abcdefghijklmnopqrstuvwxyz'; // no numbers, no underscore
const MIN_LEN = 5;
const MAX_LEN = 32;

function isValid(username) {
  if (username.length < MIN_LEN || username.length > MAX_LEN) return false;
  return /^[a-z]+$/.test(username); // only a-z, no underscore
}

// Semua strategi: insert + replace + swap + double + remove
function generateVariations(base) {
  base = base.toLowerCase().replace(/[^a-z]/g, '');
  const results = new Set();

  for (let i = 0; i <= base.length; i++)
    for (const c of CHARS) { const v = base.slice(0,i)+c+base.slice(i); if(isValid(v)) results.add(v); }

  for (let i = 0; i < base.length; i++)
    for (const c of CHARS) { if(c===base[i]) continue; const v = base.slice(0,i)+c+base.slice(i+1); if(isValid(v)) results.add(v); }

  for (let i = 0; i < base.length-1; i++) {
    const a = base.split(''); [a[i],a[i+1]]=[a[i+1],a[i]]; const v=a.join('');
    if(v!==base && isValid(v)) results.add(v);
  }

  for (let i = 0; i < base.length; i++) { const v=base.slice(0,i)+base[i]+base.slice(i); if(isValid(v)) results.add(v); }

  for (let i = 0; i < base.length; i++) { const v=base.slice(0,i)+base.slice(i+1); if(isValid(v)) results.add(v); }

  results.delete(base);
  return [...results];
}

// /tamhur — hanya tambah huruf di tiap posisi
function generateInsertOnly(base) {
  base = base.toLowerCase().replace(/[^a-z]/g, '');
  const results = new Set();
  for (let i = 0; i <= base.length; i++)
    for (const c of CHARS) { const v = base.slice(0,i)+c+base.slice(i); if(isValid(v)) results.add(v); }
  results.delete(base);
  return [...results];
}

// /ganhur — hanya ganti 1 huruf di tiap posisi
function generateReplaceOnly(base) {
  base = base.toLowerCase().replace(/[^a-z]/g, '');
  const results = new Set();
  for (let i = 0; i < base.length; i++)
    for (const c of CHARS) { if(c===base[i]) continue; const v=base.slice(0,i)+c+base.slice(i+1); if(isValid(v)) results.add(v); }
  results.delete(base);
  return [...results];
}

module.exports = { generateVariations, generateInsertOnly, generateReplaceOnly };
