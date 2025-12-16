# Variables Import Export

A Figma plugin for importing and exporting design tokens/variables with Style Dictionary compatibility.

## Features

- **Export Variables**: Export Figma variables to JSON format with design token syntax
  - Select specific collections and modes to export
  - Supports `$type` and `$value` syntax
  - Includes `$extensions` metadata for collection and mode info
  - Copy to clipboard or download as ZIP files

- **Import Variables**: Import JSON design tokens back into Figma
  - Supports multiple file import or pasting content
  - Creates variable collections automatically
  - Handles token aliases/references

## Setup

### 1. Install the Plugin

1. Download or clone this repository
2. In Figma: **Plugins → Development → Import plugin from manifest**
3. Select the `manifest.json` file from this project

### 2. Usage

#### Exporting Tokens
1. Run the plugin: **Plugins → Variables Import Export → Export Variables**
2. Select the collections and modes you want to export
3. Click **Export Selected**
4. Review the exported JSON in the textarea
5. Click **Copy to Clipboard** or download as ZIP files

#### Importing Tokens
1. Run the plugin: **Plugins → Variables Import Export → Import Variables**
2. Select local files or paste JSON content
3. Click **Import** to create Figma variables

## Export Format

Tokens are exported with the following structure:

```json
{
  "color": {
    "primary": {
      "$type": "color",
      "$value": "#0066CC"
    }
  },
  "$extensions": {
    "com.designtokensmanager": {
      "collection": "colors",
      "mode": "light",
      "exportKey": "variables",
      "dateCreated": "2023-10-01T12:00:00.000Z",
      "lastModified": "2023-10-01T12:00:00.000Z"
    }
  }
}
```

## Development

### Prerequisites
- Node.js (for build script)
- Figma Desktop app

### Development Setup
1. Clone this repository
2. In Figma: **Plugins → Development → Import plugin from manifest**
3. Select `manifest.json`

### Making Changes
- Edit source files (`code.js`, `export.html`, `import.html`)
- Reload the plugin in Figma to test changes

## Utility Scripts

### build.js
Build script (no longer embeds config):
```bash
node build.js
```

### split-tokens.js
Helper script to split multi-collection exports into separate files:
```bash
node split-tokens.js figma-export.json output-directory/
```

## Troubleshooting

### Plugin won't load
- Ensure `manifest.json` is valid JSON
- Try reloading the plugin in Figma
- Check the Figma console for errors
