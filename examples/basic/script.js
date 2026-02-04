// script.js - vlist Basic Example
// Demonstrates a simple virtual list with static items and real-time stats

// Direct imports for optimal tree-shaking
import createButton from "mtrl/components/button";
import createSlider from "mtrl/components/slider";
import { createLayout } from "mtrl-addons/layout";
import { createVList } from "vlist";

// Constants
const TOTAL_ITEMS = 10000;

// Generate test items
const generateItems = (count) => {
  const items = [];
  for (let i = 0; i < count; i++) {
    items.push({
      id: i + 1,
      name: `User ${i + 1}`,
      email: `user${i + 1}@example.com`,
      initials: String.fromCharCode(65 + (i % 26)),
    });
  }
  return items;
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
          text: "vlist is a lightweight, high-performance virtual list library with zero dependencies. Only visible items are rendered in the DOM, enabling smooth scrolling through massive datasets.",
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

// Item template - create element once per item
const createItemElement = (item, index) => {
  const schema = [
    { class: "item-content" },
    [{ class: "item-avatar", text: item.initials }],
    [
      { class: "item-details" },
      [{ class: "item-name", text: item.name }],
      [{ class: "item-email", text: item.email }],
    ],
    [{ class: "item-index", text: `#${index + 1}` }],
  ];
  return createLayout(schema).element;
};

// Initialize
document.addEventListener("DOMContentLoaded", () => {
  createBasicExample(document.getElementById("content"));
});

const createBasicExample = (container) => {
  // Generate items once
  const items = generateItems(TOTAL_ITEMS);

  // Main layout with header, body, footer
  const layout = createLayout(
    createComponentsLayout({
      title: "Basic Virtual List",
      description:
        "A simple virtual list with 10,000 static items. Only visible items are rendered in the DOM.",
    }),
    container,
  ).component;

  // Section with showcase (left) and info (right)
  const section = createLayout(
    createComponentSection({
      title: "Virtual List Demo",
      description:
        "Click items to select them. Use the controls to navigate through the list.",
    }),
    layout.body,
  ).component;

  const showcaseElement = section.showcase.element || section.showcase;

  let list = null;

  // Stats tracking
  const stats = {
    domElements: 0,
    visibleStart: 0,
    visibleEnd: 0,
    selectedId: null,
  };

  const createList = () => {
    list = createVList({
      container: showcaseElement,
      itemHeight: 64,
      items: items,
      selection: {
        mode: "single",
      },
      template: (item, index) => createItemElement(item, index),
    });

    // Wire up list events
    list.on("scroll", () => {
      scheduleUpdate();
    });

    list.on("range:change", ({ range }) => {
      stats.visibleStart = range.start;
      stats.visibleEnd = range.end;
      scheduleUpdate();
    });

    list.on("selection:change", ({ selected }) => {
      stats.selectedId = selected.length > 0 ? selected[0] : null;
      scheduleUpdate();
    });

    list.on("item:click", ({ item, index }) => {
      console.log("Clicked:", item.name, "at index", index);
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
        [{ class: "panel__title", text: "List Statistics" }],
        [
          { class: "stats-grid" },
          [
            { class: "stat-card" },
            ["totalItems", { class: "stat-card__value", text: "0" }],
            [{ class: "stat-card__label", text: "Total Items" }],
          ],
          [
            { class: "stat-card" },
            ["domElements", { class: "stat-card__value", text: "0" }],
            [{ class: "stat-card__label", text: "DOM Elements" }],
          ],
        ],
      ],

      // Visible Range panel
      [
        "rangePanel",
        { tag: "div", class: "mtrl-panel" },
        [{ class: "panel__title", text: "Visible Range" }],
        [
          { class: "range-display" },
          ["rangeStart", { class: "range-display__value", text: "0" }],
          [{ tag: "span", text: " — " }],
          ["rangeEnd", { class: "range-display__value", text: "0" }],
        ],
        [
          { class: "range-bar" },
          ["rangeFill", { class: "range-bar__fill", style: { width: "0%" } }],
        ],
        [
          { class: "range-labels" },
          [{ text: "0" }],
          ["rangeTotal", { text: TOTAL_ITEMS.toLocaleString() }],
        ],
      ],

      // Memory efficiency panel
      [
        "efficiencyPanel",
        { tag: "div", class: "mtrl-panel" },
        [{ class: "panel__title", text: "Memory Efficiency" }],
        [
          { class: "efficiency-display" },
          ["efficiencyValue", { class: "efficiency-display__value", text: "0%" }],
          [{ class: "efficiency-display__label", text: "DOM Nodes Saved" }],
        ],
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
        [createButton, "jumpMiddle", { text: "Middle", variant: "outlined" }],
        [createButton, "jumpEnd", { text: "End", variant: "outlined" }],
      ],

      // Action buttons
      [
        { layout: { type: "row", gap: 8 } },
        [createButton, "clearSelection", { text: "Clear Selection", variant: "tonal" }],
      ],
    ],
    section.info,
  ).component;

  // Cache previous state to avoid unnecessary DOM updates
  let prevState = {
    domElements: -1,
    visibleStart: -1,
    visibleEnd: -1,
    efficiency: -1,
  };

  // Update panels function (optimized - only update changed values)
  const updateControls = () => {
    // Count DOM elements
    const domElements = document.querySelectorAll(".vlist-item").length;
    stats.domElements = domElements;

    const efficiency = Math.round((1 - domElements / TOTAL_ITEMS) * 100);

    // Only update if changed
    if (prevState.domElements !== domElements) {
      controls.totalItems.textContent = TOTAL_ITEMS.toLocaleString();
      controls.domElements.textContent = domElements;
      prevState.domElements = domElements;
    }

    if (prevState.visibleStart !== stats.visibleStart || prevState.visibleEnd !== stats.visibleEnd) {
      controls.rangeStart.textContent = stats.visibleStart;
      controls.rangeEnd.textContent = stats.visibleEnd;

      // Update range bar
      const startPercent = (stats.visibleStart / TOTAL_ITEMS) * 100;
      const widthPercent = ((stats.visibleEnd - stats.visibleStart) / TOTAL_ITEMS) * 100;
      controls.rangeFill.style.left = `${startPercent}%`;
      controls.rangeFill.style.width = `${Math.max(widthPercent, 1)}%`;

      prevState.visibleStart = stats.visibleStart;
      prevState.visibleEnd = stats.visibleEnd;
    }

    if (prevState.efficiency !== efficiency) {
      controls.efficiencyValue.textContent = `${efficiency}%`;
      prevState.efficiency = efficiency;
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

  // Wire up controls
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

  controls.clearSelection.on("click", () => {
    if (list) list.clearSelection();
  });

  // Initial update after a short delay to let the list render
  setTimeout(() => {
    scheduleUpdate();
  }, 100);

  return { layout, section, list, stats, controls };
};
