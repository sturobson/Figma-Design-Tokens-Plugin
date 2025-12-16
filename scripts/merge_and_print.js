const fs = require('fs');
const path = require('path');

const dir = path.resolve(__dirname, '../../design-tokens-separate');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));

const deepMerge = (target, source) => {
  if (!source) return target;
  if (!target) return source;
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      if (source[key].$value !== undefined) {
        result[key] = source[key];
      } else {
        result[key] = deepMerge(result[key] || {}, source[key]);
      }
    } else {
      result[key] = source[key];
    }
  }
  return result;
};

const combined = {};
const combinedExtensions = {};

for (const file of files) {
  const content = fs.readFileSync(path.join(dir, file), 'utf8');
  const body = JSON.parse(content);

  // collect extensions
  if (body.$extensions) {
    const ext = body.$extensions;
    if (ext['com.designtokensmanager']) {
      const meta = ext['com.designtokensmanager'];
      const key = meta.collection || file.replace(/\.json$/, '');
      combinedExtensions[key] = { 'com.designtokensmanager': meta };
    } else {
      for (const [extKey, extVal] of Object.entries(ext)) {
        if (extVal && typeof extVal === 'object' && extVal.collection) {
          combinedExtensions[extVal.collection] = combinedExtensions[extVal.collection] || {};
          combinedExtensions[extVal.collection][extKey] = extVal;
        } else {
          combinedExtensions[extKey] = combinedExtensions[extKey] || {};
          combinedExtensions[extKey][extKey] = extVal;
        }
      }
    }
  }

  for (const [key, value] of Object.entries(body)) {
    if (key === '$extensions') continue;
    combined[key] = deepMerge(combined[key] || {}, value);
  }
}

if (Object.keys(combinedExtensions).length) combined.$extensions = combinedExtensions;

console.log(JSON.stringify(combined, null, 2));

// Print the extension keys only
console.log('\nExtensions keys:', Object.keys(combined.$extensions || {}));
