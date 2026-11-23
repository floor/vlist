/**
 * Regression matrix for search membership against vlist 3.8.10 (f140c9d).
 *
 * Expected snapshots are what that commit does, except the cases tagged in
 * the test name:
 * a. a join regroups once. A plain list's extra leading callback is the key
 *    comparison, so the assertion is one rebuild at the new filtered length.
 * b. a throw from the group callback or an earlier hook leaves the previous
 *    filter, count/layout/ARIA/counter agree, the error reaches the caller,
 *    and a retry applies the edit (FLO-1508)
 * c. the first match created by an edit in navigate mode is revealed and
 *    emits search:match
 *
 * A throw from header.height is excluded (FLO-1509). search() rejects data().
 */

import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { registerDOM } from "../../helpers/dom";
import { capturePrototypeGeometry } from "../../helpers/geometry";
import { createContainer } from "../../helpers/factory";
import { scoped } from "../../helpers/scope";
import { createVList } from "../../../src/core/create";
import type { VList, VListPlugin } from "../../../src/core/types";
import type { VListItem } from "../../../src/types";
import { PLACEHOLDER_ID_PREFIX } from "../../../src/constants";
import { data } from "../../../src/plugins/data";
import { groups } from "../../../src/plugins/groups/plugin";
import { search } from "../../../src/plugins/search/plugin";
import { table } from "../../../src/plugins/table";

registerDOM();

let geometry: ReturnType<typeof capturePrototypeGeometry>;
beforeAll(() => {
  geometry = capturePrototypeGeometry();
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { get() { return 800; }, configurable: true });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { get() { return 300; }, configurable: true });
});
afterAll(() => {
  geometry.restore();
});
afterAll(() => geometry.assertRestored());

interface Row extends VListItem {
  id: number;
  group: string;
  label: string;
  note?: string;
}

type Api = VList<Row> & {
  setQuery(query: string): void;
  getMatches(): number[];
  nextMatch(): void;
  getGroupLayout(): { totalEntries: number; groups: Array<{ key: string; count: number }> };
};

type Op = "updateItem" | "setItems" | "prependItems" | "insertItem" | "nested";
type Dir = "join" | "leave" | "stays-in" | "stays-out" | "same" | "other" | "reversal" | "join-leave" | "match-meta" | "longer" | "shorter" | "rekey";
type Mode = "filter" | "navigate";
type Surface = "plain" | "table";
type ThrowKind = "none" | "group" | "earlier";
type Tag = "a" | "b" | "c";

interface Case {
  id: string;
  op: Op;
  dir: Dir;
  mode: Mode;
  surface: Surface;
  throwKind: ThrowKind;
  tag?: Tag;
  at?: number;
}

interface Snap {
  matches: number[];
  total: number;
  entries: number;
  keys: string;
  aria: string | null;
  counter: string;
  rendered: string;
  focused: string | null;
  events: string[];
  scroll: number;
}

const RECORD = process.env.MATRIX_RECORD === "1";
const RECORDED: Record<string, unknown> = {
  "nested/later-leave/filter/plain": {
    "stage1": {
      "matches": [
        0,
        1,
        2,
        3
      ],
      "total": 4,
      "entries": 8,
      "keys": "A:1,B:1,C:1,D:1",
      "aria": null,
      "counter": "4 results",
      "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
      "focused": null,
      "events": [
        "change:4",
        "change:4"
      ],
      "scroll": 0
    },
    "stage2": {
      "matches": [
        1,
        2,
        3
      ],
      "total": 3,
      "entries": 6,
      "keys": "B:1,C:1,D:1",
      "aria": null,
      "counter": "3 results",
      "rendered": "__group_header_0,2,__group_header_1,3,__group_header_2,4",
      "focused": null,
      "events": [
        "change:4",
        "change:4",
        "change:3"
      ],
      "scroll": 0
    }
  },
  "nested/later-leave/filter/table": {
    "stage1": {
      "matches": [
        0,
        1,
        2,
        3
      ],
      "total": 4,
      "entries": 8,
      "keys": "A:1,B:1,C:1,D:1",
      "aria": "9",
      "counter": "4 results",
      "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
      "focused": null,
      "events": [
        "change:4",
        "change:4"
      ],
      "scroll": 0
    },
    "stage2": {
      "matches": [
        1,
        2,
        3
      ],
      "total": 3,
      "entries": 6,
      "keys": "B:1,C:1,D:1",
      "aria": "7",
      "counter": "3 results",
      "rendered": "__group_header_0,2,__group_header_1,3,__group_header_2,4",
      "focused": null,
      "events": [
        "change:4",
        "change:4",
        "change:3"
      ],
      "scroll": 0
    }
  },
  "nested/later-leave/navigate/plain": {
    "stage1": {
      "matches": [
        0,
        1,
        2,
        3
      ],
      "total": 4,
      "entries": 8,
      "keys": "A:1,B:1,C:1,D:1",
      "aria": null,
      "counter": "3 of 4",
      "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
      "focused": "3",
      "events": [
        "change:4",
        "change:4"
      ],
      "scroll": 0
    },
    "stage2": {
      "matches": [
        1,
        2,
        3
      ],
      "total": 4,
      "entries": 8,
      "keys": "A:1,B:1,C:1,D:1",
      "aria": null,
      "counter": "2 of 3",
      "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
      "focused": "3",
      "events": [
        "change:4",
        "change:4",
        "change:3"
      ],
      "scroll": 0
    }
  },
  "nested/later-leave/navigate/table": {
    "stage1": {
      "matches": [
        0,
        1,
        2,
        3
      ],
      "total": 4,
      "entries": 8,
      "keys": "A:1,B:1,C:1,D:1",
      "aria": "9",
      "counter": "3 of 4",
      "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
      "focused": "3",
      "events": [
        "change:4",
        "change:4"
      ],
      "scroll": 0
    },
    "stage2": {
      "matches": [
        1,
        2,
        3
      ],
      "total": 4,
      "entries": 8,
      "keys": "A:1,B:1,C:1,D:1",
      "aria": "9",
      "counter": "2 of 3",
      "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
      "focused": "3",
      "events": [
        "change:4",
        "change:4",
        "change:3"
      ],
      "scroll": 0
    }
  },
  "navigate/listener-leave/plain": {
    "during": [
      {
        "kind": "match",
        "keys": "A:1,B:1,C:1,D:1",
        "lookup": [
          1,
          2,
          3,
          4
        ],
        "headers": "A|B|C|D",
        "trace": [
          "earlier",
          "group:1"
        ]
      },
      {
        "kind": "change",
        "keys": "A:1,B:1,C:1,D:1",
        "lookup": [
          1,
          2,
          3,
          4
        ],
        "headers": "A|B|C|D",
        "trace": [
          "earlier",
          "group:1"
        ]
      }
    ],
    "focused": "3",
    "matches": [
      2
    ],
    "counter": "1 of 1",
    "headers": "A|Z|C|D"
  },
  "navigate/focus-preserved/plain": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "3 of 3",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "3",
    "events": [
      "change:3"
    ],
    "scroll": 0
  },
  "navigate/focus-wrap/plain": {
    "matches": [
      1
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 1",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [
      "match:1",
      "change:1"
    ],
    "scroll": 0
  },
  "navigate/setItems-rebase/plain": {
    "matches": [
      1,
      2,
      4
    ],
    "total": 5,
    "entries": 10,
    "keys": "Z:1,C:1,B:1,Y:1,X:1",
    "aria": null,
    "counter": "2 of 3",
    "rendered": "__group_header_0,9,__group_header_1,3,__group_header_2,2,__group_header_3,8,__group_header_4,7",
    "focused": "2",
    "events": [
      "match:2",
      "change:3"
    ],
    "scroll": 0,
    "note": "shifted"
  },
  "navigate/insert-rebase/plain": {
    "matches": [
      1,
      2,
      3
    ],
    "total": 5,
    "entries": 10,
    "keys": "A:1,Z:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "2 of 3",
    "rendered": "__group_header_0,1,__group_header_1,5,__group_header_2,2,__group_header_3,3,__group_header_4,4",
    "focused": "2",
    "events": [
      "match:2",
      "change:3"
    ],
    "scroll": 0,
    "lookup": [
      1,
      5,
      2,
      3,
      4
    ],
    "note": "shifted"
  },
  "navigate/listener-leave/table": {
    "during": [
      {
        "kind": "match",
        "keys": "A:1,Z:1,C:1,D:1",
        "lookup": [
          1,
          2,
          3,
          4
        ],
        "headers": "",
        "trace": [
          "earlier",
          "group:1",
          "group:0",
          "group:1",
          "group:2",
          "group:3"
        ]
      },
      {
        "kind": "change",
        "keys": "A:1,Z:1,C:1,D:1",
        "lookup": [
          1,
          2,
          3,
          4
        ],
        "headers": "",
        "trace": [
          "earlier",
          "group:1",
          "group:0",
          "group:1",
          "group:2",
          "group:3"
        ]
      }
    ],
    "focused": "3",
    "matches": [
      2
    ],
    "counter": "1 of 1",
    "headers": ""
  },
  "navigate/focus-preserved/table": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "3 of 3",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "3",
    "events": [
      "change:3"
    ],
    "scroll": 0
  },
  "navigate/focus-wrap/table": {
    "matches": [
      1
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "1 of 1",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [
      "match:1",
      "change:1"
    ],
    "scroll": 0
  },
  "navigate/setItems-rebase/table": {
    "matches": [
      1,
      2,
      4
    ],
    "total": 5,
    "entries": 10,
    "keys": "Z:1,C:1,B:1,Y:1,X:1",
    "aria": "11",
    "counter": "2 of 3",
    "rendered": "__group_header_0,9,__group_header_1,3,__group_header_2,2,__group_header_3,8,__group_header_4,7",
    "focused": "2",
    "events": [
      "match:2",
      "change:3"
    ],
    "scroll": 0,
    "note": "shifted"
  },
  "navigate/insert-rebase/table": {
    "matches": [
      1,
      2,
      3
    ],
    "total": 5,
    "entries": 10,
    "keys": "A:1,Z:1,B:1,C:1,D:1",
    "aria": "11",
    "counter": "2 of 3",
    "rendered": "__group_header_0,1,__group_header_1,5,__group_header_2,2,__group_header_3,3,__group_header_4,4",
    "focused": "2",
    "events": [
      "match:2",
      "change:3"
    ],
    "scroll": 0,
    "lookup": [
      1,
      5,
      2,
      3,
      4
    ],
    "note": "shifted"
  },
  "updateItem/rename-front/filter/plain": {
    "matches": [
      0,
      1,
      3
    ],
    "total": 3,
    "entries": 6,
    "keys": "A:1,B:1,D:1",
    "aria": null,
    "counter": "3 results",
    "rendered": "__group_header_0,11,__group_header_1,2,__group_header_2,4",
    "focused": null,
    "events": [
      "change:3"
    ],
    "scroll": 0,
    "lookup": [
      11,
      2,
      4,
      null,
      null
    ]
  },
  "updateItem/rename-middle/filter/plain": {
    "matches": [
      1,
      2,
      3
    ],
    "total": 3,
    "entries": 6,
    "keys": "B:1,C:1,D:1",
    "aria": null,
    "counter": "3 results",
    "rendered": "__group_header_0,2,__group_header_1,33,__group_header_2,4",
    "focused": null,
    "events": [
      "change:3"
    ],
    "scroll": 0,
    "lookup": [
      2,
      33,
      4,
      null,
      null
    ]
  },
  "updateItem/rename-tail/filter/plain": {
    "matches": [
      1,
      3,
      4
    ],
    "total": 3,
    "entries": 6,
    "keys": "B:1,D:1,E:1",
    "aria": null,
    "counter": "3 results",
    "rendered": "__group_header_0,2,__group_header_1,4,__group_header_2,55",
    "focused": null,
    "events": [
      "change:3"
    ],
    "scroll": 0,
    "lookup": [
      2,
      4,
      55,
      null,
      null
    ]
  },
  "updateItem/rename-front/filter/table": {
    "matches": [
      0,
      1,
      3
    ],
    "total": 3,
    "entries": 6,
    "keys": "A:1,B:1,D:1",
    "aria": "7",
    "counter": "3 results",
    "rendered": "__group_header_0,11,__group_header_1,2,__group_header_2,4",
    "focused": null,
    "events": [
      "change:3"
    ],
    "scroll": 0,
    "lookup": [
      11,
      2,
      4,
      null,
      null
    ]
  },
  "updateItem/rename-middle/filter/table": {
    "matches": [
      1,
      2,
      3
    ],
    "total": 3,
    "entries": 6,
    "keys": "B:1,C:1,D:1",
    "aria": "7",
    "counter": "3 results",
    "rendered": "__group_header_0,2,__group_header_1,33,__group_header_2,4",
    "focused": null,
    "events": [
      "change:3"
    ],
    "scroll": 0,
    "lookup": [
      2,
      33,
      4,
      null,
      null
    ]
  },
  "updateItem/rename-tail/filter/table": {
    "matches": [
      1,
      3,
      4
    ],
    "total": 3,
    "entries": 6,
    "keys": "B:1,D:1,E:1",
    "aria": "7",
    "counter": "3 results",
    "rendered": "__group_header_0,2,__group_header_1,4,__group_header_2,55",
    "focused": null,
    "events": [
      "change:3"
    ],
    "scroll": 0,
    "lookup": [
      2,
      4,
      55,
      null,
      null
    ]
  },
  "ungrouped/join/filter": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 3,
    "rendered": "1,2,3",
    "counter": "3 results",
    "events": [
      "change:3"
    ],
    "aria": null,
    "focused": null
  },
  "updateItem/rename-front/navigate/plain": {
    "matches": [
      0,
      1,
      3
    ],
    "total": 5,
    "entries": 10,
    "keys": "A:1,B:1,C:1,D:1,E:1",
    "aria": null,
    "counter": "2 of 3",
    "rendered": "__group_header_0,11,__group_header_1,2,__group_header_2,3,__group_header_3,4,__group_header_4,5",
    "focused": "2",
    "events": [
      "change:3"
    ],
    "scroll": 0,
    "lookup": [
      11,
      2,
      3,
      4,
      5
    ]
  },
  "updateItem/rename-middle/navigate/plain": {
    "matches": [
      1,
      2,
      3
    ],
    "total": 5,
    "entries": 10,
    "keys": "A:1,B:1,C:1,D:1,E:1",
    "aria": null,
    "counter": "1 of 3",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,33,__group_header_3,4,__group_header_4,5",
    "focused": "2",
    "events": [
      "change:3"
    ],
    "scroll": 0,
    "lookup": [
      1,
      2,
      33,
      4,
      5
    ]
  },
  "updateItem/rename-tail/navigate/plain": {
    "matches": [
      1,
      3,
      4
    ],
    "total": 5,
    "entries": 10,
    "keys": "A:1,B:1,C:1,D:1,E:1",
    "aria": null,
    "counter": "1 of 3",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4,__group_header_4,55",
    "focused": "2",
    "events": [
      "change:3"
    ],
    "scroll": 0,
    "lookup": [
      1,
      2,
      3,
      4,
      55
    ]
  },
  "updateItem/rename-front/navigate/table": {
    "matches": [
      0,
      1,
      3
    ],
    "total": 5,
    "entries": 10,
    "keys": "A:1,B:1,C:1,D:1,E:1",
    "aria": "11",
    "counter": "2 of 3",
    "rendered": "__group_header_0,11,__group_header_1,2,__group_header_2,3,__group_header_3,4,__group_header_4,5",
    "focused": "2",
    "events": [
      "change:3"
    ],
    "scroll": 0,
    "lookup": [
      11,
      2,
      3,
      4,
      5
    ]
  },
  "updateItem/rename-middle/navigate/table": {
    "matches": [
      1,
      2,
      3
    ],
    "total": 5,
    "entries": 10,
    "keys": "A:1,B:1,C:1,D:1,E:1",
    "aria": "11",
    "counter": "1 of 3",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,33,__group_header_3,4,__group_header_4,5",
    "focused": "2",
    "events": [
      "change:3"
    ],
    "scroll": 0,
    "lookup": [
      1,
      2,
      33,
      4,
      5
    ]
  },
  "updateItem/rename-tail/navigate/table": {
    "matches": [
      1,
      3,
      4
    ],
    "total": 5,
    "entries": 10,
    "keys": "A:1,B:1,C:1,D:1,E:1",
    "aria": "11",
    "counter": "1 of 3",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4,__group_header_4,55",
    "focused": "2",
    "events": [
      "change:3"
    ],
    "scroll": 0,
    "lookup": [
      1,
      2,
      3,
      4,
      55
    ]
  },
  "ungrouped/join/navigate": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 4,
    "rendered": "1,2,3,4",
    "counter": "2 of 3",
    "events": [
      "change:3"
    ],
    "aria": null,
    "focused": "2"
  },
  "data/sparse": {
    "loaded": 1000,
    "renamedFrom": -1,
    "renamedTo": 0,
    "placeholderId": "__placeholder_20",
    "placeholderAfter": "__placeholder_20",
    "placeholderIndex": -1,
    "total": 80
  }
};
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function baseRows(): Row[] {
  return [
    { id: 1, group: "A", label: "hide" },
    { id: 2, group: "B", label: "show" },
    { id: 3, group: "C", label: "show" },
    { id: 4, group: "D", label: "hide" },
  ];
}

