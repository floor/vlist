# Styles

> CSS styling system for vlist with design tokens, variants, dark mode support, and performance-optimized CSS.

## Overview

vlist uses a CSS custom properties (design tokens) system that provides:

- **Zero runtime overhead** - Pure CSS, no JavaScript styling
- **Dark mode support** - Automatic via `prefers-color-scheme` or manual via `.dark` class
- **Customizable** - Override tokens to match your design system
- **Variants** - Pre-built compact, comfortable, borderless, and striped styles
- **Tailwind compatible** - Works alongside Tailwind CSS v4+
- **Performance-optimized** - CSS containment, `will-change`, and scroll transition suppression
- **Split CSS** - Core styles (6.7 KB) separated from optional extras (3.4 KB)

## Quick Start

### Import Styles

```typescript
import { createVList } from 'vlist';
import 'vlist/styles';

const list = createVList({
  container: '#app',
  item: {
    height: 48,
    template: (item) => `<div>${item.name}</div>`,
  },
  items: data
});
```

### Import Optional Extras

The CSS is split into **core** and **extras** for minimal bundle size:

| File | Size | Contents |
|------|------|----------|
| `dist/vlist.css` | 6.7 KB | Tokens, base layout, item states, custom scrollbar |
| `dist/vlist-extras.css` | 3.4 KB | Variants, loading/empty states, utilities, animations |

```typescript
// Core styles only (recommended minimum)
import 'vlist/styles';

// Optional extras (variants, loading states, animations)
import 'vlist/styles/extras';
```

### Using a CDN

```html
<!-- Core styles -->
<link rel="stylesheet" href="https://unpkg.com/vlist/dist/vlist.css">

<!-- Optional extras -->
<link rel="stylesheet" href="https://unpkg.com/vlist/dist/vlist-extras.css">
```

## CSS Classes

### Structure Classes

| Class | Element | Description |
|-------|---------|-------------|
| `.vlist` | Root | Container element, sets dimensions and overflow |
| `.vlist-viewport` | Scrollable area | Handles scroll with native scrollbar |
| `.vlist-content` | Content wrapper | Sets total height for scroll |
| `.vlist-items` | Items container | Holds rendered item elements |
| `.vlist-item` | Individual item | Positioned absolutely with transforms |

### State Classes

| Class | Description |
|-------|-------------|
| `.vlist-item--selected` | Applied to selected items |
| `.vlist-item--focused` | Applied to keyboard-focused item |
| `.vlist-item--enter` | Applied briefly for fade-in animation |
| `.vlist--scrolling` | Applied to root during active scroll (suppresses CSS transitions) |

### Custom Scrollbar Classes

Used in compressed mode (1M+ items):

| Class | Description |
|-------|-------------|
| `.vlist-scrollbar` | Scrollbar track container |
| `.vlist-scrollbar--visible` | Shows the scrollbar |
| `.vlist-scrollbar--dragging` | Active during thumb drag |
| `.vlist-scrollbar-thumb` | Draggable thumb element |

## CSS Performance Optimizations

vlist applies several CSS-level performance optimizations automatically:

### CSS Containment

The items container and individual items use CSS containment to help the browser optimize layout and paint:

```css
/* Items container - layout and style containment */
.vlist-items {
  contain: layout style;
}

/* Individual items - content containment + compositing hint */
.vlist-item {
  contain: content;
  will-change: transform;
}
```

- **`contain: layout style`** on the items container tells the browser that layout/style changes inside won't affect outside elements
- **`contain: content`** on items is a stricter containment that enables more aggressive optimization
- **`will-change: transform`** promotes items to their own compositing layer for smooth GPU-accelerated positioning

### Static Positioning via CSS

Item positioning uses CSS classes instead of inline `style.cssText`. The `.vlist-item` class sets `position: absolute; top: 0; left: 0; right: 0` — only the dynamic `height` and `transform` (for Y positioning) are set via JavaScript. This eliminates per-element CSS string parsing.

### Scroll Transition Suppression

During active scrolling, the `.vlist--scrolling` class is added to the root element. This disables CSS transitions on items to prevent visual jank:

```css
/* Transitions are suppressed during scroll */
.vlist--scrolling .vlist-item {
  transition: none !important;
}
```

When scrolling stops (idle detected), the class is removed and transitions are re-enabled. This ensures smooth 60fps scrolling while preserving animations during interaction.

---

## Design Tokens

All visual properties are controlled via CSS custom properties.

### Colors (Light Mode)

