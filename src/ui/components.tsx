import { Button, Column, Row, Text, View, Progress, Spinner, Icon, Pressable, openExternal, type IconName, type Child } from "@tarve/core";
import { T, S, ICONS, SERVICE_COLOR, fmtUptime, fmtBytes } from "./theme";
import { MANIFEST, type ServiceName } from "../core/manifest";
import type { ServiceState } from "../core/services";
import type { ServiceConfig } from "../core/config";
import type { InstallProgress } from "../core/installer";

/** Built-in icon by name, or one of ours from ICONS. */
export function Glyph(props: { name: string; size?: number; color?: string }) {
  const node = ICONS[props.name];
  const size = props.size ?? 16;
  // fixed square box: Icon alone sits on the text baseline and drifts down next to labels
  return (
    <View style={{ width: size, height: size, shrink: 0, align: "center", justify: "center" }}>
      {node ? (
        <Icon iconNode={node} size={size} color={props.color} strokeWidth={2} />
      ) : (
        <Icon name={props.name as IconName} size={size} color={props.color} strokeWidth={2} />
      )}
    </View>
  );
}

const status = () =>
  ({
    running: { bg: T.greenBg, fg: T.green, dot: T.greenDot, label: "Running" },
    stopped: { bg: T.paperAlt, fg: T.inkSoft, dot: T.lineStrong, label: "Stopped" },
    starting: { bg: T.blueBg, fg: T.blue, dot: T.blueDot, label: "Starting" },
    "not-installed": { bg: T.amberBg, fg: T.accent, dot: T.accentSoft, label: "Not installed" },
    occupied: { bg: T.amberBg, fg: T.accent, dot: T.accentSoft, label: "Port in use" },
  }) as const;

export function StatusPill(props: { state: ServiceState; busy?: boolean }) {
  const st = props.state.status;
  const m = status()[st];
  const live = st === "running" || st === "starting";
  return (
    <View style={S.pill(m.bg)}>
      {props.busy ? (
        <Spinner size={10} />
      ) : (
        <View
          style={{
            width: 7,
            height: 7,
            radius: 99,
            background: m.dot,
            boxShadow: live ? { blur: 6, color: m.dot } : undefined,
            animation: live
              ? { from: { opacity: 0.35 }, duration: st === "starting" ? 500 : 1200, iterations: "infinite", direction: "alternate", easing: "easeInOut" }
              : undefined,
          }}
        />
      )}
      <Text size={11} weight={600} color={m.fg}>{m.label}</Text>
    </View>
  );
}

/** Connection hint: click opens `href` when present, text is selectable for copying. */
export function ConnectionRow(props: { value: string; href?: string; active: boolean }) {
  const body = (
    <Row gap={8} align="center" style={{ minWidth: 0 }}>
      <Glyph name={props.href ? "globe" : "terminal"} size={13} color={props.active ? T.accent : T.inkFaint} />
      <Text size={11.5} color={props.active ? T.ink : T.inkFaint} style={{ fontFamily: T.mono, userSelect: "text", flex: 1 }}>{props.value}</Text>
      {props.href && props.active ? <Glyph name="external" size={12} color={T.accent} /> : null}
    </Row>
  );
  const box = {
    background: T.paper,
    borderColor: T.line,
    borderWidth: 1,
    borderStyle: "dashed" as const,
    radius: 8,
    padding: { top: 7, bottom: 7, left: 10, right: 10 },
  };
  if (!props.href) return <View style={box}>{body}</View>;
  return (
    <Pressable
      disabled={!props.active}
      onClick={() => props.href && openExternal(props.href)}
      style={{
        ...box,
        cursor: props.active ? "pointer" : "default",
        hover: props.active ? { background: T.accentBg, borderColor: T.accentSoft } : {},
      }}
    >
      {body}
    </Pressable>
  );
}

function Chip(props: { label: string; value: string; tone?: string }) {
  return (
    <Row gap={5} align="baseline" style={S.chip}>
      <Text size={10.5} color={T.inkFaint}>{props.label}</Text>
      <Text size={11} weight={600} color={props.tone ?? T.inkSoft} style={{ fontVariantNumeric: "tabular-nums" }}>{props.value}</Text>
    </Row>
  );
}

/** Square icon-only button (gear by default). */
export function GearButton(props: { onClick: () => void; icon?: string }) {
  return (
    <Pressable
      onClick={props.onClick}
      style={{
        width: 28,
        height: 28,
        radius: 8,
        align: "center",
        justify: "center",
        borderColor: "transparent",
        borderWidth: 1,
        hover: { background: T.paperAlt, borderColor: T.line },
        active: { background: T.line },
      }}
    >
      <Glyph name={props.icon ?? "gear"} size={15} color={T.inkFaint} />
    </Pressable>
  );
}

