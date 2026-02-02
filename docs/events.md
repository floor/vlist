# Events Module

> Lightweight, type-safe event emitter system for vlist.

## Overview

The events module provides a simple but powerful event system that enables:

- **Type-safe events**: Full TypeScript support for event names and payloads
- **Subscription management**: Easy subscribe/unsubscribe patterns
- **Error isolation**: Handlers are wrapped to prevent cascade failures
- **Memory safety**: Simple cleanup with `clear()` method

## Module Structure

```
src/events/
├── index.ts    # Module exports
└── emitter.ts  # Event emitter implementation
```

## Key Concepts

### Event-Driven Architecture

vlist uses events to communicate state changes without tight coupling:

```
User Action → Handler → State Change → Event Emitted → Subscribers Notified
```

### Type Safety

Events are fully typed using TypeScript's mapped types:

```typescript
interface VListEvents<T extends VListItem> {
  'item:click': { item: T; index: number; event: MouseEvent };
  'selection:change': { selected: Array<string | number>; items: T[] };
  'scroll': { scrollTop: number; direction: 'up' | 'down' };
  // ...
}

// Handlers receive correctly typed payloads
emitter.on('item:click', ({ item, index, event }) => {
  // TypeScript knows all types here
});
```

## API Reference

### `createEmitter`

Creates a type-safe event emitter.

```typescript
function createEmitter<T extends EventMap>(): Emitter<T>;

type EventMap = Record<string, unknown>;
```

### Emitter Interface

```typescript
interface Emitter<T extends EventMap> {
  /** Subscribe to an event */
  on: <K extends keyof T>(
    event: K,
    handler: EventHandler<T[K]>
  ) => Unsubscribe;

  /** Unsubscribe from an event */
  off: <K extends keyof T>(
    event: K,
    handler: EventHandler<T[K]>
  ) => void;

  /** Emit an event to all subscribers */
  emit: <K extends keyof T>(
    event: K,
    payload: T[K]
  ) => void;

  /** Subscribe once (auto-unsubscribe after first call) */
  once: <K extends keyof T>(
    event: K,
    handler: EventHandler<T[K]>
  ) => Unsubscribe;

  /** Remove all listeners */
  clear: <K extends keyof T>(event?: K) => void;

  /** Get listener count for an event */
  listenerCount: <K extends keyof T>(event: K) => number;
}
```

### Types

```typescript
/** Event handler function */
type EventHandler<T> = (payload: T) => void;

/** Unsubscribe function returned by on() */
type Unsubscribe = () => void;
```

## VList Events

vlist emits the following events:

### `item:click`

Fired when an item is clicked.

```typescript
interface ItemClickPayload<T> {
  item: T;           // The clicked item
  index: number;     // Item index
  event: MouseEvent; // Original mouse event
}

list.on('item:click', ({ item, index, event }) => {
  console.log(`Clicked item ${index}:`, item);
});
```

### `selection:change`

Fired when selection changes.

```typescript
interface SelectionChangePayload<T> {
  selected: Array<string | number>; // Selected IDs
  items: T[];                       // Selected items
}

list.on('selection:change', ({ selected, items }) => {
  console.log(`${selected.length} items selected`);
});
```

### `scroll`

Fired on scroll position change.

```typescript
interface ScrollPayload {
  scrollTop: number;
  direction: 'up' | 'down';
}

list.on('scroll', ({ scrollTop, direction }) => {
  console.log(`Scrolled ${direction} to ${scrollTop}px`);
});
```

### `range:change`

Fired when visible range changes.

```typescript
interface RangeChangePayload {
  range: Range;
}

list.on('range:change', ({ range }) => {
  console.log(`Visible range: ${range.start} - ${range.end}`);
});
```

### `load:start`

Fired when data loading starts (adapter mode).

```typescript
interface LoadStartPayload {
  offset: number;
  limit: number;
}

list.on('load:start', ({ offset, limit }) => {
  console.log(`Loading ${limit} items from offset ${offset}`);
});
```

### `load:end`

Fired when data loading completes.

```typescript
interface LoadEndPayload<T> {
  items: T[];
  total?: number;
}

list.on('load:end', ({ items, total }) => {
  console.log(`Loaded ${items.length} items, total: ${total}`);
});
```

### `error`

Fired when an error occurs.

```typescript
interface ErrorPayload {
  error: Error;
  context: string;
}

list.on('error', ({ error, context }) => {
  console.error(`Error in ${context}:`, error.message);
});
```

