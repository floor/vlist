# Sandbox

The sandbox is an interactive development environment for exploring vlist examples and browsing the source code.

## Quick Start

```bash
# Build and serve
bun run sandbox

# Or separately
bun run build          # Build vlist library
bun run build:sandbox  # Build sandbox examples
bun run serve          # Start dev server
```

Then open http://localhost:3337/sandbox

## Structure

```
sandbox/
├── build.ts              # Auto-discovers and builds all examples
├── basic/                # Pure vanilla JS example (no dependencies)
│   ├── index.html
│   ├── script.js
│   ├── styles.css
│   └── dist/             # Built output (gitignored)
├── selection/            # Selection modes example
├── infinite-scroll/      # Async data loading example
├── million-items/        # Stress test example
└── velocity-loading/     # Velocity-based loading example
```

## Adding a New Example

1. Create a new folder in `sandbox/`:

```
sandbox/my-example/
├── index.html
├── script.js
└── styles.css
```

2. The build script auto-discovers it:

```bash
bun run build:sandbox
# Output: Found 6 examples: basic, infinite-scroll, million-items, my-example, selection, velocity-loading
```

That's it. No configuration needed.

## Build Script

`sandbox/build.ts` automatically:

- Scans `sandbox/` for directories containing `script.js`
- Builds all examples in parallel using Bun
- Outputs to `sandbox/{name}/dist/script.js`
- Reports build times for each example

```bash
bun run build:sandbox

# Output:
# Building sandbox...
# Found 5 examples: basic, infinite-scroll, million-items, selection, velocity-loading
#   basic                 3ms
#   infinite-scroll      12ms
#   million-items        15ms
#   selection            18ms
#   velocity-loading     22ms
# Done in 23ms
```

### Watch Mode

For development, use watch mode to auto-rebuild on changes:

```bash
bun run dev:sandbox
```

## Dev Server

`serve.ts` is a simple Bun-based static file server with:

- **Breadcrumb navigation** - click any path segment to navigate
- **File icons** - Zed-style SVG icons for each file type
- **Markdown rendering** - `.md` files render as HTML
- **Syntax highlighting** - TypeScript, JSON, YAML files are highlighted
- **Hidden files** - `.git`, `node_modules`, `.DS_Store`, `bun.lock` are hidden

### Served vs Rendered

| Extension | Behavior |
|-----------|----------|
| `.html`, `.js`, `.css` | Served as-is (for browsers to execute) |
| `.ts`, `.tsx`, `.jsx` | Rendered with syntax highlighting |
| `.json`, `.yaml`, `.yml` | Rendered with syntax highlighting |
| `.md` | Rendered as HTML |
| `LICENSE`, `.gitignore` | Rendered as text |

### Raw Files

Add `?raw` to any URL to get the raw file:

```
http://localhost:3337/README.md       # Rendered as HTML
http://localhost:3337/README.md?raw   # Raw markdown
```

## Example HTML Template

```html
<!doctype html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>vlist - My Example</title>
    <link rel="stylesheet" href="/dist/vlist.css" />
    <link rel="stylesheet" href="/sandbox/my-example/styles.css" />
</head>
<body>
    <a href="/sandbox/" class="back-link">← Back to Sandbox</a>
    <div id="list-container"></div>
    <script type="module" src="/sandbox/my-example/dist/script.js"></script>
</body>
</html>
```

## Example Script

The basic example shows the minimal vlist usage:

```javascript
import { createVList } from "vlist";

const items = Array.from({ length: 10000 }, (_, i) => ({
  id: i + 1,
  name: `Item ${i + 1}`,
}));

const list = createVList({
  container: "#list-container",
  item: {
    height: 48,
    template: (item) => `<div>${item.name}</div>`,
  },
  items: items,
});
```

## Port

The dev server runs on port **3337** by default (to avoid conflicts with common ports like 3000).