export function IconButton(props: { icon: string; label: string; onClick: () => void; disabled?: boolean; dark?: boolean; tone?: "side" | "code" }) {
  // dark = sidebar (follows theme); tone "code" = always-dark log panel
  const tone = props.tone ?? (props.dark ? "side" : undefined);
  const fg = tone === "code" ? T.codeMuted : tone === "side" ? T.sideMuted : T.inkSoft;
  return (
    <Pressable
      disabled={props.disabled}
      onClick={props.onClick}
      style={{
        direction: "row",
        align: "center",
        gap: 6,
        radius: 7,
        padding: { top: 5, bottom: 5, left: 8, right: 8 },
        opacity: props.disabled ? 0.45 : 1,
        hover: props.disabled ? {} : { background: tone === "code" ? T.codeLine : tone === "side" ? T.sideAlt : T.paperAlt },
      }}
    >
      <Glyph name={props.icon} size={14} color={fg} />
      <Text size={12} color={tone === "code" ? T.codeText : tone === "side" ? T.sideText : T.inkSoft}>{props.label}</Text>
    </Pressable>
  );
}

export function ServiceCard(props: {
  name: ServiceName;
  title: string;
  description: string;
  state: ServiceState;
  svc: ServiceConfig;
  installed: string[];
  busy: boolean;
  progress?: InstallProgress;
  extra?: string;
  connection: { value: string; href?: string };
  onToggleRun: () => void;
  onRestart: () => void;
  onInstall: () => void;
  onOpenLog: () => void;
  onChangePort: () => void;
  onSettings: () => void;
}) {
  const { name, title, description, state, svc, busy } = props;
  const color = SERVICE_COLOR[name];
  const foreign = state.status === "occupied";
  const running = state.status === "running";
  const notInstalled = state.status === "not-installed";
  const entry = MANIFEST[name].versions.find((v) => v.version === svc.version);
  const p = props.progress;
  const downloading = p?.version === svc.version && p.state === "downloading";
  const extracting = p?.version === svc.version && p.state === "extracting";
  const pct = p && p.total > 0 ? Math.min(100, Math.round((p.received / p.total) * 100)) : 0;
  const uptime = fmtUptime(state.uptimeMs);
  const message = state.message ?? (p?.version === svc.version && p.state === "error" ? p.message : undefined);

  return (
    <Column
      gap={14}
      padding={16}
      style={{
        ...S.card,
        borderColor: running ? T.greenLine : T.line,
        transition: { borderColor: { duration: 200 } },
      }}
    >
      <Row gap={12} align="start">
        <View style={{ width: 40, height: 40, radius: 10, background: color.bg, align: "center", justify: "center" }}>
          <Text size={name === "php" ? 12 : 14} weight={750} color={color.fg}>{color.mono}</Text>
        </View>
        <Column flex={1} gap={2} style={{ minWidth: 0 }}>
          <Row justify="between" align="center" gap={8}>
            <Text size={15} weight={650}>{title}</Text>
            <Row gap={4} align="center">
              <StatusPill state={state} busy={busy} />
              <GearButton onClick={props.onSettings} />
            </Row>
          </Row>
          <Text size={12} color={T.inkSoft}>{description}</Text>
        </Column>
      </Row>

      <Row gap={6} align="center" style={{ wrap: true }}>
        <Chip label="port" value={props.extra ?? String(state.port)} />
        {state.pid ? <Chip label="pid" value={String(state.pid)} /> : null}
        {running && uptime ? <Chip label="uptime" value={uptime} tone={T.green} /> : null}
        {svc.enabled ? <Chip label="auto" value="on" tone={T.accent} /> : null}
        {state.orphan ? <Chip label="source" value="previous session" tone={T.accent} /> : null}
      </Row>

      <Row gap={8} align="center">
        <Row gap={10} align="baseline" flex={1} style={{ minWidth: 0, padding: { top: 8, bottom: 8, left: 12, right: 12 }, radius: 9, background: T.paper, borderColor: T.line, borderWidth: 1 }}>
          <Text size={10.5} weight={700} color={T.inkFaint} style={{ letterSpacing: 0.6 }}>VERSION</Text>
          <Text size={13.5} weight={650} style={{ fontVariantNumeric: "tabular-nums" }}>{svc.version}</Text>
          {entry?.notes ? <Text size={11} color={T.inkFaint}>{entry.notes}</Text> : null}
          <View flex={1} />
          {props.installed.includes(svc.version) ? <Text size={11} color={T.green}>Installed</Text> : <Text size={11} color={T.accent}>Not installed</Text>}
        </Row>
        {notInstalled ? (
          <Button size="sm" onClick={props.onInstall} disabled={busy}>
            <Row gap={6} align="center">
              <Glyph name="download" size={13} color={T.onPrimary} />
              <Text size={12.5} weight={600} color={T.onPrimary}>Install</Text>
            </Row>
          </Button>
        ) : null}
      </Row>

      <ConnectionRow value={props.connection.value} href={props.connection.href} active={running} />

      {downloading ? (
        <Column gap={5}>
          <Progress value={pct} max={100} />
          <Row justify="between">
            <Text size={11} color={T.inkFaint}>Downloading {svc.version}…</Text>
            <Text size={11} color={T.inkSoft} style={{ fontVariantNumeric: "tabular-nums" }}>
              {p.total > 0 ? `${fmtBytes(p.received)} / ${fmtBytes(p.total)} · ${pct}%` : fmtBytes(p.received)}
            </Text>
          </Row>
        </Column>
      ) : null}
      {extracting ? (
        <Row gap={8} align="center">
          <Spinner size={12} />
          <Text size={11.5} color={T.inkSoft}>Extracting and installing…</Text>
        </Row>
      ) : null}
      {foreign ? (
        <Row gap={8} align="start" style={{ background: T.amberBg, borderColor: T.amberLine, borderWidth: 1, radius: 8, padding: { top: 8, bottom: 8, left: 10, right: 10 } }}>
          <Glyph name="alert" size={14} color={T.accent} />
          <Text size={11.5} color={T.accent} style={{ flex: 1, userSelect: "text" }}>
            Port {String(state.port)} is being used by {state.ownerPath ?? state.owner ?? "another program"}{state.pid ? ` (PID ${state.pid})` : ""}.{" "}
            {state.ownerPath ? "This isn't Vela: stop it there or use another port." : "Windows can't identify the program (a system service or one running as an administrator). Stop it there or use another port."}
          </Text>
        </Row>
      ) : null}
      {message ? (
        <View style={{ background: T.redBg, borderColor: T.redLine, borderWidth: 1, radius: 8, padding: { top: 7, bottom: 7, left: 10, right: 10 } }}>
          <Text size={11.5} color={T.red} style={{ userSelect: "text" }}>{message}</Text>
        </View>
      ) : null}

      <View style={{ height: 1, background: T.line }} />

      <Row justify="between" align="center" gap={8}>
        <View />
        <Row gap={4} align="center">
          <IconButton icon="logs" label="Logs" onClick={props.onOpenLog} />
          {running ? <IconButton icon="refresh" label="Restart" disabled={busy} onClick={props.onRestart} /> : null}
          {foreign ? (
            <Button variant="outline" size="sm" disabled={busy} onClick={props.onChangePort} style={{ minWidth: 84 }}>
              Change port
            </Button>
          ) : (
            <Button
              variant={running ? "outline" : "default"}
              size="sm"
              disabled={busy || notInstalled}
              onClick={props.onToggleRun}
              style={{ minWidth: 84 }}
            >
              {state.status === "running" ? "Stop" : "Start"}
            </Button>
          )}
        </Row>
      </Row>
    </Column>
  );
}

