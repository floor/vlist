// script.js - vlist Million Items Example
// Demonstrates compression for handling millions of items

// Direct imports for optimal tree-shaking
import { createButton } from "mtrl";
import { createLayout } from "mtrl-addons/layout";
import { createVList, MAX_VIRTUAL_HEIGHT } from "vlist";

// Constants
const ITEM_HEIGHT = 48;
const SIZES = {
  "1m": 1_000_000,
  "2m": 2_000_000,
  "5m": 5_000_000,
};

const COLORS = [
  "linear-gradient(90deg, #667eea, #764ba2)",
  "linear-gradient(90deg, #f093fb, #f5576c)",
  "linear-gradient(90deg, #4facfe, #00f2fe)",
  "linear-gradient(90deg, #43e97b, #38f9d7)",
  "linear-gradient(90deg, #fa709a, #fee140)",
  "linear-gradient(90deg, #a8edea, #fed6e3)",
  "linear-gradient(90deg, #ff9a9e, #fecfef)",
  "linear-gradient(90deg, #ffecd2, #fcb69f)",
];

// Simple hash function for consistent values
const hash = (n) => {
  let h = n * 2654435761;
  h ^= h >>> 16;
  return Math.abs(h);
};

// Generate item on demand
const generateItem = (index) => ({
  id: index,
  value: hash(index) % 100,
  hash: hash(index).toString(16).slice(0, 8).toUpperCase(),
  color: COLORS[index % COLORS.length],
});

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
          text: "vlist uses automatic compression to handle lists that exceed the browser's 16 million pixel height limit. This enables smooth scrolling through millions of items while maintaining accurate positioning.",
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
      [
        "showcase",
        {
          class: "components__section-showcase",
          style: { position: "relative" },
        },
        [
          "loadingOverlay",
          { class: "loading-overlay loading-overlay--hidden" },
          [{ class: "loading-spinner" }],
          [
            "loadingText",
            { class: "loading-text", text: "Generating items..." },
          ],
        ],
      ],
      ["info", { class: "components__section-info" }],
    ],
  ],
];

// Item element creator
const createItemElement = (item, index) => {
  const schema = [
    { class: "item-content" },
    [{ class: "item-index", text: `#${(index + 1).toLocaleString()}` }],
    [
      { class: "item-bar" },
      [
        {
          class: "item-bar__fill",
          style: { width: `${item.value}%`, background: item.color },
        },
      ],
    ],
    [{ class: "item-value", text: `${item.value}%` }],
    [{ class: "item-hash", text: item.hash }],
  ];
  return createLayout(schema).element;
};

// Initialize
document.addEventListener("DOMContentLoaded", () => {
  createMillionItemsExample(document.getElementById("content"));
});

