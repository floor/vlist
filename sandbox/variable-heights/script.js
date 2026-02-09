// Variable Heights Example - Chat Message Feed
// Demonstrates truly dynamic item heights via DOM measurement at init.
// Each item is rendered into a hidden measuring element once, and the
// measured pixel height is stored. The height function is a pure lookup.

import { createVList } from "vlist";

// =============================================================================
// Data
// =============================================================================

const MESSAGES = [
  "Hey!",
  "What's up?",
  "Not much, you?",
  "Check out this new album I found on Radiooooo 🎶",
  "Oh nice! What decade?",
  "1970s Brazilian funk. It's incredible — the groove, the horns, everything about it is just perfect. I've had it on repeat all week.",
  "I've been listening to a lot of 1960s Japanese city pop lately. There's something about the production quality that feels way ahead of its time. The arrangements are so lush and detailed.",
  "lol",
  "👍",
  "brb",
  "Did you know you can scroll through music by country AND decade? I spent 3 hours exploring Soviet-era Georgian folk music yesterday and honestly it changed my life. The polyphonic singing is out of this world — layers upon layers of voices weaving together.",
  "Ha, classic rabbit hole",
  "The best kind though",
  "true",
  "Anyone want to grab lunch?",
  "🎵🎵🎵",
  "I was thinking about how music from the 1950s in West Africa has this incredible rhythmic complexity that influenced so much of what came after — jazz, funk, afrobeat, and even modern electronic music. You can trace entire lineages of sound back to those recordings.",
  "Totally agree",
  "Yes! Fela Kuti's early stuff especially",
  "omw",
  "k",
  "The thing about exploring music geographically is that you start to hear the connections between cultures — how a melody travels from North Africa through Spain into Latin America and back again. It's like an audible map of human migration and trade routes across centuries.",
  "That's deep",
  "Mind = blown 🤯",
  "Wait, have you tried the random mode? It just drops you into a random country and decade. Yesterday I landed on 1980s Iceland and discovered this amazing post-punk scene I never knew existed.",
  "No way, adding that to my list",
  "Do it. You won't regret it.",
  "🇮🇸 🎸",
  "So I went down the Iceland rabbit hole and found this whole scene of experimental electronic music from Reykjavik in the late 90s that basically paved the way for a lot of the ambient and IDM stuff we hear today",
  "Has anyone here tried making a playlist that follows one genre across every continent? Like taking jazz and hearing how it mutated from New Orleans to Paris to Tokyo to Lagos?",
  "That sounds amazing, how do I do that?",
  "Just pick a decade, then click through the countries one by one — you'll hear the local flavor each place added",
  "🔥🔥🔥",
  "ok I just tried 1940s Cuba and I can't stop dancing at my desk",
  "haha same thing happened to me last week",
  "The mambo recordings from that era are genuinely some of the most joyful music ever committed to tape. Pérez Prado was doing things with brass arrangements that still sound fresh 80 years later. The energy is absolutely infectious — you physically cannot sit still listening to it.",
];

const USERS = [
  { name: "Alice", color: "#667eea" },
  { name: "Bob", color: "#e06595" },
  { name: "Charlie", color: "#38a169" },
  { name: "Diana", color: "#d97706" },
  { name: "Eve", color: "#4facfe" },
];

const DATE_HEADERS = [
  "Today",
  "Yesterday",
  "Monday",
  "Last Week",
  "December 15",
  "December 10",
  "December 1",
  "November",
  "October",
  "Earlier",
];

const DATE_HEADER_HEIGHT = 40;

// =============================================================================
// Item Generation (heights are assigned later via DOM measurement)
// =============================================================================

const generateItems = (count) => {
  const items = [];
  let msgIndex = 0;
  const messagesPerSection = Math.ceil(count / DATE_HEADERS.length);

  for (let section = 0; section < DATE_HEADERS.length; section++) {
    items.push({
      id: `header-${section}`,
      isHeader: true,
      text: DATE_HEADERS[section],
      height: DATE_HEADER_HEIGHT,
    });

    const sectionCount = Math.min(messagesPerSection, count - msgIndex);

    for (let i = 0; i < sectionCount && msgIndex < count; i++) {
      const text = MESSAGES[msgIndex % MESSAGES.length];
      const user = USERS[msgIndex % USERS.length];

      items.push({
        id: `msg-${msgIndex}`,
        isHeader: false,
        text,
        user: user.name,
        color: user.color,
        initials: user.name[0],
        time: `${9 + (msgIndex % 12)}:${String((msgIndex * 7) % 60).padStart(2, "0")}`,
        height: 0, // measured below
      });

      msgIndex++;
    }

    if (msgIndex >= count) break;
  }

  return items;
};

// =============================================================================
// Templates
// =============================================================================

const renderHeaderHTML = (item) => `
  <div class="date-header">
    <span class="date-header__line"></span>
    <span class="date-header__text">${item.text}</span>
    <span class="date-header__line"></span>
  </div>
`;

const renderMessageHTML = (item) => `
  <div class="message">
    <div class="message__avatar" style="background: ${item.color}">${item.initials}</div>
    <div class="message__body">
      <div class="message__meta">
        <span class="message__user">${item.user}</span>
        <span class="message__time">${item.time}</span>
      </div>
      <div class="message__text">${item.text}</div>
    </div>
  </div>
`;

const renderItem = (item) => {
  if (item.isHeader) return renderHeaderHTML(item);
  return renderMessageHTML(item);
};

// =============================================================================
// DOM Measurement
// =============================================================================

