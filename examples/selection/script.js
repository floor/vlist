// script.js - vlist Selection Example
// Demonstrates single and multiple selection modes with keyboard navigation

// Direct imports for optimal tree-shaking
import createButton from "mtrl/components/button";
import { createLayout } from "mtrl-addons/layout";
import { createVList } from "vlist";

// Constants
const TOTAL_ITEMS = 1000;
const ROLES = [
  "Developer",
  "Designer",
  "Manager",
  "Analyst",
  "Engineer",
  "Director",
  "Lead",
  "Intern",
];
const COLORS = [
  "#667eea",
  "#f093fb",
  "#4facfe",
  "#43e97b",
  "#fa709a",
  "#fee140",
  "#30cfd0",
  "#a8edea",
];

// Generate test items
const generateItems = (count) => {
  const items = [];
  for (let i = 0; i < count; i++) {
    items.push({
      id: i + 1,
      name: `Employee ${i + 1}`,
      role: ROLES[i % ROLES.length],
      initials: `E${i + 1}`,
      color: COLORS[i % COLORS.length],
    });
  }
  return items;
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
          text: "vlist supports both single and multiple selection modes with full keyboard navigation. Use arrow keys to navigate, Space or Enter to toggle selection, and Home/End to jump to first/last items.",
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

// Item element creator
const createItemElement = (item, selected) => {
  const schema = [
    { class: "item-content" },
    [
      {
        class: "item-avatar",
        style: { background: item.color },
        text: item.initials.slice(0, 2),
      },
    ],
    [
      { class: "item-details" },
      [{ class: "item-name", text: item.name }],
      [{ class: "item-role", text: item.role }],
    ],
  ];
  return createLayout(schema).element;
};

// Initialize
document.addEventListener("DOMContentLoaded", () => {
  createSelectionExample(document.getElementById("content"));
});

const createSelectionExample = (container) => {
  // Generate items once
  const items = generateItems(TOTAL_ITEMS);

  // Main layout
  const layout = createLayout(
    createComponentsLayout({
      title: "Selection Example",
      description:
        "Click items to select them. Use keyboard navigation with arrow keys.",
    }),
    container,
  ).component;

  // Section with showcase and info
  const section = createLayout(
    createComponentSection({
      title: "Selection Modes Demo",
      description:
        "Switch between single and multiple selection modes. Use keyboard to navigate.",
    }),
    layout.body,
  ).component;

  const showcaseElement = section.showcase.element || section.showcase;

  let list = null;
  let currentMode = "multiple";

  // Stats tracking
  const stats = {
    selectedCount: 0,
    selectedNames: [],
  };

  const createList = (mode) => {
    // Destroy existing list
    if (list) {
      list.destroy();
    }

    currentMode = mode;

    list = createVList({
      container: showcaseElement,
      itemHeight: 56,
      items: items,
      selection: {
        mode: mode,
        initial: [],
      },
      template: (item, index, { selected }) =>
        createItemElement(item, selected),
    });

    // Handle selection changes
    list.on("selection:change", ({ selected, items: selectedItems }) => {
      stats.selectedCount = selected.length;
      stats.selectedNames = selectedItems.map((item) => item.name);
      scheduleUpdate();
    });

    // Focus the list for keyboard navigation
    list.element.setAttribute("tabindex", "0");
    list.element.focus();

    // Reset stats
    stats.selectedCount = 0;
    stats.selectedNames = [];
    scheduleUpdate();
  };

  // Use requestAnimationFrame to ensure layout is complete
  requestAnimationFrame(() => createList("multiple"));

  // Create controls
  const controls = createLayout(
    [
      { layout: { type: "column", gap: 16 } },

      // Mode toggle panel
      [
        "modePanel",
        { tag: "div", class: "mtrl-panel" },
        [{ class: "panel__title", text: "Selection Mode" }],
        [
          { class: "mode-toggle" },
          [
            "modeSingle",
            {
              tag: "button",
              class: "mode-toggle__button",
              text: "Single",
            },
          ],
          [
            "modeMultiple",
            {
              tag: "button",
              class: "mode-toggle__button mode-toggle__button--active",
              text: "Multiple",
            },
          ],
        ],
      ],

      // Selection info panel
      [
        "selectionPanel",
        { tag: "div", class: "mtrl-panel" },
        [{ class: "panel__title", text: "Selection" }],
        [
          { class: "selection-info" },
          [
            "selectionCount",
            { class: "selection-info__count", text: "0 items selected" },
          ],
          ["selectionNames", { class: "selection-info__names" }],
        ],
      ],

      // Stats panel
      [
        "statsPanel",
        { tag: "div", class: "mtrl-panel" },
        [{ class: "panel__title", text: "Statistics" }],
        [
          { class: "stats-grid" },
          [
            { class: "stat-card" },
            [
              "totalItems",
              { class: "stat-card__value", text: TOTAL_ITEMS.toLocaleString() },
            ],
            [{ class: "stat-card__label", text: "Total Items" }],
          ],
          [
            { class: "stat-card" },
            [
              "selectedStat",
              {
                class: "stat-card__value stat-card__value--primary",
                text: "0",
              },
            ],
            [{ class: "stat-card__label", text: "Selected" }],
          ],
        ],
      ],

      // Action buttons
      [
        { layout: { type: "row", gap: 8 } },
        [
          createButton,
          "selectAll",
          { text: "Select All", variant: "outlined" },
        ],
        [
          createButton,
          "clearSelection",
          { text: "Clear", variant: "outlined" },
        ],
      ],

      [
        { layout: { type: "row", gap: 8 } },
        [
          createButton,
          "selectFirst10",
          { text: "Select First 10", variant: "tonal" },
        ],
      ],

      // Keyboard hints
      [
        { class: "keyboard-hints" },
        [{ class: "keyboard-hints__title", text: "Keyboard Shortcuts" }],
        [
          { tag: "div" },
          [{ tag: "span", class: "kbd", text: "↑" }],
          [{ tag: "span", class: "kbd", text: "↓" }],
          [{ tag: "span", text: " Navigate" }],
        ],
        [
          { tag: "div" },
          [{ tag: "span", class: "kbd", text: "Space" }],
          [{ tag: "span", text: " or " }],
          [{ tag: "span", class: "kbd", text: "Enter" }],
          [{ tag: "span", text: " Toggle" }],
        ],
        [
          { tag: "div" },
          [{ tag: "span", class: "kbd", text: "Home" }],
          [{ tag: "span", text: " First | " }],
          [{ tag: "span", class: "kbd", text: "End" }],
          [{ tag: "span", text: " Last" }],
        ],
      ],
    ],
    section.info,
  ).component;

  // Cache previous state
  let prevState = {
    selectedCount: -1,
  };

  // Update controls
  const updateControls = () => {
    if (prevState.selectedCount !== stats.selectedCount) {
      const count = stats.selectedCount;
      controls.selectionCount.textContent = `${count} item${count !== 1 ? "s" : ""} selected`;
      controls.selectedStat.textContent = count;

      // Update names display
      if (count === 0) {
        controls.selectionNames.textContent = "";
      } else if (count <= 5) {
        controls.selectionNames.textContent = stats.selectedNames.join(", ");
      } else {
        const first5 = stats.selectedNames.slice(0, 5).join(", ");
        controls.selectionNames.textContent = `${first5}, and ${count - 5} more...`;
      }

      prevState.selectedCount = count;
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

  // Mode toggle handlers
  controls.modeSingle.addEventListener("click", () => {
    if (currentMode === "single") return;
    controls.modeSingle.classList.add("mode-toggle__button--active");
    controls.modeMultiple.classList.remove("mode-toggle__button--active");
    controls.selectAll.disabled = true;
    createList("single");
  });

  controls.modeMultiple.addEventListener("click", () => {
    if (currentMode === "multiple") return;
    controls.modeMultiple.classList.add("mode-toggle__button--active");
    controls.modeSingle.classList.remove("mode-toggle__button--active");
    controls.selectAll.disabled = false;
    createList("multiple");
  });

  // Button handlers
  controls.selectAll.on("click", () => {
    if (list && currentMode === "multiple") {
      list.selectAll();
    }
  });

  controls.clearSelection.on("click", () => {
    if (list) {
      list.clearSelection();
    }
  });

  controls.selectFirst10.on("click", () => {
    if (list) {
      list.clearSelection();
      const first10Ids = items.slice(0, 10).map((item) => item.id);
      list.select(...first10Ids);
    }
  });

  // Initial update
  setTimeout(scheduleUpdate, 100);

  return { layout, section, list, stats, controls };
};
