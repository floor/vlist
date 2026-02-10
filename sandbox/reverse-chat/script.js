// script.js - vlist Reverse Mode Example
// Chat-style messaging UI demonstrating reverse: true
//
// Features shown:
//   - reverse: true → starts scrolled to bottom
//   - appendItems() auto-scrolls to bottom (new messages)
//   - prependItems() preserves scroll position (older messages)
//   - Manual "load older" on scroll near top (no adapter — reverse
//     mode is best demonstrated with explicit prepend/append)
//   - Variable heights via DOM measurement

import { createVList } from "vlist";

// =============================================================================
// Data — message corpus & users
// =============================================================================

const MESSAGES = [
  "Hey! 👋",
  "What's up?",
  "Not much, just listening to some music",
  "Check out this new album I found on Radiooooo 🎶",
  "Oh nice! What decade?",
  "1970s Brazilian funk. The groove is incredible.",
  "I've been on a 1960s Japanese city pop kick lately. The production quality is way ahead of its time — lush arrangements, incredible detail.",
  "lol",
  "👍",
  "brb",
  "Did you know you can scroll through music by country AND decade? I spent 3 hours exploring Soviet-era Georgian folk music yesterday. The polyphonic singing is out of this world — layers upon layers of voices.",
  "Ha, classic rabbit hole",
  "The best kind though",
  "true",
  "Anyone want to grab lunch?",
  "🎵🎵🎵",
  "I was thinking about how 1950s West African music has this incredible rhythmic complexity that influenced jazz, funk, afrobeat, and even modern electronic music.",
  "Totally agree",
  "Yes! Fela Kuti's early stuff especially",
  "omw",
  "k",
  "The thing about exploring music geographically is that you hear the connections between cultures — a melody traveling from North Africa through Spain into Latin America and back. An audible map of human migration.",
  "That's deep",
  "Mind = blown 🤯",
  "Wait, have you tried the random mode? It drops you into a random country and decade. Yesterday I landed on 1980s Iceland and discovered an amazing post-punk scene.",
  "No way, adding that to my list",
  "Do it. You won't regret it.",
  "🇮🇸 🎸",
  "So I went down the Iceland rabbit hole and found experimental electronic music from Reykjavik in the late 90s that basically paved the way for ambient and IDM",
  "Has anyone tried making a playlist that follows one genre across every continent? Like jazz from New Orleans to Paris to Tokyo to Lagos?",
  "That sounds amazing, how do I do that?",
  "Just pick a decade, click through countries one by one — you'll hear the local flavor each place added",
  "🔥🔥🔥",
  "ok I just tried 1940s Cuba and I can't stop dancing at my desk",
  "haha same thing happened to me last week",
  "The mambo recordings from that era are some of the most joyful music ever. Pérez Prado was doing things with brass that still sound fresh 80 years later.",
];

const USERS = [
  { name: "Alice", color: "#667eea", initials: "A" },
  { name: "Bob", color: "#e06595", initials: "B" },
  { name: "Charlie", color: "#38a169", initials: "C" },
  { name: "Diana", color: "#d97706", initials: "D" },
  { name: "You", color: "#667eea", initials: "Y" },
];

const SELF_USER = USERS[4];

const DATE_LABELS = [
  "December 10",
  "December 12",
  "December 14",
  "December 16",
  "Yesterday",
  "Today",
];

const DATE_HEADER_HEIGHT = 36;
const DEFAULT_MSG_HEIGHT = 56;

// Total messages available to "load" from the server
const TOTAL_HISTORY = 500;
// How many to load as the initial page (newest)
const INITIAL_PAGE = 100;
// How many to prepend when scrolling near the top
const PREPEND_PAGE = 60;
// Scroll threshold (px from top) to trigger loading older messages
const LOAD_THRESHOLD = 200;
// Simulated network delay (ms)
const LOAD_DELAY = 300;

// =============================================================================
// Message generation — produces a deterministic corpus
// =============================================================================

const generateMessage = (index) => {
  const text = MESSAGES[index % MESSAGES.length];
  const userIdx = index % (USERS.length - 1); // exclude "You" from history
  const user = USERS[userIdx];
  const hour = 8 + (index % 14);
  const minute = (index * 7) % 60;

  return {
    id: `msg-${index}`,
    isHeader: false,
    text,
    user: user.name,
    color: user.color,
    initials: user.initials,
    isSelf: false,
    time: `${hour}:${String(minute).padStart(2, "0")}`,
    height: 0, // measured below
  };
};

/**
 * Generate a page of messages in chronological order.
 * Sprinkles date separators at regular intervals.
 */
const generatePage = (startIndex, count) => {
  const items = [];
  const messagesPerDate = Math.ceil(TOTAL_HISTORY / DATE_LABELS.length);

  for (let i = 0; i < count; i++) {
    const globalIdx = startIndex + i;
    if (globalIdx >= TOTAL_HISTORY) break;

    // Insert date separator at section boundaries
    const dateSection = Math.floor(globalIdx / messagesPerDate);
    const prevSection =
      globalIdx > 0 ? Math.floor((globalIdx - 1) / messagesPerDate) : -1;

    if (dateSection !== prevSection && dateSection < DATE_LABELS.length) {
      items.push({
        id: `date-${dateSection}`,
        isHeader: true,
        text: DATE_LABELS[dateSection],
        height: DATE_HEADER_HEIGHT,
      });
    }

    items.push(generateMessage(globalIdx));
  }

  return items;
};

