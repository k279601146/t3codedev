import type { ContextMenuItem, ContextMenuItemIcon } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as Electron from "electron";

export interface ElectronMenuPosition {
  readonly x: number;
  readonly y: number;
}

export interface ElectronMenuContextInput {
  readonly window: Electron.BrowserWindow;
  readonly items: readonly ContextMenuItem[];
  readonly position: Option.Option<ElectronMenuPosition>;
}

export interface ElectronMenuTemplateInput {
  readonly window: Electron.BrowserWindow;
  readonly template: readonly Electron.MenuItemConstructorOptions[];
}

export interface ElectronMenuShape {
  readonly setApplicationMenu: (
    template: readonly Electron.MenuItemConstructorOptions[],
  ) => Effect.Effect<void>;
  readonly showContextMenu: (
    input: ElectronMenuContextInput,
  ) => Effect.Effect<Option.Option<string>>;
  readonly popupTemplate: (input: ElectronMenuTemplateInput) => Effect.Effect<void>;
}

export class ElectronMenu extends Context.Service<ElectronMenu, ElectronMenuShape>()(
  "t3/desktop/electron/Menu",
) {}

function normalizeContextMenuItems(source: readonly ContextMenuItem[]): ContextMenuItem[] {
  const normalizedItems: ContextMenuItem[] = [];

  for (const sourceItem of source) {
    if (typeof sourceItem.id !== "string" || typeof sourceItem.label !== "string") {
      continue;
    }

    const normalizedItem: ContextMenuItem = {
      id: sourceItem.id,
      label: sourceItem.label,
      ...(sourceItem.icon ? { icon: sourceItem.icon } : {}),
      destructive: sourceItem.destructive === true,
      disabled: sourceItem.disabled === true,
    };

    if (sourceItem.children) {
      const normalizedChildren = normalizeContextMenuItems(sourceItem.children);
      if (normalizedChildren.length === 0) {
        continue;
      }
      normalizedItem.children = normalizedChildren;
    }

    normalizedItems.push(normalizedItem);
  }

  return normalizedItems;
}

const normalizePosition = (
  position: Option.Option<ElectronMenuPosition>,
): Option.Option<ElectronMenuPosition> =>
  Option.filter(
    position,
    ({ x, y }) => Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0,
  ).pipe(Option.map(({ x, y }) => ({ x: Math.floor(x), y: Math.floor(y) })));