function patched(dir: Dir): Row[] {
  const rows = baseRows();
  if (dir === "join") rows[0] = { ...rows[0]!, label: "show" };
  if (dir === "leave") rows[1] = { ...rows[1]!, label: "hide" };
  if (dir === "stays-in") rows[1] = { ...rows[1]!, note: "kept" };
  if (dir === "stays-out") rows[3] = { ...rows[3]!, note: "kept" };
  if (dir === "longer") {
    return [...rows, { id: 5, group: "E", label: "show" }, { id: 6, group: "F", label: "hide" }];
  }
  if (dir === "shorter") return [{ ...rows[1]! }, { ...rows[2]! }];
  return rows;
}

function patchOf(dir: Dir): { id: number; updates: Partial<Row> } {
  if (dir === "join") return { id: 1, updates: { label: "show" } };
  if (dir === "leave") return { id: 2, updates: { label: "hide" } };
  if (dir === "stays-in") return { id: 2, updates: { note: "kept" } };
  if (dir === "rekey") return { id: 2, updates: { group: "Z" } };
  return { id: 4, updates: { note: "kept" } };
}

// The ten truncated filter retries and the ten stale navigate counters are
// the throw contract, not a snapshot of the bug.
function nestedTag(dir: Dir, throwKind: ThrowKind): Tag | undefined {
  if (throwKind === "none" || dir === "join-leave" || dir === "match-meta") return undefined;
  if (dir === "reversal" && throwKind === "earlier") return undefined;
  if (dir === "same" || dir === "other" || dir === "reversal") return "b";
  return undefined;
}

function added(dir: Dir): Row {
  return { id: 5, group: "Z", label: dir === "join" ? "show" : "hide" };
}

const cases: Case[] = [];

function add(op: Op, dir: Dir, mode: Mode, surface: Surface, throwKind: ThrowKind, tag?: Tag): void {
  cases.push({
    id: `${op}/${dir}/${mode}/${surface}/${throwKind}`,
    op,
    dir,
    mode,
    surface,
    throwKind,
    tag,
  });
}

for (const mode of ["filter", "navigate"] as const) {
  for (const surface of ["plain", "table"] as const) {
    for (const dir of ["join", "leave", "stays-in", "stays-out"] as const) {
      const joinOnce = mode === "filter" && dir === "join" ? "a" : undefined;
      add("updateItem", dir, mode, surface, "none", joinOnce);
      add("setItems", dir, mode, surface, "none");
      if (dir === "join" || dir === "stays-out") {
        add("prependItems", dir, mode, surface, "none");
        add("insertItem", dir, mode, surface, "none");
      }
      if (dir !== "stays-out") add("updateItem", dir, mode, surface, "group", "b");
      add("updateItem", dir, mode, surface, "earlier", "b");
      add("setItems", dir, mode, surface, "group");
    }
    for (const dir of ["same", "other", "reversal", "join-leave", "match-meta"] as const) {
      const once = dir === "match-meta" && mode === "filter" ? "a" : nestedTag(dir, "none");
      add("nested", dir, mode, surface, "none", once);
      if (dir === "match-meta") continue;
      add("nested", dir, mode, surface, "group", nestedTag(dir, "group"));
      add("nested", dir, mode, surface, "earlier", nestedTag(dir, "earlier"));
    }
    add("setItems", "longer", mode, surface, "none");
    add("setItems", "shorter", mode, surface, "none");
    add("updateItem", "rekey", mode, surface, "none");
    for (const dir of ["join", "stays-out"] as const) {
      for (const at of [2, 4]) {
        cases.push({
          id: `insertItem/${dir}@${at}/${mode}/${surface}/none`,
          op: "insertItem",
          dir,
          mode,
          surface,
          throwKind: "none",
          at,
        });
      }
    }
  }
}

function snapOf(list: Api, container: HTMLElement, events: string[]): Snap {
  const layout = list.getGroupLayout();
  const root = container.querySelector(".vlist") as HTMLElement;
  const viewport = container.querySelector(".vlist-viewport") as HTMLElement;
  const tableRows = [...container.querySelectorAll(".vlist-table-row")];
  const nodes = tableRows.length
    ? tableRows
    : [...container.querySelectorAll(".vlist-group-header, .vlist-item")];
  const rendered = nodes
    .sort((a, b) => Number(a.getAttribute("data-index")) - Number(b.getAttribute("data-index")))
    .map((el) => el.getAttribute("data-id") ?? "")
    .join(",");
  const mark = container.querySelector(".vlist-search-match--current");
  const focused = mark?.closest(".vlist-table-row, .vlist-item")?.getAttribute("data-id") ?? null;
  return {
    matches: list.getMatches(),
    total: list.total,
    entries: layout.totalEntries,
    keys: layout.groups.map((group) => `${group.key}:${group.count}`).join(","),
    aria: root.getAttribute("aria-rowcount"),
    counter: container.querySelector(".vlist-search__counter")?.textContent ?? "",
    rendered,
    focused,
    events: [...events],
    scroll: viewport.scrollTop,
  };
}

