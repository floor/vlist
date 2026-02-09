// Sticky Headers Example — Grouped Contact List (A–Z)
// Demonstrates the groups API with sticky section headers.
// Contacts are sorted by last name and grouped by the first letter.

import { createVList } from "vlist";

// =============================================================================
// Data Generation
// =============================================================================

const FIRST_NAMES = [
  "Alice",
  "Bob",
  "Charlie",
  "Diana",
  "Eve",
  "Frank",
  "Grace",
  "Hank",
  "Ivy",
  "Jack",
  "Kate",
  "Leo",
  "Mia",
  "Noah",
  "Olivia",
  "Paul",
  "Quinn",
  "Ruby",
  "Sam",
  "Tina",
  "Uma",
  "Vic",
  "Wendy",
  "Xander",
  "Yara",
  "Zane",
  "Aria",
  "Ben",
  "Cleo",
  "Dante",
  "Ella",
  "Finn",
  "Gwen",
  "Hugo",
  "Iris",
  "Joel",
  "Kira",
  "Liam",
  "Maya",
  "Nora",
  "Omar",
  "Pia",
  "Reed",
  "Sara",
  "Troy",
  "Uri",
  "Val",
  "Will",
];

const LAST_NAMES = [
  "Adams",
  "Allen",
  "Anderson",
  "Baker",
  "Barnes",
  "Bell",
  "Bennett",
  "Brooks",
  "Brown",
  "Burns",
  "Butler",
  "Campbell",
  "Carter",
  "Clark",
  "Cole",
  "Collins",
  "Cooper",
  "Cox",
  "Cruz",
  "Davis",
  "Diaz",
  "Dixon",
  "Edwards",
  "Ellis",
  "Evans",
  "Fisher",
  "Flores",
  "Ford",
  "Foster",
  "Fox",
  "Garcia",
  "Gibson",
  "Gomez",
  "Gonzalez",
  "Graham",
  "Green",
  "Griffin",
  "Hall",
  "Hamilton",
  "Harris",
  "Hart",
  "Hayes",
  "Henderson",
  "Henry",
  "Hernandez",
  "Hill",
  "Howard",
  "Hughes",
  "Hunt",
  "Ingram",
  "Irwin",
  "Jackson",
  "James",
  "Jenkins",
  "Johnson",
  "Jones",
  "Jordan",
  "Kelly",
  "Kennedy",
  "Kim",
  "King",
  "Knight",
  "Lambert",
  "Lane",
  "Lawrence",
  "Lee",
  "Lewis",
  "Long",
  "Lopez",
  "Martin",
  "Martinez",
  "Mason",
  "Matthews",
  "Miller",
  "Mitchell",
  "Moore",
  "Morgan",
  "Morris",
  "Murphy",
  "Murray",
  "Nelson",
  "Newman",
  "Nguyen",
  "Nichols",
  "Noble",
  "Norris",
  "Olson",
  "Ortiz",
  "Owen",
  "Palmer",
  "Parker",
  "Patel",
  "Patterson",
  "Perez",
  "Perry",
  "Peterson",
  "Phillips",
  "Pierce",
  "Powell",
  "Price",
  "Quinn",
  "Ramirez",
  "Reed",
  "Reyes",
  "Reynolds",
  "Richardson",
  "Riley",
  "Rivera",
  "Roberts",
  "Robinson",
  "Rogers",
  "Ross",
  "Russell",
  "Sanchez",
  "Sanders",
  "Scott",
  "Shaw",
  "Silva",
  "Simmons",
  "Smith",
  "Spencer",
  "Stewart",
  "Stone",
  "Sullivan",
  "Taylor",
  "Thomas",
  "Thompson",
  "Torres",
  "Tucker",
  "Turner",
  "Underwood",
  "Valdez",
  "Vargas",
  "Vasquez",
  "Vaughn",
  "Wagner",
  "Walker",
  "Wallace",
  "Walsh",
  "Wang",
  "Ward",
  "Warren",
  "Washington",
  "Watson",
  "Webb",
  "Wells",
  "West",
  "White",
  "Williams",
  "Wilson",
  "Wood",
  "Wright",
  "Xu",
  "Yang",
  "Young",
  "Yu",
  "Zamora",
  "Zhang",
  "Zimmerman",
];

const DEPARTMENTS = [
  "Engineering",
  "Design",
  "Marketing",
  "Sales",
  "HR",
  "Finance",
  "Operations",
  "Legal",
  "Support",
  "Product",
];

const AVATARS = [
  "#667eea",
  "#e06595",
  "#38a169",
  "#d97706",
  "#4facfe",
  "#e53e3e",
  "#805ad5",
  "#319795",
  "#dd6b20",
  "#3182ce",
];

/**
 * Generate a sorted contact list.
 * We use a seeded approach for deterministic output.
 */
const generateContacts = (count) => {
  const contacts = [];
  const usedNames = new Set();

  for (let i = 0; i < count; i++) {
    const first = FIRST_NAMES[((i * 7 + 3) * (i + 1)) % FIRST_NAMES.length];
    let last = LAST_NAMES[(i * 3 + i * i) % LAST_NAMES.length];

    // Ensure uniqueness with an incrementing suffix
    let fullKey = `${first} ${last}`;
    let suffix = 0;
    while (usedNames.has(fullKey)) {
      suffix++;
      last = LAST_NAMES[(i * 3 + i * i) % LAST_NAMES.length] + suffix;
      fullKey = `${first} ${last}`;
    }

    usedNames.add(fullKey);

    contacts.push({
      id: `contact-${i}`,
      name: `${first} ${last}`,
      firstName: first,
      lastName: last,
      department: DEPARTMENTS[i % DEPARTMENTS.length],
      email: `${first.toLowerCase()}.${last.toLowerCase()}@company.com`,
      phone: `+1 ${String(200 + (i % 800)).padStart(3, "0")}-${String((i * 137) % 10000).padStart(4, "0")}`,
      color: AVATARS[i % AVATARS.length],
      initials: first[0] + last[0],
    });
  }

  // Sort by last name (case-insensitive)
  contacts.sort((a, b) => a.lastName.localeCompare(b.lastName));

  return contacts;
};

