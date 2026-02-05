// serve.ts - Simple Bun static file server with proper MIME types
import { readFileSync, existsSync, statSync, realpathSync } from "fs";
import { join, extname, resolve } from "path";

const PORT = 3337;
const ROOT = resolve(".");

// MIME types for common file extensions
const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".ts": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".eot": "application/vnd.ms-fontobject",
  ".map": "application/json",
};

function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || "application/octet-stream";
}

function generateDirectoryListing(dirPath: string, urlPath: string): string {
  const entries = Bun.file(dirPath);
  const items = readdirSync(dirPath);

  const folders: string[] = [];
  const files: string[] = [];

  for (const item of items) {
    const fullPath = join(dirPath, item);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      folders.push(item);
    } else {
      files.push(item);
    }
  }

  folders.sort();
  files.sort();

  const folderLinks = folders
    .map(
      (f) =>
        `<a href="${urlPath}${urlPath.endsWith("/") ? "" : "/"}${f}/" class="item folder"><span class="icon">📁</span>${f}/</a>`,
    )
    .join("\n");

  const fileLinks = files
    .map((f) => {
      return `<a href="${urlPath}${urlPath.endsWith("/") ? "" : "/"}${f}" class="item file"><span class="icon">📄</span>${f}</a>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Index of ${urlPath}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 40px; background: #fff; }
    h1 { margin-bottom: 30px; color: #333; font-weight: 500; font-size: 24px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px 24px; }
    .item { display: flex; align-items: center; gap: 8px; padding: 8px 0; text-decoration: none; color: #333; font-size: 14px; }
    .item:hover { text-decoration: underline; }
    .item img, .item .icon { width: 24px; height: 24px; flex-shrink: 0; }
    .icon { display: flex; align-items: center; justify-content: center; font-size: 18px; }
    .folder { color: #5f6368; }
    .file { color: #5f6368; }
  </style>
</head>
<body>
  <h1>Index of ${urlPath}</h1>
  <div class="grid">
    ${folderLinks}
    ${fileLinks}
  </div>
</body>
</html>`;
}

import { readdirSync } from "fs";

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  let pathname = decodeURIComponent(url.pathname);

  // Resolve file path
  let filePath = resolve(join(ROOT, pathname));

  // Security: prevent directory traversal
  if (!filePath.startsWith(ROOT + "/") && filePath !== ROOT) {
    return new Response("Forbidden", { status: 403 });
  }

  // Check if path exists
  if (!existsSync(filePath)) {
    return new Response("Not Found", { status: 404 });
  }

  const stat = statSync(filePath);

  // If directory, try index.html or show listing
  if (stat.isDirectory()) {
    const indexPath = join(filePath, "index.html");
    if (existsSync(indexPath)) {
      filePath = indexPath;
    } else {
      // Generate directory listing
      const html = generateDirectoryListing(filePath, pathname);
      return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
  }

  // Serve the file
  try {
    const content = readFileSync(filePath);
    const mimeType = getMimeType(filePath);

    return new Response(content, {
      headers: {
        "Content-Type": mimeType,
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {
    return new Response("Internal Server Error", { status: 500 });
  }
}

console.log(`
🚀 vlist dev server running at http://localhost:${PORT}

Press Ctrl+C to stop.
`);

Bun.serve({
  port: PORT,
  fetch: handleRequest,
});