```css
:root {
  --vlist-bg: #ffffff;                    /* Background */
  --vlist-bg-hover: #f9fafb;              /* Hover state */
  --vlist-bg-selected: #eff6ff;           /* Selected state */
  --vlist-bg-selected-hover: #dbeafe;     /* Selected + hover */
  --vlist-border: #e5e7eb;                /* Borders */
  --vlist-border-selected: #3b82f6;       /* Selected indicator */
  --vlist-text: #111827;                  /* Primary text */
  --vlist-text-muted: #6b7280;            /* Secondary text */
  --vlist-focus-ring: #3b82f6;            /* Focus outline */
  --vlist-scrollbar-thumb: #d1d5db;       /* Scrollbar thumb */
  --vlist-scrollbar-thumb-hover: #9ca3af; /* Scrollbar hover */
}
```

### Colors (Dark Mode)

Automatically applied via `prefers-color-scheme: dark` or `.dark` class:

```css
:root {
  --vlist-bg: #111827;
  --vlist-bg-hover: #1f2937;
  --vlist-bg-selected: rgba(59, 130, 246, 0.2);
  --vlist-bg-selected-hover: rgba(59, 130, 246, 0.3);
  --vlist-border: #374151;
  --vlist-border-selected: #3b82f6;
  --vlist-text: #f9fafb;
  --vlist-text-muted: #9ca3af;
  --vlist-scrollbar-thumb: #4b5563;
  --vlist-scrollbar-thumb-hover: #6b7280;
}
```

### Spacing

```css
:root {
  --vlist-item-padding-x: 1rem;     /* Horizontal padding */
  --vlist-item-padding-y: 0.75rem;  /* Vertical padding */
  --vlist-border-radius: 0.5rem;    /* Container radius */
}
```

### Custom Scrollbar (Compressed Mode)

```css
:root {
  --vlist-scrollbar-width: 8px;
  --vlist-scrollbar-track-bg: transparent;
  --vlist-scrollbar-custom-thumb-bg: rgba(0, 0, 0, 0.3);
  --vlist-scrollbar-custom-thumb-hover-bg: rgba(0, 0, 0, 0.5);
  --vlist-scrollbar-custom-thumb-radius: 4px;
}
```

### Transitions

```css
:root {
  --vlist-transition-duration: 150ms;
  --vlist-transition-timing: ease-in-out;
}
```

## Customization

### Override Tokens

Apply custom values to match your design system:

```css
/* Custom theme */
:root {
  --vlist-bg: #fafafa;
  --vlist-bg-selected: #e0f2fe;
  --vlist-border-selected: #0ea5e9;
  --vlist-focus-ring: #0ea5e9;
  --vlist-border-radius: 0.75rem;
}
```

### Scoped Customization

Apply different styles to specific lists:

```css
.my-custom-list {
  --vlist-bg: #1e1e2e;
  --vlist-text: #cdd6f4;
  --vlist-bg-selected: #45475a;
}
```

```html
<div id="my-list" class="my-custom-list"></div>
```

### Custom Class Prefix

Change the default `vlist` prefix:

```typescript
const list = createVList({
  container: '#app',
  classPrefix: 'mylist',  // Uses .mylist, .mylist-item, etc.
  // ...
});
```

Then update your CSS:

```css
.mylist { /* ... */ }
.mylist-item { /* ... */ }
.mylist-item--selected { /* ... */ }
```

## Variants

### Compact

Reduced padding for dense lists:

```html
<div id="list" class="vlist vlist--compact"></div>
```

```css
.vlist--compact .vlist-item {
  padding: 0.5rem 0.75rem;
}
```

### Comfortable

Increased padding for touch-friendly lists:

```html
<div id="list" class="vlist vlist--comfortable"></div>
```

```css
.vlist--comfortable .vlist-item {
  padding: 1rem 1.25rem;
}
```

### Borderless

Remove container and item borders:

```html
<div id="list" class="vlist vlist--borderless"></div>
```

### Striped

Alternating row backgrounds:

```html
<div id="list" class="vlist vlist--striped"></div>
```

### Animated

Enable smooth item transitions:

```html
<div id="list" class="vlist vlist--animate"></div>
```

### Combining Variants

```html
<div id="list" class="vlist vlist--compact vlist--striped vlist--borderless"></div>
```

## Dark Mode

### Automatic (System Preference)

Dark mode is automatically applied when the user's system prefers dark mode:

```css
@media (prefers-color-scheme: dark) {
  :root {
    --vlist-bg: #111827;
    /* ... dark mode tokens */
  }
}
```

### Manual Toggle