// =============================================================================
// Templates
// =============================================================================

const renderContact = (item) => {
  // Group header pseudo-items have __groupHeader flag
  if (item.__groupHeader) {
    return renderGroupHeader(item.groupKey);
  }

  return `
    <div class="contact">
      <div class="contact__avatar" style="background: ${item.color}">${item.initials}</div>
      <div class="contact__info">
        <div class="contact__name">${item.name}</div>
        <div class="contact__detail">${item.department} · ${item.email}</div>
      </div>
      <div class="contact__phone">${item.phone}</div>
    </div>
  `;
};

const renderGroupHeader = (group) => `
  <div class="group-header">
    <span class="group-header__letter">${group}</span>
    <span class="group-header__line"></span>
  </div>
`;

// =============================================================================
// Setup
// =============================================================================

const TOTAL_CONTACTS = 2000;
const contacts = generateContacts(TOTAL_CONTACTS);

// =============================================================================
// Create List with Groups
// =============================================================================

const container = document.getElementById("list-container");

const list = createVList({
  container,
  ariaLabel: "Contact list",
  item: {
    height: 64,
    template: renderContact,
  },
  groups: {
    getGroupForIndex: (index) => contacts[index].lastName[0].toUpperCase(),
    headerHeight: 36,
    headerTemplate: (group) => renderGroupHeader(group),
    sticky: true,
  },
  items: contacts,
});

// =============================================================================
// Stats
// =============================================================================

const statsEl = document.getElementById("stats");
const groupDistEl = document.getElementById("group-distribution");

// Build group distribution
const groupCounts = new Map();
for (const contact of contacts) {
  const letter = contact.lastName[0].toUpperCase();
  groupCounts.set(letter, (groupCounts.get(letter) || 0) + 1);
}

const sortedGroups = [...groupCounts.entries()].sort((a, b) =>
  a[0].localeCompare(b[0]),
);
const maxGroupSize = Math.max(...sortedGroups.map(([, c]) => c));

groupDistEl.innerHTML =
  `<div class="dist-title">${sortedGroups.length} groups across ${contacts.length.toLocaleString()} contacts</div>` +
  `<div class="dist-grid">${sortedGroups
    .map(([letter, count]) => {
      const barHeight = Math.round((count / maxGroupSize) * 100);
      return `
        <div class="dist-col" title="${letter}: ${count} contacts">
          <div class="dist-bar-wrap">
            <div class="dist-bar" style="height: ${barHeight}%"></div>
          </div>
          <span class="dist-letter">${letter}</span>
        </div>
      `;
    })
    .join("")}</div>`;

const updateStats = () => {
  const domNodes = document.querySelectorAll(".vlist-item").length;
  const total = contacts.length;
  const saved = Math.round(
    (1 - domNodes / (total + sortedGroups.length)) * 100,
  );

  statsEl.innerHTML = `
    <span><strong>Contacts:</strong> ${total.toLocaleString()}</span>
    <span><strong>Groups:</strong> ${sortedGroups.length}</span>
    <span><strong>DOM nodes:</strong> ${domNodes}</span>
    <span><strong>Virtualized:</strong> ${saved}%</span>
  `;
};

list.on("scroll", updateStats);
list.on("range:change", updateStats);
updateStats();

// =============================================================================
// Controls
// =============================================================================

document.getElementById("jump-top").addEventListener("click", () => {
  list.scrollToIndex(0, { behavior: "smooth" });
});

document.getElementById("jump-middle").addEventListener("click", () => {
  list.scrollToIndex(Math.floor(contacts.length / 2), {
    align: "center",
    behavior: "smooth",
  });
});

document.getElementById("jump-bottom").addEventListener("click", () => {
  list.scrollToIndex(contacts.length - 1, {
    align: "end",
    behavior: "smooth",
  });
});

document.getElementById("jump-random").addEventListener("click", () => {
  const randomLetter =
    sortedGroups[Math.floor(Math.random() * sortedGroups.length)][0];
  // Find first contact with that letter
  const idx = contacts.findIndex(
    (c) => c.lastName[0].toUpperCase() === randomLetter,
  );
  if (idx >= 0) {
    list.scrollToIndex(idx, { behavior: "smooth" });
  }
});

// Toggle sticky headers (destroy and recreate)
let stickyEnabled = true;
const toggleBtn = document.getElementById("toggle-sticky");

toggleBtn.addEventListener("click", () => {
  stickyEnabled = !stickyEnabled;
  toggleBtn.classList.toggle("control-btn--active", stickyEnabled);
  toggleBtn.textContent = stickyEnabled ? "📌 Sticky" : "📌 No Sticky";

  // Toggle the sticky header visibility
  const stickyEl = container.querySelector(".vlist-sticky-header");
  if (stickyEl) {
    stickyEl.style.display = stickyEnabled ? "" : "none";
  }
});

// =============================================================================
// Click Handler
// =============================================================================

list.on("item:click", ({ item, index }) => {
  if (item.__groupHeader) {
    console.log(`Clicked group header: "${item.groupKey}"`);
  } else {
    console.log(
      `Clicked: ${item.name} (${item.department}) at data index ${index}`,
    );
  }
});
