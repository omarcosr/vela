/** Per-service settings modal (version, port, auto-start, MariaDB password, files). */
import { Button, Column, Input, Modal, openExternal, Row, Scroll, Text, View } from "@tarve/core";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { binDir, isValidPort, logsDir } from "../../core/config";
import { configFileOf, mariaDbInitialized, PHP_WORKERS } from "../../core/services";
import { MANIFEST } from "../../core/manifest";
import { findStatus, SERVICE_META, ui, update } from "../store";
import { Glyph, IconButton, StatusPill, SwitchControl } from "../components";
import { saveServiceSettings } from "../actions";
import { Select } from "../select";
import { SERVICE_COLOR, T } from "../theme";

function ModalLabel(props: { children: string }) {
  return (
    <Text size={10.5} weight={700} color={T.inkFaint} style={{ letterSpacing: 0.8, margin: { top: 4 } }}>
      {props.children}
    </Text>
  );
}

function FileRow(props: { icon: string; label: string; path: string; missing?: string }) {
  const exists = existsSync(props.path);
  return (
    <Row gap={10} align="center" style={{ padding: { top: 8, bottom: 8, left: 10, right: 6 }, radius: 9, background: T.paperAlt, borderColor: T.line, borderWidth: 1 }}>
      <View style={{ width: 28, height: 28, radius: 7, background: T.card, align: "center", justify: "center", borderColor: T.line, borderWidth: 1 }}>
        <Glyph name={props.icon} size={14} color={exists ? T.accent : T.inkFaint} />
      </View>
      <Column flex={1} gap={1} style={{ minWidth: 0 }}>
        <Text size={12} weight={600}>{props.label}</Text>
        <Text size={10.5} color={T.inkFaint} style={{ fontFamily: T.mono, userSelect: "text", textOverflow: "ellipsis", whiteSpace: "nowrap", overflow: "hidden" }}>
          {exists ? props.path : props.missing ?? "doesn't exist yet"}
        </Text>
      </Column>
      <IconButton icon="external" label="Open" disabled={!exists} onClick={() => openExternal(props.path)} />
    </Row>
  );
}

