# Tarve API Cheat-Sheet (@tarve/core 0.9.0)

Fonte única de verdade: `node_modules/@tarve/core/dist/types/core/src/*.d.ts`. Todos os snippets abaixo refletem exatamente as assinaturas dos `.d.ts`.

Importação: `import { ... } from "@tarve/core"` — o barrel é `index.d.ts`.

---

## 1. Bootstrap

```ts
// app.d.ts
function createApp(view: () => VNode, options?: AppOptions): AppHandle;
function render(view: () => VNode, options?: AppOptions): Promise<void>;
// render() roda até a janela fechar; um 2º call no mesmo processo (bun --hot) remonta na janela aberta.
```

```tsx
import { render } from "@tarve/core";
import { App } from "./app-view";
await render(App);
```

`AppOptions` (todos opcionais): `debug, headless, renderer ("auto"|"gpu"|"cpu"), componentAdapters, bridge, onError, dev (boolean|{inspector}), frameOverlay, maxFps (number|null, default 60), fontFaces, rememberWindow (boolean|string), closeBehavior ("exit"|"hide"), msaa (0|2|4|8), textRendering, keyboardEvents, pointerEvents, memoryTrimDelay, lowPower, appIdentity {id,name,icon?}, icon, protocols, fileTypes, plugins`.

`AppHandle` (principais): `ready`, `closed` (Promises), `update()`, `flush()`, `layout(ids)`, `close()`, `openWindow(view, opts)`, `focus(id)`, `registerHotkey(shortcut, handler)`, `show()/hide()/minimize()/activate()`, `setMaximized/setFullscreen/toggleFullscreen`, `tray(options)`, `menuBar(items|null)`, `notify(options)`, `onEvent(listener)`, `onOpenUrl`, `onOpenFiles`, `remount(view)`, `inspect()`, `stats()`, `capture(path)`, file dialogs (`openFileDialog`, `saveFileDialog`, …).

### Window

```tsx
<Window title="App" width={900} height={800} minWidth={700} minHeight={560}
        position="center" theme={lightTheme} maximized resizable frameless={false}
        backdrop="mica" onCloseRequest={(e) => { /* e.preventDefault() para bloquear */ }}>
  ...
</Window>
```

`WindowProps extends ViewProps`: `title?, width?, height?, minWidth?, minHeight?, resizable?, maximized?, position? (preset "center"… ou {x,y,physical?}), level? ("normal"|"alwaysOnTop"|"alwaysOnBottom"), skipTaskbar?, frameless?, desktopWidget? ({columns,rows}), backdrop? ("none"|"transparent"|"blur"|"mica"|"acrylic"), theme? (ThemeDefinition), onCloseRequest?`.

### TitleBar

```tsx
<TitleBar title="App" height={40} showMinimize showMaximize showClose
          leading={<Icon name="search" />} actions={<Button size="sm">Go</Button>} />
```

`TitleBarProps extends ViewProps`: `title?, height?, showMinimize?, showMaximize?, showClose?, buttonStyle?, glass? (boolean|GlassVariant), appearance? ("light"|"dark"), leading?, actions?, onBack?` + `children`.

---

## 2. Layout

`View`, `Row`, `Column`, `Portal` compartilham `ViewProps` (Row/Column são direções nativas; `Portal` desenha sobre a árvore):

```tsx
<Row gap={16} padding={24} align="center" justify="between" flex={1}>…</Row>
<Column gap={6} style={{ width: "100%" }}>…</Column>
```

`ViewProps extends BaseProps`: `gap?: number; padding?: Insets; flex?: number|string; align?: "start"|"center"|"end"|"stretch"|"baseline"; justify?: "start"|"center"|"end"|"between"|"around"|"evenly"|"stretch"; portal?: boolean; dismissOnOutside?: boolean; onOutsideClick?: () => void; dragRegion?: boolean; windowAction?: "minimize"|"toggleMaximize"|"toggleFullscreen"|"close"; focusable?: boolean` + drop targets (`onDrop`, `onFileDrop`, …).

