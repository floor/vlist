// serve.ts - Static file server with Markdown rendering and syntax highlighting
import { readFileSync, existsSync, statSync, readdirSync } from "fs";
import { join, extname, resolve, basename } from "path";

const PORT = 3337;
const ROOT = resolve(".");

// Files/folders to hide from directory listing
const HIDDEN_FILES = new Set([
  ".git",
  ".DS_Store",
  "bun.lock",
  "bun.lockb",
  "node_modules",
]);

// Files that should be rendered as code (no extension)
const DOTFILES = new Set([".gitignore", ".npmignore", ".editorconfig", ".prettierrc"]);

// File type icons (SVG) - Zed-style
const ICONS: Record<string, string> = {
  folder: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M1.5 2.5h4.667l1.166 1.167H14.5v9.833H1.5V2.5z" fill="#8da5b4" stroke="#8da5b4" stroke-width="1"/></svg>`,
  folderOpen: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M1.5 2.5h4.667l1.166 1.167H14.5v2H3l-1.5 7V2.5z" fill="#8da5b4" stroke="#8da5b4" stroke-width="1"/></svg>`,
  ts: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="14" height="14" rx="2" fill="#3178c6"/><text x="8" y="11.5" text-anchor="middle" font-size="8" font-weight="bold" fill="white">TS</text></svg>`,
  js: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="14" height="14" rx="2" fill="#f7df1e"/><text x="8" y="11.5" text-anchor="middle" font-size="8" font-weight="bold" fill="#000">JS</text></svg>`,
  json: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="14" height="14" rx="2" fill="#cbcb41"/><text x="8" y="11.5" text-anchor="middle" font-size="6" font-weight="bold" fill="#000">{}</text></svg>`,
  css: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="14" height="14" rx="2" fill="#563d7c"/><text x="8" y="11.5" text-anchor="middle" font-size="6" font-weight="bold" fill="white">CSS</text></svg>`,
  scss: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="14" height="14" rx="2" fill="#cd6799"/><text x="8" y="11.5" text-anchor="middle" font-size="5" font-weight="bold" fill="white">SCSS</text></svg>`,
  md: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="14" height="14" rx="2" fill="#519aba"/><text x="8" y="11.5" text-anchor="middle" font-size="6" font-weight="bold" fill="white">MD</text></svg>`,
  html: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="14" height="14" rx="2" fill="#e44d26"/><text x="8" y="11.5" text-anchor="middle" font-size="5" font-weight="bold" fill="white">&lt;/&gt;</text></svg>`,
  gitignore: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="14" height="14" rx="2" fill="#f05032"/><text x="8" y="11.5" text-anchor="middle" font-size="8" font-weight="bold" fill="white">G</text></svg>`,
  license: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="14" height="14" rx="2" fill="#d4af37"/><text x="8" y="11.5" text-anchor="middle" font-size="6" font-weight="bold" fill="white">LIC</text></svg>`,
  txt: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="1" width="12" height="14" rx="1" fill="#6b7280"/><line x1="4" y1="5" x2="12" y2="5" stroke="white" stroke-width="1"/><line x1="4" y1="8" x2="12" y2="8" stroke="white" stroke-width="1"/><line x1="4" y1="11" x2="9" y2="11" stroke="white" stroke-width="1"/></svg>`,
  default: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="1" width="12" height="14" rx="1" fill="#9aa5b1" stroke="#9aa5b1"/><line x1="4" y1="5" x2="12" y2="5" stroke="white" stroke-width="1"/><line x1="4" y1="8" x2="12" y2="8" stroke="white" stroke-width="1"/><line x1="4" y1="11" x2="9" y2="11" stroke="white" stroke-width="1"/></svg>`,
};

function getFileIcon(filename: string): string {
  const ext = extname(filename).toLowerCase();
  const name = filename.toLowerCase();

  if (name === ".gitignore") return ICONS.gitignore;
  if (name === "license" || name === "license.md" || name === "license.txt") return ICONS.license;

  const iconMap: Record<string, string> = {
    ".ts": ICONS.ts,
    ".tsx": ICONS.ts,
    ".js": ICONS.js,
    ".mjs": ICONS.js,
    ".jsx": ICONS.js,
    ".json": ICONS.json,
    ".css": ICONS.css,
    ".scss": ICONS.scss,
    ".md": ICONS.md,
    ".html": ICONS.html,
    ".htm": ICONS.html,
    ".txt": ICONS.txt,
  };

  return iconMap[ext] || ICONS.default;
}

// File extensions that should be rendered with syntax highlighting (not served raw)
const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".jsx", ".json",
  ".scss", ".xml", ".yaml", ".yml",
  ".sh", ".bash", ".zsh", ".txt",
]);

// Files that should be rendered as plain text (no extension)
const TEXT_FILES = new Set(["license", "readme", "changelog", "authors", "contributors"]);

// MIME types for raw file serving
const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
};

function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || "application/octet-stream";
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getLanguageFromExt(ext: string): string {
  const langMap: Record<string, string> = {
    ".ts": "typescript", ".tsx": "tsx", ".js": "javascript", ".jsx": "jsx",
    ".mjs": "javascript", ".json": "json", ".css": "css", ".scss": "scss",
    ".html": "html", ".xml": "xml", ".yaml": "yaml", ".yml": "yaml",
    ".sh": "bash", ".bash": "bash", ".zsh": "bash", ".md": "markdown",
  };
  return langMap[ext] || "plaintext";
}

function generateBreadcrumb(urlPath: string): string {
  const parts = urlPath.split("/").filter(Boolean);
  let crumbs = `<a href="/" class="crumb">vlist</a>`;
  let currentPath = "";

  for (let i = 0; i < parts.length; i++) {
    currentPath += "/" + parts[i];
    const isLast = i === parts.length - 1;
    if (isLast) {
      crumbs += `<span class="separator">/</span><span class="crumb current">${escapeHtml(parts[i])}</span>`;
    } else {
      crumbs += `<span class="separator">/</span><a href="${currentPath}/" class="crumb">${escapeHtml(parts[i])}</a>`;
    }
  }

  return crumbs;
}

// Simple Markdown to HTML converter
function renderMarkdown(content: string): string {
  let html = escapeHtml(content);

  // Code blocks
  html = html.replace(
    /```(\w*)\n([\s\S]*?)```/g,
    (_, lang, code) => `<pre><code class="language-${lang || "plaintext"}">${code.trim()}</code></pre>`,
  );

  // Inline code
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Headers
  html = html.replace(/^######\s+(.*)$/gm, "<h6>$1</h6>");
  html = html.replace(/^#####\s+(.*)$/gm, "<h5>$1</h5>");
  html = html.replace(/^####\s+(.*)$/gm, "<h4>$1</h4>");
  html = html.replace(/^###\s+(.*)$/gm, "<h3>$1</h3>");
  html = html.replace(/^##\s+(.*)$/gm, "<h2>$1</h2>");
  html = html.replace(/^#\s+(.*)$/gm, "<h1>$1</h1>");

  // Bold and italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Unordered lists
  html = html.replace(/^[-*]\s+(.*)$/gm, "<li>$1</li>");
  html = html.replace(/(<li>.*<\/li>\n?)+/g, "<ul>$&</ul>");

  // Horizontal rules
  html = html.replace(/^---+$/gm, "<hr>");

  // Paragraphs
  html = html.replace(/^(?!<[hluop]|<hr|<pre|<code)(.+)$/gm, (match, content) => {
    if (content.trim()) return `<p>${content}</p>`;
    return match;
  });

  return html;
}

const STYLES = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    padding: 40px;
    background: #fff;
    max-width: 1000px;
    margin: 0 auto;
    line-height: 1.6;
    color: #333;
  }
  .breadcrumb {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-bottom: 24px;
    font-size: 14px;
  }
  .crumb {
    color: #667eea;
    text-decoration: none;
  }
  .crumb:hover { text-decoration: underline; }
  .crumb.current { color: #333; font-weight: 500; }
  .separator { color: #999; }
  /* Directory listing */
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 4px 24px;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    text-decoration: none;
    color: #333;
    font-size: 14px;
    border-radius: 4px;
  }
  .item:hover { background: #f5f5f5; }
  .icon { width: 16px; height: 16px; flex-shrink: 0; display: flex; align-items: center; }
  .icon svg { width: 16px; height: 16px; }
  /* Markdown & code styles */
  .content { margin-top: 24px; }
  h1, h2, h3, h4, h5, h6 { margin: 24px 0 16px; color: #111; font-weight: 600; }
  h1 { font-size: 2em; border-bottom: 1px solid #e5e7eb; padding-bottom: 8px; }
  h2 { font-size: 1.5em; border-bottom: 1px solid #e5e7eb; padding-bottom: 8px; }
  h3 { font-size: 1.25em; }
  p { margin: 16px 0; }
  a { color: #667eea; }
  code {
    background: #f3f4f6;
    padding: 2px 6px;
    border-radius: 4px;
    font-family: "SF Mono", Consolas, monospace;
    font-size: 0.9em;
  }
  pre {
    background: #f8f9fa;
    padding: 16px;
    border-radius: 8px;
    overflow-x: auto;
    margin: 16px 0;
    border: 1px solid #e5e7eb;
  }
  pre code {
    background: none;
    padding: 0;
    font-size: 14px;
    line-height: 1.5;
  }
  ul, ol { margin: 16px 0; padding-left: 24px; }
  li { margin: 8px 0; }
  hr { border: none; border-top: 1px solid #e5e7eb; margin: 24px 0; }
`;

function wrapInPage(breadcrumb: string, content: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>vlist</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
  <script>hljs.highlightAll();</script>
  <style>${STYLES}</style>
</head>
<body>
  <nav class="breadcrumb">${breadcrumb}</nav>
  <div class="content">${content}</div>
</body>
</html>`;
}

function renderCodeFile(content: string, ext: string): string {
  const lang = getLanguageFromExt(ext);
  return `<pre><code class="language-${lang}">${escapeHtml(content)}</code></pre>`;
}

function generateDirectoryListing(dirPath: string, urlPath: string): string {
  const items = readdirSync(dirPath);
  const folders: string[] = [];
  const files: string[] = [];

  for (const item of items) {
    // Skip hidden files
    if (HIDDEN_FILES.has(item)) continue;

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
    .map((f) => `<a href="${urlPath}${urlPath.endsWith("/") ? "" : "/"}${f}/" class="item"><span class="icon">${ICONS.folder}</span>${f}</a>`)
    .join("\n");

  const fileLinks = files
    .map((f) => `<a href="${urlPath}${urlPath.endsWith("/") ? "" : "/"}${f}" class="item"><span class="icon">${getFileIcon(f)}</span>${f}</a>`)
    .join("\n");

  const breadcrumb = generateBreadcrumb(urlPath);
  const content = `<div class="grid">${folderLinks}${fileLinks}</div>`;

  return wrapInPage(breadcrumb, content);
}

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  let pathname = decodeURIComponent(url.pathname);
  const wantsRaw = url.searchParams.has("raw");

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
      const html = generateDirectoryListing(filePath, pathname);
      return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
  }

  // Serve the file
  try {
    const ext = extname(filePath).toLowerCase();

    // If raw requested or binary file, serve as-is
    if (wantsRaw || MIME_TYPES[ext]?.startsWith("image/") || MIME_TYPES[ext]?.startsWith("font/")) {
      const rawContent = readFileSync(filePath);
      return new Response(rawContent, {
        headers: {
          "Content-Type": getMimeType(filePath),
          "Cache-Control": "no-cache",
        },
      });
    }

    const content = readFileSync(filePath, "utf-8");
    const breadcrumb = generateBreadcrumb(pathname);

    // Render Markdown files
    if (ext === ".md") {
      const html = wrapInPage(breadcrumb, renderMarkdown(content));
      return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // Render code files with syntax highlighting
    if (CODE_EXTENSIONS.has(ext)) {
      const html = wrapInPage(breadcrumb, renderCodeFile(content, ext));
      return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // Render dotfiles (.gitignore, etc.)
    const filename = basename(filePath);
    if (DOTFILES.has(filename)) {
      const html = wrapInPage(breadcrumb, `<pre><code>${escapeHtml(content)}</code></pre>`);
      return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // Render text files without extension (LICENSE, README, etc.)
    const filenameNoExt = basename(filePath).toLowerCase();
    if (TEXT_FILES.has(filenameNoExt)) {
      const html = wrapInPage(breadcrumb, `<pre><code>${escapeHtml(content)}</code></pre>`);
      return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // Default: serve as-is
    return new Response(content, {
      headers: {
        "Content-Type": getMimeType(filePath),
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
