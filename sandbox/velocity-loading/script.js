// script.js - vlist Velocity-Based Loading Example
// Demonstrates how vlist skips loading when scrolling fast and loads when velocity drops

// Direct imports for optimal tree-shaking
import { createButton, createSlider, addClass, removeClass } from "mtrl";
import { createLayout } from "mtrl-addons/layout";
import { createVList } from "vlist";

// Constants
const CANCEL_LOAD_VELOCITY_THRESHOLD = 25; // px/ms
const TOTAL_ITEMS = 1000000;
const UPDATE_THROTTLE_MS = 50; // Throttle UI updates

// API configuration
const API_BASE = "http://localhost:3338";
let apiDelay = 0;
let useRealApi = true;

// --------------------------------------------------------------------------
// Real API — fetches from vlist.dev backend
// --------------------------------------------------------------------------

const fetchFromApi = async (offset, limit) => {
  const params = new URLSearchParams({
    offset: String(offset),
    limit: String(limit),
    total: String(TOTAL_ITEMS),
  });
  if (apiDelay > 0) params.set("delay", String(apiDelay));

  const res = await fetch(`${API_BASE}/api/users?${params}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
};

// --------------------------------------------------------------------------
// Simulated API — deterministic in-memory fallback (zero network)
// --------------------------------------------------------------------------

const generateItem = (id) => ({
  id,
  name: `User ${id}`,
  email: `user${id}@example.com`,
  role: ["Admin", "Editor", "Viewer"][id % 3],
  avatar: String.fromCharCode(65 + (id % 26)),
});

const fetchSimulated = async (offset, limit) => {
  if (apiDelay > 0) await new Promise((r) => setTimeout(r, apiDelay));
  const items = [];
  const end = Math.min(offset + limit, TOTAL_ITEMS);
  for (let i = offset; i < end; i++) items.push(generateItem(i + 1));
  return { items, total: TOTAL_ITEMS, hasMore: end < TOTAL_ITEMS };
};

// --------------------------------------------------------------------------
// Unified fetch — delegates to real or simulated based on toggle
// --------------------------------------------------------------------------

const fetchItems = (offset, limit) =>
  useRealApi ? fetchFromApi(offset, limit) : fetchSimulated(offset, limit);

// Stats tracking (simplified)
const createStatsTracker = () => {
  const state = {
    loadRequests: 0,
    currentVelocity: 0,
    isLoading: false,
  };

  return {
    trackLoad: () => state.loadRequests++,
    setVelocity: (v) => (state.currentVelocity = v),
    setLoading: (l) => (state.isLoading = l),
    getStats: () => state,
    reset: () => (state.loadRequests = 0),
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

// Cached template schemas (created once, not on every render)
const PLACEHOLDER_SCHEMA = [
  { class: "item-content" },
  [{ class: "item-avatar item-avatar--placeholder" }],
  [
    { class: "item-details" },
    [{ class: "item-name item-name--placeholder" }],
    [{ class: "item-email item-email--placeholder" }],
  ],
];

// Cache for placeholder element (clone instead of recreate)
let cachedPlaceholderElement = null;

const getPlaceholderElement = () => {
  if (!cachedPlaceholderElement) {
    cachedPlaceholderElement = createLayout(PLACEHOLDER_SCHEMA).element;
  }
  return cachedPlaceholderElement.cloneNode(true);
};

const createItemElement = (item, index) => {
  // Real API returns firstName/lastName; simulated returns name
  const displayName = item.firstName
    ? `${item.firstName} ${item.lastName}`
    : item.name;
  const avatarText = item.avatar || displayName[0];
  const role = item.role || "";
  const email = item.email || "";

  const schema = [
    { class: "item-content" },
    [{ class: "item-avatar", text: avatarText }],
    [
      { class: "item-details" },
      [{ class: "item-name", text: `${displayName} (${index})` }],
      [{ class: "item-email", text: email }],
      [{ class: "item-role", text: role }],
    ],
  ];
  return createLayout(schema).element;
};

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

  const showcaseElement = section.showcase.element || section.showcase;

  let list = null;

  const createList = () => {
    list = createVList({
      container: showcaseElement,
      item: {
        height: 72,
        template: (item, index) => {
          return item._isPlaceholder
            ? getPlaceholderElement()
            : createItemElement(item, index);
        },
      },
      selection: {
        mode: "single",
      },
      adapter: {
        read: async ({ offset, limit }) => {
          stats.trackLoad();
          stats.setLoading(true);
          scheduleUpdate();
          const result = await fetchItems(offset, limit);
          stats.setLoading(false);
          scheduleUpdate();
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
        scheduleUpdate();
        scheduleVelocityDecay();
      }
      lastScrollTop = scrollTop;
      lastScrollTime = now;
    });

    list.on("load:start", () => {
      stats.setLoading(true);
      scheduleUpdate();
    });

    list.on("load:end", () => {
      stats.setLoading(false);
      scheduleUpdate();
    });
  };

  // Use requestAnimationFrame to ensure layout is complete
  requestAnimationFrame(createList);

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
            ["loadRequests", { class: "stat-card__value", text: "0" }],
            [{ class: "stat-card__label", text: "Load Requests" }],
          ],
          [
            { class: "stat-card" },
            [
              "isLoading",
              {
                class: "stat-card__value stat-card__value--small",
                text: "✓ Idle",
              },
            ],
            [{ class: "stat-card__label", text: "Status" }],
          ],
        ],
      ],

      // Velocity panel
      [
        "velocityPanel",
        { tag: "div", class: "mtrl-panel" },
        [{ class: "panel__title", text: "Scroll Velocity" }],
        [
          { class: "velocity-display" },
          ["velocityValue", { class: "velocity-display__value", text: "0.0" }],
          [{ class: "velocity-display__unit", text: " px/ms" }],
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
          [
            "velocityThreshold",
            { text: `Threshold: ${CANCEL_LOAD_VELOCITY_THRESHOLD}` },
          ],
          [{ text: "50+" }],
        ],
        [
          "velocityStatus",
          { class: "mtrl-velocity-status", text: "✅ Loading allowed" },
        ],
      ],

      // Data source toggle
      [
        createButton,
        "toggleApi",
        {
          text: "⚡ Live API",
          variant: "tonal",
        },
      ],

      // Sliders
      [
        createSlider,
        "delay",
        {
          label: "API Delay (ms)",
          min: 0,
          max: 1000,
          value: apiDelay,
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

  // Cache previous state to avoid unnecessary DOM updates
  let prevState = {
    loadRequests: -1,
    isLoading: null,
    isAboveThreshold: null,
    velocityPercent: -1,
  };

  // Update panels function (optimized - only update changed values)
  const updateControls = () => {
    const { loadRequests, currentVelocity, isLoading } = stats.getStats();
    const velocityPercent = Math.min(100, (currentVelocity / 50) * 100);
    const isAboveThreshold = currentVelocity > CANCEL_LOAD_VELOCITY_THRESHOLD;

    // Only update load requests if changed
    if (prevState.loadRequests !== loadRequests) {
      controls.loadRequests.textContent = loadRequests;
      prevState.loadRequests = loadRequests;
    }

    // Only update loading status if changed
    if (prevState.isLoading !== isLoading) {
      if (isLoading) {
        addClass(controls.isLoading, "stat-card__value--loading");
        removeClass(controls.isLoading, "stat-card__value--idle");
        controls.isLoading.textContent = "Loading...";
      } else {
        removeClass(controls.isLoading, "stat-card__value--loading");
        addClass(controls.isLoading, "stat-card__value--idle");
        controls.isLoading.textContent = "✓ Idle";
      }
      prevState.isLoading = isLoading;
    }

    // Only update threshold status if changed
    if (prevState.isAboveThreshold !== isAboveThreshold) {
      if (isAboveThreshold) {
        addClass(
          controls.velocityValue.parentElement,
          "velocity-display--fast",
        );
        addClass(
          controls.velocityThreshold,
          "velocity-labels__threshold--fast",
        );
        addClass(controls.velocityPercent, "velocity-bar__fill--fast");
        removeClass(controls.velocityPercent, "velocity-bar__fill--slow");
        addClass(controls.velocityStatus, "velocity-status--skipped");
        removeClass(controls.velocityStatus, "velocity-status--allowed");
        controls.velocityStatus.textContent = "🚫 Loading skipped";
      } else {
        removeClass(
          controls.velocityValue.parentElement,
          "velocity-display--fast",
        );
        removeClass(
          controls.velocityThreshold,
          "velocity-labels__threshold--fast",
        );
        removeClass(controls.velocityPercent, "velocity-bar__fill--fast");
        addClass(controls.velocityPercent, "velocity-bar__fill--slow");
        removeClass(controls.velocityStatus, "velocity-status--skipped");
        addClass(controls.velocityStatus, "velocity-status--allowed");
        controls.velocityStatus.textContent = "✅ Loading allowed";
      }
      prevState.isAboveThreshold = isAboveThreshold;
    }

    // Always update velocity display and bar (these change frequently)
    controls.velocityValue.textContent = currentVelocity.toFixed(1);

    // Only update bar width if changed significantly (avoid sub-pixel updates)
    const roundedPercent = Math.round(velocityPercent);
    if (prevState.velocityPercent !== roundedPercent) {
      controls.velocityPercent.style.width = `${roundedPercent}%`;
      prevState.velocityPercent = roundedPercent;
    }
  };

  // Throttled update scheduling
  let updateScheduled = false;
  const scheduleUpdate = () => {
    if (updateScheduled) return;
    updateScheduled = true;
    requestAnimationFrame(() => {
      updateControls();
      updateScheduled = false;
    });
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
      scheduleUpdate();
    }, 100);
  };

  // Wire up controls
  const updateToggleButton = () => {
    controls.toggleApi.textContent = useRealApi
      ? "⚡ Live API"
      : "🧪 Simulated";
  };

  controls.toggleApi.on("click", () => {
    useRealApi = !useRealApi;
    updateToggleButton();
    if (list) list.reload();
  });

  controls.delay.on("change", (e) => {
    apiDelay = e.value;
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
    prevState.loadRequests = -1; // Force update
    scheduleUpdate();
  });

  // Initial update
  scheduleUpdate();

  return { layout, section, list, stats, controls };
};
