/** Window chrome: title bar, sidebar navigation and the page header. */
import { type Child, Column, Modal, openExternal, Pressable, Row, Spinner, Svg, Text, TitleBar, View } from "@tarve/core";
import { ALL_SERVICES } from "../core/services";
import { wwwDir } from "../core/config";
import { GearButton, Glyph, IconButton } from "./components";
import { SHORTCUTS, goTo, openPhpMyAdmin, setTheme } from "./actions";
import { isDark, SAIL, T, type ThemeMode } from "./theme";
import { localUrl, type Tab, ui, update } from "./store";

function NavItem(props: { value: Tab; label: string; icon: string; badge?: string }) {
  const active = ui.tab === props.value;
  return (
    <Pressable
      onClick={() => goTo(props.value)}
      style={{
        direction: "row",
        align: "center",
        gap: 10,
        radius: 8,
        padding: { top: 8, bottom: 8, left: 10, right: 10 },
        background: active ? T.sideAlt : "transparent",
        borderColor: active ? T.sideLine : "transparent",
        borderWidth: 1,
        hover: active ? {} : { background: T.sideAlt },
      }}
    >
      <View style={{ width: 3, height: 16, radius: 2, background: active ? T.accentSoft : "transparent", margin: { left: -6 } }} />
      <Glyph name={props.icon} size={16} color={active ? T.accentSoft : T.sideMuted} />
      <Text size={13} weight={active ? 600 : 450} color={active ? T.sideText : T.sideMuted} style={{ flex: 1 }}>{props.label}</Text>
      {props.badge ? <Text size={11} weight={600} color={active ? T.sideText : T.sideMuted}>{props.badge}</Text> : null}
    </Pressable>
  );
}

export function Sidebar() {
  const runningCount = ui.statuses.filter((s) => s.status === "running").length;
  return (
    <Column style={{ width: 216, background: T.side, borderWidth: { right: 1 }, borderColor: T.sideLine }} padding={{ top: 14, bottom: 14, left: 12, right: 12 }} gap={18}>
      <Column gap={2}>
        <NavItem value="services" label="Services" icon="server" badge={`${runningCount}/${ALL_SERVICES.length}`} />
        <NavItem value="sites" label="Sites" icon="sites" />
        <NavItem value="logs" label="Logs" icon="logs" />
        <NavItem value="settings" label="Settings" icon="settings" />
      </Column>

      <View flex={1} />

      <Column gap={2}>
        <IconButton dark icon="globe" label="Open localhost" onClick={() => openExternal(localUrl())} />
        <IconButton dark icon="folder" label="www folder" onClick={() => openExternal(wwwDir(ui.cfg.root))} />
        <IconButton dark icon="database" label="phpMyAdmin" onClick={() => void openPhpMyAdmin()} />
        <IconButton dark icon="keyboard" label="Shortcuts" onClick={() => { ui.helpOpen = true; update(); }} />
        <IconButton dark icon={currentTheme().icon} label={`Theme: ${currentTheme().label}`} onClick={cycleTheme} />
      </Column>

    </Column>
  );
}

export function PageHeader(props: { title: string; subtitle: string; actions?: Child }) {
  return (
    <Row justify="between" align="center" padding={{ top: 22, bottom: 16, left: 24, right: 24 }} gap={16}>
      <Column gap={2} flex={1} style={{ minWidth: 0 }}>
        <Text size={21} weight={700}>{props.title}</Text>
        <Text size={12.5} color={T.inkFaint}>{props.subtitle}</Text>
      </Column>
      {props.actions ?? null}
    </Row>
  );
}