const createMillionItemsExample = (container) => {
  // Main layout
  const layout = createLayout(
    createComponentsLayout({
      title: "Million Items",
      description:
        "Testing vlist with 1-5 million items. Compression automatically handles the browser's pixel limit.",
    }),
    container,
  ).component;

  // Section with showcase and info
  const section = createLayout(
    createComponentSection({
      title: "Large List Stress Test",
      description:
        "Switch between 1M, 2M, and 5M items. Watch FPS and performance metrics.",
    }),
    layout.body,
  ).component;

  const showcaseElement = section.showcase.element || section.showcase;
  const loadingOverlay =
    section.loadingOverlay.element || section.loadingOverlay;
  const loadingText = section.loadingText.element || section.loadingText;

  let list = null;
  let currentSize = "1m";
  let currentTotal = SIZES[currentSize];
  let items = [];

  // Stats tracking
  const stats = {
    fps: 0,
    domNodes: 0,
    scrollPos: 0,
    visibleStart: 0,
    visibleEnd: 0,
  };

  // Performance tracking
  const perf = {
    init: 0,
    generate: 0,
    render: 0,
    scroll: 0,
  };

  // FPS counter
  let frameCount = 0;
  let lastFpsUpdate = performance.now();

  const updateFps = () => {
    frameCount++;
    const now = performance.now();
    if (now - lastFpsUpdate >= 1000) {
      stats.fps = Math.round((frameCount * 1000) / (now - lastFpsUpdate));
      frameCount = 0;
      lastFpsUpdate = now;
      scheduleUpdate();
    }
    requestAnimationFrame(updateFps);
  };
  requestAnimationFrame(updateFps);

  const showLoading = (text) => {
    loadingText.textContent = text;
    loadingOverlay.classList.remove("loading-overlay--hidden");
  };

  const hideLoading = () => {
    loadingOverlay.classList.add("loading-overlay--hidden");
  };

  const createList = async (size) => {
    const total = SIZES[size];
    currentSize = size;
    currentTotal = total;

    showLoading(`Generating ${(total / 1_000_000).toFixed(0)}M items...`);

    // Wait a frame to let the UI update
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Destroy existing list
    if (list) {
      list.destroy();
    }

    // Generate items
    const generateStart = performance.now();
    items = Array.from({ length: total }, (_, i) => generateItem(i));
    perf.generate = performance.now() - generateStart;

    // Update compression info
    updateCompressionInfo(total);

    // Create the list
    const initStart = performance.now();

    list = createVList({
      container: showcaseElement,
      ariaLabel: "Million items list",
      item: {
        height: ITEM_HEIGHT,
        template: (item, index) => createItemElement(item, index),
      },
      items: items,
      overscan: 5,
    });

    perf.init = performance.now() - initStart;

    // Event handlers
    let lastScrollTime = 0;

    list.on("scroll", ({ scrollTop }) => {
      const now = performance.now();
      if (lastScrollTime > 0) {
        perf.scroll = now - lastScrollTime;
      }
      lastScrollTime = now;
      stats.scrollPos = scrollTop;
      scheduleUpdate();
    });

    list.on("range:change", ({ range }) => {
      stats.visibleStart = range.start;
      stats.visibleEnd = range.end;

      const renderStart = performance.now();
      requestAnimationFrame(() => {
        perf.render = performance.now() - renderStart;
        scheduleUpdate();
      });
    });

    hideLoading();
    scheduleUpdate();
  };

  const updateCompressionInfo = (total) => {
    const actualHeight = total * ITEM_HEIGHT;
    const isCompressed = actualHeight > MAX_VIRTUAL_HEIGHT;
    const virtualHeight = isCompressed ? MAX_VIRTUAL_HEIGHT : actualHeight;
    const ratio = actualHeight > 0 ? virtualHeight / actualHeight : 1;

    if (controls.compressionRatio) {
      controls.compressionRatio.textContent = `${(ratio * 100).toFixed(1)}%`;
    }
    if (controls.virtualHeight) {
      controls.virtualHeight.textContent = `${(virtualHeight / 1_000_000).toFixed(1)}M px`;
    }
  };

  // Use requestAnimationFrame to ensure layout is complete
  requestAnimationFrame(() => createList("1m"));

  // Create controls
  const controls = createLayout(
    [
      { layout: { type: "column", gap: 16 } },

      // Size toggle panel
      [
        "sizePanel",
        { tag: "div", class: "mtrl-panel" },
        [{ class: "panel__title", text: "List Size" }],
        [
          { class: "size-toggle" },
          [
            "size1m",
            {
              tag: "button",
              class: "size-toggle__button size-toggle__button--active",
              text: "1M",
            },
          ],
          [
            "size2m",
            { tag: "button", class: "size-toggle__button", text: "2M" },
          ],
          [
            "size5m",
            { tag: "button", class: "size-toggle__button", text: "5M" },
          ],
        ],
      ],

      // Metrics panel
      [
        "metricsPanel",
        { tag: "div", class: "mtrl-panel" },
        [{ class: "panel__title", text: "Metrics" }],
        [
          { class: "stats-grid" },
          [
            { class: "stat-card" },
            ["totalItems", { class: "stat-card__value", text: "0" }],
            [{ class: "stat-card__label", text: "Total" }],
          ],
          [
            { class: "stat-card" },
            [
              "domNodes",
              {
                class: "stat-card__value stat-card__value--highlight",
                text: "0",
              },
            ],
            [{ class: "stat-card__label", text: "DOM" }],
          ],
          [
            { class: "stat-card" },
            ["fps", { class: "stat-card__value", text: "--" }],
            [{ class: "stat-card__label", text: "FPS" }],
          ],
        ],
        [
          {
            class: "stats-grid stats-grid--2col",
            style: { marginTop: "12px" },
          },
          [
            { class: "stat-card" },
            [
              "memorySaved",
              {
                class: "stat-card__value stat-card__value--highlight",
                text: "0%",
              },
            ],
            [{ class: "stat-card__label", text: "Memory Saved" }],
          ],
          [
            { class: "stat-card" },
            ["visibleRange", { class: "stat-card__value", text: "0-0" }],
            [{ class: "stat-card__label", text: "Visible" }],
          ],
        ],
      ],

      // Compression info panel
      [
        "compressionPanel",
        { tag: "div", class: "mtrl-panel" },
        [{ class: "panel__title", text: "Compression" }],
        [
          { class: "compression-info" },
          [
            { class: "compression-info__title" },
            [{ tag: "span", text: "✅ Compression Active" }],
            [{ tag: "span", class: "compression-info__badge", text: "AUTO" }],
          ],
          [
            { class: "compression-info__row" },
            [{ tag: "span", text: "Ratio:" }],
            [
              "compressionRatio",
              { class: "compression-info__value", text: "--" },
            ],
          ],
          [
            { class: "compression-info__row" },
            [{ tag: "span", text: "Virtual Height:" }],
            ["virtualHeight", { class: "compression-info__value", text: "--" }],
          ],
        ],
      ],

      // Performance panel
      [
        "perfPanel",
        { tag: "div", class: "mtrl-panel" },
        [{ class: "panel__title", text: "Performance" }],
        [
          { class: "performance-bar" },
          [
            { class: "performance-bar__times" },
            [
              { class: "performance-bar__time" },
              [{ tag: "span", text: "Init: " }],
              ["perfInit", { tag: "span", text: "--" }],
            ],
            [
              { class: "performance-bar__time" },
              [{ tag: "span", text: "Generate: " }],
              ["perfGenerate", { tag: "span", text: "--" }],
            ],
            [
              { class: "performance-bar__time" },
              [{ tag: "span", text: "Render: " }],
              ["perfRender", { tag: "span", text: "--" }],
            ],
            [
              { class: "performance-bar__time" },
              [{ tag: "span", text: "Scroll: " }],
              ["perfScroll", { tag: "span", text: "--" }],
            ],
          ],
        ],
      ],

      // Navigation buttons
      [
        { layout: { type: "row", gap: 8 } },
        [createButton, "jumpRandom", { text: "Random", variant: "filled" }],
        [createButton, "jumpStart", { text: "Start", variant: "outlined" }],
        [createButton, "jumpEnd", { text: "End", variant: "outlined" }],
      ],

      // Jump to input
      [
        { class: "jump-input" },
        [
          "jumpInput",
          {
            tag: "input",
            class: "jump-input__field",
            type: "number",
            placeholder: "Jump to index...",
            min: "0",
          },
        ],
        [createButton, "jumpGo", { text: "Go", variant: "tonal" }],
      ],
    ],
    section.info,
  ).component;

  // Cache previous state
  let prevState = {
    fps: -1,
    domNodes: -1,
    visibleRange: "",
  };

  // Update controls
  const updateControls = () => {
    stats.domNodes = document.querySelectorAll(".vlist-item").length;
    const memorySaved = ((1 - stats.domNodes / currentTotal) * 100).toFixed(4);
    const visibleRange = `${stats.visibleStart.toLocaleString()}-${stats.visibleEnd.toLocaleString()}`;

    controls.totalItems.textContent = currentTotal.toLocaleString();
    controls.domNodes.textContent = stats.domNodes;
    controls.memorySaved.textContent = `${memorySaved}%`;

    if (prevState.fps !== stats.fps) {
      controls.fps.textContent = stats.fps;
      controls.fps.className =
        stats.fps < 30
          ? "stat-card__value stat-card__value--warning"
          : "stat-card__value stat-card__value--highlight";
      prevState.fps = stats.fps;
    }

    if (prevState.visibleRange !== visibleRange) {
      controls.visibleRange.textContent = visibleRange;
      prevState.visibleRange = visibleRange;
    }

    // Update performance metrics
    controls.perfInit.textContent = `${perf.init.toFixed(1)}ms`;
    controls.perfGenerate.textContent = `${perf.generate.toFixed(0)}ms`;
    controls.perfRender.textContent = `${perf.render.toFixed(1)}ms`;
    controls.perfScroll.textContent = `${perf.scroll.toFixed(1)}ms`;
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

  // Size toggle handlers
  const setActiveSize = (size) => {
    controls.size1m.classList.toggle(
      "size-toggle__button--active",
      size === "1m",
    );
    controls.size2m.classList.toggle(
      "size-toggle__button--active",
      size === "2m",
    );
    controls.size5m.classList.toggle(
      "size-toggle__button--active",
      size === "5m",
    );
  };

  controls.size1m.addEventListener("click", () => {
    if (currentSize === "1m") return;
    setActiveSize("1m");
    createList("1m");
  });

  controls.size2m.addEventListener("click", () => {
    if (currentSize === "2m") return;
    setActiveSize("2m");
    createList("2m");
  });

  controls.size5m.addEventListener("click", () => {
    if (currentSize === "5m") return;
    setActiveSize("5m");
    createList("5m");
  });

  // Navigation handlers
  controls.jumpRandom.on("click", () => {
    if (list) {
      const randomIndex = Math.floor(Math.random() * currentTotal);
      list.scrollToIndex(randomIndex, "center");
    }
  });

  controls.jumpStart.on("click", () => {
    if (list) list.scrollToIndex(0, "start");
  });

  controls.jumpEnd.on("click", () => {
    if (list) list.scrollToIndex(currentTotal - 1, "end");
  });

  controls.jumpGo.on("click", () => {
    if (list) {
      const index = parseInt(controls.jumpInput.value);
      if (!isNaN(index) && index >= 0 && index < currentTotal) {
        list.scrollToIndex(index, "center");
      }
    }
  });

  controls.jumpInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      controls.jumpGo.element.click();
    }
  });

  return { layout, section, list, stats, controls };
};