- `Scroll` / `ScrollArea` (alias, mesmas props — `ScrollAreaProps = ScrollProps`): `extends ViewProps` + `speed?: number; orientation?: "vertical"|"horizontal"|"both"; onScroll?: (offset, max, info) => void; onScrollPosition?: (position) => void`.
- `Separator`: `orientation?: "horizontal" | "vertical"` + BaseProps.
- `Pressable`: `extends ViewProps, DraggableProps` + `disabled?, onClick?, onContextMenu?(pos), onLongPress?, onPinch?, onHover?(hovered), control?, focusable?, onEscape?, onKeyDown?(key), onBlur?, modal?`.

`BaseProps` (base de quase tudo): `id?, key?, children?, style?: Style, className?/class? (Tailwind via tw), rovingGroup?, highlight?, motionFrom?, onTransitionEnd?, onPaste?, onSize?, onPointerMove?, onPointerLeave?`.

---

## 3. Texto

```tsx
<Text size={26} weight={650}>Título</Text>
<Text color={theme.colors.mutedForeground}>secundário</Text>
```

- `Text`: `size?: number; weight?: number; color?: string; style?: IntrinsicStyle; children?` (o estilo nativo usa `foreground`/`fontSize`/`fontWeight`; `color` é atalho).
- `Typography`: `variant?: "h1"|"h2"|"h3"|"h4"|"p"|"lead"|"large"|"small"|"muted"|"code"|"blockquote"`.
- `Label`: `required?, disabled?, onClick?` + children.
- `Link`: **`href: string` (obrigatório)**, `style?: IntrinsicStyle`, `label?` (a11y) + resto de Pressable. Abre via handler do SO.
- `Badge`: `variant?: "default"|"secondary"|"outline"|"destructive"`.
- `Kbd`: sem props próprias (children).
- `Icon`: `name?: IconName; iconNode?: readonly SvgNode[]; size?: number; color?: string; strokeWidth?: number`. `IconName`: `check, x, plus, minus, chevron-down, chevron-up, chevron-right, chevron-left, search, info, house, settings, user, bell, heart, star, download, trash-2, folder, mail, play, pause, skip-back, skip-forward`. Ícones custom: `iconNode={ [["path", { d: "…" }]] }`.

---

## 4. Inputs

```tsx
<Button variant="outline" size="sm" disabled={false} onClick={() => {}}>Salvar</Button>
// variant: "default" | "secondary" | "outline" | "ghost" | "destructive"
// size: "sm" | "default" | "lg"

<Input type="email" value={email} placeholder="voce@x.com"
       onChange={v => { email = v; }} onSubmit={v => {}} />

<TextArea value={notes} submitOnEnter onChange={v => {}} onSubmit={v => {}} />

<Checkbox label="Enviar updates" checked={updates}
          onCheckedChange={v => { updates = v; }} />

<Switch label="Notificações" checked={on} onCheckedChange={v => { on = v; }} />
```

- `ButtonProps`: `variant?, size?, disabled?, control?, onClick?, onHover?` + BaseProps. `CheckboxProps`/`SwitchProps`: **`checked: boolean; label: string` obrigatórios**, `disabled?, onCheckedChange?(checked)`.
- `Slider`: `value: number` (obrigatório), `min?, max?, step?, label?, orientation?, disabled?, onValueChange?(value: number)`.
- `Toggle`: `pressed: boolean` (obrig.), `label?, disabled?, variant? ("default"|"outline"), size?, onPressedChange?(pressed)`.
- `ToggleGroup`: `type?: "single"|"multiple"; value: string | string[]; items: readonly {value,label,content?,disabled?}[]; disabled?, onValueChange?(value: string|string[])`.
- `RadioGroup`: `value: string; options: {value,label,disabled?}[]; orientation?, disabled?, onValueChange?(value: string)`.

### Select / Combobox — formato exato

```tsx
<Select id="role" value={role} placeholder="Escolha…"
        options={[{ value: "dev", label: "Developer" }]}
        onValueChange={v => { role = v; }} />
```

- `SelectProps`: **`id: string` OBRIGATÓRIO**, `value?: string; options: readonly SelectOption[]; placeholder?, disabled?, open?, onOpenChange?, onValueChange?(value: string)`. `SelectOption = { value: string; label: string; disabled?: boolean }`.
- `NativeSelect`: mesmas props (shadcn-like).
- `Combobox`: **`id, open, query, options` obrigatórios**; `value?, placeholder?, searchPlaceholder?, emptyText?, disabled?, onOpenChange?, onQueryChange?, onValueChange?`. `ComboboxOption = { value, label, keywords?, disabled? }`. Totalmente controlado (você controla `open` + `query`).
- `Select`/`NativeSelect` também aceitam `open`/`onOpenChange` opcionais (uncontrolled default).

