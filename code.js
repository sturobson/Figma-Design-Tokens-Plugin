console.clear();

// Cache for existing variables - built once per import
let variableCache = new Map();
// Track heavy operations and yield periodically to avoid WASM memory pressure
let operationCounter = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function buildVariableCache(collection) {
  variableCache.clear();
  console.log(`Building variable cache for ${collection.variableIds.length} variables...`);
  for (const varId of collection.variableIds) {
    const variable = await figma.variables.getVariableByIdAsync(varId);
    if (variable) {
      variableCache.set(variable.name, variable);
      operationCounter++;
      if (operationCounter % 10 === 0) await sleep(60);
    }
  }
  console.log(`Cache built with ${variableCache.size} variables`);
}

async function getOrCreateCollection(name, modeName) {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  let collection = collections.find(c => c.name === name);

  if (collection) {
    console.log(`Found existing collection: ${name}`);
    // Build cache of existing variables
    await buildVariableCache(collection);
    // Determine desired mode id if provided, otherwise use first mode
    let modeId = collection.modes[0].modeId;
    if (modeName) {
      const mode = collection.modes.find(m => m.name === modeName);
      if (mode) modeId = mode.modeId;
    }
    return { collection, modeId, isExisting: true };
  }

  console.log(`Creating new collection: ${name}`);
  collection = figma.variables.createVariableCollection(name);
  variableCache.clear(); // New collection has no variables
  const modeId = collection.modes[0].modeId;
  return { collection, modeId, isExisting: false };
}

async function getOrCreateToken(collection, modeId, type, name, value, description = '') {
  // Check cache for existing variable
  const existing = variableCache.get(name);
  if (existing) {
    console.log(`Updating existing variable: ${name}`);
    console.log(`Setting value for ${name} (${modeId}):`, value);
    try {
      existing.setValueForMode(modeId, value);
      // Try to set description on existing variable if provided
      if (description && typeof existing.setDescription === 'function') {
        existing.setDescription(description);
      } else if (description && 'description' in existing) {
        try { existing.description = description; } catch (e) { /* ignore */ }
      }
    } catch (err) {
      console.error(`Failed to set value for ${name} on mode ${modeId}:`, err, value);
      if (err && (err.message || '').toLowerCase().includes('read-only')) {
        try { figma.ui.postMessage({ type: 'IMPORT_FAILED', fileName: collection.name, message: "Plugin is running in read-only mode; cannot set variable values." }); } catch (postErr) { /* ignore */ }
        figma.notify('Import failed: plugin is running in read-only mode — cannot set variable values.');
      }
    }
    operationCounter++;
    if (operationCounter % 10 === 0) await sleep(60);
    return existing;
  }

  // Create new variable
  console.log(`Creating new variable: ${name}`);
  console.log(`Creating variable: ${name} (${type})`);
  let token;
  try {
    token = figma.variables.createVariable(name, collection, type);
  } catch (err) {
    console.error(`Failed to create variable ${name} (${type}) in collection ${collection.name}:`, err);
    // If this error is due to the plugin running in read-only mode, provide a clearer message
    if (err && (err.message || '').toLowerCase().includes('read-only')) {
      try { figma.ui.postMessage({ type: 'IMPORT_FAILED', fileName: collection.name, message: "Plugin is running in read-only mode; cannot create variables. Ensure the plugin is allowed to edit this file and you have edit permissions." }); } catch (postErr) { /* ignore */ }
      figma.notify('Import failed: plugin is running in read-only mode — cannot create variables.');
    }
    throw err;
  }
  console.log(`Setting value for ${name} (${modeId}):`, value);
  try {
    token.setValueForMode(modeId, value);
    // Try to set description on new variable
    if (description && typeof token.setDescription === 'function') {
      token.setDescription(description);
    } else if (description && 'description' in token) {
      try { token.description = description; } catch (e) { /* ignore */ }
    }
  } catch (err) {
    console.error(`Failed to set initial value for created variable ${name} on mode ${modeId}:`, err, value);
    if (err && (err.message || '').toLowerCase().includes('read-only')) {
      try { figma.ui.postMessage({ type: 'IMPORT_FAILED', fileName: collection.name, message: "Plugin is running in read-only mode; cannot set variable values." }); } catch (postErr) { /* ignore */ }
      figma.notify('Import failed: plugin is running in read-only mode — cannot set variable values.');
    }
    throw err;
  }
  operationCounter++;
  if (operationCounter % 10 === 0) await sleep(60);
  // Add to cache
  variableCache.set(name, token);
  return token;
}