## Usage Examples

### Basic Subscription

```typescript
import { createEmitter } from './events';

// Create emitter with typed events
const emitter = createEmitter<{
  'message': { text: string };
  'count': { value: number };
}>();

// Subscribe
const unsubscribe = emitter.on('message', ({ text }) => {
  console.log(text);
});

// Emit
emitter.emit('message', { text: 'Hello!' }); // logs: "Hello!"

// Unsubscribe
unsubscribe();
```

### One-Time Subscription

```typescript
// Subscribe once - auto-unsubscribes after first call
emitter.once('message', ({ text }) => {
  console.log('First message only:', text);
});

emitter.emit('message', { text: 'First' });  // logs
emitter.emit('message', { text: 'Second' }); // nothing happens
```

### Manual Unsubscribe

```typescript
const handler = ({ text }) => console.log(text);

emitter.on('message', handler);
emitter.off('message', handler);
```

### Clear All Listeners

```typescript
// Clear specific event
emitter.clear('message');

// Clear all events
emitter.clear();
```

### Check Listener Count

```typescript
emitter.on('message', () => {});
emitter.on('message', () => {});

console.log(emitter.listenerCount('message')); // 2
```

### VList Event Usage

```typescript
import { createVList } from 'vlist';

const list = createVList({
  container: '#app',
  itemHeight: 48,
  items: myItems,
  template: (item) => `<div>${item.name}</div>`,
  selection: { mode: 'multiple' }
});

// Track scroll position
list.on('scroll', ({ scrollTop }) => {
  saveScrollPosition(scrollTop);
});

// Handle selection changes
list.on('selection:change', ({ items }) => {
  updateSelectedCount(items.length);
});

// Handle clicks
list.on('item:click', ({ item, event }) => {
  if (event.ctrlKey) {
    openInNewTab(item);
  }
});

// Handle errors
list.on('error', ({ error, context }) => {
  showErrorNotification(`${context}: ${error.message}`);
});
```

### Loading States

```typescript
let isLoading = false;

list.on('load:start', () => {
  isLoading = true;
  showLoadingSpinner();
});

list.on('load:end', () => {
  isLoading = false;
  hideLoadingSpinner();
});

list.on('error', ({ context }) => {
  if (context === 'loadMore') {
    showRetryButton();
  }
});
```

## Implementation Details

### Error Isolation

Event handlers are wrapped in try-catch to prevent one handler from breaking others:

```typescript
const emit = (event, payload) => {
  listeners[event]?.forEach((handler) => {
    try {
      handler(payload);
    } catch (error) {
      console.error(`[vlist] Error in event handler for "${event}":`, error);
    }
  });
};
```

### Memory Management

Listeners are stored in Sets for O(1) add/remove operations:

```typescript
type Listeners<T extends EventMap> = {
  [K in keyof T]?: Set<EventHandler<T[K]>>;
};
```

### Unsubscribe Pattern

The `on()` method returns an unsubscribe function, enabling clean cleanup:

```typescript
const subscriptions: Unsubscribe[] = [];

// Subscribe
subscriptions.push(list.on('scroll', handleScroll));
subscriptions.push(list.on('selection:change', handleSelection));

// Cleanup
subscriptions.forEach(unsub => unsub());
```

## Best Practices

### Always Unsubscribe

Prevent memory leaks by unsubscribing when done:

```typescript
// In a component or module
const unsubscribers: Unsubscribe[] = [];

function init() {
  unsubscribers.push(list.on('scroll', handleScroll));
}

function cleanup() {
  unsubscribers.forEach(unsub => unsub());
  unsubscribers.length = 0;
}
```

### Use `once` for One-Time Events

```typescript
// Good: auto-cleanup
list.once('load:end', showWelcomeMessage);

// Instead of
const unsub = list.on('load:end', (payload) => {
  showWelcomeMessage(payload);
  unsub();
});
```

### Handle Errors

Always add an error handler:

```typescript
list.on('error', ({ error, context }) => {
  // Log to monitoring service
  logError(error, { context, component: 'vlist' });
  
  // Show user feedback
  showErrorToast(`Failed to ${context}`);
});
```

## Related Modules

- [types.md](./types.md) - Event type definitions
- [handlers.md](./handlers.md) - Event handlers that emit events
- [context.md](./context.md) - Context holds emitter reference

---

*The event system provides clean decoupling between vlist internals and consumer code.*