---

## 5. Feedback

```tsx
<Spinner size={20} label="Carregando…" />
<Progress value={72} max={100} label="Upload" />
<Alert variant="success" title="Salvo" description="Tudo certo." />
<Skeleton width={200} height={12} radius={6} />
<Empty title="Nada aqui" description="Crie o primeiro." action={<Button>Criar</Button>} />
```

- `Alert`: `title?, description?, variant? ("default"|"destructive"|"success"), icon?`.
- `Progress`: **`value: number`** obrig., `max?, label?`. `Spinner`: `size?, label?`. `Skeleton`: `width?, height?, radius?`. `Empty`: **`title: string`** obrig., `description?, icon?, action?`.

### Toast / Toaster — render-driven (você é o dono do array)

```tsx
let toasts: ToastItem[] = [];
// emitir:
toasts = [...toasts, { id: crypto.randomUUID(), title: "Salvo", description: "…", variant: "success" }];
// renderizar (uma vez na árvore):
<Toaster toasts={toasts} position="bottom-right"
         onDismiss={id => { toasts = toasts.filter(t => t.id !== id); }} />
```

`ToasterProps`: `toasts: ToastItem[]` (obrig.), `position? ("top-left"|"top-right"|"bottom-left"|"bottom-right"), onDismiss?(id)`. `ToastItem`: `{ id, title, description?, variant? ("default"|"success"|"destructive"), action? ({label, onClick}) }`. Não há API imperativa `toast()`; quem remove é o seu `onDismiss`. (Notificação do SO: `app.notify({ title, body?, onClick?, id?, at? })`.)

---

## 6. Overlays

Todos controlados via `open` + `onOpenChange`:

```tsx
let open = false;
<Modal open={open} onOpenChange={o => { open = o; }} title="Confirmar"
       description="Deseja salvar?" width={420} closeOnOverlay closeOnEscape
       footer={<Button onClick={() => { open = false; }}>OK</Button>}>
  conteúdo…
</Modal>
```

- `Modal` (= `Dialog`, alias): **`open: boolean` obrig.**, `onOpenChange?, title?, description?, footer?, width?: number, closeOnOverlay?, closeOnEscape?, showClose?`.
- `Sheet`: `open` obrig., `side? ("left"|"right"|"top"|"bottom"), size?, title?, description?, footer?, closeOnOverlay?, closeOnEscape?, showClose?, onOpenChange?`. `AlertDialog`: `open, title` obrig., `description?, cancelLabel?, actionLabel?, actionVariant?, actionDisabled?, closeOnEscape?, onCancel?, onAction?, onOpenChange?`. `Drawer`: igual Sheet + `showClose?`.
- `Tooltip`: **`id: string, trigger: Child, content: Child` obrig.**, `open?` (opcional — sem ele mostra no hover), `side? ("top"|"right"|"bottom"|"left"), label?, onOpenChange?, contentStyle?`.
- `Popover`: **`id, open, trigger` obrig.**, `label?, side?, disabled?, onOpenChange?, triggerStyle?, contentStyle?` + children.
- `DropdownMenu`: **`id, open, trigger, items` obrig.**, `label?, side?, disabled?, onOpenChange?, onSelect?(value)`. Item: `{ value, label, icon? (IconName), shortcut?, disabled?, checked? }`. `ContextMenu`: mesmas props (abre com onContextMenu no trigger).

---

## 7. Navegação

```tsx
let tab = "profile";
<Tabs value={tab} onValueChange={v => { tab = v; }} items={[
  { value: "profile", label: "Profile", content: <Column>…</Column> },
  { value: "billing", label: "Billing", content: <Column>…</Column> },
]} />
```

- `Tabs`: `value: string` (obrig.), `items: {value, label, content: Child, disabled?}[]` (obrig.), `onValueChange?`. O conteúdo é renderizado pelo próprio Tabs.
- `Sidebar`: `items: {value, label, icon? (IconName), disabled?, badge?}[]`, `value?, collapsed?, width?: number, collapsedWidth?: number, header?, footer?, onValueChange?, onCollapsedChange?`.
- `Accordion`: `items: {value, title, content, disabled?}[]`, `value?: string, onValueChange?(value: string | undefined)` (undefined = nada aberto).
- `NavigationMenu`: `items: {value, label, disabled?, links?}[]` (links: `{value,label,description?,disabled?}`), `value?, openValue?, onValueChange?, onOpenValueChange?(string|undefined)`.