async function createVariable(collection, modeId, key, valueKey, tokens) {
  const token = tokens[valueKey];
  const desc = (token && (token.description || token.$description)) || '';
  return await getOrCreateToken(collection, modeId, token.resolvedType, key, {
    type: "VARIABLE_ALIAS",
    id: `${token.id}`,
  }, desc);
}

async function importJSONFile({ fileName, body, parsedInUI, base64Encoded }) {
  operationCounter = 0;
  try {
    // Sanitize the incoming JSON from GitHub or file imports. Some token files
    // may contain comments or JS-style unquoted keys; try to clean common
    // patterns, then parse.
    const sanitizeJson = (str) => {
      // Remove JS/CSS style comments outside of strings using manual scanning
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

        // Start of string
        if ((ch === '"' || ch === "'")) {
          inString = true;
          stringChar = ch;
          out += ch;
          i++;
          continue;
        }

        // Line comment
        if (ch === '/' && next === '/') {
          // skip until newline
          i += 2;
          while (i < str.length && str[i] !== '\n') i++;
          continue;
        }

        // Block comment
        if (ch === '/' && next === '*') {
          i += 2;
          while (i < str.length && !(str[i] === '*' && str[i + 1] === '/')) i++;
          i += 2; // skip */
          continue;
        }

        out += ch;
        i++;
      }
      // Remove trailing commas before close braces/brackets (outside strings)
      const removeTrailingCommas = (s) => {
        let res = '';
        let inString = false;
        let stringChar = null;
        let escaped = false;
        for (let i = 0; i < s.length; i++) {
          const ch = s[i];
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
            while (j < s.length && /\s/.test(s[j])) j++;
            if (s[j] === '}' || s[j] === ']') {
              // skip this comma
              continue;
            }
          }
          res += ch;
        }
        return res;
      };

      const cleaned = removeTrailingCommas(out);
      // Remove zero-width and BOM characters which can break parser
      return cleaned.replace(/\uFEFF|\u200B|\u200C|\u200D|\u2060/g, '');
    };

    let json;
    try {
      // Log the incoming body shape and size/hash for diagnostics
      const bodyIsObject = typeof body === 'object' && body !== null;
      if (bodyIsObject) {
        console.log('Received body as structured object from UI; skipping sanitize/parse.');
        json = body;
        try {
          const str = JSON.stringify(body);
          const hash = (() => { let h = 0; for (let i = 0; i < str.length; i++) { h = (h << 5) - h + str.charCodeAt(i); h |= 0; } return (h >>> 0).toString(16); })();
          console.log(`Structured object received: serialized length=${str.length}, hash=${hash}`);
        } catch (hErr) {
          console.warn('Unable to hash structured body', hErr);
        }
      } else {
        try {
          const hash = (() => { let h = 0; for (let i = 0; i < (body || '').length; i++) { h = (h << 5) - h + (body || '').charCodeAt(i); h |= 0; } return (h >>> 0).toString(16); })();
          console.log(`Received body as string; length=${(body || '').length}, hash=${hash}`);
        } catch (logErr) {
          console.warn('Unable to compute body hash/length', logErr);
        }

        // If the UI sent base64-encoded sanitized JSON (fallback), decode it first
        let rawBody = body;
        if (base64Encoded) {
          // Try environment decoders first
          try {
            if (typeof atob === 'function') {
              rawBody = atob(body);
            } else if (typeof Buffer !== 'undefined') {
              rawBody = Buffer.from(body, 'base64').toString('utf8');
            }
          } catch (dErr) {
            console.warn('Failed to decode base64 with built-in decoders', dErr);
          }
          // If still seems encoded (e.g. starts with base64 chars), try manual decode
          if (typeof rawBody === 'string' && /^[A-Za-z0-9+/=\s]+$/.test(rawBody) && rawBody.trim().length > 0) {
            try {
              rawBody = decodeBase64ToUtf8String(body);
            } catch (manErr) {
              console.warn('Manual base64 decode failed', manErr);
            }
          }
        }

        // Log raw decoded length/hash for diagnostics
        try {
          const rawHash = (() => { let h = 0; for (let i = 0; i < rawBody.length; i++) { h = (h << 5) - h + rawBody.charCodeAt(i); h |= 0; } return (h >>> 0).toString(16); })();
          console.log(`Decoded raw body: len=${rawBody.length}, hash=${rawHash}, base64Encoded=${!!base64Encoded}`);
        } catch (hErr) {
          console.warn('Unable to hash decoded body', hErr);
        }

        const sanitized = sanitizeJson(rawBody);
        console.log('Sanitized snippet start:', sanitized.substring(0, 200));
        console.log('Sanitized snippet end:', sanitized.substring(Math.max(0, sanitized.length - 200)));
        const hash = (() => {
          let h = 0; for (let i = 0; i < sanitized.length; i++) { h = (h << 5) - h + sanitized.charCodeAt(i); h |= 0; } return (h >>> 0).toString(16);
        })();
        console.log(`Parsing sanitized body: len=${sanitized.length}, hash=${hash}`);
        json = JSON.parse(sanitized);
      }
    } catch (err) {
      console.error('Failed to parse sanitized JSON; trying raw parse', err);
      try {
        json = JSON.parse(body);
      } catch (rawErr) {
        console.error('Failed to parse raw JSON as well', rawErr);
        // Log a sanitized preview to aid debugging
        const preview = sanitizeJson(body).split('\n').slice(0, 50).map((ln, i) => `${i + 1}: ${ln}`).join('\n');
        console.error('Sanitized preview (first 50 lines):\n', preview);
        // Post back to UI with details so UI can report a helpful message.
        // Extract error line number if available
        let errLine = rawErr.lineNumber || null;
        if (!errLine) {
          const m = /(?:<input>|<anonymous>):?(\d+)/.exec(rawErr.stack || rawErr.message || '');
          if (m) errLine = parseInt(m[1], 10);
        }
        const sanitized = sanitizeJson(body);
        // Scan sanitized for invalid control characters
        const controlChars = [];
        for (let i = 0; i < sanitized.length; i++) {
          const code = sanitized.charCodeAt(i);
          if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
            // store up to 20
            if (controlChars.length < 20) controlChars.push({ pos: i + 1, code });
          }
        }
        const sanitizedLines = sanitized.split('\n');
        const contextLine = errLine ? Math.max(1, errLine) : null;
        const startLine = contextLine ? Math.max(1, contextLine - 5) : 1;
        const endLine = contextLine ? Math.min(sanitizedLines.length, contextLine + 5) : Math.min(50, sanitizedLines.length);
        const errorContext = sanitizedLines.slice(startLine - 1, endLine).map((ln, idx) => `${startLine + idx}: ${ln}`).join('\n');
        // Provide character code diagnostics for the problem line
        let errorLineCodes = null;
        if (contextLine) {
          const problemLine = sanitizedLines[contextLine - 1] || '';
          errorLineCodes = Array.from(problemLine).map(ch => ch.charCodeAt(0));
        }
        try {
          figma.ui.postMessage({ type: 'IMPORT_FAILED', fileName, message: rawErr.message, sanitizedPreview: sanitized.slice(0, 1600), previewLines: preview, errorLine: contextLine, errorContext, errorLineCodes, controlChars, parsedInUI, base64Encoded });
        } catch (postErr) {
          console.warn('Unable to post import failed message to UI:', postErr);
        }
        // Notify and abort import
        figma.notify(`Import failed for ${fileName}: ${rawErr.message}`);
        return;
      }
    }

    // Get collection name from $extensions if available, otherwise use fileName
    let collectionName = fileName.replace('.json', '');
    if (json.$extensions && json.$extensions["com.designtokensmanager"] && json.$extensions["com.designtokensmanager"].collection) {
      collectionName = json.$extensions["com.designtokensmanager"].collection;
    }

    const modeName = (json.$extensions && json.$extensions["com.designtokensmanager"] && json.$extensions["com.designtokensmanager"].mode) || undefined;
    const { collection, modeId, isExisting } = await getOrCreateCollection(collectionName, modeName);
    const aliases = {};
    const tokens = {};

    // Ensure we process tokens in order and with throttling so the WASM runtime
    // and the Figma plugin environment don't get overwhelmed.
    for (const [key, object] of Object.entries(json)) {
      await traverseToken({
        collection,
        modeId,
        type: json.$type,
        key,
        object,
        tokens,
        aliases,
      });
    }

    await processAliases({ collection, modeId, aliases, tokens });

    // If any aliases remain unresolved, warn in console
    if (Object.keys(aliases).length > 0) {
      console.warn('Unresolved aliases remain after import:', aliases);
    }

    const action = isExisting ? 'Updated' : 'Created';
    figma.notify(`${action} collection: ${collectionName}`);
    console.log(`Import complete: ${collectionName} (${operationCounter} token operations)`, { collectionName, operationCounter });
    // Let the UI know this import finished successfully
    try {
      figma.ui.postMessage({ type: 'IMPORT_DONE', fileName: collectionName, operationCount: operationCounter, parsedInUI });
    } catch (err) {
      console.warn('Unable to post message to UI (might not be open):', err);
    }
  } catch (err) {
    // Unhandled error during import
    console.error('Unhandled error during importJSONFile:', err);
    try {
      figma.ui.postMessage({ type: 'IMPORT_FAILED', fileName, message: err.message, parsedInUI, base64Encoded });
    } catch (postErr) {
      console.warn('Failed to post IMPORT_FAILED message', postErr);
    }
    figma.notify(`Import failed for ${fileName}: ${err.message}`);
    return;
  }
}

