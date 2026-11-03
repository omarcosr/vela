/** Sites: projects served on their own domain (<name>.localhost / <name>.test), with their dialogs. */
import { Button, Column, Input, Modal, openExternal, Pressable, Row, Scroll, Spinner, Text, View } from "@tarve/core";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { SITE_NAME, type SiteConfig } from "../../core/config";
import { docrootCandidates, siteDomain, siteEntry, siteRoot, siteUrl } from "../../core/sites";
import { dbNameFor, TEMPLATES } from "../../core/templates";
import { anyBusy, findStatus, ui, update } from "../store";
import { GearButton, Glyph, IconButton, SwitchControl } from "../components";
import {
  confirmRemoveSite,
  onToggleRun,
  openNewSite,
  openSite,
  openSiteInEditor,
  openSiteLogs,
  openSiteSettings,
  openSiteTerminal,
  pickFolderForSite,
  saveSiteSettings,
  submitNewSite,
} from "../actions";
import { PageHeader } from "../chrome";
import { Select } from "../select";
import { S, T } from "../theme";

export function SitesPage() {
  const nginx = findStatus("nginx");
  const nginxUp = nginx.status === "running";
  const sites = ui.cfg.sites;
  return (
    <Column flex={1} align="stretch">
      <PageHeader
        title="Sites"
        subtitle={`${sites.length} ${sites.length === 1 ? "site" : "sites"} · *.${ui.cfg.siteTld}`}
        actions={
          <Row gap={8} align="center">
            <Button variant="outline" onClick={() => void pickFolderForSite()}>
              <Row gap={6} align="center">
                <Glyph name="folderPlus" size={14} color={T.inkSoft} />
                <Text size={13}>Add Folder</Text>
              </Row>
            </Button>
            <Button onClick={() => openNewSite()}>
              <Row gap={6} align="center">
                <Glyph name="plus" size={14} color={T.onPrimary} />
                <Text size={13} weight={600} color={T.onPrimary}>New Site</Text>
              </Row>
            </Button>
          </Row>
        }
      />
      {!nginxUp ? (
        <Row gap={10} align="center" style={{ margin: { left: 24, right: 24, bottom: 12 }, background: T.amberBg, borderColor: T.amberLine, borderWidth: 1, radius: 10, padding: { top: 9, bottom: 9, left: 12, right: 12 } }}>
          <Glyph name="alert" size={15} color={T.accent} />
          <Text size={12.5} color={T.accent} style={{ flex: 1 }}>
            {nginx.status === "occupied" ? `Port ${nginx.port} is in use by ${nginx.owner}: sites won't open until you free the port or change Nginx's port.` : "Nginx is stopped: sites only open while it's running."}
          </Text>
          {nginx.status !== "occupied" ? (
            <Button size="sm" variant="outline" disabled={anyBusy() || nginx.status === "not-installed"} onClick={() => void onToggleRun("nginx")}>Start Nginx</Button>
          ) : null}
        </Row>
      ) : null}
      <Scroll flex={1}>
        <View padding={{ top: 4, left: 24, right: 24, bottom: 24 }} style={{ display: "grid", columns: "repeat(auto-fill, minmax(330px, 1fr))", gap: 12 }}>
          {sites.map((s) => (
            <SiteCard key={s.name} site={s} live={nginxUp} />
          ))}
          {sites.length === 0 ? (
            <Column gap={8} align="center" style={{ ...S.card, padding: 36, gridColumn: "1 / -1" }}>
              <Glyph name="sites" size={30} color={T.lineStrong} />
              <Text size={15} weight={650}>No sites yet</Text>
              <Text size={12.5} color={T.inkFaint}>Create a project (blank, Laravel, or WordPress) or add an existing folder.</Text>
              <Row gap={8} style={{ margin: { top: 6 } }}>
                <Button variant="outline" onClick={() => void pickFolderForSite()}>Add Folder</Button>
                <Button onClick={() => openNewSite()}>New Site</Button>
              </Row>
            </Column>
          ) : null}
        </View>
      </Scroll>
      <NewSiteModal />
      <SiteSettingsModal />
    </Column>
  );
}