export const layer = Layer.sync(ElectronMenu, () => {
  let destructiveMenuIconCache: Option.Option<Electron.NativeImage> | undefined;
  const menuIconCache = new Map<string, Option.Option<Electron.NativeImage>>();

  const getDestructiveMenuIcon = (): Option.Option<Electron.NativeImage> => {
    if (process.platform !== "darwin") {
      return Option.none();
    }
    if (destructiveMenuIconCache !== undefined) {
      return destructiveMenuIconCache;
    }

    try {
      const icon = Electron.nativeImage.createFromNamedImage("trash").resize({
        width: 12,
        height: 12,
      });
      destructiveMenuIconCache = icon.isEmpty() ? Option.none() : Option.some(icon);
    } catch {
      destructiveMenuIconCache = Option.none();
    }

    return destructiveMenuIconCache;
  };

  const getMenuIcon = (
    iconName: ContextMenuItemIcon | undefined,
    destructive: boolean,
  ): Option.Option<Electron.NativeImage> => {
    if (!iconName) {
      return Option.none();
    }
    const cacheKey = `${iconName}:${destructive ? "destructive" : "normal"}`;
    const cached = menuIconCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const stroke = destructive ? "#dc2626" : "#4b5563";
    const paths: Record<ContextMenuItemIcon, string> = {
      pin: '<path d="M6 3.5l4.5 4.5"/><path d="M8 2l6 6-2 2 1 3-1 1-3-1-2 2-6-6 2-2 3 1 2-2z"/>',
      "folder-open":
        '<path d="M2.5 5.5h4l1.4 1.5h7.6v6.5a1.5 1.5 0 0 1-1.5 1.5h-11a1.5 1.5 0 0 1-1.5-1.5v-6.5a1.5 1.5 0 0 1 1.5-1.5z"/><path d="M2 9h14l-1.3 4.4a1.5 1.5 0 0 1-1.4 1.1h-10.2a1.5 1.5 0 0 1-1.4-1.9z"/>',
      edit: '<path d="M3 13l1-3 6.8-6.8a1.4 1.4 0 0 1 2 0 1.4 1.4 0 0 1 0 2l-6.8 6.8-3 1z"/><path d="M10 4l2 2"/>',
      archive:
        '<path d="M3 5h10v9.5a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1z"/><path d="M2 2.5h12v2.5h-12z"/><path d="M6 8h4"/>',
      x: '<path d="M4 4l8 8"/><path d="M12 4l-8 8"/>',
      copy: '<path d="M6 6h7v7h-7z"/><path d="M3 10v-7h7"/>',
    };
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="${stroke}" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round">${paths[iconName]}</svg>`;
    const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

    try {
      const icon = Electron.nativeImage.createFromDataURL(dataUrl).resize({
        width: 16,
        height: 16,
      });
      const result = icon.isEmpty() ? Option.none() : Option.some(icon);
      menuIconCache.set(cacheKey, result);
      return result;
    } catch {
      const result = Option.none<Electron.NativeImage>();
      menuIconCache.set(cacheKey, result);
      return result;
    }
  };

  const buildTemplate = (
    entries: readonly ContextMenuItem[],
    complete: (selectedItemId: Option.Option<string>) => void,
  ): Electron.MenuItemConstructorOptions[] => {
    const template: Electron.MenuItemConstructorOptions[] = [];
    let hasInsertedDestructiveSeparator = false;

    for (const item of entries) {
      if (item.destructive && !hasInsertedDestructiveSeparator && template.length > 0) {
        template.push({ type: "separator" });
        hasInsertedDestructiveSeparator = true;
      }

      const itemOption: Electron.MenuItemConstructorOptions = {
        label: item.label,
        enabled: !item.disabled,
      };
      if (item.children && item.children.length > 0) {
        itemOption.submenu = buildTemplate(item.children, complete);
      } else {
        itemOption.click = () => complete(Option.some(item.id));
      }
      if (item.destructive && (!item.children || item.children.length === 0)) {
        const destructiveIcon = getDestructiveMenuIcon();
        if (Option.isSome(destructiveIcon)) {
          itemOption.icon = destructiveIcon.value;
        }
      }
      if (!itemOption.icon) {
        const menuIcon = getMenuIcon(item.icon, item.destructive === true);
        if (Option.isSome(menuIcon)) {
          itemOption.icon = menuIcon.value;
        }
      }

      template.push(itemOption);
    }

    return template;
  };

  return ElectronMenu.of({
    setApplicationMenu: (template) =>
      Effect.sync(() => {
        Electron.Menu.setApplicationMenu(Electron.Menu.buildFromTemplate([...template]));
      }),
    popupTemplate: (input) =>
      Effect.sync(() => {
        if (input.template.length === 0) {
          return;
        }
        Electron.Menu.buildFromTemplate([...input.template]).popup({ window: input.window });
      }),
    showContextMenu: (input) =>
      Effect.callback<Option.Option<string>>((resume) => {
        const normalizedItems = normalizeContextMenuItems(input.items);
        if (normalizedItems.length === 0) {
          resume(Effect.succeed(Option.none()));
          return;
        }

        let completed = false;
        const complete = (selectedItemId: Option.Option<string>) => {
          if (completed) {
            return;
          }
          completed = true;
          resume(Effect.succeed(selectedItemId));
        };

        const menu = Electron.Menu.buildFromTemplate(buildTemplate(normalizedItems, complete));
        const popupPosition = normalizePosition(input.position);
        const popupOptions = Option.match(popupPosition, {
          onNone: (): Electron.PopupOptions => ({
            window: input.window,
            callback: () => complete(Option.none()),
          }),
          onSome: (position): Electron.PopupOptions => ({
            window: input.window,
            x: position.x,
            y: position.y,
            callback: () => complete(Option.none()),
          }),
        });
        menu.popup(popupOptions);
      }),
  });
});