async function processAliases({ collection, modeId, aliases, tokens }) {
  aliases = Object.values(aliases);
  let generations = aliases.length;
  while (aliases.length && generations > 0) {
    for (let i = 0; i < aliases.length; i++) {
      const { key, type, valueKey } = aliases[i];
      const token = tokens[valueKey];
      if (token) {
        aliases.splice(i, 1);
        tokens[key] = await createVariable(collection, modeId, key, valueKey, tokens);
      }
    }
    generations--;
  }
}

function isAlias(value) {
  return value.toString().trim().charAt(0) === "{";
}

async function traverseToken({
  collection,
  modeId,
  type,
  key,
  object,
  tokens,
  aliases,
}) {
  type = type || object.$type;
  // if key is a meta field, move on
  if (key.charAt(0) === "$") {
    return;
  }
  const desc = object.$description || object.description || '';
  if (object.$value !== undefined) {
    if (isAlias(object.$value)) {
      const valueKey = object.$value
        .trim()
        .replace(/\./g, "/")
        .replace(/[\{\}]/g, "");
      if (tokens[valueKey]) {
        tokens[key] = await createVariable(collection, modeId, key, valueKey, tokens);
      } else {
        aliases[key] = {
          key,
          type,
          valueKey,
        };
      }
    } else if (type === "color") {
      try {
        const value = parseColor(object.$value);
        tokens[key] = await getOrCreateToken(
          collection,
          modeId,
          "COLOR",
          key,
          value
          , desc);
      } catch (err) {
        console.error(`Failed to parse color for ${key}:`, object.$value, err);
      }
    } else if (type === "number") {
      try {
        tokens[key] = await getOrCreateToken(
          collection,
          modeId,
          "FLOAT",
          key,
          object.$value
          , desc);
      } catch (err) {
        console.error(`Failed to set number for ${key}:`, object.$value, err);
      }
    } else if (type === "dimension") {
      try {
        // Accept either { value: number, unit: 'px' } or strings like '12px'
        let num;
        if (typeof object.$value === 'object' && object.$value !== null) {
          num = parseFloat(object.$value.value);
        } else {
          const m = /([+-]?\d*\.?\d+)([a-z%]*)/.exec(object.$value.toString());
          num = m ? parseFloat(m[1]) : parseFloat(object.$value);
        }
        tokens[key] = await getOrCreateToken(
          collection,
          modeId,
          "FLOAT",
          key,
          num
          , desc);
      } catch (err) {
        console.error(`Failed to parse dimension for ${key}:`, object.$value, err);
      }
    } else {
      console.log("unsupported type", type, object);
    }
  } else {
    for (const [key2, object2] of Object.entries(object)) {
      if (key2.charAt(0) !== "$") {
        await traverseToken({
          collection,
          modeId,
          type,
          key: `${key}/${key2}`,
          object: object2,
          tokens,
          aliases,
        });
      }
    }
  }
}

