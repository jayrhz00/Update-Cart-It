/**
 * Single place to update production URLs when you go live.
 * Loaded before background.js (Firefox) or via importScripts in the service worker (Chrome).
 */
(function cartItExtensionConfig() {
  const root = typeof self !== "undefined" ? self : window;

  /**
   * CHANGE THESE for your production deployment.
   * If these are "localhost", the extension only works with your local server.
   */
  const defaultWebAppOrigin = "http://localhost:3000";
  const defaultApiBase = "http://localhost:5001";

  /** 
   * Helpers to check if a tab is one of our web app pages.
   * Used by background scripts to know when to sync tokens.
   */
  function isWebAppHost(hostname) {
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "cart-it.com" ||
      hostname.includes("cart-it-frontend.pages.dev")
    );
  }

  function contentScriptMatches() {
    // These matches allow the extension to inject content.js into the web app
    // to "bridge" the login token into extension storage.
    const extra = [];
    return [
      "http://localhost/*",
      "http://127.0.0.1/*",
      "https://localhost/*",
      "https://127.0.0.1/*",
      "https://cart-it.com/*",
      ...extra,
    ];
  }

  root.CART_IT_CONFIG = {
    defaultWebAppOrigin,
    defaultApiBase,
    fallbackLocalApi: "http://127.0.0.1:5001",
    isWebAppHost,
    contentScriptMatches,
  };
})();