/**
 * Measure the actual rendered height of every item by inserting its HTML
 * into a hidden element that matches the list's inner width.
 *
 * We only need to measure each *unique* template output — messages that
 * share the same text+user produce the same height, so we cache by a
 * content key and reuse the result. For 5 000 items with ~36 unique
 * messages this means ~40 actual DOM measurements instead of 5 000.
 *
 * The measuring element is:
 *   - Attached to the DOM so fonts/styles are resolved
 *   - Same width as #list-container (matches the rendering context)
 *   - visibility:hidden + position:absolute so it never causes layout shift
 *   - Removed after measurement
 */
const measureHeights = (items, container) => {
  const measurer = document.createElement("div");
  measurer.style.cssText =
    "position:absolute;top:0;left:0;visibility:hidden;pointer-events:none;" +
    `width:${container.offsetWidth}px;`;
  document.body.appendChild(measurer);

  // Cache: content key → measured height
  const cache = new Map();

  for (const item of items) {
    // Headers have a fixed known height — skip measurement
    if (item.isHeader) continue;

    // Build a cache key from the content that affects height
    const key = item.text;

    if (cache.has(key)) {
      item.height = cache.get(key);
      continue;
    }

    // Render into the measurer and read the height
    measurer.innerHTML = renderMessageHTML(item);
    const measured = measurer.firstElementChild.offsetHeight;
    item.height = measured;
    cache.set(key, measured);
  }

  measurer.remove();
};

// =============================================================================
// Setup
// =============================================================================

const TOTAL_MESSAGES = 5000;
const items = generateItems(TOTAL_MESSAGES);

const container = document.getElementById("list-container");

// Measure all items before creating the list
measureHeights(items, container);

/**
 * The height function — pure index lookup into pre-measured values.
 */
const getItemHeight = (index) => items[index]?.height ?? 56;

// =============================================================================
// Create List
// =============================================================================

const list = createVList({
  container,
  ariaLabel: "Chat messages",
  item: {
    height: getItemHeight,
    template: renderItem,
  },
  items,
});

// =============================================================================
// Stats & Height Distribution
// =============================================================================

const statsEl = document.getElementById("stats");
const heightDistEl = document.getElementById("height-distribution");

// Collect unique heights and build a distribution
const heightCounts = new Map();
let minHeight = Infinity;
let maxHeight = 0;

for (const item of items) {
  const h = item.height;
  heightCounts.set(h, (heightCounts.get(h) || 0) + 1);
  if (h < minHeight) minHeight = h;
  if (h > maxHeight) maxHeight = h;
}

const uniqueHeights = heightCounts.size;

// Build a histogram with ~8 buckets across the height range
const BUCKET_COUNT = 8;
const bucketSize = Math.max(
  1,
  Math.ceil((maxHeight - minHeight + 1) / BUCKET_COUNT),
);
const buckets = [];

for (let i = 0; i < BUCKET_COUNT; i++) {
  const lo = minHeight + i * bucketSize;
  const hi = Math.min(lo + bucketSize - 1, maxHeight);
  let count = 0;

  for (const [h, c] of heightCounts) {
    if (h >= lo && h <= hi) count += c;
  }

  if (count > 0) {
    buckets.push({ lo, hi, count });
  }
}

const maxBucketCount = Math.max(...buckets.map((b) => b.count));

heightDistEl.innerHTML =
  `<div class="dist-title">${uniqueHeights} unique heights (${minHeight}px – ${maxHeight}px)</div>` +
  buckets
    .map((b) => {
      const pct = Math.round((b.count / items.length) * 100);
      const barWidth = Math.round((b.count / maxBucketCount) * 100);
      const label = b.lo === b.hi ? `${b.lo}px` : `${b.lo}–${b.hi}px`;
      return `
        <div class="dist-row">
          <span class="dist-label">${label}</span>
          <div class="dist-bar-track">
            <div class="dist-bar" style="width: ${barWidth}%"></div>
          </div>
          <span class="dist-value">${b.count.toLocaleString()} (${pct}%)</span>
        </div>
      `;
    })
    .join("");

const updateStats = () => {
  const domNodes = document.querySelectorAll(".vlist-item").length;
  const total = items.length;
  const saved = Math.round((1 - domNodes / total) * 100);

  statsEl.innerHTML = `
    <span><strong>Total:</strong> ${total.toLocaleString()} items</span>
    <span><strong>DOM nodes:</strong> ${domNodes}</span>
    <span><strong>Virtualized:</strong> ${saved}%</span>
    <span><strong>Unique heights:</strong> ${uniqueHeights}</span>
  `;
};

list.on("scroll", updateStats);
list.on("range:change", updateStats);
updateStats();

// =============================================================================
// Jump-to buttons
// =============================================================================

document.getElementById("jump-top").addEventListener("click", () => {
  list.scrollToIndex(0, { behavior: "smooth" });
});

document.getElementById("jump-middle").addEventListener("click", () => {
  list.scrollToIndex(Math.floor(items.length / 2), {
    align: "center",
    behavior: "smooth",
  });
});

document.getElementById("jump-bottom").addEventListener("click", () => {
  list.scrollToIndex(items.length - 1, {
    align: "end",
    behavior: "smooth",
  });
});

document.getElementById("jump-random-header").addEventListener("click", () => {
  const headers = items
    .map((item, idx) => (item.isHeader ? idx : -1))
    .filter((idx) => idx >= 0);
  const randomIdx = headers[Math.floor(Math.random() * headers.length)];
  list.scrollToIndex(randomIdx, { behavior: "smooth" });
});

list.on("item:click", ({ item, index }) => {
  if (item.isHeader) {
    console.log(
      `Clicked header: "${item.text}" at index ${index} (${item.height}px)`,
    );
  } else {
    console.log(
      `Clicked message from ${item.user}: "${item.text.slice(0, 40)}…" at index ${index} (${item.height}px)`,
    );
  }
});