async function getCollectionsList() {
  console.log("getCollectionsList called");
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  console.log("Found collections:", collections);
  const collectionsList = collections.map(({ id, name, modes }) => ({
    id,
    name,
    modes: modes.map(({ modeId, name }) => ({ modeId, name }))
  }));
  console.log("Sending collections list:", collectionsList);
  figma.ui.postMessage({ type: "COLLECTIONS_LIST", collections: collectionsList });
}

async function exportToJSON(selections) {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const files = [];

  if (selections && selections.length > 0) {
    // Export only selected collections and modes
    for (const selection of selections) {
      const collection = collections.find(c => c.id === selection.id);
      if (collection) {
        files.push(...(await processCollection(collection, selection.modeIds)));
      }
    }
  } else {
    // Export all (backward compatibility)
    for (const collection of collections) {
      files.push(...(await processCollection(collection)));
    }
  }

  figma.ui.postMessage({ type: "EXPORT_RESULT", files });
}

async function processCollection({ name, modes, variableIds }, selectedModeIds = null) {
  const files = [];
  const modesToProcess = selectedModeIds
    ? modes.filter(mode => selectedModeIds.includes(mode.modeId))
    : modes;

  // Sanitize name for filename: lowercase, replace spaces with hyphens
  const sanitize = (str) => str.toLowerCase().replace(/\s+/g, '-');

  for (const mode of modesToProcess) {
    const fileName = `${sanitize(name)}.${sanitize(mode.name)}.tokens.json`;
    const file = { fileName, body: {} };
    for (const variableId of variableIds) {
      const variable = await figma.variables.getVariableByIdAsync(variableId);
      const { name: varName, resolvedType, valuesByMode, description, scopes } = variable;
      const value = valuesByMode[mode.modeId];
      if (value !== undefined && ["COLOR", "FLOAT"].includes(resolvedType)) {
        let obj = file.body;
        const pathParts = varName.split("/");

        // Create nested groups
        for (let i = 0; i < pathParts.length - 1; i++) {
          const groupName = pathParts[i];
          obj[groupName] = obj[groupName] || {};
          obj = obj[groupName];
        }

        // Create the final token
        const lastPart = pathParts[pathParts.length - 1];
        // Export typography font-size and spacing floats as `dimension` with px units
        const isTypographyFontSize = pathParts[0] === 'typography' && pathParts[1] === 'font-size';
        const isSpacing = pathParts[0] === 'spacing';
        const exportType = resolvedType === "COLOR" ? "color" : (resolvedType === "FLOAT" && (isTypographyFontSize || isSpacing) ? "dimension" : "number");
        obj[lastPart] = {
          $type: exportType,
          $value: null
        };

        // Always include `description` (empty string if not present)
        obj[lastPart].description = (description || "");

        if (value.type === "VARIABLE_ALIAS") {
          const currentVar = await figma.variables.getVariableByIdAsync(
            value.id
          );
          obj[lastPart].$value = `{${currentVar.name.replace(/\//g, ".")}}`;
        } else {
          if (resolvedType === "COLOR") {
            obj[lastPart].$value = exportColorObject(value);
          } else if (resolvedType === "FLOAT") {
            const numericValue = value;
            if (isTypographyFontSize || isSpacing) {
              obj[lastPart].$value = { value: numericValue, unit: 'px' };
            } else {
              obj[lastPart].$value = numericValue;
            }
          }
        }
      }
    }

    // Add single extension at file root level
    file.body.$extensions = {
      "com.designtokensmanager": {
        collection: name,
        mode: mode.name,
        exportKey: "variables"
      },
      date: new Date().toISOString()
    };

    files.push(file);
  }
  return files;
}

