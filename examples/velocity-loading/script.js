// script.js - vlist Velocity-Based Loading Example
// Demonstrates how vlist skips loading when scrolling fast and loads when velocity drops

// Direct imports for optimal tree-shaking
import createButton from "mtrl/components/button";
import createSlider from "mtrl/components/slider";
import { addClass, removeClass } from "mtrl/core/dom";
import { createLayout } from "mtrl-addons/layout";
import { createVList } from "vlist";

// Constants
const CANCEL_LOAD_VELOCITY_THRESHOLD = 25; // px/ms
const TOTAL_ITEMS = 1000000;

// Simulated API
let simulatedDelay = 0;

const generateItem = (id) => ({
  id,
  name: `User ${id}`,
  email: `user${id}@example.com`,
  role: ["Admin", "Editor", "Viewer"][id % 3],
  avatar: String.fromCharCode(65 + (id % 26)),
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

// Stats tracking
const createStatsTracker = () => {
  let loadRequests = 0;
  let currentVelocity = 0;
  let isLoading = false;

  return {
    trackLoad: () => loadRequests++,
    setVelocity: (v) => {
      currentVelocity = v;
    },
    setLoading: (l) => {
      isLoading = l;
    },
    getStats: () => ({ loadRequests, currentVelocity, isLoading }),
    reset: () => {
      loadRequests = 0;
    },
  };
};

// Layout schemas (matching mtrl-app content.scss structure)
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
          text: "vlist is a lightweight, high-performance virtual list library with zero dependencies. It supports compression for handling millions of items, velocity-based load cancellation, and integrates seamlessly with async data sources.",
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

// Initialize
document.addEventListener("DOMContentLoaded", () => {
  createVelocityExample(document.getElementById("content"));
});

const createVelocityExample = (container) => {
  const stats = createStatsTracker();

  // Main layout with header, body, footer
  const layout = createLayout(
    createComponentsLayout({
      title: "Velocity-Based Loading",
      description:
        "vlist intelligently skips data loading when scrolling fast (>25 px/ms) and loads immediately when velocity drops below threshold.",
    }),
    container,
  ).component;

  // Section with showcase (left) and info (right)
  const section = createLayout(
    createComponentSection({
      title: "Virtual List with Smart Loading",
      description:
        "Scroll fast to see loading skip. Slow down to see data load immediately.",
    }),
    layout.body,
  ).component;

  // Create vlist in the showcase (left side)
  // The layout system returns elements directly or via .element property
  const showcaseElement = section.showcase.element || section.showcase;

  // Create vlist after a frame to ensure container has dimensions
  let list;

  // Item template schemas for createLayout
  const createPlaceholderSchema = () => [
    { class: "item-content" },
    [{ class: "item-avatar item-avatar--placeholder" }],
    [
      { class: "item-details" },
      [{ class: "item-name item-name--placeholder" }],
      [{ class: "item-email item-email--placeholder" }],
    ],
  ];

  const createItemSchema = (item, index) => [
    { class: "item-content" },
    [{ class: "item-avatar", text: item.avatar }],
    [
      { class: "item-details" },
      [{ class: "item-name", text: `${item.name} (${index})` }],
      [{ class: "item-email", text: item.email }],
      [{ class: "item-role", text: item.role }],
    ],
  ];

  const createList = () => {
    list = createVList({
      container: showcaseElement,
      itemHeight: 72,
      template: (item, index) => {
        const schema = item._isPlaceholder
          ? createPlaceholderSchema()
          : createItemSchema(item, index);
        return createLayout(schema).element;
      },
      adapter: {
        read: async ({ offset, limit }) => {
          stats.trackLoad();
          stats.setLoading(true);
          updateControls();
          const result = await fetchItems(offset, limit);
          stats.setLoading(false);
          updateControls();
          return result;
        },
      },
    });

    // Wire up list events
    list.on("scroll", ({ scrollTop }) => {
      const now = performance.now();
      const timeDelta = now - lastScrollTime;
      if (timeDelta > 0) {
        const velocity = Math.abs(scrollTop - lastScrollTop) / timeDelta;
        stats.setVelocity(velocity);
        updateControls();
        scheduleVelocityDecay();
      }
      lastScrollTop = scrollTop;
      lastScrollTime = now;
    });

    list.on("load:start", () => {
      stats.setLoading(true);
      updateControls();
    });

    list.on("load:end", () => {
      stats.setLoading(false);
      updateControls();
    });
  };

  // Use requestAnimationFrame to ensure layout is complete
  requestAnimationFrame(() => {
    createList();
  });

  // Create controls in the info panel (right side)
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

            ["loadRequests", { class: "stat-card__value" }],
            [{ class: "stat-card__label", text: "Load Request" }],
          ],
          [
            { class: "stat-card" },
            [
              "isLoading",
              { class: "stat-card__value stat-card__value--small" },
            ],
            [{ class: "stat-card__label", text: "Status" }],
          ],
        ],
      ],

      // Velocity panel
      [
        "velocityPanel",
        { tag: "div", class: "mtrl-panel" }[
          { class: "panel__title", text: "Scroll Velocity" }
        ],
        [
          "velocityDisplay",
          { class: "velocity-display" },
          [{ class: "velocity-display__unit", text: "px/ms" }],
        ],
        [
          { class: "velocity-bar" },
          [
            "velocityPercent",
            { class: "velocity-bar__fill", style: { width: "0%" } },
          ],
          [{ class: "velocity-bar__marker" }],
        ],
        [
          { class: "velocity-labels" },
          [{ text: "0" }],
          ["velocityThreshold"],
          [{ text: "50+" }],
        ],
        ["velocityStatus", { class: "mtrl-velocity-status" }],
      ],

      // Sliders
      [
        createSlider,
        "delay",
        {
          label: "API Delay (ms)",
          min: 0,
          max: 1000,
          value: simulatedDelay,
          step: 20,
        },
      ],

      [
        createSlider,
        "scrollTo",
        {
          label: "Scroll to Index",
          min: 0,
          max: TOTAL_ITEMS - 1,
          value: 0,
          step: 1000,
        },
      ],

      // Navigation buttons
      [
        { layout: { type: "row", gap: 8 } },
        [createButton, "jumpStart", { text: "Start", variant: "outlined" }],
        [createButton, "jumpMiddle", { text: "Middle", variant: "outlined" }],
        [createButton, "jumpEnd", { text: "End", variant: "outlined" }],
      ],

      // Action buttons
      [
        { layout: { type: "row", gap: 8 } },
        [createButton, "reload", { text: "Reload", variant: "filled" }],
        [createButton, "resetStats", { text: "Reset Stats", variant: "tonal" }],
      ],
    ],
    section.info,
  ).component;

  // Update panels function
  const updateControls = () => {
    const { loadRequests, currentVelocity, isLoading } = stats.getStats();
    const velocityPercent = Math.min(100, (currentVelocity / 50) * 100);
    const isAboveThreshold = currentVelocity > CANCEL_LOAD_VELOCITY_THRESHOLD;

    controls.loadRequests.innerHTML = `${loadRequests}`;

    if (isLoading) {
      controls.isLoading.classList.add("mtrl-stat-card__value--loading");
      controls.isLoading.classList.remove("mtrl-stat-card__value--idle");
      controls.isLoading.innerHTML = "Loading...";
    } else {
      controls.isLoading.classList.remove("mtrl-stat-card__value--loading");
      controls.isLoading.classList.add("mtrl-stat-card__value--idle");
      controls.isLoading.innerHTML = "✓ Idle";
    }

    if (isAboveThreshold) {
      addClass(controls.velocityDisplay, "velocity-display--fast");
      addClass(controls.velocityThreshold, "velocity-labels__threshold--fast");
      addClass(controls.velocityPercent, "velocity-bar__fill--fast");
      removeClass(controls.velocityPercent, "velocity-bar__fill--slow");
      addClass(controls.velocityStatus, "velocity-status--skipped");
      removeClass(controls.velocityStatus, "velocity-status--allowed");
      controls.velocityStatus.innerHTML = "🚫 Loading skipped";
    } else {
      removeClass(controls.velocityDisplay, "velocity-display--fast");
      removeClass(controls.velocityPercent, "velocity-bar__fill--fast");
      removeClass(
        controls.velocityThreshold,
        "velocity-labels__threshold--fast",
      );
      addClass(controls.velocityPercent, "velocity-bar__fill--slow");
      removeClass(controls.velocityPercent, "velocity-bar__fill--fast");
      removeClass(controls.velocityStatus, "velocity-status--skipped");
      addClass(controls.velocityStatus, "velocity-status--allowed");
      controls.velocityStatus.innerHTML = "✅ Loading allowed";
    }

    controls.velocityDisplay.innerHTML = `${currentVelocity.toFixed(1)}`;
    controls.velocityPercent.style.width = `${velocityPercent}%`;
    controls.velocityThreshold.innerHTML = `Threshold: ${CANCEL_LOAD_VELOCITY_THRESHOLD}`;
  };

  // Track velocity from scroll events
  let lastScrollTop = 0;
  let lastScrollTime = performance.now();
  let velocityDecayTimeout = null;

  // Reset velocity to 0 if no scroll event occurs within 100ms
  const scheduleVelocityDecay = () => {
    if (velocityDecayTimeout) {
      clearTimeout(velocityDecayTimeout);
    }
    velocityDecayTimeout = setTimeout(() => {
      stats.setVelocity(0);
      updateControls();
    }, 100);
  };

  // Wire up controls
  controls.delay.on("change", (e) => {
    simulatedDelay = e.value;
  });

  controls.scrollTo.on("change", (e) => {
    if (list) list.scrollToIndex(e.value, "center");
  });

  controls.jumpStart.on("click", () => {
    if (list) list.scrollToIndex(0, "start");
  });

  controls.jumpMiddle.on("click", () => {
    if (list) list.scrollToIndex(Math.floor(TOTAL_ITEMS / 2), "center");
  });

  controls.jumpEnd.on("click", () => {
    if (list) list.scrollToIndex(TOTAL_ITEMS - 1, "end");
  });

  controls.reload.on("click", async () => {
    if (list) await list.reload();
  });

  controls.resetStats.on("click", () => {
    stats.reset();
    updateControls();
  });

  // Initial update
  updateControls();

  return { layout, section, list, stats, controls };
};