function earlierPlugin(
  listRef: { list: Api | null },
  spec: Case,
  arm: { throw: boolean },
): VListPlugin<Row> {
  return {
    name: "earlier-hook",
    priority: 40,
    setup(ctx) {
      const prev = ctx.hooks.get("_onItemUpdate") as ((id: string | number, updates: Partial<Row>) => void) | undefined;
      ctx.hooks.method("_onItemUpdate", (id: string | number, updates: Partial<Row>): void => {
        if (arm.throw && spec.throwKind === "earlier") {
          arm.throw = false;
          throw new Error("earlier");
        }
        if (spec.op === "nested" && id === 1 && listRef.list) {
          const inner = spec.dir === "same"
            ? { id: 1, updates: { note: "meta" } as Partial<Row> }
            : spec.dir === "other"
              ? { id: 4, updates: { note: "meta" } as Partial<Row> }
              : spec.dir === "reversal"
                ? { id: 4, updates: { label: "show" } as Partial<Row> }
                : spec.dir === "match-meta"
                  ? { id: 2, updates: { note: "meta" } as Partial<Row> }
                  : { id: 1, updates: { label: "hide" } as Partial<Row> };
          if (updates.label === "show" || updates.note === undefined) {
            const current = listRef.list;
            listRef.list = null;
            try {
              current.updateItem(inner.id, inner.updates);
            } finally {
              listRef.list = current;
            }
          }
        }
        prev?.(id, updates);
      });
    },
  };
}

async function mount(spec: Case, arm: { throw: boolean }, calls: number[]): Promise<{ list: Api; container: HTMLElement }> {
  const listRef: { list: Api | null } = { list: null };
  const container = createContainer({ width: 300, height: 800 });
  const plugins: Array<VListPlugin<Row>> = [];
  if (spec.surface === "table") {
    plugins.push(table<Row>({ columns: [{ key: "label", label: "Label", width: 120 }], rowHeight: 40, headerHeight: 32 }));
  }
  plugins.push(groups<Row>({
    getGroupForIndex: (index, item) => {
      calls.push(index);
      if (arm.throw && spec.throwKind === "group") {
        arm.throw = false;
        throw new Error("group");
      }
      return item?.group ?? "";
    },
    header: { height: 32, template: (key) => key },
    sticky: false,
  }));
  plugins.push(earlierPlugin(listRef, spec, arm));
  plugins.push(search<Row>({ mode: spec.mode, field: "label" }));
  const list = createVList<Row>(
    {
      container,
      items: baseRows(),
      item: { height: 40, template: (item) => item.label },
    },
    plugins,
  ) as Api;
  listRef.list = list;
  await tick();
  list.setQuery("show");
  await tick();
  return { list, container };
}

function act(list: Api, spec: Case): void {
  if (spec.op === "updateItem" || spec.op === "nested") {
    const patch = spec.op === "nested" ? { id: 1, updates: { label: "show" } as Partial<Row> } : patchOf(spec.dir);
    list.updateItem(patch.id, patch.updates);
    return;
  }
  if (spec.op === "setItems") {
    list.setItems(patched(spec.dir));
    return;
  }
  const row = added(spec.dir);
  if (spec.op === "prependItems") list.prependItems([row]);
  else list.insertItem(row, spec.at ?? 0);
}

// A rebuild is a contiguous walk from index 0. A lone call is the key
// comparison groups makes before deciding to rebuild.
function rebuildLengths(calls: number[]): number[] {
  const lengths: number[] = [];
  let i = 0;
  while (i < calls.length) {
    if (calls[i] === 0 && calls[i + 1] === 1) {
      let end = i;
      while (end + 1 < calls.length && calls[end + 1] === calls[end]! + 1) end++;
      lengths.push(end - i + 1);
      i = end + 1;
    } else {
      i++;
    }
  }
  return lengths;
}

function keep(id: string, detail: unknown): void {
  if (RECORD) {
    console.log(JSON.stringify({ id, detail }));
    return;
  }
  expect(detail, id).toEqual(RECORDED[id]);
}

async function mountCustom(
  items: Row[],
  mode: Mode,
  surface: Surface,
  hooks?: {
    earlier?: (id: string | number, updates: Partial<Row>, list: Api) => void;
    trace?: string[];
    grouped?: boolean;
  },
): Promise<{ list: Api; container: HTMLElement }> {
  const listRef: { list: Api | null } = { list: null };
  const container = createContainer({ width: 300, height: 800 });
  const plugins: Array<VListPlugin<Row>> = [];
  if (surface === "table") {
    plugins.push(table<Row>({ columns: [{ key: "label", label: "Label", width: 120 }], rowHeight: 40, headerHeight: 32 }));
  }
  if (hooks?.grouped !== false) {
    plugins.push(groups<Row>({
      getGroupForIndex: (index, item) => {
        hooks?.trace?.push(`group:${index}`);
        return item?.group ?? "";
      },
      header: { height: 32, template: (key) => key },
      sticky: false,
    }));
  }
  plugins.push({
    name: "earlier-hook",
    priority: 40,
    setup(ctx) {
      const prev = ctx.hooks.get("_onItemUpdate") as ((id: string | number, updates: Partial<Row>) => void) | undefined;
      ctx.hooks.method("_onItemUpdate", (id: string | number, updates: Partial<Row>): void => {
        if (!listRef.list) {
          prev?.(id, updates);
          return;
        }
        hooks?.trace?.push("earlier");
        const current = listRef.list;
        listRef.list = null;
        try {
          hooks?.earlier?.(id, updates, current);
        } finally {
          listRef.list = current;
        }
        prev?.(id, updates);
      });
    },
  });
  plugins.push(search<Row>({ mode, field: "label" }));
  const list = createVList<Row>(
    { container, items, item: { height: 40, template: (item) => item.label } },
    plugins,
  ) as Api;
  listRef.list = list;
  await tick();
  list.setQuery("show");
  await tick();
  return { list, container };
}

function headersOf(container: HTMLElement): string {
  return [...container.querySelectorAll(".vlist-group-header")].map((el) => el.textContent ?? "").join("|");
}

function lookupOf(list: Api, count: number): Array<number | string | null> {
  const ids: Array<number | string | null> = [];
  for (let i = 0; i < count; i++) ids.push(list.getItemAt(i)?.id ?? null);
  return ids;
}

