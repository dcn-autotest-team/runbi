/**
 * Runbi Content Script Entry Point
 * Part of Runbi Chrome Extension (Manifest V3)
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { initShadowRoot, destroyShadowRoot, getShadowHost } from './shadowRoot';
import App from './App';

let reactRoot: ReactDOM.Root | null = null;

/**
 * Mounts the Runbi floating root and React Shadow DOM app.
 */
export function mountRunbi(): void {
  // Prevent duplicate mounts
  if (getShadowHost() && reactRoot) {
    return;
  }

  const { container } = initShadowRoot();

  if (container) {
    reactRoot = ReactDOM.createRoot(container);
    reactRoot.render(React.createElement(App));
  }
}

/**
 * Unmounts the Runbi React tree and destroys the Shadow DOM host.
 */
export function unmountRunbi(): void {
  if (reactRoot) {
    reactRoot.unmount();
    reactRoot = null;
  }
  destroyShadowRoot();
}

// Auto-initialize when document is ready
if (typeof document !== 'undefined') {
  console.log('[Runbi] 润笔 Content Script loaded on:', window.location.href);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      mountRunbi();
      console.log('[Runbi] 润笔 mounted on DOMContentLoaded');
    });
  } else {
    mountRunbi();
    console.log('[Runbi] 润笔 mounted immediately');
  }
}

// Listen for background service worker messages (e.g. trigger command)
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.action === 'MOUNT_RUNBI') {
      mountRunbi();
      sendResponse({ status: 'MOUNTED' });
    } else if (message?.action === 'UNMOUNT_RUNBI') {
      unmountRunbi();
      sendResponse({ status: 'UNMOUNTED' });
    }
  });
}