---

## 8. Dados

```tsx
<Card title="Perfil" description="…" footer={<Button>Salvar</Button>}>…</Card>

<Item title="Account" description="Profile, email" trailing={<Text>›</Text>}
      selected onClick={() => {}} />

<Table columns={[
    { key: "name", header: "Name", accessor: "name" },
    { key: "act", header: "", render: row => <Text>{row.act}</Text> },
  ]}
  data={rows} rowKey={(r) => r.id} onRowClick={(r) => {}} />

<Markdown source="# Olá\nClique [aqui](https://x.com)" onLinkClick={href => {}} />
<Code code="const x = 1" language="ts" showLineNumbers />
```

- `Card (extends ViewProps)`: `title?, description?, footer?` + children.
- `Item`: **`title: string`** obrig., `description?, leading?, trailing?, disabled?, selected?, onClick?`.
- `List<T> (extends ScrollProps)`: `items?: readonly T[]; renderItem?: (item, index) => Child; keyForItem?: (item, index) => string|number; gap?: number` (não-virtual; para virtualizar use `VirtualList`).
- `Table<T>` / `DataTable<T>` (alias): `columns: TableColumn<T>[]` obrig. (`{ key, header, accessor? (keyof T | (row,i)=>Child), render?, width?, align? }`), `data: T[]` obrig., `rowKey?, empty?, onRowClick?`.
- `Markdown`: `source: string` obrig., `onLinkClick?`. `Code`: `code: string` obrig., `language?, path?, showLineNumbers?`. Ambos aceitam `syntaxTheme?`. `Diff`: `source?` ou `oldText?+newText?`, `wordDiff?, collapsedPaths?, maxLines?`, callbacks.

---

## 9. Sistema de estilo (`style?: Style`)

`Style` = `StateStyle` + layout. Resumo dos campos:

```tsx
style={{
  width: "100%",            // Length: number(px) | `${n}%` | "auto" | "50vh"… 
  height: 48, minWidth: 0,
  flex: 1,                  // number = "N 1 0"; string aceita CSS ("1 1 176px")
  padding: 16,              // Insets: number | {top,right,bottom,left}
  margin: "auto",           // Margins: px | % | "auto" | por lado
  gap: 12, align: "center", justify: "between",
  background: "#1e293b",    // cor | objeto Gradient | string CSS linear-gradient(…)
  foreground: theme.colors.foreground, // cor do texto (Text: use color=)
  borderColor: theme.colors.border, borderWidth: 1, // borderWidth: Insets
  borderStyle: "dashed",    // solid|dashed|dotted|double|groove|ridge|inset|outset
  radius: 8,                // CornerRadius: number | {topLeft,…}
  opacity: 0.9,
  boxShadow: { y: 8, blur: 24, color: "#0f172a33" }, // ou array, ou string CSS
  textShadow: { x: 0, y: 2, color: "#0006" },
  transform: "translateY(-2px) scale(1.02)",         // ou objeto {x,y,scale,rotate,…}
  overflow: "hidden", cursor: "pointer", zIndex: 1,
  hover: { background: theme.colors.primaryHover, transform: "translateY(-4px)" },
  active: { background: theme.colors.primaryActive },
  focusVisible: { outlineWidth: 2, outlineColor: theme.colors.ring },
  disabled: { opacity: 0.5 },
  transition: { all: { duration: 220, easing: "easeOut" } }, // MotionTransitions
  animation: { from: { opacity: 0 }, duration: 300 },        // StyleAnimation
  spin: 800,               // rotação contínua, ms por volta
  dark: { background: "#0f172a" },  // overrides quando a janela está dark
  sm: { direction: "row" },         // breakpoints 640/768/1024/1280/1536
  display: "grid", columns: "repeat(auto-fill, minmax(176px, 1fr))",
  userSelect: "text", lineHeight: 1.5, textAlign: "center",
}}
```