describe("search join matrix against 3.8.10", () => {
  for (const spec of cases) {
    const title = spec.tag ? `${spec.id} [${spec.tag}]` : spec.id;
    it(title, scoped(async (scope) => {
      const arm = { throw: false };
      const calls: number[] = [];
      const { list, container } = await mount(spec, arm, calls);
      scope.own(list, container);
      const events: string[] = [];
      list.on("search:change", (event) => events.push(`change:${event.matches}`));
      list.on("search:match", (event) => events.push(`match:${String(event.index)}`));
      const before = snapOf(list, container, events);
      calls.length = 0;
      arm.throw = spec.throwKind !== "none";
      let threw: string | null = null;
      try {
        act(list, spec);
      } catch (error) {
        threw = (error as Error).message;
      }
      await tick();
      const afterThrow = snapOf(list, container, events);
      const groupIdx = [...calls];
      if (spec.throwKind !== "none") {
        try {
          act(list, spec);
        } catch (error) {
          threw = `${threw ?? ""}|retry:${(error as Error).message}`;
        }
        await tick();
      }
      const after = snapOf(list, container, events);

      if (RECORD) {
        console.log(JSON.stringify({ id: spec.id, tag: spec.tag ?? "", threw, groupIdx, before, afterThrow, after }));
        return;
      }

      if (spec.op === "setItems" && spec.throwKind !== "none") {
        expect((threw ?? "").split("|")[0], spec.id).toBe("group");
      }

      if (spec.tag === "b") {
        // b. a throw leaves the previous filter; count, layout, ARIA and the
        // counter still agree; the error reaches the caller; a retry applies.
        expect(threw, spec.id).toBe(spec.throwKind === "group" ? "group" : "earlier");
        expect(afterThrow, spec.id).toEqual(before);
        const cleanId = spec.id.replace(`/${spec.throwKind}`, "/none");
        expect(after, spec.id).toEqual(EXPECTED[cleanId]);
        return;
      }

      if (spec.tag === "a") {
        // a. one rebuild at the filtered length. The leading lone index is
        // the key comparison, not a second rebuild.
        expect(rebuildLengths(groupIdx), spec.id).toEqual([3]);
      }

      if (spec.dir === "match-meta") {
        // Navigate does not rebuild the filtered layout. f140c9d only compares keys.
        if (spec.mode === "navigate") expect(rebuildLengths(groupIdx), spec.id).toEqual([]);
        const noted = list.getItemAt(1);
        expect(noted?.id, spec.id).toBe(2);
        expect(noted?.note, spec.id).toBe("meta");
      }

      expect(after, spec.id).toEqual(EXPECTED[spec.id]);
    }));
  }

  for (const mode of ["filter", "navigate"] as const) {
    it(`data/${mode} rejects search`, () => {
      const container = createContainer({ width: 300, height: 800 });
      try {
        expect(() => createVList<Row>(
          { container, item: { height: 40, template: (item) => item.label } },
          [
            data<Row>({ adapter: { read: async () => ({ items: [], total: 0 }) }, total: 0 }),
            search<Row>({ mode, field: "label" }),
          ],
        )).toThrow('[vlist] Plugin "search" conflicts with "data"');
      } finally {
        container.remove();
      }
    });
  }

  for (const surface of ["plain", "table"] as const) {
    // c. the first match created by an edit in navigate mode is revealed and
    // emits search:match.
    it(`navigate/first-match/${surface} [c]`, scoped(async (scope) => {
      const items: Row[] = [];
      for (let id = 1; id <= 30; id++) items.push({ id, group: "A", label: "hide" });
      const container = createContainer({ width: 300, height: 800 });
      const plugins: Array<VListPlugin<Row>> = [];
      if (surface === "table") {
        plugins.push(table<Row>({ columns: [{ key: "label", label: "Label", width: 120 }], rowHeight: 40, headerHeight: 32 }));
      }
      plugins.push(groups<Row>({
        getGroupForIndex: (_index, item) => item?.group ?? "",
        header: { height: 32, template: (key) => key },
        sticky: false,
      }));
      plugins.push(search<Row>({ mode: "navigate", field: "label" }));
      const list = createVList<Row>(
        { container, items, item: { height: 40, template: (item) => item.label } },
        plugins,
      ) as Api;
      scope.own(list, container);
      await tick();
      list.setQuery("show");
      await tick();
      const events: string[] = [];
      list.on("search:change", (event) => events.push(`change:${event.matches}`));
      list.on("search:match", (event) => events.push(`match:${String(event.index)}`));
      list.updateItem(21, { label: "show" });
      await tick();
      const viewport = container.querySelector(".vlist-viewport") as HTMLElement;
      if (RECORD) {
        console.log(JSON.stringify({
          id: `navigate/first-match/${surface}`,
          events,
          scroll: viewport.scrollTop,
          matches: list.getMatches(),
        }));
        return;
      }
      expect(events, surface).toEqual(FIRST_MATCH[surface].events);
      expect(viewport.scrollTop, surface).toBe(FIRST_MATCH[surface].scroll);
      expect(list.getMatches(), surface).toEqual([20]);
    }));
  }

  for (const mode of ["filter", "navigate"] as const) {
    for (const surface of ["plain", "table"] as const) {
      // Outer join of a later row; the earlier hook joins the row at the
      // previous slot, then that earlier row leaves.
      it(`nested/later-leave/${mode}/${surface}`, scoped(async (scope) => {
        const items: Row[] = [
          { id: 1, group: "A", label: "hide" },
          { id: 2, group: "B", label: "hide" },
          { id: 3, group: "C", label: "show" },
          { id: 4, group: "D", label: "show" },
        ];
        const { list, container } = await mountCustom(items, mode, surface, {
          earlier: (id, updates, current) => {
            if (id === 2 && updates.label === "show") current.updateItem(1, { label: "show" });
          },
        });
        scope.own(list, container);
        const events: string[] = [];
        list.on("search:change", (event) => events.push(`change:${event.matches}`));
        list.on("search:match", (event) => events.push(`match:${String(event.index)}`));
        list.updateItem(2, { label: "show" });
        await tick();
        const stage1 = snapOf(list, container, events);
        list.updateItem(1, { label: "hide" });
        await tick();
        const stage2 = snapOf(list, container, events);
        keep(`nested/later-leave/${mode}/${surface}`, { stage1, stage2 });
      }));

      // A group throw, then an unrelated edit, then the retry. The unrelated
      // edit must still see the previous filter.
      it(`updateItem/join/${mode}/${surface}/unrelated [b]`, scoped(async (scope) => {
        const arm = { throw: false };
        const calls: number[] = [];
        const spec: Case = { id: "unrelated", op: "updateItem", dir: "join", mode, surface, throwKind: "group" };
        const { list, container } = await mount(spec, arm, calls);
        scope.own(list, container);
        const events: string[] = [];
        list.on("search:change", (event) => events.push(`change:${event.matches}`));
        list.on("search:match", (event) => events.push(`match:${String(event.index)}`));
        const before = snapOf(list, container, events);
        arm.throw = true;
        let threw: string | null = null;
        try {
          list.updateItem(1, { label: "show" });
        } catch (error) {
          threw = (error as Error).message;
        }
        await tick();
        let side: string | null = null;
        try {
          list.updateItem(4, { note: "side" });
        } catch (error) {
          side = (error as Error).message;
        }
        await tick();
        const afterSide = snapOf(list, container, events);
        try {
          list.updateItem(1, { label: "show" });
        } catch (error) {
          threw = `${threw ?? ""}|retry:${(error as Error).message}`;
        }
        await tick();
        const after = snapOf(list, container, events);
        if (RECORD) {
          console.log(JSON.stringify({ id: `updateItem/join/${mode}/${surface}/unrelated`, threw, side, before, afterSide, after }));
          return;
        }
        expect(threw, surface).toBe("group");
        expect(side, surface).toBeNull();
        expect(afterSide, surface).toEqual(before);
        expect(after, surface).toEqual(EXPECTED[`updateItem/join/${mode}/${surface}/none`]);
      }));
    }
  }

  for (const surface of ["plain", "table"] as const) {
    it(`navigate/listener-leave/${surface}`, scoped(async (scope) => {
      const trace: string[] = [];
      const { list, container } = await mountCustom(baseRows(), "navigate", surface, { trace });
      scope.own(list, container);
      const during: unknown[] = [];
      const take = (kind: string): void => {
        during.push({
          kind,
          keys: list.getGroupLayout().groups.map((group) => `${group.key}:${group.count}`).join(","),
          lookup: lookupOf(list, 4),
          headers: headersOf(container),
          trace: [...trace],
        });
      };
      list.on("search:change", () => take("change"));
      list.on("search:match", () => take("match"));
      trace.length = 0;
      list.updateItem(2, { label: "hide", group: "Z" });
      await tick();
      keep(`navigate/listener-leave/${surface}`, {
        during,
        focused: container.querySelector(".vlist-search-match--current")?.closest(".vlist-table-row, .vlist-item")?.getAttribute("data-id") ?? null,
        matches: list.getMatches(),
        counter: container.querySelector(".vlist-search__counter")?.textContent ?? "",
        headers: headersOf(container),
      });
    }));

    it(`navigate/focus-preserved/${surface}`, scoped(async (scope) => {
      const { list, container } = await mountCustom(baseRows(), "navigate", surface);
      scope.own(list, container);
      list.nextMatch();
      await tick();
      const events: string[] = [];
      list.on("search:change", (event) => events.push(`change:${event.matches}`));
      list.on("search:match", (event) => events.push(`match:${String(event.index)}`));
      list.updateItem(1, { label: "show" });
      await tick();
      keep(`navigate/focus-preserved/${surface}`, snapOf(list, container, events));
    }));

    it(`navigate/focus-wrap/${surface}`, scoped(async (scope) => {
      const { list, container } = await mountCustom(baseRows(), "navigate", surface);
      scope.own(list, container);
      list.nextMatch();
      await tick();
      const events: string[] = [];
      list.on("search:change", (event) => events.push(`change:${event.matches}`));
      list.on("search:match", (event) => events.push(`match:${String(event.index)}`));
      list.updateItem(3, { label: "hide" });
      await tick();
      keep(`navigate/focus-wrap/${surface}`, snapOf(list, container, events));
    }));

    it(`navigate/setItems-rebase/${surface}`, scoped(async (scope) => {
      const { list, container } = await mountCustom(baseRows(), "navigate", surface);
      scope.own(list, container);
      list.nextMatch();
      await tick();
      const events: string[] = [];
      list.on("search:change", (event) => events.push(`change:${event.matches}`));
      list.on("search:match", (event) => events.push(`match:${String(event.index)}`));
      list.setItems([
        { id: 9, group: "Z", label: "hide" },
        { id: 3, group: "C", label: "show" },
        { id: 2, group: "B", label: "show" },
        { id: 8, group: "Y", label: "hide" },
        { id: 7, group: "X", label: "show" },
      ]);
      await tick();
      list.updateItem(3, { note: "shifted" });
      await tick();
      keep(`navigate/setItems-rebase/${surface}`, {
        ...snapOf(list, container, events),
        note: list.getItemAt(1)?.note ?? null,
      });
    }));

    it(`navigate/insert-rebase/${surface}`, scoped(async (scope) => {
      const { list, container } = await mountCustom(baseRows(), "navigate", surface);
      scope.own(list, container);
      list.nextMatch();
      await tick();
      const events: string[] = [];
      list.on("search:change", (event) => events.push(`change:${event.matches}`));
      list.on("search:match", (event) => events.push(`match:${String(event.index)}`));
      list.insertItem({ id: 5, group: "Z", label: "show" }, 1);
      await tick();
      list.updateItem(3, { note: "shifted" });
      await tick();
      keep(`navigate/insert-rebase/${surface}`, {
        ...snapOf(list, container, events),
        lookup: lookupOf(list, 5),
        note: list.getItemAt(3)?.note ?? null,
      });
    }));
  }

  for (const mode of ["filter", "navigate"] as const) {
    for (const surface of ["plain", "table"] as const) {
      for (const where of ["front", "middle", "tail"] as const) {
        it(`updateItem/rename-${where}/${mode}/${surface}`, scoped(async (scope) => {
          const items: Row[] = [
            { id: 1, group: "A", label: "hide" },
            { id: 2, group: "B", label: "show" },
            { id: 3, group: "C", label: "hide" },
            { id: 4, group: "D", label: "show" },
            { id: 5, group: "E", label: "hide" },
          ];
          const target = where === "front" ? 1 : where === "middle" ? 3 : 5;
          const next = where === "front" ? 11 : where === "middle" ? 33 : 55;
          const { list, container } = await mountCustom(items, mode, surface);
          scope.own(list, container);
          const events: string[] = [];
          list.on("search:change", (event) => events.push(`change:${event.matches}`));
          list.on("search:match", (event) => events.push(`match:${String(event.index)}`));
          list.updateItem(target, { id: next, label: "show" });
          await tick();
          keep(`updateItem/rename-${where}/${mode}/${surface}`, {
            ...snapOf(list, container, events),
            lookup: lookupOf(list, 5),
          });
        }));
      }
    }

    it(`ungrouped/join/${mode}`, scoped(async (scope) => {
      const container = createContainer({ width: 300, height: 800 });
      const list = createVList<Row>(
        { container, items: baseRows(), item: { height: 40, template: (item) => item.label } },
        [search<Row>({ mode, field: "label" })],
      ) as Api;
      scope.own(list, container);
      await tick();
      list.setQuery("show");
      await tick();
      const events: string[] = [];
      list.on("search:change", (event) => events.push(`change:${event.matches}`));
      list.on("search:match", (event) => events.push(`match:${String(event.index)}`));
      list.updateItem(1, { label: "show" });
      await tick();
      const rendered = [...container.querySelectorAll(".vlist-item")]
        .sort((a, b) => Number(a.getAttribute("data-index")) - Number(b.getAttribute("data-index")))
        .map((el) => el.getAttribute("data-id") ?? "")
        .join(",");
      keep(`ungrouped/join/${mode}`, {
        matches: list.getMatches(),
        total: list.total,
        rendered,
        counter: container.querySelector(".vlist-search__counter")?.textContent ?? "",
        events,
        aria: (container.querySelector(".vlist") as HTMLElement).getAttribute("aria-rowcount"),
        focused: container.querySelector(".vlist-search-match--current")?.closest(".vlist-item")?.getAttribute("data-id") ?? null,
      });
    }));
  }

  it("data/sparse renames a loaded id and ignores an unloaded placeholder", scoped(async (scope) => {
    const container = createContainer({ width: 300, height: 800 });
    const list = createVList<Row>(
      { container, items: [], item: { height: 40, template: (item) => item.label } },
      [data<Row>({
        total: 80,
        adapter: {
          read: async ({ offset }) => ({
            items: offset === 0
              ? Array.from({ length: 10 }, (_, i) => ({ id: i, group: "A", label: "row" }))
              : [],
            total: 80,
          }),
        },
      })],
    );
    scope.own(list, container);
    for (let i = 0; i < 20 && list.getItemAt(0)?.id !== 0; i++) await tick();
    const placeholder = list.getItemAt(20);
    const placeholderId = placeholder?.id;
    list.updateItem(placeholderId ?? "__placeholder_20", { label: "nope" });
    await tick();
    list.updateItem(0, { id: 1000 });
    await tick();
    const detail = {
      loaded: list.getItemAt(0)?.id ?? null,
      renamedFrom: list.getIndexById(0),
      renamedTo: list.getIndexById(1000),
      placeholderId,
      placeholderAfter: list.getItemAt(20)?.id ?? null,
      placeholderIndex: list.getIndexById(placeholderId ?? ""),
      total: list.total,
    };
    if (RECORD) {
      console.log(JSON.stringify({ id: "data/sparse", detail }));
      return;
    }
    expect(detail.loaded, "sparse").toBe(1000);
    expect(detail.renamedFrom, "sparse").toBe(-1);
    expect(detail.renamedTo, "sparse").toBe(0);
    expect(String(detail.placeholderId), "sparse").toBe(`${PLACEHOLDER_ID_PREFIX}20`);
    expect(detail.placeholderAfter, "sparse").toBe(detail.placeholderId);
    expect(detail.placeholderIndex, "sparse").toBe(-1);
    expect(detail.total, "sparse").toBe(80);
  }));
});

