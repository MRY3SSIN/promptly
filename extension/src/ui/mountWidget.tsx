import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { HOST_ELEMENT_NAME } from '../config/constants';
import type { Theme } from './theme';

/**
 * The extension's entire physical footprint on the host page: one `<div>`,
 * appended once to the end of `<body>`, with everything else sealed inside its
 * shadow root.
 *
 * We mount the shadow root by hand rather than using WXT's `createShadowRootUi`
 * for one specific reason: that helper splits `@font-face` and `@property`
 * rules out of the shadow CSS and appends them as a second `<style>` element
 * to `document.head`. That would be a second node in somebody else's document,
 * and it would register our two typefaces in the *page's* font registry —
 * making them usable, and detectable, by the page. Chromium honours
 * `@font-face` inside a shadow root (verified against the bundled Chromium),
 * so the split buys us nothing and costs us the isolation guarantee.
 */

export interface WidgetHandle {
  /** The one element we added. */
  host: HTMLDivElement;
  shadow: ShadowRoot;
  container: HTMLDivElement;
  setTheme(theme: Theme): void;
  destroy(): void;
}

/**
 * Styles the host must hold regardless of what the page's stylesheet says.
 *
 * Written as inline `!important` declarations because that is the only author
 * priority a host-page rule cannot beat. A site that ships `body > div {
 * position: static }` — and some do, for layout resets — would otherwise
 * detach the widget from its anchor entirely.
 */
const HOST_STYLE: ReadonlyArray<readonly [string, string]> = [
  // Fixed, so the transform we write is in plain viewport coordinates.
  ['position', 'fixed'],
  ['top', '0'],
  ['left', '0'],
  ['width', 'auto'],
  ['height', 'auto'],
  ['margin', '0'],
  ['padding', '0'],
  ['border', '0'],
  ['z-index', '2147483647'],
  // The container never swallows clicks meant for the page; interactive parts
  // opt back in. This is also what lets our own occlusion hit-test see past
  // itself to whatever is really underneath.
  ['pointer-events', 'none'],
  // Nothing inside can invalidate layout outside.
  ['contain', 'layout style'],
  ['isolation', 'isolate'],
  // Hidden until the AnchorEngine has decided where this belongs. A widget
  // that flashes at 0,0 on every page load is worse than a slow one.
  ['visibility', 'hidden'],
  ['transform', 'translate3d(0, 0, 0)'],
];

/**
 * Resets inheritable properties that pierce the shadow boundary — font,
 * colour, line-height, direction. Custom properties are deliberately not
 * affected by `all`, so the design tokens defined later in the sheet survive.
 */
const SHADOW_RESET = ':host{all:initial}';

export function mountWidget(cssText: string, node: ReactNode): WidgetHandle {
  const host = document.createElement('div');
  host.setAttribute('data-forge-host', HOST_ELEMENT_NAME);
  // Never analyse ourselves, and signal to other well-behaved assistants that
  // this subtree is not user content.
  host.setAttribute('data-forge', 'false');
  host.setAttribute('aria-live', 'off');
  applyHostStyle(host);

  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `${SHADOW_RESET}\n${cssText}`;
  shadow.append(style);

  const container = document.createElement('div');
  container.className = 'forge-root';
  shadow.append(container);

  document.body.append(host);

  const root: Root = createRoot(container);
  root.render(node);

  return {
    host,
    shadow,
    container,
    setTheme(theme: Theme) {
      // Read by `:host([data-forge-theme='dark'])` in tokens.css.
      host.setAttribute('data-forge-theme', theme);
    },
    destroy() {
      root.unmount();
      host.remove();
    },
  };
}

export function applyHostStyle(host: HTMLElement): void {
  for (const [prop, value] of HOST_STYLE) {
    host.style.setProperty(prop, value, 'important');
  }
}
