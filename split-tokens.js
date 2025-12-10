/**
 * Split Figma plugin export into separate token files
 * This script takes the multi-object JSON output from Figma and splits it into
 * separate properly formatted token files based on the collection name.
 */

const fs = require('fs');
const path = require('path');

function splitFigmaExport(inputFile, outputDir) {
  // Read the file content
  const content = fs.readFileSync(inputFile, 'utf8');

  // Split by }{ pattern to separate the JSON objects
  const jsonStrings = content.split(/\}\s*\n\s*\{/);

  // Reconstruct each JSON object
  const jsonObjects = jsonStrings.map((str, index) => {
    let json = str.trim();
    // Add back the braces that were removed by splitting
    if (index > 0) json = '{' + json;
    if (index < jsonStrings.length - 1) json = json + '}';
    return JSON.parse(json);
  });

  // Create output directory if it doesn't exist
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Process each JSON object
  jsonObjects.forEach((obj) => {
    const extensions = obj.$extensions?.['com.designtokensmanager'];
    if (!extensions) {
      console.warn('No extensions found in object, skipping');
      return;
    }

    const collection = extensions.collection || 'unknown';
    const mode = extensions.mode || 'default';

    // Remove $extensions from the object as we'll add it back wrapped
    const { $extensions, ...tokens } = obj;

    // Wrap tokens in collection name and add extensions back
    const wrappedObj = {
      [collection]: {
        ...tokens,
        $extensions
      }
    };

    // Create filename
    const filename = `${collection}.tokens.json`;
    const outputPath = path.join(outputDir, filename);

    // Write file
    fs.writeFileSync(outputPath, JSON.stringify(wrappedObj, null, 2));
    console.log(`✔︎ Created ${outputPath}`);
  });
}

// Run if called directly
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.log('Usage: node split-tokens.js <input-file> <output-directory>');
    console.log('Example: node split-tokens.js figma-export.json src/');
    process.exit(1);
  }

  const [inputFile, outputDir] = args;
  splitFigmaExport(inputFile, outputDir);
}

module.exports = { splitFigmaExport };
