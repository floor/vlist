// script.js - vlist Infinite Scroll Example
// Demonstrates async data loading with simulated API calls

// Direct imports for optimal tree-shaking
import createButton from "mtrl/components/button";
import createSlider from "mtrl/components/slider";
import { createLayout } from "mtrl-addons/layout";
import { createVList } from "vlist";

// Constants
const TOTAL_ITEMS = 10000;
const STATUSES = ["active", "pending", "inactive"];

// Simulated API
let simulatedDelay = 500;

const generateItem = (id) => ({
  id,
  title: `Item #${id}`,
  subtitle: `Description for item ${id} - Lorem ipsum dolor sit amet`,
  date: new Date(
    Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000,
  ).toLocaleDateString(),
  status: STATUSES[id % 3],
  letter: String.fromCharCode(65 + (id % 26)),
});

const fetchItems = async (offset, limit) => {
  await new Promise((resolve) => setTimeout(resolve, simulatedDelay));
  const items = [];
  const end = Math.min(offset + limit, TOTAL_ITEMS);
  for (let i = offset; i < end; i++) {
    items.push(generateItem(i + 1));
  }
  return { items, total: TOTAL_ITEMS, hasMore: end < TOTAL_ITEMS };
};

// Layout schemas
const createComponentsLayout = (info) => [
  [
    "head",
    { class: "content__header" },
    [
      { tag: "section", class: "content__box content-info" },
      ["title", { tag: "h1", class: "content__title", text: info.title }],
      [
        "description",
        { tag: "p", class: "content__description", text: info.description },
      ],
    ],
  ],
  ["body", { class: "content__body" }],
  [
    "foot",
    { class: "content__footer" },
    [
      { tag: "section", class: "content__footer-section" },
      [
        {
          tag: "p",
          class: "content__footer-text",
          text: "vlist supports async data loading with automatic infinite scroll. Scroll down to load more items, or use the controls to navigate. The adapter pattern makes it easy to integrate with any API.",
        },
      ],
    ],
  ],
];

const createComponentSection = (info) => [
  [
    { tag: "section", class: "components__section" },
    [
      { class: "components__section-head" },
      [
        "title",
        { tag: "h2", class: "components__section-title", text: info.title },
      ],
      [
        "description",
        {
          tag: "div",
          class: "components__section-description",
          text: info.description,
        },
      ],
    ],
    [
      "body",
      { class: "components__section-body" },
      ["showcase", { class: "components__section-showcase" }],
      ["info", { class: "components__section-info" }],
    ],
  ],
];

// Cached placeholder schema
const PLACEHOLDER_SCHEMA = [
  { class: "item-content" },
  [{ class: "item-image item-image--placeholder" }],
  [
    { class: "item-details" },
    [{ class: "item-title item-title--placeholder" }],
    [{ class: "item-subtitle item-subtitle--placeholder" }],
  ],
  [
    { class: "item-meta" },
    [{ class: "item-date item-date--placeholder" }],
  ],
];

let cachedPlaceholderElement = null;

const getPlaceholderElement = () => {
  if (!cachedPlaceholderElement) {
    cachedPlaceholderElement = createLayout(PLACEHOLDER_SCHEMA).element;
  }
  return cachedPlaceholderElement.cloneNode(true);
};

const createItemElement = (item) => {
  const schema = [
    { class: "item-content" },
    [{ class: "item-image", text: item.letter }],
    [
      { class: "item-details" },
      [{ class: "item-title", text: item.title }],
      [{ class: "item-subtitle", text: item.subtitle }],
    ],
    [
      { class: "item-meta" },
      [{ class: "item-date", text: item.date }],
      [{ class: `item-status item-status--${item.status}`, text: item.status }],
    ],
  ];
  return createLayout(schema).element;
};

// Initialize
document.addEventListener("DOMContentLoaded", () => {
  createInfiniteScrollExample(document.getElementById("content"));
});