// =============================================================================
// Templates (return HTML strings)
// =============================================================================

const renderDateSep = (item) => `
  <div class="date-sep">
    <span class="date-sep__line"></span>
    <span class="date-sep__text">${item.text}</span>
    <span class="date-sep__line"></span>
  </div>
`;

const renderMessage = (item) => {
  const selfClass = item.isSelf ? " msg--self" : "";
  return `
    <div class="msg${selfClass}">
      <div class="msg__avatar" style="background:${item.color}">${item.initials}</div>
      <div class="msg__bubble">
        <div class="msg__name">${item.user}</div>
        <div class="msg__text">${item.text}</div>
        <div class="msg__time">${item.time}</div>
      </div>
    </div>
  `;
};

const renderItem = (item) => {
  if (item.isHeader) return renderDateSep(item);
  return renderMessage(item);
};

// =============================================================================
// DOM Measurement
//
// Measure BEFORE creating the vlist so we use the container's full width
// (no scrollbar yet). A persistent content cache avoids redundant DOM
// measurements across pages.
// =============================================================================

const contentCache = new Map();

const measureHeights = (items, containerWidth) => {
  const measurer = document.createElement("div");
  measurer.style.cssText =
    "position:absolute;top:0;left:0;visibility:hidden;pointer-events:none;" +
    `width:${containerWidth}px;`;
  document.body.appendChild(measurer);

  for (const item of items) {
    if (item.isHeader) continue; // fixed height

    const key = `${item.isSelf ? "self:" : ""}${item.user}:${item.text}`;
    if (contentCache.has(key)) {
      item.height = contentCache.get(key);
      continue;
    }

    measurer.innerHTML = renderMessage(item);
    const measured = measurer.firstElementChild.offsetHeight;
    item.height = measured;
    contentCache.set(key, measured);
  }

  measurer.remove();
};

/**
 * Return the width to use for measurement.
 * After vlist is created, use .vlist-viewport clientWidth (excludes scrollbar).
 * Before vlist exists, use the container's clientWidth.
 */
const getMeasureWidth = (container) => {
  const viewport = container.querySelector(".vlist-viewport");
  return viewport ? viewport.clientWidth : container.clientWidth;
};

// =============================================================================
// Event log
// =============================================================================

const MAX_LOG = 20;
const logEntries = [];

const addLog = (event, data) => {
  const time = new Date().toLocaleTimeString();
  logEntries.unshift({ time, event, data });
  if (logEntries.length > MAX_LOG) logEntries.pop();
  renderLog();
};

const renderLog = () => {
  const el = document.getElementById("event-log");
  if (!el) return;
  el.innerHTML = logEntries
    .map(
      (e) =>
        `<div class="event-log__entry">` +
        `<span class="event-log__time">[${e.time}]</span>` +
        `<span class="event-log__event">${e.event}</span>` +
        `<span class="event-log__data">${e.data}</span>` +
        `</div>`,
    )
    .join("");
};

// =============================================================================
// Setup
// =============================================================================

