const fs = require('fs');

const path = require('path');
const data = fs.readFileSync(path.resolve(__dirname, '../result.tokens.json'), 'utf8');

function stripComments(str) {
  let out = '';
  let i = 0;
  let inString = false;
  let stringChar = null;
  let escaped = false;
  while (i < str.length) {
    const ch = str[i];
    const next = str[i + 1];
    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === stringChar) {
        inString = false;
        stringChar = null;
      }
      i++;
      continue;
    }
    if ((ch === '"' || ch === "'")) {
      inString = true;
      stringChar = ch;
      out += ch;
      i++;
      continue;
    }
    if (ch === '/' && next === '/') {
      i += 2;
      while (i < str.length && str[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < str.length && !(str[i] === '*' && str[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function removeTrailingCommas(str) {
  let res = '';
  let inString = false;
  let stringChar = null;
  let escaped = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (inString) {
      res += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === stringChar) {
        inString = false;
        stringChar = null;
      }
      continue;
    }
    if ((ch === '"' || ch === "'")) {
      inString = true;
      stringChar = ch;
      res += ch;
      continue;
    }
    if (ch === ',') {
      // look ahead for next non-whitespace
      let j = i + 1;
      while (j < str.length && /\s/.test(str[j])) j++;
      if (str[j] === '}' || str[j] === ']') {
        continue;
      }
    }
    res += ch;
  }
  return res;
}

function splitJsonObjects(str) {
  const cleaned = removeTrailingCommas(stripComments(str));
  const objects = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let stringChar = null;
  let escaped = false;

  for (let i = 0; i < cleaned.length; i++) {
    const char = cleaned[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === stringChar) {
        inString = false;
        stringChar = null;
      }
      continue;
    } else {
      if (char === '"' || char === "'") {
        inString = true;
        stringChar = char;
        continue;
      }
      if (char === '{') {
        if (depth === 0) start = i;
        depth++;
      } else if (char === '}') {
        depth--;
        if (depth === 0 && start !== -1) {
          objects.push(cleaned.substring(start, i + 1));
          start = -1;
        }
      }
    }
  }
  return objects;
}

const objs = splitJsonObjects(data);
console.log('found', objs.length, 'objects');

objs.forEach((obj, idx) => {
  try {
    JSON.parse(obj);
    console.log(`#${idx + 1} parsed ok, length=${obj.length}`);
  } catch (err) {
    console.error(`#${idx + 1} parse failed:`, err.message);
    // print context around error line
    const lines = obj.split('\n');
    const lineNumber = err.lineNumber || 0;
    const startLine = Math.max(0, lineNumber - 5);
    const endLine = Math.min(lines.length, lineNumber + 5);
    console.log('Context:');
    for (let i = startLine; i < endLine; i++) {
      console.log(`${i + 1}: ${lines[i]}`);
    }
    // Show bracket balance at each line
    let balance = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const ch of line) {
        if (ch === '{') balance++;
        if (ch === '}') balance--;
      }
      if (i >= startLine - 1 && i <= endLine - 1) {
        console.log(`line ${i + 1} balance=${balance}`);
      }
    }
  }
});