figma.ui.onmessage = async (e) => {
  console.log("code received message", e);
  if (e.type === "IMPORT") {
    const { fileName, body, parsedInUI, base64Encoded } = e;
    try {
      await importJSONFile({ fileName, body, parsedInUI, base64Encoded });
    } catch (err) {
      console.error('Import failed', err);
      figma.notify('Import failed — check the console for details.');
    }
  } else if (e.type === "GET_COLLECTIONS") {
    await getCollectionsList();
  } else if (e.type === "EXPORT") {
    await exportToJSON(e.selections);
  }
};
if (figma.command === "import") {
  figma.showUI(__uiFiles__["import"], {
    width: 500,
    height: 500,
    themeColors: true,
  });
} else if (figma.command === "export") {
  figma.showUI(__uiFiles__["export"], {
    width: 500,
    height: 500,
    themeColors: true,
  });
}

function rgbToHex({ r, g, b, a }) {
  const toHex = (value) => {
    const hex = Math.round(value * 255).toString(16);
    return hex.length === 1 ? "0" + hex : hex;
  };

  const hex = [toHex(r), toHex(g), toHex(b)].join("");

  // Use 8-digit hex for colors with alpha (DTCG spec compliant)
  if (a !== undefined && a !== 1) {
    return `#${hex}${toHex(a)}`;
  }

  return `#${hex}`;
}

