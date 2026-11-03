# Select inside Modal: popup list is hidden under the modal and clicks fall through to the overlay

**Package:** `@tarve/core` 0.9.0 · Windows 11 x64 · Bun 1.4 · default renderer

## Summary

A `<Select>` rendered inside a `<Modal>` opens (its `${id}-popup` node exists in `inspect()` with the right rect, just below the trigger), but the list is **not painted** and **does not receive pointer input**: it stays under the modal overlay.

- With `closeOnOverlay` (the default), clicking where an option should be **closes the modal** (`onOpenChange(false)`), and `onValueChange` never fires.
- With `closeOnOverlay={false}`, the click does nothing; the value never changes.

The same `<Select>` outside a modal works.

## Repro (TestRenderer)

```tsx
import { createTestRenderer, Window, Column, Text, Select, Modal } from "@tarve/core";

const opts = [{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }, { value: "c", label: "Gamma" }];
let value = "a", open = true;
const log: string[] = [];

const r = await createTestRenderer(() => (
  <Window title="repro" width={700} height={500}>
    <Column padding={20}><Text>value={value}</Text></Column>
    <Modal open={open} title="M" onOpenChange={(o) => { log.push("modal:" + o); open = o; }}>
      <Select id="s" value={value} options={opts} onValueChange={(v) => { log.push("value:" + v); value = v; }} />
    </Modal>
  </Window>
), { headless: true });

await r.waitForIdle();
await r.getById("s-trigger").click();
await r.waitForIdle();
console.log("popup nodes:", await r.getById("s-popup").count()); // 1, rect below the trigger
await r.capture("open.png");                                     // no list visible
await r.getById("s-option-c").click();
await r.waitForIdle();
console.log(log, { value, open });
```

**Expected:** `["value:c"]`, `{ value: "c", open: true }`, and the list is visible in `open.png`.
**Actual:** `["modal:false"]`, `{ value: "a", open: false }`, and `open.png` shows only the modal.

## Cause (from `dist/npm/index.js`)

- `Select` renders its list as `Scroll { portal: true, dismissOnOutside: true }` **without a `zIndex`**.
- `Modal` is itself a `Pressable { portal: true }` overlay (`onClick: close`) with no `zIndex`.
- The nested portal is stacked under the modal's portal, so hit-testing goes to the overlay.
- Unlike `Select`, `Popover`, `DropdownMenu`, `Tooltip` and the menus give their popup `zIndex: POPUP_Z_INDEX + 1` (`popups.ts`). Giving the Select popup the same `zIndex` in user land is **not** enough; nested portals still paint and hit-test under the parent modal portal.

## Workaround

Render the list **without** `portal` (an absolute child, with the Select root at `zIndex: 1000` while it is open). It then paints above the modal panel's later siblings and receives clicks. In Vela this is `src/ui/select.tsx` (`<Select inline …/>`).

## Suggested fix

1. Nested portals should stack above their ancestor portal (paint and hit-test in tree order), or
2. `Select`/`NativeSelect` should use the popup stacking that `popups.ts` uses (shared `POPUP_Z_INDEX`, and above an open `Modal`/`Sheet`/`Drawer`).

It would also help if a `Modal`'s overlay `onClick` ignored clicks that land inside a descendant portal.
