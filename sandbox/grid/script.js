// Grid Layout Example — Virtualized 2D Photo Gallery
// Demonstrates vlist's grid mode with 1,000 real photos from Lorem Picsum

import { createVList } from "vlist";

// =============================================================================
// Data Generation
// =============================================================================

// Picsum has photos with IDs 0–1084 (some gaps). We use 1000 items.
// Photo URL: https://picsum.photos/id/{id}/{width}/{height}
const PHOTO_COUNT = 1084;

const categories = [
  "Nature",
  "Urban",
  "Portrait",
  "Abstract",
  "Travel",
  "Food",
  "Animals",
  "Architecture",
  "Art",
  "Space",
];

const ITEM_COUNT = 1_000;

const items = Array.from({ length: ITEM_COUNT }, (_, i) => {
  const picId = i % PHOTO_COUNT;
  const category = categories[i % categories.length];
  return {
    id: i + 1,
    title: `Photo ${i + 1}`,
    category,
    likes: Math.floor(Math.random() * 500),
    picId,
  };
});

// =============================================================================
// State
// =============================================================================

let currentColumns = 4;
let currentGap = 8;
let listInstance = null;

// =============================================================================
// Create Grid
// =============================================================================

const createGrid = (columns, gap) => {
  // Destroy previous instance
  if (listInstance) {
    listInstance.destroy();
    listInstance = null;
  }

  // Clear the container
  const container = document.getElementById("grid-container");
  container.innerHTML = "";

  // Calculate row height from column width to maintain 4:3 aspect ratio
  const innerWidth = container.clientWidth - 2; // account for 1px border each side
  const colWidth = (innerWidth - (columns - 1) * gap) / columns;
  const height = Math.round(colWidth * 0.75);

  listInstance = createVList({
    container: "#grid-container",
    ariaLabel: "Photo gallery",
    layout: "grid",
    grid: {
      columns,
      gap,
    },
    item: {
      height,
      template: (item) => `
        <div class="card">
          <img
            class="card-img"
            src="https://picsum.photos/id/${item.picId}/400/300"
            alt="${item.title}"
            loading="lazy"
            decoding="async"
          />
          <div class="card-overlay">
            <div class="card-title">${item.title}</div>
            <div class="card-meta">
              <span class="card-category">${item.category}</span>
              <span class="card-likes">♥ ${item.likes}</span>
            </div>
          </div>
        </div>
      `,
    },
    items,
  });

  // Update stats on scroll
  listInstance.on("scroll", updateStats);
  listInstance.on("range:change", updateStats);
  updateStats();

  // Log clicks
  listInstance.on("item:click", ({ item, index }) => {
    console.log(`Clicked: ${item.title} (${item.category}) at index ${index}`);
  });
};

// =============================================================================
// Stats
// =============================================================================

const statsEl = document.getElementById("stats");

const updateStats = () => {
  const domNodes = document.querySelectorAll(
    ".vlist-item, .vlist-grid-item",
  ).length;
  const total = items.length;
  const rows = Math.ceil(total / currentColumns);
  const saved = Math.round((1 - domNodes / total) * 100);

  statsEl.innerHTML = `
    <span><strong>Total:</strong> ${total.toLocaleString()} photos</span>
    <span><strong>Rows:</strong> ${rows.toLocaleString()}</span>
    <span><strong>DOM nodes:</strong> ${domNodes}</span>
    <span><strong>Memory saved:</strong> ${saved}%</span>
  `;
};

// =============================================================================
// Controls
// =============================================================================

const columnsSelect = document.getElementById("columns-select");
const gapSelect = document.getElementById("gap-select");

columnsSelect.addEventListener("change", (e) => {
  currentColumns = parseInt(e.target.value, 10);
  createGrid(currentColumns, currentGap);
});

gapSelect.addEventListener("change", (e) => {
  currentGap = parseInt(e.target.value, 10);
  createGrid(currentColumns, currentGap);
});

// =============================================================================
// Initialize
// =============================================================================

createGrid(currentColumns, currentGap);