function exportColorObject(value) {
  // value: { r, g, b, a } with r,g,b in 0..1
  const r = typeof value.r === 'number' ? value.r : 0;
  const g = typeof value.g === 'number' ? value.g : 0;
  const b = typeof value.b === 'number' ? value.b : 0;
  const a = typeof value.a === 'number' ? value.a : 1;
  const hex = rgbToHex({ r, g, b, a });
  const round = (n) => Math.round(n * 1e6) / 1e6;
  return {
    colorSpace: 'srgb',
    components: [round(r), round(g), round(b)],
    alpha: round(a),
    hex: hex.toLowerCase(),
  };
}

// Manual base64 -> UTF8 decoder for environments without atob/Buffer
function decodeBase64ToUtf8String(b64) {
  // Remove whitespace/newlines
  const s = String(b64).replace(/\s+/g, '');
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  const len = s.length;
  const bytes = [];
  let i = 0;
  while (i < len) {
    const enc1 = chars.indexOf(s.charAt(i++));
    const enc2 = chars.indexOf(s.charAt(i++));
    const enc3 = chars.indexOf(s.charAt(i++));
    const enc4 = chars.indexOf(s.charAt(i++));
    const chr1 = (enc1 << 2) | (enc2 >> 4);
    const chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
    const chr3 = ((enc3 & 3) << 6) | enc4;
    bytes.push(chr1);
    if (enc3 !== 64) bytes.push(chr2);
    if (enc4 !== 64) bytes.push(chr3);
  }
  // decode utf-8 bytes to string
  let out = '';
  let j = 0;
  while (j < bytes.length) {
    const c = bytes[j++] & 0xff;
    if (c < 128) {
      out += String.fromCharCode(c);
    } else if (c > 191 && c < 224) {
      const c2 = bytes[j++] & 0xff;
      out += String.fromCharCode(((c & 31) << 6) | (c2 & 63));
    } else {
      const c2 = bytes[j++] & 0xff;
      const c3 = bytes[j++] & 0xff;
      out += String.fromCharCode(((c & 15) << 12) | ((c2 & 63) << 6) | (c3 & 63));
    }
  }
  return out;
}