const createInfiniteScrollExample = (container) => {
  // Main layout
  const layout = createLayout(
    createComponentsLayout({
      title: "Infinite Scroll",
      description:
        "Scroll down to automatically load more items. Simulates API calls with configurable delay.",
    }),
    container,
  ).component;

  // Section with showcase and info
  const section = createLayout(
    createComponentSection({
      title: "Async Data Loading",
      description:
        "Items are fetched on demand as you scroll. Watch the event log to see API calls.",
    }),
    layout.body,
  ).component;

  const showcaseElement = section.showcase.element || section.showcase;

  let list = null;

  // Stats tracking
  const stats = {
    loaded: 0,
    total: TOTAL_ITEMS,
    isLoading: false,
    domElements: 0,
  };

  // Event log entries
  const eventLog = [];
  const MAX_LOG_ENTRIES = 15;

  const addLogEntry = (event, data) => {
    const time = new Date().toLocaleTimeString();
    eventLog.unshift({ time, event, data });
    if (eventLog.length > MAX_LOG_ENTRIES) {
      eventLog.pop();
    }
    updateEventLog();
  };

  const updateEventLog = () => {
    if (!controls.eventLog) return;
    controls.eventLog.innerHTML = eventLog
      .map(
        (entry) =>
          `<div class="event-log__entry"><span class="event-log__time">[${entry.time}]</span><span class="event-log__event">${entry.event}</span><span class="event-log__data">${entry.data}</span></div>`,
      )
      .join("");
  };

  const createList = () => {
    list = createVList({
      container: showcaseElement,
      item: {
        height: 72,
        template: (item, index) => {
          return item._isPlaceholder
            ? getPlaceholderElement()
            : createItemElement(item);
        },
      },
      adapter: {
        read: async ({ offset, limit }) => {
          addLogEntry("fetch", `offset=${offset}, limit=${limit}`);
          stats.isLoading = true;
          scheduleUpdate();

          const result = await fetchItems(offset, limit);

          stats.loaded = Math.min(offset + result.items.length, result.total);
          stats.isLoading = false;
          addLogEntry("loaded", `${result.items.length} items`);
          scheduleUpdate();

          return result;
        },
      },
    });

    // Wire up events
    list.on("scroll", () => {
      scheduleUpdate();
    });

    list.on("load:start", () => {
      stats.isLoading = true;
      scheduleUpdate();
    });

    list.on("load:end", () => {
      stats.isLoading = false;
      scheduleUpdate();
    });

    list.on("range:change", ({ range }) => {
      addLogEntry("range", `${range.start} - ${range.end}`);
    });

    list.on("error", ({ error, context }) => {
      addLogEntry("error", `${context}: ${error.message}`);
    });

    addLogEntry("init", "Virtual list initialized");
  };

  // Use requestAnimationFrame to ensure layout is complete
  requestAnimationFrame(createList);

  // Create controls
  const controls = createLayout(
    [
      { layout: { type: "column", gap: 16 } },

      // Stats panel
      [
        "statsPanel",
        { tag: "div", class: "mtrl-panel" },
        [{ class: "panel__title", text: "Loading Stats" }],
        [
          { class: "stats-grid" },
          [
            { class: "stat-card" },
            ["loadedCount", { class: "stat-card__value", text: "0" }],
            [{ class: "stat-card__label", text: "Loaded" }],
          ],
          [
            { class: "stat-card" },
            [
              "status",
              {
                class: "stat-card__value stat-card__value--small",
                text: "Ready",
              },
            ],
            [{ class: "stat-card__label", text: "Status" }],
          ],
        ],
      ],

      // Progress panel
      [
        "progressPanel",
        { tag: "div", class: "mtrl-panel" },
        [{ class: "panel__title", text: "Load Progress" }],
        [
          { class: "progress-display" },
          [
            { class: "progress-display__text" },
            ["progressText", { tag: "span" }],
          ],
          [
            { class: "progress-bar" },
            ["progressFill", { class: "progress-bar__fill" }],
          ],
        ],
      ],

      // API delay slider
      [
        createSlider,
        "delay",
        {
          label: "API Delay (ms)",
          min: 0,
          max: 2000,
          value: simulatedDelay,
          step: 100,
        },
      ],

      // Scroll to slider
      [
        createSlider,
        "scrollTo",
        {
          label: "Scroll to Index",
          min: 0,
          max: TOTAL_ITEMS - 1,
          value: 0,
          step: 100,
        },
      ],

      // Navigation buttons
      [
        { layout: { type: "row", gap: 8 } },
        [createButton, "jumpStart", { text: "Start", variant: "outlined" }],
        [createButton, "jump500", { text: "#500", variant: "outlined" }],
        [createButton, "jumpEnd", { text: "End", variant: "outlined" }],
      ],

      // Action buttons
      [
        { layout: { type: "row", gap: 8 } },
        [createButton, "reload", { text: "Reload", variant: "filled" }],
      ],

      // Event log
      [
        "logPanel",
        { tag: "div", class: "mtrl-panel" },
        [{ class: "panel__title", text: "Event Log" }],
        ["eventLog", { class: "event-log" }],
      ],
    ],
    section.info,
  ).component;

  // Cache previous state
  let prevState = {
    loaded: -1,
    isLoading: null,
    progress: -1,
  };

  // Update controls
  const updateControls = () => {
    stats.domElements = document.querySelectorAll(".vlist-item").length;
    const progress = Math.round((stats.loaded / stats.total) * 100);

    if (prevState.loaded !== stats.loaded) {
      controls.loadedCount.textContent = `${stats.loaded.toLocaleString()} / ${stats.total.toLocaleString()}`;
      controls.progressText.textContent = `${stats.loaded.toLocaleString()} of ${stats.total.toLocaleString()} items loaded (${progress}%)`;
      prevState.loaded = stats.loaded;
    }

    if (prevState.isLoading !== stats.isLoading) {
      if (stats.isLoading) {
        controls.status.textContent = "Loading...";
        controls.status.classList.add("stat-card__value--loading");
        controls.status.classList.remove("stat-card__value--idle");
      } else {
        controls.status.textContent = "Ready";
        controls.status.classList.remove("stat-card__value--loading");
        controls.status.classList.add("stat-card__value--idle");
      }
      prevState.isLoading = stats.isLoading;
    }

    if (prevState.progress !== progress) {
      controls.progressFill.style.width = `${progress}%`;
      prevState.progress = progress;
    }
  };

  // Throttled update
  let updateScheduled = false;
  const scheduleUpdate = () => {
    if (updateScheduled) return;
    updateScheduled = true;
    requestAnimationFrame(() => {
      updateControls();
      updateScheduled = false;
    });
  };

  // Wire up controls
  controls.delay.on("change", (e) => {
    simulatedDelay = e.value;
  });

  controls.scrollTo.on("change", (e) => {
    if (list) list.scrollToIndex(e.value, "center");
  });

  controls.jumpStart.on("click", () => {
    if (list) {
      list.scrollToIndex(0, "start");
      addLogEntry("action", "Jump to start");
    }
  });

  controls.jump500.on("click", () => {
    if (list) {
      list.scrollToIndex(499, "center");
      addLogEntry("action", "Jump to #500");
    }
  });

  controls.jumpEnd.on("click", () => {
    if (list) {
      list.scrollToIndex(TOTAL_ITEMS - 1, "end");
      addLogEntry("action", "Jump to end");
    }
  });

  controls.reload.on("click", async () => {
    if (list) {
      addLogEntry("action", "Reloading data...");
      stats.loaded = 0;
      scheduleUpdate();
      await list.reload();
    }
  });

  // Initial update
  setTimeout(scheduleUpdate, 100);

  return { layout, section, list, stats, controls };
};
