<script>
  import { onMount } from "svelte";
  import { createVList } from "vlist";

  let host;

  onMount(() => {
    const list = createVList({
      container: host,
      items: [
        { id: 1, name: "One" },
        { id: 2, name: "Two" },
        { id: 3, name: "Three" },
      ],
      item: {
        height: 48,
        template: (item) => `<div>${item.name}</div>`,
      },
    });
    return () => list.destroy();
  });
</script>

<div bind:this={host} style="height: 240px"></div>