/** Custom title bar (frameless window): brand, live stack state and window controls, in the sidebar's ink. */
export function AppTitleBar() {
  const up = ui.statuses.filter((s) => s.status === "running").length;
  const installedCount = ui.statuses.filter((s) => s.status !== "not-installed").length;
  const allUp = installedCount > 0 && up === installedCount;
  const dot = up === 0 ? T.sideMuted : allUp ? T.greenDot : T.accentSoft;
  const label = ui.globalBusy === "start" ? "starting…" : ui.globalBusy === "stop" ? "stopping…" : up === 0 ? "stopped" : allUp ? "running" : "partially running";
  return (
    <TitleBar
      height={40}
      appearance={isDark() ? "dark" : "light"}
      showMinimize
      showMaximize
      showClose
      dragRegion
      style={{ background: T.side, foreground: T.sideText, borderWidth: { bottom: 1 }, borderColor: T.sideLine }}
      buttonStyle={{ background: "transparent", foreground: T.sideText, hover: { background: T.sideAlt, foreground: T.sideText } }}
      leading={
        <Row gap={9} align="center" padding={{ left: 14 }}>
          <View
            style={{
              width: 22,
              height: 22,
              radius: 7,
              background: "linear-gradient(145deg, #fbbf24, #d97706 55%, #9a3412)",
              align: "center",
              justify: "center",
            }}
          >
            <Svg size={15} viewBox="0 0 24 24" stroke="none" strokeWidth={0} nodes={SAIL} />
          </View>
          <Text size={13} weight={700} color={T.sideText}>Vela</Text>
          <Text size={12} color={T.sideHint}>stack manager</Text>
        </Row>
      }
      actions={
        <Row gap={8} align="center" padding={{ right: 8 }}>
          <Pressable
            onClick={() => goTo("services")}
            style={{
              direction: "row",
              gap: 7,
              align: "center",
              radius: 999,
              padding: { top: 3, bottom: 3, left: 10, right: 10 },
              background: T.sideAlt,
              borderColor: T.sideLine,
              borderWidth: 1,
              hover: { borderColor: T.sideMuted },
            }}
          >
            {ui.globalBusy ? (
              <Spinner size={9} />
            ) : (
              <View
                style={{
                  width: 7,
                  height: 7,
                  radius: 99,
                  background: dot,
                  boxShadow: up ? { blur: 6, color: dot } : undefined,
                  animation: up ? { from: { opacity: 0.4 }, duration: 1300, iterations: "infinite", direction: "alternate", easing: "easeInOut" } : undefined,
                }}
              />
            )}
            <Text size={11.5} weight={600} color={T.sideText}>Stack {label}</Text>
            <Text size={11} color={T.sideMuted} style={{ fontVariantNumeric: "tabular-nums" }}>{`${up}/${ALL_SERVICES.length}`}</Text>
          </Pressable>
        </Row>
      }
    />
  );
}

export const THEME_OPTIONS: { value: ThemeMode; icon: string; label: string }[] = [
  { value: "light", icon: "sun", label: "Light" },
  { value: "dark", icon: "moon", label: "Dark" },
  { value: "system", icon: "monitor", label: "System" },
];

const currentTheme = () => THEME_OPTIONS.find((o) => o.value === ui.cfg.theme) ?? THEME_OPTIONS[2]!;

/** One sidebar entry that steps Light → Dark → System; the full choice lives in Settings. */
function cycleTheme() {
  const i = THEME_OPTIONS.findIndex((o) => o.value === ui.cfg.theme);
  setTheme(THEME_OPTIONS[(i + 1) % THEME_OPTIONS.length]!.value);
}

/** A single key cap, in the app palette (Tarve's Kbd is a fixed dark chip). */
function Keycap(props: { label: string }) {
  return (
    <View
      style={{
        minWidth: 24,
        height: 24,
        padding: { left: 7, right: 7 },
        radius: 6,
        align: "center",
        justify: "center",
        background: T.card,
        borderColor: T.lineStrong,
        borderWidth: { top: 1, left: 1, right: 1, bottom: 2 },
      }}
    >
      <Text size={11.5} weight={600} color={T.inkSoft} style={{ fontFamily: T.mono }}>{props.label}</Text>
    </View>
  );
}

/** F1: the keyboard shortcuts, grouped, one key cap per key. */
export function ShortcutsDialog() {
  const close = () => { ui.helpOpen = false; update(); };
  return (
    <Modal open={ui.helpOpen} width={440} showClose={false} closeOnOverlay closeOnEscape onOpenChange={(o) => { if (!o) close(); }}>
      <Column gap={18}>
        <Row gap={12} align="center">
          <View style={{ width: 36, height: 36, radius: 9, background: T.accentBg, align: "center", justify: "center" }}>
            <Glyph name="keyboard" size={18} color={T.accent} />
          </View>
          <Column flex={1} gap={1}>
            <Text size={16} weight={700}>Keyboard shortcuts</Text>
            <Text size={12} color={T.inkFaint}>Work when the Vela window is focused.</Text>
          </Column>
          <GearButton icon="x" onClick={close} />
        </Row>
        {SHORTCUTS.map((g) => (
          <Column key={g.group} gap={2}>
            <Text size={10.5} weight={700} color={T.inkFaint} style={{ letterSpacing: 0.8, padding: { bottom: 4 } }}>{g.group.toUpperCase()}</Text>
            {g.items.map((s) => (
              <Row key={s.label} justify="between" align="center" style={{ minHeight: 34 }}>
                <Text size={13} color={T.ink}>{s.label}</Text>
                <Row gap={4} align="center">
                  {s.keys.map((k, i) => (
                    <Row key={k} gap={4} align="center">
                      {i > 0 ? <Text size={11} color={T.inkFaint}>+</Text> : null}
                      <Keycap label={k} />
                    </Row>
                  ))}
                </Row>
              </Row>
            ))}
          </Column>
        ))}
      </Column>
    </Modal>
  );
}