document.addEventListener("DOMContentLoaded", () => {
  const container = document.getElementById("list-container");
  const statsEl = document.getElementById("stats");
  const statusEl = document.getElementById("channel-status");
  const inputEl = document.getElementById("message-input");
  const sendBtn = document.getElementById("send-btn");

  // ------------------------------------------------------------------
  // Generate & measure the initial page BEFORE creating vlist
  // (so the container width has no scrollbar deducted yet).
  // ------------------------------------------------------------------

  // How many messages from history have been loaded so far
  let historyLoaded = INITIAL_PAGE;
  // Counter for new user-sent messages
  let sentCounter = 0;
  // Flag to prevent concurrent loads
  let isLoadingOlder = false;

  const startIdx = TOTAL_HISTORY - INITIAL_PAGE;
  const initialItems = generatePage(startIdx, INITIAL_PAGE);

  // Measure at the container width (no vlist DOM yet → no scrollbar)
  measureHeights(initialItems, container.clientWidth);

  // Mirror of vlist's internal items — the height function needs this
  // during createVList() (before `list` is assigned) and after mutations.
  let currentItems = [...initialItems];

  const updateStatus = () => {
    const remaining = TOTAL_HISTORY - historyLoaded;
    statusEl.textContent =
      remaining > 0
        ? `${remaining} older messages available`
        : `All ${TOTAL_HISTORY} messages loaded`;
  };

  updateStatus();

  // ------------------------------------------------------------------
  // Create the list with reverse: true and static items
  // ------------------------------------------------------------------

  const list = createVList({
    container,
    ariaLabel: "Chat messages",
    reverse: true,
    item: {
      height: (index) => {
        const item = currentItems[index];
        return (item && item.height) || DEFAULT_MSG_HEIGHT;
      },
      template: (item) => {
        const el = document.createElement("div");
        el.innerHTML = renderItem(item);
        return el.firstElementChild;
      },
    },
    items: initialItems,
  });

  addLog("init", `reverse: true — ${initialItems.length} items loaded`);

  // ------------------------------------------------------------------
  // Load older messages on scroll near top (manual prependItems)
  // ------------------------------------------------------------------

  const loadOlderMessages = async () => {
    if (isLoadingOlder) return;

    const remaining = TOTAL_HISTORY - historyLoaded;
    if (remaining <= 0) return;

    isLoadingOlder = true;
    addLog("load", "fetching older messages…");

    // Simulate network delay
    await new Promise((r) => setTimeout(r, LOAD_DELAY));

    const count = Math.min(PREPEND_PAGE, remaining);
    const start = TOTAL_HISTORY - historyLoaded - count;
    const page = generatePage(Math.max(0, start), count);

    // Measure at the viewport width (scrollbar exists now)
    measureHeights(page, getMeasureWidth(container));

    currentItems = [...page, ...currentItems];
    list.prependItems(page);
    historyLoaded += count;

    addLog("prepend", `${page.length} older messages (scroll preserved)`);
    updateStatus();
    isLoadingOlder = false;
    scheduleStatsUpdate();
  };

  // ------------------------------------------------------------------
  // Wire events
  // ------------------------------------------------------------------

  list.on("scroll", ({ scrollTop }) => {
    scheduleStatsUpdate();

    // Trigger "load older" when near the top
    if (scrollTop < LOAD_THRESHOLD && !isLoadingOlder) {
      loadOlderMessages();
    }
  });

  list.on("range:change", ({ range }) => {
    addLog("range", `${range.start}–${range.end}`);
  });

  list.on("error", ({ error, context }) => {
    addLog("error", `${context}: ${error.message}`);
  });

  // ------------------------------------------------------------------
  // Send message (appendItems — auto-scrolls when at bottom)
  // ------------------------------------------------------------------

  const sendMessage = (text) => {
    if (!text.trim()) return;

    const now = new Date();
    const time = `${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")}`;
    const msg = {
      id: `sent-${sentCounter++}`,
      isHeader: false,
      text: text.trim(),
      user: SELF_USER.name,
      color: SELF_USER.color,
      initials: SELF_USER.initials,
      isSelf: true,
      time,
      height: 0,
    };

    // Measure at the actual viewport width
    measureHeights([msg], getMeasureWidth(container));

    currentItems.push(msg);
    list.appendItems([msg]);
    addLog("append", `"${text.trim().slice(0, 40)}…"`);
    inputEl.value = "";
    inputEl.focus();
    scheduleStatsUpdate();
  };

  sendBtn.addEventListener("click", () => sendMessage(inputEl.value));
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(inputEl.value);
    }
  });

  // ------------------------------------------------------------------
  // Controls
  // ------------------------------------------------------------------

  document.getElementById("jump-bottom").addEventListener("click", () => {
    const total = list.total;
    if (total > 0) {
      list.scrollToIndex(total - 1, "end");
      addLog("action", "Jump to bottom");
    }
  });

  document.getElementById("add-batch").addEventListener("click", () => {
    const now = new Date();
    const time = `${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")}`;
    const batch = [];

    for (let i = 0; i < 5; i++) {
      const userIdx = i % (USERS.length - 1);
      const user = USERS[userIdx];
      const text = MESSAGES[(sentCounter + i) % MESSAGES.length];
      batch.push({
        id: `sent-${sentCounter++}`,
        isHeader: false,
        text,
        user: user.name,
        color: user.color,
        initials: user.initials,
        isSelf: false,
        time,
        height: 0,
      });
    }

    measureHeights(batch, getMeasureWidth(container));
    currentItems.push(...batch);
    list.appendItems(batch);
    addLog("append", `batch of ${batch.length} messages`);
    scheduleStatsUpdate();
  });

  document.getElementById("load-older").addEventListener("click", () => {
    loadOlderMessages();
  });

  // ------------------------------------------------------------------
  // Stats display (throttled)
  // ------------------------------------------------------------------

  let statsRaf = false;

  function scheduleStatsUpdate() {
    if (statsRaf) return;
    statsRaf = true;
    requestAnimationFrame(() => {
      updateStats();
      statsRaf = false;
    });
  }

  function updateStats() {
    const total = list.total;
    const domNodes = container.querySelectorAll(".vlist-item").length;
    const virtualized =
      total > 0 ? Math.round((1 - domNodes / total) * 100) : 0;

    statsEl.innerHTML = [
      `<span><strong>Total:</strong> ${total.toLocaleString()} items</span>`,
      `<span><strong>DOM:</strong> ${domNodes}</span>`,
      `<span><strong>Virtualized:</strong> ${virtualized}%</span>`,
      `<span><strong>History:</strong> ${historyLoaded}/${TOTAL_HISTORY}</span>`,
    ].join("");
  }

  setTimeout(scheduleStatsUpdate, 100);
});
