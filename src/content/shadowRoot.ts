/**
 * Shadow DOM Host and Encapsulation Manager
 * Part of Runbi Chrome Extension (Manifest V3)
 */

import contentCss from '../styles/content.css?inline';

export const HOST_ELEMENT_ID = 'runbi-extension-root';
export const CONTAINER_ELEMENT_ID = 'runbi-app-container';

export interface ShadowDOMContext {
  host: HTMLElement;
  shadowRoot: ShadowRoot;
  container: HTMLElement;
}

/**
 * Creates and injects the isolated Shadow DOM host into the document body.
 * If already mounted, returns the existing instance.
 */
export function initShadowRoot(): ShadowDOMContext {
  let host = document.getElementById(HOST_ELEMENT_ID) as HTMLElement | null;
  let shadowRoot: ShadowRoot | null = null;
  let container: HTMLElement | null = null;

  if (host && host.shadowRoot) {
    shadowRoot = host.shadowRoot;
    container = shadowRoot.getElementById(CONTAINER_ELEMENT_ID) as HTMLElement | null;
    if (container) {
      return { host, shadowRoot, container };
    }
  }

  if (!host) {
    host = document.createElement('div');
    host.id = HOST_ELEMENT_ID;
    host.style.position = 'absolute';
    host.style.top = '0';
    host.style.left = '0';
    host.style.width = '0';
    host.style.height = '0';
    host.style.overflow = 'visible';
    host.style.pointerEvents = 'none';
    host.style.zIndex = '2147483647';
    host.style.margin = '0';
    host.style.padding = '0';
    host.style.border = 'none';
    host.style.background = 'transparent';

    const target = document.body || document.documentElement;
    target.appendChild(host);
  }

  shadowRoot = host.shadowRoot || host.attachShadow({ mode: 'open' });

  // Clear existing shadow content if re-initializing
  shadowRoot.innerHTML = '';

  // Inject styles into Shadow DOM
  const styleEl = document.createElement('style');
  const cssString = typeof contentCss === 'string' ? contentCss : (contentCss as any)?.default || '';
  styleEl.textContent = cssString;
  shadowRoot.appendChild(styleEl);

  // Create App Container for React mounting (must be pointer-events: none so it never blocks web page clicks)
  container = document.createElement('div');
  container.id = CONTAINER_ELEMENT_ID;
  container.style.position = 'absolute';
  container.style.top = '0';
  container.style.left = '0';
  container.style.width = '0';
  container.style.height = '0';
  container.style.overflow = 'visible';
  container.style.pointerEvents = 'none';
  shadowRoot.appendChild(container);

  return { host, shadowRoot, container };
}

/**
 * Retrieves the Shadow DOM host element if present in DOM.
 */
export function getShadowHost(): HTMLElement | null {
  return document.getElementById(HOST_ELEMENT_ID);
}

/**
 * Retrieves the active open ShadowRoot if host is mounted.
 */
export function getShadowRoot(): ShadowRoot | null {
  const host = getShadowHost();
  return host ? host.shadowRoot : null;
}

/**
 * Retrieves the React app container element within the Shadow DOM.
 */
export function getAppContainer(): HTMLElement | null {
  const root = getShadowRoot();
  return root ? (root.getElementById(CONTAINER_ELEMENT_ID) as HTMLElement | null) : null;
}

/**
 * Destroys and cleans up the Shadow DOM host element from DOM.
 */
export function destroyShadowRoot(): void {
  const host = getShadowHost();
  if (host && host.parentNode) {
    host.parentNode.removeChild(host);
  }
}
