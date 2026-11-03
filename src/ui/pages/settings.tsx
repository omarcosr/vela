/** Ajustes: general preferences, stack folder, ports, danger zone. */
import { Button, Column, Input, openExternal, Pressable, Row, Scroll, Text } from "@tarve/core";
import { ALL_SERVICES, PHP_WORKERS, resetMariaDbDatadir } from "../../core/services";
import { binDir, configPath, dataDir } from "../../core/config";
import { ask, SERVICE_META, toast, ui, update } from "../store";
import { Field, Glyph, Section, SwitchControl } from "../components";
import { PageHeader, THEME_OPTIONS } from "../chrome";
import { onTrustCa, saveHttpsPort, savePorts, saveRoot, setPref, setSiteTld, setTheme, toggleAutostart, withBusy } from "../actions";
import { T } from "../theme";

export function SettingsPage() {
  return (
    <Column flex={1}>
      <PageHeader title="Settings" subtitle={configPath()} />
      <Scroll flex={1}>
        <Column gap={14} padding={{ left: 24, right: 24, bottom: 24 }} style={{ maxWidth: 820 }}>
          <Section title="General" description="Appearance, notifications, and what happens when you open and close the app.">
            <Field label="Theme" hint="System follows the Windows app theme">
              <ThemeSegmented />
            </Field>
            <Field label="Notify on crashes" hint="Windows notification when a service stops unexpectedly">
              <SwitchControl checked={ui.cfg.notifyCrash} onChange={(v) => setPref("notifyCrash", v)} />
            </Field>
            <Field label="Notify on installs" hint="When a download or installation finishes">
              <SwitchControl checked={ui.cfg.notifyInstall} onChange={(v) => setPref("notifyInstall", v)} />
            </Field>
            <Field label="Tray icon" hint="Quick menu to start and stop services">
              <SwitchControl checked={ui.cfg.tray} onChange={(v) => setPref("tray", v)} />
            </Field>
            <Field label="Close to tray" hint={ui.cfg.tray ? "The X hides the window; quit from the tray menu" : "Requires the tray icon"}>
              <SwitchControl disabled={!ui.cfg.tray} checked={ui.cfg.closeToTray} onChange={(v) => setPref("closeToTray", v)} />
            </Field>
            <Field label="Open at sign-in" hint={ui.autostart === null ? "Only for the installed Vela.exe" : "Start Vela minimized when you sign in to Windows"}>
              <SwitchControl disabled={ui.autostart == null} checked={!!ui.autostart} onChange={(v) => void toggleAutostart(v)} />
            </Field>
            <Field label="Start on launch" hint="Starts services set to auto-start">
              <SwitchControl checked={ui.cfg.autoStart} onChange={(v) => setPref("autoStart", v)} />
            </Field>
            <Field label="Stop on exit" hint="Stops services Vela started when you exit">
              <SwitchControl checked={ui.cfg.stopOnExit} onChange={(v) => setPref("stopOnExit", v)} />
            </Field>
          </Section>

          <Section title="Sites" description="How projects in the Sites tab are served.">
            <Field label="Domain" hint={ui.cfg.siteTld === "test" ? "Edits the hosts file (requires administrator access)" : "Chrome, Edge, and Firefox resolve names automatically"}>
              <Row gap={4} style={{ background: T.paperAlt, radius: 10, padding: 4, borderColor: T.line, borderWidth: 1 }}>
                {(["localhost", "test"] as const).map((tld) => {
                  const on = ui.cfg.siteTld === tld;
                  return (
                    <Pressable
                      key={tld}
                      onClick={() => void setSiteTld(tld)}
                      style={{ radius: 7, padding: { top: 6, bottom: 6, left: 12, right: 12 }, background: on ? T.card : "transparent", boxShadow: on ? { y: 1, blur: 3, color: T.shadowHoverSm } : undefined, hover: on ? {} : { background: T.paper } }}
                    >
                      <Text size={12.5} weight={on ? 600 : 450} color={on ? T.ink : T.inkSoft} style={{ fontFamily: T.mono }}>{`site.${tld}`}</Text>
                    </Pressable>
                  );
                })}
              </Row>
            </Field>
            <Field label="HTTPS port" hint="Used by sites with HTTPS enabled">
              <Input id="https-port" value={ui.form.httpsPort} onChange={(v) => { ui.form.httpsPort = v.replace(/\D/g, "").slice(0, 5); update(); }} onSubmit={saveHttpsPort} style={{ width: 110, fontFamily: T.mono }} />
              <Button size="sm" variant="outline" onClick={saveHttpsPort}>Save</Button>
            </Field>
            <Field label="Local certificate" hint={ui.caTrusted ? "Trusted by Windows: HTTPS without warnings" : "Install so your browser trusts site HTTPS connections"}>
              {ui.caTrusted ? (
                <Row gap={6} align="center">
                  <Glyph name="check" size={14} color={T.green} />
                  <Text size={12.5} color={T.green}>Installed</Text>
                </Row>
              ) : (
                <Button size="sm" onClick={() => void onTrustCa()}>Install Vela certificate</Button>
              )}
            </Field>
          </Section>

          <Section title="Stack" description="Where binaries, data, logs, and sites are stored.">
            <Field label="Stack folder" hint="bin, data, logs, www">
              <Input id="root-input" value={ui.form.root} onChange={(v) => { ui.form.root = v; }} onSubmit={saveRoot} style={{ flex: 1 }} />
              <Button size="sm" variant="outline" onClick={() => openExternal(ui.cfg.root)}>Open</Button>
              <Button size="sm" onClick={saveRoot}>Save</Button>
            </Field>
          </Section>

          <Section title="Ports" description={`PHP uses ${PHP_WORKERS} consecutive ports starting from the configured port.`}>
            {ALL_SERVICES.map((s) => (
              <Field key={s} label={SERVICE_META[s].title} hint={s === "php" ? `${ui.form.ports.php}–${Number(ui.form.ports.php) + PHP_WORKERS - 1}` : undefined}>
                <Input id={`port-${s}`} value={ui.form.ports[s]} onChange={(v) => { ui.form.ports[s] = v.replace(/\D/g, ""); update(); }} onSubmit={savePorts} style={{ width: 110 }} />
              </Field>
            ))}
            <Row justify="end" padding={{ top: 6, bottom: 8 }}>
              <Button size="sm" onClick={savePorts}>Save ports</Button>
            </Row>
          </Section>

          <Section title="Danger zone" description="Actions that delete data. Confirmation required.">
            <Field label="Reset MariaDB" hint="Deletes data/mariadb; recreated on next launch">
              <Button
                size="sm"
                variant="destructive"
                disabled={!!ui.busy.mariadb}
                onClick={() =>
                  ask(
                    "Delete all databases?",
                    `This stops MariaDB and completely removes ${dataDir(ui.cfg.root, "mariadb")}. This can't be undone.`,
                    "Delete datadir",
                    () =>
                      void withBusy("mariadb", async () => {
                        await resetMariaDbDatadir(ui.cfg);
                        toast("MariaDB datadir deleted", "It will be recreated with the configured password.", "success");
                      }),
                  )
                }
              >
                Reset datadir
              </Button>
            </Field>
          </Section>

          <Section title="About">
            <Column gap={6} padding={{ top: 4, bottom: 10 }}>
              <Text size={12.5} color={T.inkSoft}>Vela — a native alternative to WNMP. Portable Nginx + PHP (FastCGI) + MariaDB + Redis, managed by a Tarve app (native TSX, no WebView).</Text>
              <Text size={11.5} color={T.inkFaint} style={{ fontFamily: T.mono, userSelect: "text" }}>{binDir(ui.cfg.root, "<service>", "<version>")}</Text>
            </Column>
          </Section>
        </Column>
      </Scroll>
    </Column>
  );
}

/** Same choice on the Ajustes page, themed with the content area. */
function ThemeSegmented() {
  return (
    <Row gap={4} style={{ background: T.paperAlt, radius: 10, padding: 4, borderColor: T.line, borderWidth: 1 }}>
      {THEME_OPTIONS.map((o) => {
        const on = ui.cfg.theme === o.value;
        return (
          <Pressable
            key={o.value}
            onClick={() => setTheme(o.value)}
            style={{
              direction: "row",
              gap: 7,
              align: "center",
              radius: 7,
              padding: { top: 6, bottom: 6, left: 12, right: 12 },
              background: on ? T.card : "transparent",
              boxShadow: on ? { y: 1, blur: 3, color: T.shadowHoverSm } : undefined,
              hover: on ? {} : { background: T.paper },
            }}
          >
            <Glyph name={o.icon} size={14} color={on ? T.accent : T.inkFaint} />
            <Text size={12.5} weight={on ? 600 : 450} color={on ? T.ink : T.inkSoft}>{o.label}</Text>
          </Pressable>
        );
      })}
    </Row>
  );
}