- Gradientes como objeto: `{ type: "linear", angle?: number, to?: GradientSide, stops: [{color, offset?}] }` (também `radial` e `conic`), ou strings CSS `linear-gradient(135deg, #2563eb, #9333ea)`.
- `glass?: GlassMaterial` e `backdropBlur?`/`backdropFilter?` para efeito de vidro; componente pronto: `<Glass variant="regular" tint="#fff3" radius={26} />` (helpers `glassSurface`, `glassChrome`, `over(top,bottom)`).
- `Style.create(obj)` (allocation-free, `as const`) e `Style.merge(...styles)` são helpers tipados.

### Tokens de tema (`theme.d.ts`)

```tsx
import { theme, lightTheme, darkTheme, createTheme, Theme } from "@tarve/core";
theme.colors.background // card, foreground, muted, mutedForeground, border, input,
// primary(+Foreground/Hover/Active), secondary(+…), destructive(+Foreground/Hover/Active/destructiveText),
// ring, ringSoft, success, successMuted, diffAdd/Remove* (4 cada), disabled, disabledForeground,
// placeholder, selection, scrollbar, overlay, imagePlaceholder, sliderThumb, windowCloseHover/Active
theme.space  // xs:4 sm:8 md:12 lg:16 xl:24 xxl:32
theme.radius // sm:6 md:8 lg:12
theme.font   // family "system-ui", size 14, lineHeight 1.5
```

- **Dark mode**: `createTheme(darkTheme)` ou `<Window theme={darkTheme}>`; em qualquer `style`, `dark: { … }` aplica overrides quando a luminância do fundo da janela < 0.5 (como `dark:` do Tailwind).
- `resolveThemeColor(value, theme)` / `resolveThemeStyle(style, theme)` resolvem tokens em cores concretas.

---

## 10. Estado / reatividade

**Não há hooks (`useState`, `useEffect`, `useMemo`) em Tarve.** O modelo é *render-driven*:

- `view` é uma função `() => VNode` que a engine chama a cada update; o resultado é diffado contra a árvore nativa e aplicado como patch (Rust retém a árvore).
- O padrão dos exemplos oficiais: **variáveis module-level + handlers que as mutam**; após o handler rodar, a engine re-renderiza (o reconciler invalida memos do nó via `invalidateMemos(renderScope, id)`).

```tsx
let count = 0; // module-level
export function App() {
  return <Button onClick={() => { count++; }}>{count}</Button>;
}
```

- Performance: `memo(render, equal?)` (default `shallowEqual`, Object.is por prop) marca um componente cuja subárvore compilada é reutilizada enquanto as props não mudam; **tudo que o componente mostra deve virar das props** (estado de módulo lido dentro fica stale). `template(render, events?)` compila o subtree em build time. `shallowEqual` também é exportado.
- Não confunda: não existe `signals`; reatividade = re-executar a view + diff.

---

## 11. Teclado / hotkeys

```ts
const handle = app.registerHotkey("Ctrl+Shift+S", () => { save(); });
handle(); // cancela o registro
```

- `AppHandle.registerHotkey(shortcut: string, handler: () => void): () => void`. `HotkeyHandler = () => void`. Formato canônico: `Ctrl+Shift+S` (normalize com `normalizeHotkey(shortcut)` exportada).
- Por nó: `Pressable.onKeyDown?(key)`, `onEscape?`. Global: `AppOptions.keyboardEvents` + `app.onEvent` (eventos `keyboard`/`key` com DOM `key`/`code`).

---

## Extras rápidos

- `AnimatePresence`: `<AnimatePresence id="x" present={show} enter={{ opacity: 0 }} exit={{ opacity: 0 }} transition={{ all: { duration: 200 } }}><View>…</View></AnimatePresence>` — mantém o filho nativo vivo durante o exit; a borda fica sempre montada.
- `tw` (Tailwind) e `className`/`class` são compilados para `style` no call-site.
- `appConfigDirectory(app?)`, `windowStateStore()`, `applySavedState()` para persistir janela (`AppOptions.rememberWindow`).
- Intrínsecos HTML também existem (`<div>`, `<input>`, `<form onSubmit>`, `<img src>`, SVG declarativo…) com `IntrinsicStyle` (aliases CSS: `backgroundColor`, `color`, `borderRadius`, `flexDirection`…).

*Gerado a partir dos .d.ts de @tarve/core 0.9.0 e dos exemplos oficiais (examples/forms, examples/components) — nenhuma prop inventada.*