const EXPECTED: Record<string, Snap> = {
  "updateItem/join/filter/plain/none": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 3,
    "entries": 6,
    "keys": "A:1,B:1,C:1",
    "aria": null,
    "counter": "3 results",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3",
    "focused": null,
    "events": [
      "change:3"
    ],
    "scroll": 0
  },
  "setItems/join/filter/plain/none": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 3,
    "entries": 6,
    "keys": "A:1,B:1,C:1",
    "aria": null,
    "counter": "3 results",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3",
    "focused": null,
    "events": [
      "change:3"
    ],
    "scroll": 0
  },
  "prependItems/join/filter/plain/none": {
    "matches": [
      0,
      2,
      3
    ],
    "total": 3,
    "entries": 6,
    "keys": "Z:1,B:1,C:1",
    "aria": null,
    "counter": "3 results",
    "rendered": "__group_header_0,5,__group_header_1,2,__group_header_2,3",
    "focused": null,
    "events": [
      "change:3"
    ],
    "scroll": 0
  },
  "insertItem/join/filter/plain/none": {
    "matches": [
      0,
      2,
      3
    ],
    "total": 3,
    "entries": 6,
    "keys": "Z:1,B:1,C:1",
    "aria": null,
    "counter": "3 results",
    "rendered": "__group_header_0,5,__group_header_1,2,__group_header_2,3",
    "focused": null,
    "events": [
      "change:3"
    ],
    "scroll": 0
  },
  "updateItem/join/filter/plain/group": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 3,
    "entries": 4,
    "keys": "A:1,B:1",
    "aria": null,
    "counter": "2 results",
    "rendered": "__group_header_0,1,__group_header_1,2",
    "focused": null,
    "events": [],
    "scroll": 0
  },
  "updateItem/join/filter/plain/earlier": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 3,
    "entries": 4,
    "keys": "A:1,B:1",
    "aria": null,
    "counter": "2 results",
    "rendered": "__group_header_0,1,__group_header_1,2",
    "focused": null,
    "events": [],
    "scroll": 0
  },
  "setItems/join/filter/plain/group": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 3,
    "entries": 6,
    "keys": "A:1,B:1,C:1",
    "aria": null,
    "counter": "3 results",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3",
    "focused": null,
    "events": [
      "change:3"
    ],
    "scroll": 0
  },
  "updateItem/leave/filter/plain/none": {
    "matches": [
      2
    ],
    "total": 1,
    "entries": 2,
    "keys": "C:1",
    "aria": null,
    "counter": "1 result",
    "rendered": "__group_header_0,3",
    "focused": null,
    "events": [
      "change:1"
    ],
    "scroll": 0
  },
  "setItems/leave/filter/plain/none": {
    "matches": [
      2
    ],
    "total": 1,
    "entries": 2,
    "keys": "C:1",
    "aria": null,
    "counter": "1 result",
    "rendered": "__group_header_0,3",
    "focused": null,
    "events": [
      "change:1"
    ],
    "scroll": 0
  },
  "updateItem/leave/filter/plain/group": {
    "matches": [
      2
    ],
    "total": 1,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": null,
    "counter": "1 result",
    "rendered": "__group_header_0,3,__group_header_1,3",
    "focused": null,
    "events": [
      "change:1"
    ],
    "scroll": 0
  },
  "updateItem/leave/filter/plain/earlier": {
    "matches": [
      2
    ],
    "total": 1,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": null,
    "counter": "2 results",
    "rendered": "__group_header_0,3,__group_header_1,3",
    "focused": null,
    "events": [],
    "scroll": 0
  },
  "setItems/leave/filter/plain/group": {
    "matches": [
      2
    ],
    "total": 1,
    "entries": 2,
    "keys": "C:1",
    "aria": null,
    "counter": "1 result",
    "rendered": "__group_header_0,3",
    "focused": null,
    "events": [
      "change:1"
    ],
    "scroll": 0
  },
  "updateItem/stays-in/filter/plain/none": {
    "matches": [
      1,
      2
    ],
    "total": 2,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": null,
    "counter": "2 results",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": null,
    "events": [],
    "scroll": 0
  },
  "setItems/stays-in/filter/plain/none": {
    "matches": [
      1,
      2
    ],
    "total": 2,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": null,
    "counter": "2 results",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": null,
    "events": [
      "change:2"
    ],
    "scroll": 0
  },
  "updateItem/stays-in/filter/plain/group": {
    "matches": [
      1,
      2
    ],
    "total": 2,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": null,
    "counter": "2 results",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": null,
    "events": [],
    "scroll": 0
  },
  "updateItem/stays-in/filter/plain/earlier": {
    "matches": [
      1,
      2
    ],
    "total": 2,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": null,
    "counter": "2 results",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": null,
    "events": [],
    "scroll": 0
  },
  "setItems/stays-in/filter/plain/group": {
    "matches": [
      1,
      2
    ],
    "total": 2,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": null,
    "counter": "2 results",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": null,
    "events": [
      "change:2"
    ],
    "scroll": 0
  },
  "updateItem/stays-out/filter/plain/none": {
    "matches": [
      1,
      2
    ],
    "total": 2,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": null,
    "counter": "2 results",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": null,
    "events": [],
    "scroll": 0
  },
  "setItems/stays-out/filter/plain/none": {
    "matches": [
      1,
      2
    ],
    "total": 2,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": null,
    "counter": "2 results",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": null,
    "events": [
      "change:2"
    ],
    "scroll": 0
  },
  "prependItems/stays-out/filter/plain/none": {
    "matches": [
      2,
      3
    ],
    "total": 2,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": null,
    "counter": "2 results",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": null,
    "events": [
      "change:2"
    ],
    "scroll": 0
  },
  "insertItem/stays-out/filter/plain/none": {
    "matches": [
      2,
      3
    ],
    "total": 2,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": null,
    "counter": "2 results",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": null,
    "events": [
      "change:2"
    ],
    "scroll": 0
  },
  "updateItem/stays-out/filter/plain/earlier": {
    "matches": [
      1,
      2
    ],
    "total": 2,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": null,
    "counter": "2 results",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": null,
    "events": [],
    "scroll": 0
  },
  "setItems/stays-out/filter/plain/group": {
    "matches": [
      1,
      2
    ],
    "total": 2,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": null,
    "counter": "2 results",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": null,
    "events": [
      "change:2"
    ],
    "scroll": 0
  },
  "nested/same/filter/plain/none": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 3,
    "entries": 6,
    "keys": "A:1,B:1,C:1",
    "aria": null,
    "counter": "3 results",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3",
    "focused": null,
    "events": [
      "change:3"
    ],
    "scroll": 0
  },
  "nested/same/filter/plain/group": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 3,
    "entries": 4,
    "keys": "A:1,B:1",
    "aria": null,
    "counter": "2 results",
    "rendered": "__group_header_0,1,__group_header_1,2",
    "focused": null,
    "events": [],
    "scroll": 0
  },
  "nested/same/filter/plain/earlier": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 3,
    "entries": 4,
    "keys": "A:1,B:1",
    "aria": null,
    "counter": "2 results",
    "rendered": "__group_header_0,1,__group_header_1,2",
    "focused": null,
    "events": [],
    "scroll": 0
  },
  "nested/other/filter/plain/none": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 3,
    "entries": 6,
    "keys": "A:1,B:1,C:1",
    "aria": null,
    "counter": "3 results",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3",
    "focused": null,
    "events": [
      "change:3"
    ],
    "scroll": 0
  },
  "nested/other/filter/plain/group": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 3,
    "entries": 4,
    "keys": "A:1,B:1",
    "aria": null,
    "counter": "2 results",
    "rendered": "__group_header_0,1,__group_header_1,2",
    "focused": null,
    "events": [],
    "scroll": 0
  },
  "nested/other/filter/plain/earlier": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 3,
    "entries": 4,
    "keys": "A:1,B:1",
    "aria": null,
    "counter": "2 results",
    "rendered": "__group_header_0,1,__group_header_1,2",
    "focused": null,
    "events": [],
    "scroll": 0
  },
  "nested/reversal/filter/plain/none": {
    "matches": [
      0,
      1,
      2,
      3
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "4 results",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": null,
    "events": [
      "change:4",
      "change:4"
    ],
    "scroll": 0
  },
  "nested/reversal/filter/plain/group": {
    "matches": [
      0,
      1,
      2,
      3
    ],
    "total": 4,
    "entries": 4,
    "keys": "A:1,B:1",
    "aria": null,
    "counter": "2 results",
    "rendered": "__group_header_0,1,__group_header_1,2",
    "focused": null,
    "events": [],
    "scroll": 0
  },
  "nested/reversal/filter/plain/earlier": {
    "matches": [
      0,
      1,
      2,
      3
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "4 results",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": null,
    "events": [
      "change:4"
    ],
    "scroll": 0
  },
  "nested/join-leave/filter/plain/none": {
    "matches": [
      1,
      2
    ],
    "total": 2,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": null,
    "counter": "2 results",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": null,
    "events": [
      "change:2",
      "change:2"
    ],
    "scroll": 0
  },
  "nested/join-leave/filter/plain/group": {
    "matches": [
      1,
      2
    ],
    "total": 2,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": null,
    "counter": "2 results",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": null,
    "events": [
      "change:2",
      "change:2",
      "change:2"
    ],
    "scroll": 0
  },
  "nested/join-leave/filter/plain/earlier": {
    "matches": [
      1,
      2
    ],
    "total": 2,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": null,
    "counter": "2 results",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": null,
    "events": [
      "change:2"
    ],
    "scroll": 0
  },
  "nested/match-meta/filter/plain/none": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 3,
    "entries": 6,
    "keys": "A:1,B:1,C:1",
    "aria": null,
    "counter": "3 results",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3",
    "focused": null,
    "events": [
      "change:3"
    ],
    "scroll": 0
  },
  "setItems/longer/filter/plain/none": {
    "matches": [
      1,
      2,
      4
    ],
    "total": 3,
    "entries": 6,
    "keys": "B:1,C:1,E:1",
    "aria": null,
    "counter": "3 results",
    "rendered": "__group_header_0,2,__group_header_1,3,__group_header_2,5",
    "focused": null,
    "events": [
      "change:3"
    ],
    "scroll": 0
  },
  "setItems/shorter/filter/plain/none": {
    "matches": [
      0,
      1
    ],
    "total": 2,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": null,
    "counter": "2 results",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": null,
    "events": [
      "change:2"
    ],
    "scroll": 0
  },
  "updateItem/rekey/filter/plain/none": {
    "matches": [
      1,
      2
    ],
    "total": 2,
    "entries": 4,
    "keys": "Z:1,C:1",
    "aria": null,
    "counter": "2 results",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": null,
    "events": [],
    "scroll": 0
  },
  "insertItem/join@2/filter/plain/none": {
    "matches": [
      1,
      2,
      3
    ],
    "total": 3,
    "entries": 6,
    "keys": "B:1,Z:1,C:1",
    "aria": null,
    "counter": "3 results",
    "rendered": "__group_header_0,2,__group_header_1,5,__group_header_2,3",
    "focused": null,
    "events": [
      "change:3"
    ],
    "scroll": 0
  },
  "insertItem/join@4/filter/plain/none": {
    "matches": [
      1,
      2,
      4
    ],
    "total": 3,
    "entries": 6,
    "keys": "B:1,C:1,Z:1",
    "aria": null,
    "counter": "3 results",
    "rendered": "__group_header_0,2,__group_header_1,3,__group_header_2,5",
    "focused": null,
    "events": [
      "change:3"
    ],
    "scroll": 0
  },
  "insertItem/stays-out@2/filter/plain/none": {
    "matches": [
      1,
      3
    ],
    "total": 2,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": null,
    "counter": "2 results",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": null,
    "events": [
      "change:2"
    ],
    "scroll": 0
  },
  "insertItem/stays-out@4/filter/plain/none": {
    "matches": [
      1,
      2
    ],
    "total": 2,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": null,
    "counter": "2 results",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": null,
    "events": [
      "change:2"
    ],
    "scroll": 0
  },
  "updateItem/join/filter/table/none": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 3,
    "entries": 6,
    "keys": "A:1,B:1,C:1",
    "aria": "7",
    "counter": "3 results",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3",
    "focused": null,
    "events": [
      "change:3"
    ],
    "scroll": 0
  },
  "setItems/join/filter/table/none": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 3,
    "entries": 6,
    "keys": "A:1,B:1,C:1",
    "aria": "7",
    "counter": "3 results",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3",
    "focused": null,
    "events": [
      "change:3"
    ],
    "scroll": 0
  },
  "prependItems/join/filter/table/none": {
    "matches": [
      0,
      2,
      3
    ],
    "total": 3,
    "entries": 6,
    "keys": "Z:1,B:1,C:1",
    "aria": "7",
    "counter": "3 results",
    "rendered": "__group_header_0,5,__group_header_1,2,__group_header_2,3",
    "focused": null,
    "events": [
      "change:3"
    ],
    "scroll": 0
  },
  "insertItem/join/filter/table/none": {
    "matches": [
      0,
      2,
      3
    ],
    "total": 3,
    "entries": 6,
    "keys": "Z:1,B:1,C:1",
    "aria": "7",
    "counter": "3 results",
    "rendered": "__group_header_0,5,__group_header_1,2,__group_header_2,3",
    "focused": null,
    "events": [
      "change:3"
    ],
    "scroll": 0
  },
  "updateItem/join/filter/table/group": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 3,
    "entries": 4,
    "keys": "A:1,B:1",
    "aria": "5",
    "counter": "2 results",
    "rendered": "__group_header_0,1,__group_header_1,2",
    "focused": null,
    "events": [],
    "scroll": 0
  },
  "updateItem/join/filter/table/earlier": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 3,
    "entries": 4,
    "keys": "A:1,B:1",
    "aria": "5",
    "counter": "2 results",
    "rendered": "__group_header_0,1,__group_header_1,2",
    "focused": null,
    "events": [],
    "scroll": 0
  },
  "setItems/join/filter/table/group": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 3,
    "entries": 6,
    "keys": "A:1,B:1,C:1",
    "aria": "7",
    "counter": "3 results",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3",
    "focused": null,
    "events": [
      "change:3"
    ],
    "scroll": 0
  },
  "updateItem/leave/filter/table/none": {
    "matches": [
      2
    ],
    "total": 1,
    "entries": 2,
    "keys": "C:1",
    "aria": "3",
    "counter": "1 result",
    "rendered": "__group_header_0,3",
    "focused": null,
    "events": [
      "change:1"
    ],
    "scroll": 0
  },
  "setItems/leave/filter/table/none": {
    "matches": [
      2
    ],
    "total": 1,
    "entries": 2,
    "keys": "C:1",
    "aria": "3",
    "counter": "1 result",
    "rendered": "__group_header_0,3",
    "focused": null,
    "events": [
      "change:1"
    ],
    "scroll": 0
  },
  "updateItem/leave/filter/table/group": {
    "matches": [
      2
    ],
    "total": 1,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": "2",
    "counter": "2 results",
    "rendered": "__group_header_0",
    "focused": null,
    "events": [],
    "scroll": 0
  },
  "updateItem/leave/filter/table/earlier": {
    "matches": [
      2
    ],
    "total": 1,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": "5",
    "counter": "2 results",
    "rendered": "__group_header_0,3,__group_header_1,3",
    "focused": null,
    "events": [],
    "scroll": 0
  },
  "setItems/leave/filter/table/group": {
    "matches": [
      2
    ],
    "total": 1,
    "entries": 2,
    "keys": "C:1",
    "aria": "3",
    "counter": "1 result",
    "rendered": "__group_header_0,3",
    "focused": null,
    "events": [
      "change:1"
    ],
    "scroll": 0
  },
  "updateItem/stays-in/filter/table/none": {
    "matches": [
      1,
      2
    ],
    "total": 2,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": "5",
    "counter": "2 results",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": null,
    "events": [],
    "scroll": 0
  },
  "setItems/stays-in/filter/table/none": {
    "matches": [
      1,
      2
    ],
    "total": 2,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": "5",
    "counter": "2 results",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": null,
    "events": [
      "change:2"
    ],
    "scroll": 0
  },
  "updateItem/stays-in/filter/table/group": {
    "matches": [
      1,
      2
    ],
    "total": 2,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": "5",
    "counter": "2 results",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": null,
    "events": [],
    "scroll": 0
  },
  "updateItem/stays-in/filter/table/earlier": {
    "matches": [
      1,
      2
    ],
    "total": 2,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": "5",
    "counter": "2 results",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": null,
    "events": [],
    "scroll": 0
  },
  "setItems/stays-in/filter/table/group": {
    "matches": [
      1,
      2
    ],
    "total": 2,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": "5",
    "counter": "2 results",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": null,
    "events": [
      "change:2"
    ],
    "scroll": 0
  },
  "updateItem/stays-out/filter/table/none": {
    "matches": [
      1,
      2
    ],
    "total": 2,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": "5",
    "counter": "2 results",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": null,
    "events": [],
    "scroll": 0
  },
  "setItems/stays-out/filter/table/none": {
    "matches": [
      1,
      2
    ],
    "total": 2,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": "5",
    "counter": "2 results",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": null,
    "events": [
      "change:2"
    ],
    "scroll": 0
  },
  "prependItems/stays-out/filter/table/none": {
    "matches": [
      2,
      3
    ],
    "total": 2,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": "5",
    "counter": "2 results",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": null,
    "events": [
      "change:2"
    ],
    "scroll": 0
  },
  "insertItem/stays-out/filter/table/none": {
    "matches": [
      2,
      3
    ],
    "total": 2,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": "5",
    "counter": "2 results",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": null,
    "events": [
      "change:2"
    ],
    "scroll": 0
  },
  "updateItem/stays-out/filter/table/earlier": {
    "matches": [
      1,
      2
    ],
    "total": 2,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": "5",
    "counter": "2 results",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": null,
    "events": [],
    "scroll": 0
  },
  "setItems/stays-out/filter/table/group": {
    "matches": [
      1,
      2
    ],
    "total": 2,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": "5",
    "counter": "2 results",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": null,
    "events": [
      "change:2"
    ],
    "scroll": 0
  },
  "nested/same/filter/table/none": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 3,
    "entries": 6,
    "keys": "A:1,B:1,C:1",
    "aria": "7",
    "counter": "3 results",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3",
    "focused": null,
    "events": [
      "change:3"
    ],
    "scroll": 0
  },
  "nested/same/filter/table/group": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 3,
    "entries": 4,
    "keys": "A:1,B:1",
    "aria": "5",
    "counter": "2 results",
    "rendered": "__group_header_0,1,__group_header_1,2",
    "focused": null,
    "events": [],
    "scroll": 0
  },
  "nested/same/filter/table/earlier": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 3,
    "entries": 4,
    "keys": "A:1,B:1",
    "aria": "5",
    "counter": "2 results",
    "rendered": "__group_header_0,1,__group_header_1,2",
    "focused": null,
    "events": [],
    "scroll": 0
  },
  "nested/other/filter/table/none": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 3,
    "entries": 6,
    "keys": "A:1,B:1,C:1",
    "aria": "7",
    "counter": "3 results",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3",
    "focused": null,
    "events": [
      "change:3"
    ],
    "scroll": 0
  },
  "nested/other/filter/table/group": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 3,
    "entries": 4,
    "keys": "A:1,B:1",
    "aria": "5",
    "counter": "2 results",
    "rendered": "__group_header_0,1,__group_header_1,2",
    "focused": null,
    "events": [],
    "scroll": 0
  },
  "nested/other/filter/table/earlier": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 3,
    "entries": 4,
    "keys": "A:1,B:1",
    "aria": "5",
    "counter": "2 results",
    "rendered": "__group_header_0,1,__group_header_1,2",
    "focused": null,
    "events": [],
    "scroll": 0
  },
  "nested/reversal/filter/table/none": {
    "matches": [
      0,
      1,
      2,
      3
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "4 results",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": null,
    "events": [
      "change:4",
      "change:4"
    ],
    "scroll": 0
  },
  "nested/reversal/filter/table/group": {
    "matches": [
      0,
      1,
      2,
      3
    ],
    "total": 4,
    "entries": 4,
    "keys": "A:1,B:1",
    "aria": "5",
    "counter": "2 results",
    "rendered": "__group_header_0,1,__group_header_1,2",
    "focused": null,
    "events": [],
    "scroll": 0
  },
  "nested/reversal/filter/table/earlier": {
    "matches": [
      0,
      1,
      2,
      3
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "4 results",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": null,
    "events": [
      "change:4"
    ],
    "scroll": 0
  },
  "nested/join-leave/filter/table/none": {
    "matches": [
      1,
      2
    ],
    "total": 2,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": "5",
    "counter": "2 results",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": null,
    "events": [
      "change:2",
      "change:2"
    ],
    "scroll": 0
  },
  "nested/join-leave/filter/table/group": {
    "matches": [
      1,
      2
    ],
    "total": 2,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": "5",
    "counter": "2 results",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": null,
    "events": [
      "change:2",
      "change:2"
    ],
    "scroll": 0
  },
  "nested/join-leave/filter/table/earlier": {
    "matches": [
      1,
      2
    ],
    "total": 2,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": "5",
    "counter": "2 results",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": null,
    "events": [
      "change:2"
    ],
    "scroll": 0
  },
  "nested/match-meta/filter/table/none": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 3,
    "entries": 6,
    "keys": "A:1,B:1,C:1",
    "aria": "7",
    "counter": "3 results",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3",
    "focused": null,
    "events": [
      "change:3"
    ],
    "scroll": 0
  },
  "setItems/longer/filter/table/none": {
    "matches": [
      1,
      2,
      4
    ],
    "total": 3,
    "entries": 6,
    "keys": "B:1,C:1,E:1",
    "aria": "7",
    "counter": "3 results",
    "rendered": "__group_header_0,2,__group_header_1,3,__group_header_2,5",
    "focused": null,
    "events": [
      "change:3"
    ],
    "scroll": 0
  },
  "setItems/shorter/filter/table/none": {
    "matches": [
      0,
      1
    ],
    "total": 2,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": "5",
    "counter": "2 results",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": null,
    "events": [
      "change:2"
    ],
    "scroll": 0
  },
  "updateItem/rekey/filter/table/none": {
    "matches": [
      1,
      2
    ],
    "total": 2,
    "entries": 4,
    "keys": "Z:1,C:1",
    "aria": "5",
    "counter": "2 results",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": null,
    "events": [],
    "scroll": 0
  },
  "insertItem/join@2/filter/table/none": {
    "matches": [
      1,
      2,
      3
    ],
    "total": 3,
    "entries": 6,
    "keys": "B:1,Z:1,C:1",
    "aria": "7",
    "counter": "3 results",
    "rendered": "__group_header_0,2,__group_header_1,5,__group_header_2,3",
    "focused": null,
    "events": [
      "change:3"
    ],
    "scroll": 0
  },
  "insertItem/join@4/filter/table/none": {
    "matches": [
      1,
      2,
      4
    ],
    "total": 3,
    "entries": 6,
    "keys": "B:1,C:1,Z:1",
    "aria": "7",
    "counter": "3 results",
    "rendered": "__group_header_0,2,__group_header_1,3,__group_header_2,5",
    "focused": null,
    "events": [
      "change:3"
    ],
    "scroll": 0
  },
  "insertItem/stays-out@2/filter/table/none": {
    "matches": [
      1,
      3
    ],
    "total": 2,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": "5",
    "counter": "2 results",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": null,
    "events": [
      "change:2"
    ],
    "scroll": 0
  },
  "insertItem/stays-out@4/filter/table/none": {
    "matches": [
      1,
      2
    ],
    "total": 2,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": "5",
    "counter": "2 results",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": null,
    "events": [
      "change:2"
    ],
    "scroll": 0
  },
  "updateItem/join/navigate/plain/none": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "2 of 3",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [
      "change:3"
    ],
    "scroll": 0
  },
  "setItems/join/navigate/plain/none": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 3",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "1",
    "events": [
      "match:0",
      "change:3"
    ],
    "scroll": 0
  },
  "prependItems/join/navigate/plain/none": {
    "matches": [
      0,
      2,
      3
    ],
    "total": 5,
    "entries": 10,
    "keys": "Z:1,A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 3",
    "rendered": "__group_header_0,5,__group_header_1,1,__group_header_2,2,__group_header_3,3,__group_header_4,4",
    "focused": "5",
    "events": [
      "match:0",
      "change:3"
    ],
    "scroll": 0
  },
  "insertItem/join/navigate/plain/none": {
    "matches": [
      0,
      2,
      3
    ],
    "total": 5,
    "entries": 10,
    "keys": "Z:1,A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 3",
    "rendered": "__group_header_0,5,__group_header_1,1,__group_header_2,2,__group_header_3,3,__group_header_4,4",
    "focused": "5",
    "events": [
      "match:0",
      "change:3"
    ],
    "scroll": 0
  },
  "updateItem/join/navigate/plain/group": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [],
    "scroll": 0
  },
  "updateItem/join/navigate/plain/earlier": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [],
    "scroll": 0
  },
  "setItems/join/navigate/plain/group": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 3",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "1",
    "events": [
      "match:0",
      "change:3"
    ],
    "scroll": 0
  },
  "updateItem/leave/navigate/plain/none": {
    "matches": [
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 1",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "3",
    "events": [
      "match:2",
      "change:1"
    ],
    "scroll": 0
  },
  "setItems/leave/navigate/plain/none": {
    "matches": [
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 1",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "3",
    "events": [
      "match:2",
      "change:1"
    ],
    "scroll": 0
  },
  "updateItem/leave/navigate/plain/group": {
    "matches": [
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "3",
    "events": [],
    "scroll": 0
  },
  "updateItem/leave/navigate/plain/earlier": {
    "matches": [
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "3",
    "events": [],
    "scroll": 0
  },
  "setItems/leave/navigate/plain/group": {
    "matches": [
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 1",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "3",
    "events": [
      "match:2",
      "change:1"
    ],
    "scroll": 0
  },
  "updateItem/stays-in/navigate/plain/none": {
    "matches": [
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [],
    "scroll": 0
  },
  "setItems/stays-in/navigate/plain/none": {
    "matches": [
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [
      "match:1",
      "change:2"
    ],
    "scroll": 0
  },
  "updateItem/stays-in/navigate/plain/group": {
    "matches": [
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [],
    "scroll": 0
  },
  "updateItem/stays-in/navigate/plain/earlier": {
    "matches": [
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [],
    "scroll": 0
  },
  "setItems/stays-in/navigate/plain/group": {
    "matches": [
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [
      "match:1",
      "change:2"
    ],
    "scroll": 0
  },
  "updateItem/stays-out/navigate/plain/none": {
    "matches": [
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [],
    "scroll": 0
  },
  "setItems/stays-out/navigate/plain/none": {
    "matches": [
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [
      "match:1",
      "change:2"
    ],
    "scroll": 0
  },
  "prependItems/stays-out/navigate/plain/none": {
    "matches": [
      2,
      3
    ],
    "total": 5,
    "entries": 10,
    "keys": "Z:1,A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 2",
    "rendered": "__group_header_0,5,__group_header_1,1,__group_header_2,2,__group_header_3,3,__group_header_4,4",
    "focused": "2",
    "events": [
      "match:2",
      "change:2"
    ],
    "scroll": 0
  },
  "insertItem/stays-out/navigate/plain/none": {
    "matches": [
      2,
      3
    ],
    "total": 5,
    "entries": 10,
    "keys": "Z:1,A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 2",
    "rendered": "__group_header_0,5,__group_header_1,1,__group_header_2,2,__group_header_3,3,__group_header_4,4",
    "focused": "2",
    "events": [
      "match:2",
      "change:2"
    ],
    "scroll": 0
  },
  "updateItem/stays-out/navigate/plain/earlier": {
    "matches": [
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [],
    "scroll": 0
  },
  "setItems/stays-out/navigate/plain/group": {
    "matches": [
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [
      "match:1",
      "change:2"
    ],
    "scroll": 0
  },
  "nested/same/navigate/plain/none": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "2 of 3",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [
      "change:3"
    ],
    "scroll": 0
  },
  "nested/same/navigate/plain/group": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [],
    "scroll": 0
  },
  "nested/same/navigate/plain/earlier": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [],
    "scroll": 0
  },
  "nested/other/navigate/plain/none": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "2 of 3",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [
      "change:3"
    ],
    "scroll": 0
  },
  "nested/other/navigate/plain/group": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [],
    "scroll": 0
  },
  "nested/other/navigate/plain/earlier": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [],
    "scroll": 0
  },
  "nested/reversal/navigate/plain/none": {
    "matches": [
      0,
      1,
      2,
      3
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "2 of 4",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [
      "change:4",
      "change:4"
    ],
    "scroll": 0
  },
  "nested/reversal/navigate/plain/group": {
    "matches": [
      0,
      1,
      2,
      3
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [],
    "scroll": 0
  },
  "nested/reversal/navigate/plain/earlier": {
    "matches": [
      0,
      1,
      2,
      3
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "2 of 4",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [
      "change:4"
    ],
    "scroll": 0
  },
  "nested/join-leave/navigate/plain/none": {
    "matches": [
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [
      "change:2",
      "change:2"
    ],
    "scroll": 0
  },
  "nested/join-leave/navigate/plain/group": {
    "matches": [
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [
      "change:2",
      "change:2"
    ],
    "scroll": 0
  },
  "nested/join-leave/navigate/plain/earlier": {
    "matches": [
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [
      "change:2"
    ],
    "scroll": 0
  },
  "nested/match-meta/navigate/plain/none": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "2 of 3",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [
      "change:3"
    ],
    "scroll": 0
  },
  "setItems/longer/navigate/plain/none": {
    "matches": [
      1,
      2,
      4
    ],
    "total": 6,
    "entries": 12,
    "keys": "A:1,B:1,C:1,D:1,E:1,F:1",
    "aria": null,
    "counter": "1 of 3",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4,__group_header_4,5,__group_header_5,6",
    "focused": "2",
    "events": [
      "match:1",
      "change:3"
    ],
    "scroll": 0
  },
  "setItems/shorter/navigate/plain/none": {
    "matches": [
      0,
      1
    ],
    "total": 2,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": null,
    "counter": "1 of 2",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": "2",
    "events": [
      "match:0",
      "change:2"
    ],
    "scroll": 0
  },
  "updateItem/rekey/navigate/plain/none": {
    "matches": [
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,Z:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [],
    "scroll": 0
  },
  "insertItem/join@2/navigate/plain/none": {
    "matches": [
      1,
      2,
      3
    ],
    "total": 5,
    "entries": 10,
    "keys": "A:1,B:1,Z:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 3",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,5,__group_header_3,3,__group_header_4,4",
    "focused": "2",
    "events": [
      "match:1",
      "change:3"
    ],
    "scroll": 0
  },
  "insertItem/join@4/navigate/plain/none": {
    "matches": [
      1,
      2,
      4
    ],
    "total": 5,
    "entries": 10,
    "keys": "A:1,B:1,C:1,D:1,Z:1",
    "aria": null,
    "counter": "1 of 3",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4,__group_header_4,5",
    "focused": "2",
    "events": [
      "match:1",
      "change:3"
    ],
    "scroll": 0
  },
  "insertItem/stays-out@2/navigate/plain/none": {
    "matches": [
      1,
      3
    ],
    "total": 5,
    "entries": 10,
    "keys": "A:1,B:1,Z:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,5,__group_header_3,3,__group_header_4,4",
    "focused": "2",
    "events": [
      "match:1",
      "change:2"
    ],
    "scroll": 0
  },
  "insertItem/stays-out@4/navigate/plain/none": {
    "matches": [
      1,
      2
    ],
    "total": 5,
    "entries": 10,
    "keys": "A:1,B:1,C:1,D:1,Z:1",
    "aria": null,
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4,__group_header_4,5",
    "focused": "2",
    "events": [
      "match:1",
      "change:2"
    ],
    "scroll": 0
  },
  "updateItem/join/navigate/table/none": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "2 of 3",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [
      "change:3"
    ],
    "scroll": 0
  },
  "setItems/join/navigate/table/none": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "1 of 3",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "1",
    "events": [
      "match:0",
      "change:3"
    ],
    "scroll": 0
  },
  "prependItems/join/navigate/table/none": {
    "matches": [
      0,
      2,
      3
    ],
    "total": 5,
    "entries": 10,
    "keys": "Z:1,A:1,B:1,C:1,D:1",
    "aria": "11",
    "counter": "1 of 3",
    "rendered": "__group_header_0,5,__group_header_1,1,__group_header_2,2,__group_header_3,3,__group_header_4,4",
    "focused": "5",
    "events": [
      "match:0",
      "change:3"
    ],
    "scroll": 0
  },
  "insertItem/join/navigate/table/none": {
    "matches": [
      0,
      2,
      3
    ],
    "total": 5,
    "entries": 10,
    "keys": "Z:1,A:1,B:1,C:1,D:1",
    "aria": "11",
    "counter": "1 of 3",
    "rendered": "__group_header_0,5,__group_header_1,1,__group_header_2,2,__group_header_3,3,__group_header_4,4",
    "focused": "5",
    "events": [
      "match:0",
      "change:3"
    ],
    "scroll": 0
  },
  "updateItem/join/navigate/table/group": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [],
    "scroll": 0
  },
  "updateItem/join/navigate/table/earlier": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [],
    "scroll": 0
  },
  "setItems/join/navigate/table/group": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "1 of 3",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "1",
    "events": [
      "match:0",
      "change:3"
    ],
    "scroll": 0
  },
  "updateItem/leave/navigate/table/none": {
    "matches": [
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "1 of 1",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "3",
    "events": [
      "match:2",
      "change:1"
    ],
    "scroll": 0
  },
  "setItems/leave/navigate/table/none": {
    "matches": [
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "1 of 1",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "3",
    "events": [
      "match:2",
      "change:1"
    ],
    "scroll": 0
  },
  "updateItem/leave/navigate/table/group": {
    "matches": [
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "3",
    "events": [],
    "scroll": 0
  },
  "updateItem/leave/navigate/table/earlier": {
    "matches": [
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "3",
    "events": [],
    "scroll": 0
  },
  "setItems/leave/navigate/table/group": {
    "matches": [
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "1 of 1",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "3",
    "events": [
      "match:2",
      "change:1"
    ],
    "scroll": 0
  },
  "updateItem/stays-in/navigate/table/none": {
    "matches": [
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [],
    "scroll": 0
  },
  "setItems/stays-in/navigate/table/none": {
    "matches": [
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [
      "match:1",
      "change:2"
    ],
    "scroll": 0
  },
  "updateItem/stays-in/navigate/table/group": {
    "matches": [
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [],
    "scroll": 0
  },
  "updateItem/stays-in/navigate/table/earlier": {
    "matches": [
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [],
    "scroll": 0
  },
  "setItems/stays-in/navigate/table/group": {
    "matches": [
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [
      "match:1",
      "change:2"
    ],
    "scroll": 0
  },
  "updateItem/stays-out/navigate/table/none": {
    "matches": [
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [],
    "scroll": 0
  },
  "setItems/stays-out/navigate/table/none": {
    "matches": [
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [
      "match:1",
      "change:2"
    ],
    "scroll": 0
  },
  "prependItems/stays-out/navigate/table/none": {
    "matches": [
      2,
      3
    ],
    "total": 5,
    "entries": 10,
    "keys": "Z:1,A:1,B:1,C:1,D:1",
    "aria": "11",
    "counter": "1 of 2",
    "rendered": "__group_header_0,5,__group_header_1,1,__group_header_2,2,__group_header_3,3,__group_header_4,4",
    "focused": "2",
    "events": [
      "match:2",
      "change:2"
    ],
    "scroll": 0
  },
  "insertItem/stays-out/navigate/table/none": {
    "matches": [
      2,
      3
    ],
    "total": 5,
    "entries": 10,
    "keys": "Z:1,A:1,B:1,C:1,D:1",
    "aria": "11",
    "counter": "1 of 2",
    "rendered": "__group_header_0,5,__group_header_1,1,__group_header_2,2,__group_header_3,3,__group_header_4,4",
    "focused": "2",
    "events": [
      "match:2",
      "change:2"
    ],
    "scroll": 0
  },
  "updateItem/stays-out/navigate/table/earlier": {
    "matches": [
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [],
    "scroll": 0
  },
  "setItems/stays-out/navigate/table/group": {
    "matches": [
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [
      "match:1",
      "change:2"
    ],
    "scroll": 0
  },
  "nested/same/navigate/table/none": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "2 of 3",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [
      "change:3"
    ],
    "scroll": 0
  },
  "nested/same/navigate/table/group": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [],
    "scroll": 0
  },
  "nested/same/navigate/table/earlier": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [],
    "scroll": 0
  },
  "nested/other/navigate/table/none": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "2 of 3",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [
      "change:3"
    ],
    "scroll": 0
  },
  "nested/other/navigate/table/group": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [],
    "scroll": 0
  },
  "nested/other/navigate/table/earlier": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [],
    "scroll": 0
  },
  "nested/reversal/navigate/table/none": {
    "matches": [
      0,
      1,
      2,
      3
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "2 of 4",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [
      "change:4",
      "change:4"
    ],
    "scroll": 0
  },
  "nested/reversal/navigate/table/group": {
    "matches": [
      0,
      1,
      2,
      3
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [],
    "scroll": 0
  },
  "nested/reversal/navigate/table/earlier": {
    "matches": [
      0,
      1,
      2,
      3
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "2 of 4",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [
      "change:4"
    ],
    "scroll": 0
  },
  "nested/join-leave/navigate/table/none": {
    "matches": [
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [
      "change:2",
      "change:2"
    ],
    "scroll": 0
  },
  "nested/join-leave/navigate/table/group": {
    "matches": [
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [
      "change:2",
      "change:2"
    ],
    "scroll": 0
  },
  "nested/join-leave/navigate/table/earlier": {
    "matches": [
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [
      "change:2"
    ],
    "scroll": 0
  },
  "nested/match-meta/navigate/table/none": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "2 of 3",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [
      "change:3"
    ],
    "scroll": 0
  },
  "setItems/longer/navigate/table/none": {
    "matches": [
      1,
      2,
      4
    ],
    "total": 6,
    "entries": 12,
    "keys": "A:1,B:1,C:1,D:1,E:1,F:1",
    "aria": "13",
    "counter": "1 of 3",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4,__group_header_4,5,__group_header_5,6",
    "focused": "2",
    "events": [
      "match:1",
      "change:3"
    ],
    "scroll": 0
  },
  "setItems/shorter/navigate/table/none": {
    "matches": [
      0,
      1
    ],
    "total": 2,
    "entries": 4,
    "keys": "B:1,C:1",
    "aria": "5",
    "counter": "1 of 2",
    "rendered": "__group_header_0,2,__group_header_1,3",
    "focused": "2",
    "events": [
      "match:0",
      "change:2"
    ],
    "scroll": 0
  },
  "updateItem/rekey/navigate/table/none": {
    "matches": [
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,Z:1,C:1,D:1",
    "aria": "9",
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [],
    "scroll": 0
  },
  "insertItem/join@2/navigate/table/none": {
    "matches": [
      1,
      2,
      3
    ],
    "total": 5,
    "entries": 10,
    "keys": "A:1,B:1,Z:1,C:1,D:1",
    "aria": "11",
    "counter": "1 of 3",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,5,__group_header_3,3,__group_header_4,4",
    "focused": "2",
    "events": [
      "match:1",
      "change:3"
    ],
    "scroll": 0
  },
  "insertItem/join@4/navigate/table/none": {
    "matches": [
      1,
      2,
      4
    ],
    "total": 5,
    "entries": 10,
    "keys": "A:1,B:1,C:1,D:1,Z:1",
    "aria": "11",
    "counter": "1 of 3",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4,__group_header_4,5",
    "focused": "2",
    "events": [
      "match:1",
      "change:3"
    ],
    "scroll": 0
  },
  "insertItem/stays-out@2/navigate/table/none": {
    "matches": [
      1,
      3
    ],
    "total": 5,
    "entries": 10,
    "keys": "A:1,B:1,Z:1,C:1,D:1",
    "aria": "11",
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,5,__group_header_3,3,__group_header_4,4",
    "focused": "2",
    "events": [
      "match:1",
      "change:2"
    ],
    "scroll": 0
  },
  "insertItem/stays-out@4/navigate/table/none": {
    "matches": [
      1,
      2
    ],
    "total": 5,
    "entries": 10,
    "keys": "A:1,B:1,C:1,D:1,Z:1",
    "aria": "11",
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4,__group_header_4,5",
    "focused": "2",
    "events": [
      "match:1",
      "change:2"
    ],
    "scroll": 0
  },
  "updateItem/join/filter/plain/unrelated": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 3,
    "entries": 4,
    "keys": "A:1,B:1",
    "aria": null,
    "counter": "2 results",
    "rendered": "__group_header_0,1,__group_header_1,2",
    "focused": null,
    "events": [],
    "scroll": 0
  },
  "updateItem/join/filter/table/unrelated": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 3,
    "entries": 4,
    "keys": "A:1,B:1",
    "aria": "5",
    "counter": "2 results",
    "rendered": "__group_header_0,1,__group_header_1,2",
    "focused": null,
    "events": [],
    "scroll": 0
  },
  "updateItem/join/navigate/plain/unrelated": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": null,
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [],
    "scroll": 0
  },
  "updateItem/join/navigate/table/unrelated": {
    "matches": [
      0,
      1,
      2
    ],
    "total": 4,
    "entries": 8,
    "keys": "A:1,B:1,C:1,D:1",
    "aria": "9",
    "counter": "1 of 2",
    "rendered": "__group_header_0,1,__group_header_1,2,__group_header_2,3,__group_header_3,4",
    "focused": "2",
    "events": [],
    "scroll": 0
  }
};

const FIRST_MATCH: Record<"plain" | "table", { events: string[]; scroll: number }> = {
  "plain": {
    "events": [
      "match:20",
      "change:1"
    ],
    "scroll": 72
  },
  "table": {
    "events": [
      "match:20",
      "change:1"
    ],
    "scroll": 72
  }
};
