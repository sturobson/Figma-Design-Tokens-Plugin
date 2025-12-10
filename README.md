# Variables Import Export

A Figma plugin for importing and exporting design tokens/variables with Style Dictionary compatibility.

## Features

- **Export Variables**: Export Figma variables to JSON format with design token syntax
  - Select specific collections and modes to export
  - Supports `$type` and `$value` syntax
  - Includes `$extensions` metadata for collection and mode info
  - GitHub integration to open your tokens repository

- **Import Variables**: Import JSON design tokens back into Figma
  - Supports multiple file import
  - Creates variable collections automatically
  - Handles token aliases/references

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
      "scopes": [],
      "mode": "light",
      "exportKey": "variables"
    }
  }
}
```

## GitHub Integration

Configure your GitHub repository in `config.json`:

```json
{
  "github": {
    "owner": "your-username",
    "repo": "your-repo-name",
    "branch": "main",
    "tokensPath": "src/tokens"
  }
}
```

After exporting, click "Open in GitHub" to navigate to your tokens folder.

## Development

1. Edit the plugin files
2. In Figma: Plugins → Development → Import plugin from manifest
3. Select the `manifest.json` file

## Utility Scripts

### split-tokens.js

Helper script to split multi-collection exports into separate files:

```bash
node split-tokens.js figma-export.json output-directory/
```
