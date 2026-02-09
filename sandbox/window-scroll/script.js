// Window Scroll Example
// Demonstrates scrollElement: window for document-level scrolling
// Uses adapter pattern with placeholders for async data loading

import { createVList } from "vlist";

// Constants
const TOTAL_ITEMS = 10000;
const CATEGORIES = ["Article", "Video", "Image", "Document", "Audio"];
const COLORS = ["#667eea", "#43e97b", "#fa709a", "#f093fb", "#feca57"];
const DOMAINS = [
  "example.com",
  "docs.dev",
  "blog.io",
  "wiki.org",
  "news.net",
  "media.co",
  "data.info",
  "learn.edu",
];

// Simulated API — generates items with a realistic delay
let simulatedDelay = 300;

const generateItem = (id) => {
  const catIndex = (id - 1) % CATEGORIES.length;
  return {
    id,
    title: `${CATEGORIES[catIndex]}: Search result #${id}`,
    description: `This is the description for result ${id}. It contains relevant information about the topic you searched for.`,
    category: CATEGORIES[catIndex],
    categoryColor: COLORS[catIndex],
    domain: DOMAINS[(id - 1) % DOMAINS.length],
    date: new Date(
      Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000,
    ).toLocaleDateString(),
    icon: CATEGORIES[catIndex][0],
  };
};

const fetchItems = async (offset, limit) => {
  await new Promise((resolve) => setTimeout(resolve, simulatedDelay));
  const items = [];
  const end = Math.min(offset + limit, TOTAL_ITEMS);
  for (let i = offset; i < end; i++) {
    items.push(generateItem(i + 1));
  }
  return { items, total: TOTAL_ITEMS, hasMore: end < TOTAL_ITEMS };
};

// Template — renders real items or placeholder skeletons
const itemTemplate = (item, index) => {
  if (item._isPlaceholder) {
    return `
      <div class="result-item">
        <div class="result-icon result-icon--placeholder"></div>
        <div class="result-body">
          <div class="result-title result-title--placeholder"></div>
          <div class="result-description result-description--placeholder"></div>
          <div class="result-meta">
            <span class="result-domain result-domain--placeholder"></span>
            <span class="result-date result-date--placeholder"></span>
          </div>
        </div>
      </div>
    `;
  }

  return `
    <div class="result-item">
      <div class="result-icon" style="background: ${item.categoryColor}">${item.icon}</div>
      <div class="result-body">
        <div class="result-title">${item.title}</div>
        <div class="result-description">${item.description}</div>
        <div class="result-meta">
          <span class="result-domain">${item.domain}</span>
          <span class="result-sep">·</span>
          <span class="result-date">${item.date}</span>
          <span class="result-sep">·</span>
          <span class="result-category" style="color: ${item.categoryColor}">${item.category}</span>
        </div>
      </div>
      <div class="result-index">#${index + 1}</div>
    </div>
  `;
};

// Create the virtual list with window scrolling + adapter
const list = createVList({
  container: "#list-container",
  ariaLabel: "User directory",
  scrollElement: window,
  item: {
    height: 88,
    template: itemTemplate,
  },
  adapter: {
    read: async ({ offset, limit }) => {
      return fetchItems(offset, limit);
    },
  },
});

// Stats display
const statsEl = document.getElementById("stats");
let loadedCount = 0;
let updateScheduled = false;

const scheduleUpdate = () => {
  if (updateScheduled) return;
  updateScheduled = true;
  requestAnimationFrame(() => {
    updateStats();
    updateScheduled = false;
  });
};

const updateStats = () => {
  const domNodes = document.querySelectorAll(".vlist-item").length;
  const pct = Math.round((loadedCount / TOTAL_ITEMS) * 100);

  statsEl.innerHTML = `
    <span class="stat"><strong>${loadedCount.toLocaleString()}</strong> / ${TOTAL_ITEMS.toLocaleString()} loaded</span>
    <span class="stat-sep">·</span>
    <span class="stat"><strong>${domNodes}</strong> DOM nodes</span>
    <span class="stat-sep">·</span>
    <span class="stat"><strong>${pct}%</strong></span>
  `;
};

list.on("scroll", scheduleUpdate);
list.on("range:change", scheduleUpdate);

list.on("load:end", ({ items }) => {
  loadedCount += items.length;
  scheduleUpdate();
});

updateStats();

// Navigation buttons
document.getElementById("btn-top").addEventListener("click", () => {
  list.scrollToIndex(0, { align: "start", behavior: "smooth" });
});

document.getElementById("btn-middle").addEventListener("click", () => {
  list.scrollToIndex(Math.floor(TOTAL_ITEMS / 2), {
    align: "center",
    behavior: "smooth",
  });
});

document.getElementById("btn-bottom").addEventListener("click", () => {
  list.scrollToIndex(TOTAL_ITEMS - 1, { align: "end", behavior: "smooth" });
});

// Delay control
const delayInput = document.getElementById("delay-input");
const delayValue = document.getElementById("delay-value");

if (delayInput) {
  delayInput.addEventListener("input", () => {
    simulatedDelay = parseInt(delayInput.value, 10);
    delayValue.textContent = `${simulatedDelay}ms`;
  });
}

// Log clicks
list.on("item:click", ({ item, index }) => {
  if (!item._isPlaceholder) {
    console.log(`Clicked: ${item.title} at index ${index}`);
  }
});