export function Field(props: { label: string; hint?: string; children?: Child }) {
  return (
    <Row gap={16} align="center" style={{ padding: { top: 10, bottom: 10 } }}>
      <Column gap={2} style={{ width: 260, shrink: 0 }}>
        <Text size={12.5} weight={550}>{props.label}</Text>
        {props.hint ? <Text size={11} color={T.inkFaint}>{props.hint}</Text> : null}
      </Column>
      <Row flex={1} gap={8} align="center">
        {props.children}
      </Row>
    </Row>
  );
}

export function Section(props: { title: string; description?: string; children?: Child }) {
  return (
    <Column gap={4} padding={{ top: 14, bottom: 8, left: 18, right: 18 }} style={S.card}>
      <Text size={14} weight={650}>{props.title}</Text>
      {props.description ? <Text size={12} color={T.inkFaint}>{props.description}</Text> : null}
      <Column style={{ margin: { top: 4 } }}>{props.children}</Column>
    </Column>
  );
}

/** Switch with a label in the app's type scale (Tarve's own label is 14 px and spaced for forms). */
export function LabeledSwitch(props: { id: string; label: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <Pressable
      disabled={props.disabled}
      onClick={() => props.onChange(!props.checked)}
      style={{ direction: "row", align: "center", gap: 8, padding: { top: 3, bottom: 3 }, cursor: props.disabled ? "not-allowed" : "pointer" }}
    >
      <Toggle checked={props.checked} disabled={props.disabled} />
      <Text size={12.5} color={T.inkSoft}>{props.label}</Text>
    </Pressable>
  );
}

/** The switch track alone, drawn here so it follows the palette and has no stray label gap. */
export function Toggle(props: { checked: boolean; disabled?: boolean }) {
  return (
    <View
      style={{
        position: "relative",
        width: 34,
        height: 20,
        radius: 10,
        shrink: 0,
        background: props.checked ? T.accent : T.lineStrong,
        opacity: props.disabled ? 0.45 : 1,
        transition: { background: { duration: 150 } },
      }}
    >
      <View
        style={{
          position: "absolute",
          top: 2,
          left: props.checked ? 16 : 2,
          width: 16,
          height: 16,
          radius: 8,
          background: "#ffffff",
          boxShadow: { y: 1, blur: 2, color: "#0000002e" },
          transition: { left: { duration: 150, easing: "easeOut" } },
        }}
      />
    </View>
  );
}

/** Settings switch: the whole track is the hit target, no text (the Field carries the label). */
export function SwitchControl(props: { checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <Pressable disabled={props.disabled} onClick={() => props.onChange(!props.checked)} style={{ radius: 10, cursor: props.disabled ? "not-allowed" : "pointer" }}>
      <Toggle checked={props.checked} disabled={props.disabled} />
    </Pressable>
  );
}
