/** Logs: file list, filter and the log viewer. */
import { Column, Input, openExternal, Pressable, Row, Scroll, Text, View } from "@tarve/core";
import { clearLog, levelOf } from "../../core/logs";
import { logsDir } from "../../core/config";
import { fmtBytes, S, T } from "../theme";
import { IconButton, LabeledSwitch } from "../components";
import { loadLogs, visibleLogLines } from "../actions";
import { PageHeader } from "../chrome";
import { toast, ui, update } from "../store";

export function LogsPage() {
  const sel = ui.logFiles.find((f) => f.name === ui.selectedLog);
  const lines = visibleLogLines();
  const counts = { all: ui.logLines.length, warn: 0, error: 0 };
  for (const l of ui.logLines) {
    const lv = levelOf(l);
    if (lv === "error") counts.error++;
    if (lv !== "all") counts.warn++;
  }
  return (
    <Column flex={1} align="stretch">
      <PageHeader
        title="Logs"
        subtitle={logsDir(ui.cfg.root)}
        actions={
          <Row gap={12} align="center">
            <LabeledSwitch id="log-follow" label="Live" checked={ui.logFollow} onChange={(v) => { ui.logFollow = v; update(); }} />
            <LabeledSwitch id="log-order" label="Newest first" checked={ui.logNewestFirst} onChange={(v) => { ui.logNewestFirst = v; loadLogs(); update(); }} />
            <IconButton icon="folder" label="Folder" onClick={() => openExternal(logsDir(ui.cfg.root))} />
          </Row>
        }
      />
      <Row flex={1} gap={14} align="stretch" padding={{ left: 24, right: 24, bottom: 24 }} style={{ minHeight: 0 }}>
        <Column style={{ ...S.card, width: 220 }} padding={8} gap={2}>
          <Text size={11} weight={650} color={T.inkFaint} style={{ padding: { top: 4, bottom: 6, left: 8 } }}>FILES · {ui.logFiles.length}</Text>
          <Scroll flex={1}>
            <Column gap={2}>
              {ui.logFiles.map((f) => {
                const active = f.name === ui.selectedLog;
                return (
                  <Pressable
                    key={f.name}
                    style={{
                      radius: 7,
                      padding: { top: 6, bottom: 6, left: 9, right: 9 },
                      background: active ? T.accentBg : "transparent",
                      hover: { background: active ? T.accentBg : T.paperAlt },
                    }}
                    onClick={() => {
                      ui.selectedLog = f.name;
                      loadLogs();
                      update();
                    }}
                  >
                    <Row justify="between" align="center" gap={6}>
                      <Text size={12} weight={active ? 600 : 450} color={active ? T.accent : T.inkSoft}>{f.name.replace(/\.log$/, "")}</Text>
                      <Text size={10.5} color={T.inkFaint}>{fmtBytes(f.size)}</Text>
                    </Row>
                  </Pressable>
                );
              })}
              {ui.logFiles.length === 0 ? <Text size={12} color={T.inkFaint} style={{ padding: 8 }}>No logs yet.</Text> : null}
            </Column>
          </Scroll>
        </Column>
        <Column flex={1} style={{ background: T.code, radius: 12, overflow: "hidden", minWidth: 0, borderColor: T.codeLine, borderWidth: 1 }}>
          <Row justify="between" align="center" padding={{ top: 8, bottom: 8, left: 14, right: 8 }} style={{ borderWidth: { bottom: 1 }, borderColor: T.codeLine }}>
            <Row gap={8} align="center">
              <View style={{ width: 7, height: 7, radius: 99, background: ui.logFollow ? T.greenDot : T.codeMuted }} />
              <Text size={12} weight={600} color={T.codeText} style={{ fontFamily: T.mono }}>{ui.selectedLog ?? "—"}</Text>
              {sel ? <Text size={11} color={T.codeMuted}>{new Date(sel.modified).toLocaleTimeString()}</Text> : null}
            </Row>
            <Row gap={2}>
              <IconButton tone="code" icon="refresh" label="Reload" onClick={() => { loadLogs(); update(); }} />
              <IconButton
                tone="code"
                icon="trash-2"
                label="Clear"
                disabled={!ui.selectedLog}
                onClick={() => {
                  if (ui.selectedLog && clearLog(ui.cfg.root, ui.selectedLog)) toast("Log limpo", ui.selectedLog);
                  loadLogs();
                  update();
                }}
              />
            </Row>
          </Row>
          <Row gap={10} align="center" padding={{ top: 8, bottom: 8, left: 12, right: 12 }} style={{ borderWidth: { bottom: 1 }, borderColor: T.codeLine, background: T.codeBar }}>
            <Input
              id="log-search"
              value={ui.logQuery}
              placeholder="Filter lines…  (Ctrl+F)"
              onChange={(v) => { ui.logQuery = v; update(); }}
              style={{ flex: 1, background: T.codeInput, borderColor: T.codeInputLine, foreground: T.codeText, fontFamily: T.mono, fontSize: 12, height: 32 }}
            />
            <Row gap={2} style={{ background: "#16150f", radius: 8, padding: 3, borderColor: "#3a382f", borderWidth: 1 }}>
              {([
                ["all", "All", counts.all, T.codeText],
                ["warn", "Warnings", counts.warn, "#fcd34d"],
                ["error", "Errors", counts.error, "#fca5a5"],
              ] as const).map(([v, label, n, fg]) => {
                const on = ui.logLevel === v;
                return (
                  <Pressable
                    key={v}
                    onClick={() => { ui.logLevel = v; update(); }}
                    style={{
                      direction: "row",
                      gap: 6,
                      align: "center",
                      radius: 6,
                      padding: { top: 4, bottom: 4, left: 9, right: 9 },
                      background: on ? T.codeLine : "transparent",
                      hover: on ? {} : { background: T.codeBar },
                    }}
                  >
                    <Text size={11.5} weight={on ? 600 : 450} color={on ? fg : T.codeMuted}>{label}</Text>
                    <Text size={10.5} color={on ? fg : T.sideHint} style={{ fontVariantNumeric: "tabular-nums" }}>{String(n)}</Text>
                  </Pressable>
                );
              })}
            </Row>
            {ui.logQuery || ui.logLevel !== "all" ? (
              <IconButton tone="code" icon="x" label="Clear filter" onClick={() => { ui.logQuery = ""; ui.logLevel = "all"; update(); }} />
            ) : null}
          </Row>
          <Scroll flex={1}>
            <Column padding={{ top: 8, bottom: 14, left: 0, right: 8 }}>
              {lines.length === 0 ? (
                <Text size={11.5} color={T.codeMuted} style={{ fontFamily: T.mono, padding: { left: 14, top: 6 } }}>
                  {!ui.selectedLog ? "No logs yet — start the services first." : ui.logLines.length ? "No lines match the filter." : "(empty)"}
                </Text>
              ) : (
                lines.slice(0, 400).map((l, i) => {
                  const lv = levelOf(l);
                  return (
                    <Row
                      key={i}
                      gap={0}
                      align="stretch"
                      style={{
                        background: lv === "error" ? "#3b1a1633" : "transparent",
                      }}
                    >
                      <View style={{ width: 3, background: lv === "error" ? "#ef4444" : lv === "warn" ? "#f59e0b" : "transparent" }} />
                      <Text
                        size={11.5}
                        color={lv === "error" ? "#fca5a5" : lv === "warn" ? "#fcd34d" : T.codeText}
                        style={{ fontFamily: T.mono, lineHeight: 1.5, userSelect: "text", whiteSpace: "pre-wrap", flex: 1, padding: { top: 1, bottom: 1, left: 11, right: 4 } }}
                      >
                        {l || " "}
                      </Text>
                    </Row>
                  );
                })
              )}
              {lines.length > 400 ? <Text size={11} color={T.codeMuted} style={{ padding: { left: 14, top: 8 } }}>+{lines.length - 400} lines — narrow the filter</Text> : null}
            </Column>
          </Scroll>
        </Column>
      </Row>
    </Column>
  );
}
