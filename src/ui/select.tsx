/**
 * Drop-in for Tarve's <Select> (same props and look).
 *
 * Workaround for @tarve/core 0.9.0: Select's portal popup has no zIndex (Popover,
 * DropdownMenu and Tooltip use POPUP_Z_INDEX + 1), so inside a <Modal> it is painted
 * under the modal overlay (adding the zIndex alone does not fix it — nested portals still
 * stack below the modal portal): the list never shows, and with `closeOnOverlay` a click
 * where the option should be closes the modal instead. Repro and issue:
 * docs/tarve-issues/select-in-modal.md · https://github.com/omarcosr/tarve/issues/18
 * Use `inline` inside a Modal. Remove this file once Tarve ships the fix.
 */
import { Column, Icon, Pressable, Row, Scroll, Text, theme, type SelectProps } from "@tarve/core";

const POPUP_Z_INDEX = 1000; // matches Tarve's popups.ts
const openIds = new Set<string>();

/** Open an uncontrolled Select programmatically (screenshots/tests). */
export function openSelect(id: string) {
  openIds.add(id);
}

export function Select({ id, value, options, placeholder = "Select…", disabled = false, open, onOpenChange, onValueChange, style, inline = false }: SelectProps & { inline?: boolean }) {
  const c = theme.colors;
  const expanded = open ?? openIds.has(id);
  const enabled = options.filter((o) => !o.disabled);
  const selected = options.find((o) => o.value === value);
  const popupHeight = Math.min(240, Math.max(40, options.length * 34 + 8));
  const setOpen = (next: boolean) => {
    if (open === undefined) {
      if (next) openIds.add(id);
      else openIds.delete(id);
    }
    onOpenChange?.(next);
  };
  const choose = (next: string) => {
    setOpen(false);
    onValueChange?.(next);
  };
  const move = (dir: number) => {
    if (enabled.length === 0) return;
    const cur = enabled.findIndex((o) => o.value === value);
    const next = cur < 0 ? (dir > 0 ? 0 : enabled.length - 1) : (cur + dir + enabled.length) % enabled.length;
    onValueChange?.(enabled[next]!.value);
  };
  return (
    <Column id={id} style={{ position: "relative", width: 220, height: 38, shrink: 0, zIndex: expanded ? POPUP_Z_INDEX : 0, ...style }}>
      <Pressable
        id={`${id}-trigger`}
        disabled={disabled}
        focusable
        control={{ role: "select", label: selected?.label ?? placeholder, expanded }}
        onClick={() => setOpen(!expanded)}
        onBlur={() => setOpen(false)}
        onKeyDown={(key) => {
          if (key === "ArrowDown") move(1);
          else if (key === "ArrowUp") move(-1);
          else if (key === "Escape") setOpen(false);
        }}
        style={{
          width: "100%",
          height: 38,
          direction: "row",
          align: "center",
          justify: "between",
          padding: { left: 12, right: 10 },
          background: c.input,
          borderWidth: 1,
          borderColor: expanded ? c.ring : c.border,
          radius: theme.radius.sm,
          hover: { borderColor: c.mutedForeground },
          disabled: { background: c.disabled, foreground: c.disabledForeground },
        }}
      >
        <Text size={14} color={selected ? c.foreground : c.placeholder}>{selected?.label ?? placeholder}</Text>
        <Icon name={expanded ? "chevron-up" : "chevron-down"} size={14} color={c.mutedForeground} />
        {expanded && !disabled ? (
          <Scroll
            id={`${id}-popup`}
            portal={!inline}
            dismissOnOutside
            onOutsideClick={() => setOpen(false)}
            style={{
              position: "absolute",
              top: 42,
              left: 0,
              width: "100%",
              height: popupHeight,
              padding: 4,
              background: c.card,
              borderWidth: 1,
              borderColor: c.border,
              radius: theme.radius.md,
              zIndex: POPUP_Z_INDEX + 1,
              boxShadow: { y: 8, blur: 24, color: "#0000002e" },
              pointerEvents: "block",
              positionTryFallbacks: "flip-block",
            }}
          >
            <Column gap={2} style={{ width: "100%" }}>
              {options.map((o) => (
                <Pressable
                  key={o.value}
                  id={`${id}-option-${o.value}`}
                  disabled={o.disabled}
                  focusable={false}
                  control={{ role: "option", label: o.label, selected: o.value === value }}
                  onClick={() => choose(o.value)}
                  style={{
                    minHeight: 32,
                    padding: { left: 8, right: 8 },
                    radius: theme.radius.sm,
                    direction: "row",
                    align: "center",
                    justify: "between",
                    shrink: 0,
                    background: o.value === value ? c.muted : "transparent",
                    hover: { background: c.muted },
                  }}
                >
                  <Row gap={8} align="center">
                    <Text color={o.disabled ? c.disabledForeground : c.foreground}>{o.label}</Text>
                  </Row>
                  {o.value === value ? <Icon name="check" size={14} color={c.foreground} /> : null}
                </Pressable>
              ))}
            </Column>
          </Scroll>
        ) : null}
      </Pressable>
    </Column>
  );
}
