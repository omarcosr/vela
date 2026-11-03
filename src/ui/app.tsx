/** Root view and bootstrap: wires the pages, dialogs and the refresh loop. */
import { AlertDialog, Column, createApp, Row, Toaster, Window, requestSingleInstance } from "@tarve/core";
import { ALL_SERVICES, stopAllServices } from "../core/services";
import { APP_ID, APP_NAME } from "../core/config";
import { onUnexpectedExit } from "../core/proc";
import type { ServiceName } from "../core/manifest";
import { applyTheme, goTo, onCrash, onStartAll, openNewSite, openServiceSettings, openSiteSettings, refresh, registerHotkeys } from "./actions";
import { AppTitleBar, ShortcutsDialog, Sidebar } from "./chrome";
import { LogsPage } from "./pages/logs";
import { openSelect } from "./select";
import { ServiceSettingsModal } from "./pages/service-modal";
import { ServicesPage } from "./pages/services";
import { SettingsPage } from "./pages/settings";
import { SitesPage } from "./pages/sites";
import { T, windowTheme } from "./theme";
import { type Tab, ui, update } from "./store";
import iconPath from "../../assets/icon.png" with { type: "file" };

export function App() {
  const c = ui.confirm;
  return (
    <Window title="Vela — stack manager" width={1080} height={720} minWidth={880} minHeight={560} position="center" theme={windowTheme()} frameless onCloseRequest={(ev) => {
      if (!ui.quitting && ui.cfg.closeToTray && ui.cfg.tray && ui.tray) {
        ev.preventDefault();
        ui.handle?.hide();
      }
    }}>
      <Column flex={1} align="stretch" style={{ background: T.paper, height: "100%" }}>
        <AppTitleBar />
        <Row flex={1} align="stretch" style={{ minHeight: 0 }}>
          <Sidebar />
          <Column flex={1} align="stretch" style={{ overflow: "hidden", minWidth: 0 }}>
            {ui.tab === "services" ? <ServicesPage /> : ui.tab === "sites" ? <SitesPage /> : ui.tab === "logs" ? <LogsPage /> : <SettingsPage />}
          </Column>
        </Row>
        <Toaster toasts={ui.toasts} position="bottom-right" onDismiss={(id) => { ui.toasts = ui.toasts.filter((t) => t.id !== id); update(); }} />
        <AlertDialog
          id="confirm"
          open={!!c}
          title={c?.title ?? ""}
          description={c?.description}
          cancelLabel="Cancel"
          actionLabel={c?.actionLabel ?? "OK"}
          actionVariant={c?.destructive ? "destructive" : "default"}
          closeOnEscape
          onCancel={() => { ui.confirm = null; update(); }}
          onOpenChange={(o) => { if (!o) { ui.confirm = null; update(); } }}
          onAction={() => { ui.confirm = null; update(); c?.run(); }}
        />
        <ServiceSettingsModal />
        <ShortcutsDialog />
      </Column>
    </Window>
  );
}

export function appClosed(): Promise<void> {
  if (!ui.handle) return Promise.resolve();
  return ui.handle.closed;
}

/** Called once the window is gone: stop the stack if the user asked for it. */
export async function shutdown(): Promise<void> {
  if (ui.refreshTimer) clearInterval(ui.refreshTimer);
  ui.tray?.remove();
  if (ui.cfg.stopOnExit) await stopAllServices(ui.cfg).catch(() => []);
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------


if (process.env.VELA_THEME === "dark" || process.env.VELA_THEME === "light") ui.cfg.theme = process.env.VELA_THEME;
await applyTheme();
// one Vela per user: two managers would fight over the same processes and ports
const instance = process.env.VELA_CAPTURE ? null : await requestSingleInstance({ id: APP_ID }).catch(() => null);
if (instance && !instance.primary) process.exit(0);
onUnexpectedExit(onCrash);
ui.handle = createApp(App, { renderer: "cpu", rememberWindow: !process.env.VELA_CAPTURE, debug: !!process.env.VELA_CAPTURE, icon: iconPath, appIdentity: { id: APP_ID, name: APP_NAME, icon: iconPath } });
instance?.onSecondInstance(() => ui.handle?.activate());
// "Open at sign-in" launches with --minimized: straight to the tray (or the taskbar without one)
if (process.argv.includes("--minimized")) setTimeout(() => (ui.cfg.tray ? ui.handle?.hide() : ui.handle?.minimize()), 300);
registerHotkeys();
void refresh().then(() => {
  if (ui.cfg.autoStart) void onStartAll();
});
ui.refreshTimer = setInterval(() => void refresh(), 3000);

// Docs/CI: `VELA_CAPTURE=docs/shot.png [VELA_TAB=logs] bun src/main.tsx` saves a screenshot and exits.
if (process.env.VELA_CAPTURE) {
  const out = process.env.VELA_CAPTURE;
  const t = process.env.VELA_TAB as Tab | undefined;
  setTimeout(async () => {
    if (t) goTo(t);
    const m = process.env.VELA_MODAL as ServiceName | undefined;
    if (m && ALL_SERVICES.includes(m)) openServiceSettings(m);
    if (process.env.VELA_OPEN_SELECT) openSelect(process.env.VELA_OPEN_SELECT);
    if (process.env.VELA_HELP) ui.helpOpen = true;
    if (process.env.VELA_NEWSITE) openNewSite();
    if (process.env.VELA_SITE) openSiteSettings(process.env.VELA_SITE);
    update();
    await new Promise((r) => setTimeout(r, 800));
    try {
      await ui.handle?.capture(out);
    } finally {
      ui.handle?.close();
    }
  }, 2500);
}
