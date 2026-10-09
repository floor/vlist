import type { VListItem } from "../../types";
import type { PluginContext } from "../../core/types";

/** Only focus owners import this: removal recovery costs no core/layout bytes. */
export function retainFocus<T extends VListItem>(ctx: PluginContext<T>, blur: () => void): () => boolean {
  const { dom } = ctx;
  const doc = dom.root.ownerDocument;
  let focused: Node | null = null;
  let restoring = false;

  // A microtask leaves the removal stack before rendering, but repairs focus
  // before paint. Mutation records also cover engines that emit no focusout,
  // and a focused row node that is detached and recycled in the same pass.
  const finish = (records: MutationRecord[]): void => {
    if (!focused || doc.activeElement === focused) return;
    let removed = !focused.isConnected;
    for (let i = 0; !removed && i < records.length; i++) {
      const nodes = records[i]!.removedNodes;
      for (let j = 0; !removed && j < nodes.length; j++) removed = nodes[j]!.contains(focused);
    }
    focused = null;
    observer.disconnect();
    if (ctx.getState().destroyed || !dom.root.isConnected || doc.activeElement !== doc.body) return;
    if (removed) {
      restoring = true;
      // The first of content, root, viewport that carries a tabindex. In a
      // table the content is a rowgroup without one and the root is the grid
      // the focus owner's own click path focuses, so with selection() or
      // a11y() recovery lands there (#339, #352); a table with no focus owner
      // leaves the root untabbable, so the viewport stays the fallback.
      const target = dom.content.hasAttribute("tabindex")
        ? dom.content
        : dom.root.hasAttribute("tabindex")
          ? dom.root
          : dom.viewport;
      target.focus({ preventScroll: true });
      restoring = false;
    }
    blur();
  };
  const observer = new MutationObserver(finish);
  const flush = (): void => finish(observer.takeRecords());
  const onFocusIn = (event: FocusEvent): void => {
    focused = event.target as Node;
    observer.disconnect();
    if (focused !== dom.content && dom.content.contains(focused)) {
      observer.observe(dom.content, { childList: true, subtree: true });
    }
  };
  const onFocusOut = (event: FocusEvent): void => {
    const next = event.relatedTarget as Node | null;
    if (next && dom.root.contains(next)) return;
    if (!next) {
      // Chromium dispatches this while the target is still connected.
      queueMicrotask(flush);
      return;
    }
    focused = null;
    observer.disconnect();
    blur();
  };
  dom.root.addEventListener("focusin", onFocusIn);
  dom.root.addEventListener("focusout", onFocusOut);
  ctx.hooks.onDestroy(() => {
    focused = null;
    observer.disconnect();
    dom.root.removeEventListener("focusin", onFocusIn);
    dom.root.removeEventListener("focusout", onFocusOut);
  });
  return () => restoring;
}