export function ServiceSettingsModal() {
  const e = ui.svcEdit;
  const name = e?.name ?? "nginx";
  const meta = SERVICE_META[name];
  const color = SERVICE_COLOR[name];
  const st = findStatus(name);
  const portN = Number(e?.port);
  const portOk = !!e && isValidPort(portN);
  const changed = !!e && (e.version !== ui.cfg.services[name].version || portN !== ui.cfg.services[name].port);
  const willRestart = changed && st.status === "running";
  const notInstalled = !!e && !ui.installed[name].includes(e.version);
  const close = () => { ui.svcEdit = null; update(); };
  const versions = MANIFEST[name].versions.map((v) => ({
    value: v.version,
    label: [v.version, v.notes, ui.installed[name].includes(v.version) ? "installed" : null].filter(Boolean).join("  ·  "),
  }));
  const logName = name === "nginx" ? "nginx-error.log" : `${name}-run.log`;
  return (
    <Modal
      open={!!e}
      width={520}
      showClose={false}
      closeOnOverlay
      closeOnEscape
      onOpenChange={(o) => { if (!o) close(); }}
      footer={
        <Row justify="between" align="center" gap={12} style={{ width: "100%" }}>
          <Text size={11.5} color={willRestart ? T.accent : T.inkFaint} style={{ flex: 1 }}>
            {willRestart ? "It will restart with the new settings." : notInstalled ? "Version not installed — install it after saving." : "Enter saves the port · Esc closes"}
          </Text>
          <Row gap={8}>
            <Button variant="outline" onClick={close}>Cancel</Button>
            <Button disabled={!portOk || !!ui.busy[name] || (!!e && e.dbPass !== e.dbPass2)} onClick={() => void saveServiceSettings()}>{willRestart ? "Save and restart" : "Save"}</Button>
          </Row>
        </Row>
      }
    >
      {e ? (
        <Scroll style={{ maxHeight: "62vh", minHeight: 0 }}>
          <Column gap={14} padding={{ right: 10 }}>
            <Row gap={14} align="center" style={{ padding: 14, radius: 12, background: `linear-gradient(135deg, ${color.bg}, ${T.card})`, borderColor: T.line, borderWidth: 1 }}>
              <View style={{ width: 48, height: 48, radius: 12, background: T.card, align: "center", justify: "center", borderColor: T.line, borderWidth: 1, boxShadow: { y: 2, blur: 8, color: T.shadowHoverSm } }}>
                <Text size={name === "php" ? 14 : 17} weight={800} color={color.fg}>{color.mono}</Text>
              </View>
              <Column flex={1} gap={2}>
                <Text size={17} weight={700}>{meta.title}</Text>
                <Text size={12} color={T.inkSoft}>{meta.description}</Text>
              </Column>
              <StatusPill state={st} />
            </Row>

            <ModalLabel>GENERAL</ModalLabel>
            <Column gap={12}>
              <Column gap={6}>
                <Text size={12.5} weight={600}>Version</Text>
                {/* inline popup: Tarve's portal popup is hidden under the Modal (see src/ui/select.tsx) */}
                <Select inline id="m-version" value={e.version} options={versions} style={{ width: "100%" }} onValueChange={(v) => { e.version = v; update(); }} />
              </Column>
              <Row gap={12} align="end">
                <Column gap={6} style={{ width: 150 }}>
                  <Text size={12.5} weight={600}>Port</Text>
                  <Input
                    id="m-port"
                    value={e.port}
                    onChange={(v) => { e.port = v.replace(/\D/g, "").slice(0, 5); update(); }}
                    onSubmit={() => void saveServiceSettings()}
                    style={{ borderColor: portOk ? T.line : T.red, fontFamily: T.mono }}
                  />
                </Column>
                <Text size={11.5} color={portOk ? T.inkFaint : T.red} style={{ flex: 1, padding: { bottom: 9 } }}>
                  {!portOk ? "Use 1–65535" : name === "php" ? `Workers on ${portN}–${portN + PHP_WORKERS - 1}` : name === "nginx" ? `http://localhost${portN === 80 ? "" : `:${portN}`}/` : `127.0.0.1:${portN}`}
                </Text>
              </Row>
              <Row justify="between" align="center" style={{ padding: { top: 10, bottom: 10, left: 12, right: 12 }, radius: 10, borderColor: T.line, borderWidth: 1 }}>
                <Column gap={1} flex={1}>
                  <Text size={12.5} weight={600}>Start automatically</Text>
                  <Text size={11} color={T.inkFaint}>Included in “Start all” and when the app starts</Text>
                </Column>
                <SwitchControl checked={e.enabled} onChange={(v) => { e.enabled = v; update(); }} />
              </Row>
            </Column>

            {name === "mariadb" ? (
              <>
                <ModalLabel>CREDENTIALS</ModalLabel>
                <Column gap={10}>
                  <Row gap={12} align="end">
                    <Column gap={6} flex={1}>
                      <Text size={12.5} weight={600}>New password for {ui.cfg.mariadbUser}</Text>
                      <Input id="m-pass" type={e.showPass ? "text" : "password"} value={e.dbPass} placeholder="leave blank to keep current password" onChange={(v) => { e.dbPass = v; update(); }} />
                    </Column>
                    <Column gap={6} flex={1}>
                      <Text size={12.5} weight={600}>Confirm</Text>
                      <Input
                        id="m-pass2"
                        type={e.showPass ? "text" : "password"}
                        value={e.dbPass2}
                        onChange={(v) => { e.dbPass2 = v; update(); }}
                        onSubmit={() => void saveServiceSettings()}
                        style={{ borderColor: e.dbPass2 && e.dbPass2 !== e.dbPass ? T.red : T.line }}
                      />
                    </Column>
                  </Row>
                  <Row justify="between" align="center" gap={8}>
                    <Text size={11} color={e.dbPass2 && e.dbPass2 !== e.dbPass ? T.red : T.inkFaint} style={{ flex: 1 }}>
                      {e.dbPass2 && e.dbPass2 !== e.dbPass ? "Passwords don't match" : mariaDbInitialized(ui.cfg) ? "Applied to the database (ALTER USER); starts MariaDB if it's stopped." : "Used when the data directory is created on first startup."}
                    </Text>
                    <IconButton icon={e.showPass ? "eyeOff" : "eye"} label={e.showPass ? "Hide" : "Show"} onClick={() => { e.showPass = !e.showPass; update(); }} />
                  </Row>
                </Column>
              </>
            ) : null}

            <ModalLabel>FILES</ModalLabel>
            <Column gap={6}>
              <FileRow icon="file" label="Configuration" path={configFileOf(ui.cfg, name)} missing="created on first startup" />
              <FileRow icon="folder" label="Binaries" path={binDir(ui.cfg.root, name, ui.cfg.services[name].version)} missing="version not installed" />
              <FileRow icon="logs" label="Log" path={join(logsDir(ui.cfg.root), logName)} missing="no log yet" />
            </Column>
          </Column>
        </Scroll>
      ) : null}
    </Modal>
  );
}
