// Basic Example - Pure Vanilla JavaScript
// The simplest way to use vlist - no frameworks, no dependencies

import { createVList } from "vlist";

// Generate test data
const items = Array.from({ length: 10000 }, (_, i) => ({
  id: i + 1,
  name: `User ${i + 1}`,
  email: `user${i + 1}@example.com`,
  initials: String.fromCharCode(65 + (i % 26)),
}));

// Create the virtual list
const list = createVList({
  container: "#list-container",
  itemHeight: 64,
  items: items,
  template: (item, index) => `
    <div class="item-content">
      <div class="item-avatar">${item.initials}</div>
      <div class="item-details">
        <div class="item-name">${item.name}</div>
        <div class="item-email">${item.email}</div>
      </div>
      <div class="item-index">#${index + 1}</div>
    </div>
  `,
});

// Update stats display
const statsEl = document.getElementById("stats");

const updateStats = () => {
  const domNodes = document.querySelectorAll(".vlist-item").length;
  const total = items.length;
  const saved = Math.round((1 - domNodes / total) * 100);

  statsEl.innerHTML = `
    <span><strong>Total:</strong> ${total.toLocaleString()}</span>
    <span><strong>DOM nodes:</strong> ${domNodes}</span>
    <span><strong>Memory saved:</strong> ${saved}%</span>
  `;
};

// Update on scroll and initial
list.on("scroll", updateStats);
list.on("range:change", updateStats);
updateStats();

// Log clicks
list.on("item:click", ({ item, index }) => {
  console.log(`Clicked: ${item.name} at index ${index}`);
});