function Chip(props: { icon?: string; label: string; tone?: string }) {
  return (
    <Row gap={4} align="center" style={{ ...S.chip, padding: { top: 2, bottom: 2, left: 6, right: 7 } }}>
      {props.icon ? <Glyph name={props.icon} size={11} color={props.tone ?? T.inkFaint} /> : null}
      <Text size={11} weight={600} color={props.tone ?? T.inkSoft}>{props.label}</Text>
    </Row>
  );
}

function SiteCard(props: { site: SiteConfig; live: boolean }) {
  const s = props.site;
  const task = ui.siteTasks[s.name];
  const missing = !existsSync(s.path);
  const entry = missing ? null : siteEntry(s);
  const php = s.php ?? ui.cfg.services.php.version;
  return (
    <Column gap={12} style={{ ...S.card, padding: 16 }}>
      <Row gap={12} align="center">
        <View style={{ width: 38, height: 38, radius: 10, background: T.accentBg, align: "center", justify: "center", shrink: 0 }}>
          <Text size={16} weight={750} color={T.accent}>{s.name.slice(0, 1).toUpperCase()}</Text>
        </View>
        <Column flex={1} gap={2} style={{ minWidth: 0 }}>
          <Text size={14.5} weight={650}>{s.name}</Text>
          <Pressable
            disabled={!props.live}
            onClick={() => openSite(s.name)}
            style={{ direction: "row", gap: 5, align: "center", cursor: props.live ? "pointer" : "default" }}
          >
            <Text size={12} color={props.live ? T.accent : T.inkFaint} style={{ fontFamily: T.mono }}>{siteUrl(ui.cfg, s).replace(/\/$/, "")}</Text>
            {props.live ? <Glyph name="external" size={11} color={T.accent} /> : null}
          </Pressable>
        </Column>
        <GearButton onClick={() => openSiteSettings(s.name)} />
      </Row>

      <Row gap={6} align="center" style={{ wrap: true }}>
        <Chip label={`PHP ${php}`} tone={s.php ? T.accent : undefined} />
        {s.https ? <Chip icon="lock" label="HTTPS" tone={T.green} /> : null}
        <Chip label={missing ? "folder missing" : entry ?? "no index"} tone={missing || !entry ? T.red : undefined} />
      </Row>

      <Row gap={6} align="center" style={{ minWidth: 0 }}>
        <Glyph name="folder" size={12} color={T.inkFaint} />
        <Text size={11} color={T.inkFaint} style={{ fontFamily: T.mono, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", userSelect: "text" }}>{siteRoot(s)}</Text>
      </Row>

      {task ? (
        <Row gap={8} align="center" style={{ background: T.blueBg, radius: 8, padding: { top: 7, bottom: 7, left: 10, right: 10 } }}>
          <Spinner size={11} />
          <Text size={11.5} color={T.blue} style={{ flex: 1 }}>{task}</Text>
        </Row>
      ) : null}

      <View style={{ height: 1, background: T.line }} />
      <Row justify="between" align="center" gap={2}>
        <Row gap={0} align="center">
          <IconButton icon="globe" label="Open" disabled={!props.live} onClick={() => openSite(s.name)} />
          <IconButton icon="code" label="VS Code" disabled={missing} onClick={() => openSiteInEditor(s.name)} />
          <IconButton icon="terminal" label="Terminal" disabled={missing} onClick={() => openSiteTerminal(s.name)} />
          <IconButton icon="folder" label="Folder" disabled={missing} onClick={() => openExternal(s.path)} />
        </Row>
        <IconButton icon="logs" label="Logs" onClick={() => openSiteLogs(s.name)} />
      </Row>
    </Column>
  );
}

function Label(props: { children: string; hint?: string }) {
  return (
    <Row justify="between" align="baseline">
      <Text size={12.5} weight={600}>{props.children}</Text>
      {props.hint ? <Text size={11} color={T.inkFaint}>{props.hint}</Text> : null}
    </Row>
  );
}

function ToggleRow(props: { icon: string; title: string; hint: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <Row gap={12} align="center" style={{ padding: { top: 10, bottom: 10, left: 12, right: 12 }, radius: 10, borderColor: T.line, borderWidth: 1 }}>
      <Glyph name={props.icon} size={16} color={props.checked ? T.accent : T.inkFaint} />
      <Column flex={1} gap={1}>
        <Text size={12.5} weight={600}>{props.title}</Text>
        <Text size={11} color={T.inkFaint}>{props.hint}</Text>
      </Column>
      <SwitchControl checked={props.checked} disabled={props.disabled} onChange={props.onChange} />
    </Row>
  );
}

function NewSiteModal() {
  const d = ui.newSite;
  const name = d?.name.trim() ?? "";
  const valid = SITE_NAME.test(name) && !ui.cfg.sites.some((s) => s.name === name);
  const close = () => { ui.newSite = null; update(); };
  const mariaOk = ui.installed.mariadb.includes(ui.cfg.services.mariadb.version);
  return (
    <Modal open={!!d} width={520} showClose={false} closeOnOverlay closeOnEscape onOpenChange={(o) => { if (!o) close(); }}
      footer={
        <Row justify="between" align="center" gap={12} style={{ width: "100%" }}>
          <Text size={11.5} color={T.inkFaint} style={{ flex: 1 }}>{d?.folder ? "Files will stay where they are." : "Created in www."}</Text>
          <Row gap={8}>
            <Button variant="outline" onClick={close}>Cancel</Button>
            <Button disabled={!valid} onClick={() => void submitNewSite()}>{d?.folder ? "Add" : "Create Site"}</Button>
          </Row>
        </Row>
      }
    >
      {d ? (
        <Column gap={16}>
          <Column gap={2}>
            <Text size={17} weight={700}>{d.folder ? "Add Folder" : "New Site"}</Text>
            <Text size={12} color={T.inkFaint} style={{ fontFamily: d.folder ? T.mono : undefined }}>{d.folder ?? "Choose a name and a starting point."}</Text>
          </Column>

          <Column gap={6}>
            <Label hint={valid ? `${name}.${ui.cfg.siteTld}` : name ? "lowercase letters, numbers, and -" : undefined}>Name</Label>
            <Input
              id="ns-name"
              value={d.name}
              placeholder="my-project"
              onChange={(v) => { d.name = v.toLowerCase().replace(/[^a-z0-9-]/g, "-"); update(); }}
              onSubmit={() => valid && void submitNewSite()}
              style={{ fontFamily: T.mono, borderColor: !name || valid ? T.line : T.red }}
            />
          </Column>

          {!d.folder ? (
            <Column gap={6}>
              <Label>Template</Label>
              <Row gap={8}>
                {TEMPLATES.map((t) => {
                  const on = d.template === t.value;
                  return (
                    <Pressable
                      key={t.value}
                      onClick={() => { d.template = t.value; d.db = t.value !== "blank" && mariaOk; update(); }}
                      style={{ flex: 1, gap: 3, radius: 10, padding: 12, background: on ? T.accentBg : T.card, borderColor: on ? T.accentSoft : T.line, borderWidth: 1, hover: on ? {} : { borderColor: T.lineStrong } }}
                    >
                      <Text size={13} weight={650} color={on ? T.accent : T.ink}>{t.label}</Text>
                      <Text size={10.5} color={T.inkFaint}>{t.hint}</Text>
                    </Pressable>
                  );
                })}
              </Row>
            </Column>
          ) : null}

          <Column gap={8}>
            <ToggleRow
              icon="database"
              title={`Create database “${dbNameFor(name || "my_project")}”`}
              hint={mariaOk ? (d.template === "blank" || d.folder ? "Blank, using Vela's MariaDB" : "And configured in the project") : "Install MariaDB to use this"}
              checked={d.db && mariaOk}
              disabled={!mariaOk}
              onChange={(v) => { d.db = v; update(); }}
            />
            <ToggleRow icon="lock" title="HTTPS" hint={`https://${name || "site"}.${ui.cfg.siteTld} with a local Vela certificate`} checked={d.https} onChange={(v) => { d.https = v; update(); }} />
          </Column>
        </Column>
      ) : null}
    </Modal>
  );
}

function SiteSettingsModal() {
  const e = ui.siteEdit;
  const s = e ? ui.cfg.sites.find((x) => x.name === e.name) : undefined;
  const close = () => { ui.siteEdit = null; update(); };
  const newName = e?.newName.trim() ?? "";
  const valid = SITE_NAME.test(newName) && (newName === e?.name || !ui.cfg.sites.some((x) => x.name === newName));
  const roots = s ? ["", ...docrootCandidates(s.path)] : [""];
  const phpVersions = ui.installed.php;
  return (
    <Modal open={!!e && !!s} width={520} showClose={false} closeOnOverlay closeOnEscape onOpenChange={(o) => { if (!o) close(); }}
      footer={
        <Row justify="between" align="center" gap={12} style={{ width: "100%" }}>
          <Button variant="ghost" onClick={() => e && confirmRemoveSite(e.name)}>
            <Row gap={6} align="center">
              <Glyph name="trash-2" size={14} color={T.red} />
              <Text size={13} color={T.red}>Remove</Text>
            </Row>
          </Button>
          <Row gap={8}>
            <Button variant="outline" onClick={close}>Cancel</Button>
            <Button disabled={!valid} onClick={() => void saveSiteSettings()}>Save</Button>
          </Row>
        </Row>
      }
    >
      {e && s ? (
        <Scroll style={{ maxHeight: "62vh", minHeight: 0 }}>
          <Column gap={16} padding={{ right: 10 }}>
            <Column gap={2}>
              <Text size={17} weight={700}>{s.name}</Text>
              <Text size={12} color={T.inkFaint} style={{ fontFamily: T.mono, userSelect: "text" }}>{s.path}</Text>
            </Column>

            <Column gap={6}>
              <Label hint={valid ? `${newName}.${ui.cfg.siteTld}` : "lowercase letters, numbers, and -"}>Domain</Label>
              <Input id="se-name" value={e.newName} onChange={(v) => { e.newName = v.toLowerCase().replace(/[^a-z0-9-]/g, "-"); update(); }} style={{ fontFamily: T.mono, borderColor: valid ? T.line : T.red }} />
            </Column>

            <Column gap={6}>
              <Label hint="where Nginx serves files">Document Root</Label>
              <Select
                inline
                id="se-root"
                value={e.docroot}
                options={roots.map((r) => ({ value: r, label: r ? `${r}${existsSync(join(s.path, r, "index.php")) ? "  ·  index.php found" : ""}` : "(the project folder itself)" }))}
                style={{ width: "100%" }}
                onValueChange={(v) => { e.docroot = v; update(); }}
              />
            </Column>

            <Column gap={6}>
              <Label hint="installed versions only">PHP</Label>
              <Select
                inline
                id="se-php"
                value={e.php}
                options={[{ value: "", label: `Vela default (${ui.cfg.services.php.version})` }, ...phpVersions.filter((v) => v !== ui.cfg.services.php.version).map((v) => ({ value: v, label: `PHP ${v}` }))]}
                style={{ width: "100%" }}
                onValueChange={(v) => { e.php = v; update(); }}
              />
            </Column>

            <ToggleRow icon="lock" title="HTTPS" hint={ui.caTrusted === false ? "The Vela certificate isn't trusted yet: install it in Settings" : "Local Vela certificate"} checked={e.https} onChange={(v) => { e.https = v; update(); }} />
          </Column>
        </Scroll>
      ) : null}
    </Modal>
  );
}
