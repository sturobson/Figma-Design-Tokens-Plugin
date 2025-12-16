const fs = require('fs');
const path = require('path');

function stripComments(str) {
  let out = ''; let i = 0; let inString = false; let stringChar = null; let escaped = false;
  while (i < str.length) {
    const ch = str[i]; const next = str[i + 1];
    if (inString) { out += ch; if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === stringChar) { inString = false; stringChar = null; } i++; continue; }
    if ((ch === '"' || ch === "'")) { inString = true; stringChar = ch; out += ch; i++; continue; }
    if (ch === '/' && next === '/') { i += 2; while (i < str.length && str[i] !== '\n') i++; continue; }
    if (ch === '/' && next === '*') { i += 2; while (i < str.length && !(str[i] === '*' && str[i + 1] === '/')) i++; i += 2; continue; }
    out += ch; i++;
  }
  return out;
}
function removeTrailingCommas(str) {
  let res = ''; let inString = false; let stringChar = null; let escaped = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i]; if (inString) { res += ch; if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === stringChar) { inString = false; stringChar = null; } continue; }
    if ((ch === '"' || ch === "'")) { inString = true; stringChar = ch; res += ch; continue; }
    if (ch === ',') { let j = i + 1; while (j < str.length && /\s/.test(str[j])) j++; if (str[j] === '}' || str[j] === ']') { continue; } }
    res += ch;
  }
  return res.replace(/\uFEFF|\u200B|\u200C|\u200D|\u2060/g, '');
}

const testFiles = [
  path.resolve(__dirname, '../design-tokens/primitive.Mode 1.tokens.json'),
  path.resolve(__dirname, '../result.tokens.json')
];
const brokenSnippet = '{ "color": { "neutral": { "50": { "$type": "color", "$value": "#fff", }, }, }, }';

function smallHash(s) { let h = 0; for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; } return (h >>> 0).toString(16); }

for (const f of testFiles) {
  const content = fs.readFileSync(f, 'utf8');
  const snippet = removeTrailingCommas(stripComments(content));
  let parsedBody = null;
  try { parsedBody = JSON.parse(snippet); } catch (e) { parsedBody = null; }
  let sendBody, sendBase64;
  if (parsedBody) { sendBody = parsedBody; sendBase64 = false; }
  else if (typeof globalThis.btoa === 'function') { sendBody = btoa(snippet); sendBase64 = true; }
  else { sendBody = snippet; sendBase64 = false; }
  console.log('File:', f, 'parsedInUI=', !!parsedBody, 'base64Encoded=', sendBase64, 'hash=', smallHash(snippet));
}

console.log('\nTesting broken snippet with parse failure:');
{
  const content = brokenSnippet; // intentionally malformed JSON
  const snippet = removeTrailingCommas(stripComments(content));
  let parsedBody = null;
  try { parsedBody = JSON.parse(snippet); } catch (e) { parsedBody = null; }
  // test without btoa
  globalThis.btoa = undefined;
  let sendBody, sendBase64;
  if (parsedBody) { sendBody = parsedBody; sendBase64 = false; }
  else if (typeof globalThis.btoa === 'function') { sendBody = btoa(snippet); sendBase64 = true; }
  else { sendBody = snippet; sendBase64 = false; }
  console.log('no btoa: parsedInUI=', !!parsedBody, 'base64Encoded=', sendBase64);
  // test with btoa
  globalThis.btoa = (s) => Buffer.from(s, 'utf8').toString('base64');
  if (parsedBody) { sendBody = parsedBody; sendBase64 = false; }
  else if (typeof globalThis.btoa === 'function') { sendBody = btoa(snippet); sendBase64 = true; }
  else { sendBody = snippet; sendBase64 = false; }
  console.log('with btoa: parsedInUI=', !!parsedBody, 'base64Encoded=', sendBase64);
}