function parseColor(color) {
  if (typeof color === 'object' && color !== null) {
    // Accept object form: { colorSpace: 'srgb', components: [r,g,b], alpha: 1, hex: '#rrggbb' }
    const comps = color.components || color.value || null;
    if (Array.isArray(comps) && comps.length >= 3) {
      let r = comps[0];
      let g = comps[1];
      let b = comps[2];
      const a = typeof color.alpha === 'number' ? color.alpha : 1;
      // Components might be 0..255 or 0..1 — normalize to 0..1
      if (r > 1 || g > 1 || b > 1) {
        r = r / 255;
        g = g / 255;
        b = b / 255;
      }
      return { r, g, b, a };
    }
    // Fall back to hex if available
    if (color.hex) {
      color = color.hex;
    } else {
      throw new Error('Unsupported color object format');
    }
  }
  color = color.trim();
  const rgbRegex = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/;
  const rgbaRegex =
    /^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*([\d.]+)\s*\)$/;
  const hslRegex = /^hsl\(\s*(\d{1,3})\s*,\s*(\d{1,3})%\s*,\s*(\d{1,3})%\s*\)$/;
  const hslaRegex =
    /^hsla\(\s*(\d{1,3})\s*,\s*(\d{1,3})%\s*,\s*(\d{1,3})%\s*,\s*([\d.]+)\s*\)$/;
  const hexRegex = /^#([A-Fa-f0-9]{3}){1,2}$/;
  const floatRgbRegex =
    /^\{\s*r:\s*[\d\.]+,\s*g:\s*[\d\.]+,\s*b:\s*[\d\.]+(,\s*opacity:\s*[\d\.]+)?\s*\}$/;

  if (rgbRegex.test(color)) {
    const [, r, g, b] = color.match(rgbRegex);
    return { r: parseInt(r) / 255, g: parseInt(g) / 255, b: parseInt(b) / 255 };
  } else if (rgbaRegex.test(color)) {
    const [, r, g, b, a] = color.match(rgbaRegex);
    return {
      r: parseInt(r) / 255,
      g: parseInt(g) / 255,
      b: parseInt(b) / 255,
      a: parseFloat(a),
    };
  } else if (hslRegex.test(color)) {
    const [, h, s, l] = color.match(hslRegex);
    return hslToRgbFloat(parseInt(h), parseInt(s) / 100, parseInt(l) / 100);
  } else if (hslaRegex.test(color)) {
    const [, h, s, l, a] = color.match(hslaRegex);
    return Object.assign(
      hslToRgbFloat(parseInt(h), parseInt(s) / 100, parseInt(l) / 100),
      { a: parseFloat(a) }
    );
  } else if (hexRegex.test(color)) {
    const hexValue = color.substring(1);
    const expandedHex =
      hexValue.length === 3
        ? hexValue
          .split("")
          .map((char) => char + char)
          .join("")
        : hexValue;
    return {
      r: parseInt(expandedHex.slice(0, 2), 16) / 255,
      g: parseInt(expandedHex.slice(2, 4), 16) / 255,
      b: parseInt(expandedHex.slice(4, 6), 16) / 255,
    };
  } else if (floatRgbRegex.test(color)) {
    return JSON.parse(color);
  } else {
    throw new Error("Invalid color format");
  }
}

function hslToRgbFloat(h, s, l) {
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  if (s === 0) {
    return { r: l, g: l, b: l };
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const r = hue2rgb(p, q, (h + 1 / 3) % 1);
  const g = hue2rgb(p, q, h % 1);
  const b = hue2rgb(p, q, (h - 1 / 3) % 1);

  return { r, g, b };
}