Use the `.dark` class on any parent element:

```html
<body class="dark">
  <div id="list"></div>
</body>
```

Or scope it to the list:

```html
<div id="list" class="dark"></div>
```

### Tailwind CSS Integration

If using Tailwind's dark mode:

```html
<!-- Tailwind class-based dark mode -->
<html class="dark">
  <body>
    <div id="list"></div>
  </body>
</html>
```

## Template Styling

Style items directly in your template function:

```typescript
const list = createVList({
  container: '#app',
  item: {
    height: 64,
    template: (item, index, { selected, focused }) => `
    <div class="flex items-center gap-4 w-full">
      <img 
        src="${item.avatar}" 
        class="w-10 h-10 rounded-full"
        alt="${item.name}"
      />
      <div class="flex-1 min-w-0">
        <div class="font-medium truncate ${selected ? 'text-blue-600' : ''}">${item.name}</div>
        <div class="text-sm text-gray-500 truncate">${item.email}</div>
      </div>
    </div>
  `,
  },
  items: users,
  selection: { mode: 'single' }
});
```

### Template Context

The template function receives useful state:

```typescript
item: {
  height: 48,
  template: (item, index, context) => {
    const { selected, focused } = context;
    // selected: boolean - Is this item selected?
    // focused: boolean - Is this item keyboard-focused?
    return `...`;
  },
}
```

## Loading & Empty States

### Loading Overlay

```css
.vlist-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(4px);
  z-index: 20;
}

.vlist-loading-spinner {
  width: 2rem;
  height: 2rem;
  border: 4px solid var(--vlist-border);
  border-top-color: var(--vlist-focus-ring);
  border-radius: 50%;
  animation: vlist-spin 1s linear infinite;
}

@keyframes vlist-spin {
  to { transform: rotate(360deg); }
}
```

### Empty State

```css
.vlist-empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--vlist-text-muted);
  padding: 2rem;
  text-align: center;
}

.vlist-empty-text {
  font-size: 1.125rem;
  font-weight: 500;
}

.vlist-empty-subtext {
  font-size: 0.875rem;
  margin-top: 0.25rem;
  opacity: 0.75;
}
```

## Animations

### Fade-in Animation

New items can animate in:

```css
@keyframes vlist-fade-in {
  from {
    opacity: 0;
    transform: translateY(-8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.vlist-item--enter {
  animation: vlist-fade-in 0.2s ease-out;
}
```

### Smooth Transitions

Enable with the `.vlist--animate` variant:

```css
.vlist--animate .vlist-item {
  transition:
    background-color var(--vlist-transition-duration) var(--vlist-transition-timing),
    transform 0.2s ease-out,
    opacity 0.2s ease-out;
}
```

## Utility Classes

### Hide Scrollbar

Keep scroll functionality but hide the scrollbar:

```html
<div id="list" class="vlist-scrollbar-hide"></div>
```

```css
.vlist-scrollbar-hide {
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.vlist-scrollbar-hide::-webkit-scrollbar {
  display: none;
}
```

## Best Practices

### 1. Use Design Tokens

Always use CSS custom properties instead of hardcoding values:

```css
/* ✅ Good */
.my-item {
  background: var(--vlist-bg-selected);
}

/* ❌ Avoid */
.my-item {
  background: #eff6ff;
}
```

### 2. Scope Custom Styles

Use specific selectors to avoid conflicts:

```css
/* ✅ Good - scoped */
#my-list .vlist-item {
  font-size: 14px;
}

/* ❌ Avoid - too broad */
.vlist-item {
  font-size: 14px;
}
```

### 3. Keep Templates Lightweight

For best performance, keep template CSS minimal:

```typescript
// ✅ Good - uses existing classes
item: {
  height: 48,
  template: (item) => `
    <div class="flex items-center gap-2">
      <span>${item.name}</span>
    </div>
  `,
}

// ❌ Avoid - complex inline styles
item: {
  height: 48,
  template: (item) => `
    <div style="display:flex;align-items:center;gap:8px;padding:12px;">
      <span>${item.name}</span>
    </div>
  `,
}
```

### 4. Test Dark Mode

Always verify your customizations work in both light and dark modes.

## Browser Support

The CSS uses modern features supported in:

- Chrome/Edge 88+
- Firefox 78+
- Safari 14+

Required CSS features:
- CSS Custom Properties (variables)
- Flexbox
- `inset` shorthand
- `backdrop-filter` (graceful degradation)

---

*See also: [Main Documentation](./vlist.md) | [Compression Guide](./compression.md)*