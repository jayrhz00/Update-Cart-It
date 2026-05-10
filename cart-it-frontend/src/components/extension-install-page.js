import React, { useEffect, useMemo, useState } from 'react';
import '../styles/extension-install-page.css';

const BROWSERS = {
  edge: {
    label: 'Microsoft Edge',
    storeLabel: 'Get on Edge Add-ons',
    zip: '/cart-it-extension-chromium.zip',
  },
  chrome: {
    label: 'Google Chrome',
    storeLabel: 'Get on Chrome Web Store',
    zip: '/cart-it-extension-chromium.zip',
  },
  firefox: {
    label: 'Mozilla Firefox',
    storeLabel: 'Get on Firefox Add-ons',
    zip: '/cart-it-extension-firefox.zip',
  },
};

function detectBrowser() {
  const ua = navigator.userAgent || '';
  if (/Edg\//i.test(ua)) return 'edge';
  if (/Firefox\//i.test(ua)) return 'firefox';
  if (/Chrome\//i.test(ua)) return 'chrome';
  return 'edge';
}

function normalizeLinks(raw) {
  const out = {};
  for (const key of Object.keys(BROWSERS)) {
    const row = raw && typeof raw[key] === 'object' ? raw[key] : {};
    out[key] = {
      status: String(row.status || 'pending').toLowerCase() === 'approved' ? 'approved' : 'pending',
      url: typeof row.url === 'string' ? row.url.trim() : '',
    };
  }
  return out;
}

const publicPath = (path) => `${process.env.PUBLIC_URL || ''}${path}`;

/**
 * Same content as public/extension-install.html, for SPA route /extension-install
 * (hosting often serves index.html for this path so the static HTML is never hit).
 */
export default function ExtensionInstallPage() {
  const [links, setLinks] = useState(() =>
    normalizeLinks({
      edge: { status: 'pending', url: '' },
      chrome: { status: 'pending', url: '' },
      firefox: { status: 'pending', url: '' },
    })
  );

  const current = useMemo(() => detectBrowser(), []);
  const me = BROWSERS[current];
  const meCfg = links[current];

  useEffect(() => {
    document.title = 'Cart-It extension';
  }, []);

  useEffect(() => {
    fetch(publicPath('/extension-store-links.json'), { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : {}))
      .then((raw) => setLinks(normalizeLinks(raw)))
      .catch(() => {
        setLinks(
          normalizeLinks({
            edge: { status: 'pending', url: '' },
            chrome: { status: 'pending', url: '' },
            firefox: { status: 'pending', url: '' },
          })
        );
      });
  }, []);

  useEffect(() => {
    if (!/Edg/i.test(navigator.userAgent || '')) return;
    const onClick = (e) => {
      const t = e.target;
      if (t && t.matches && t.matches('a[download*="cart-it-extension"]')) {
        setTimeout(() => {
          window.location.href = 'edge://extensions';
        }, 700);
      }
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  const footnote =
    meCfg.status === 'approved' && meCfg.url
      ? 'Your browser’s section below has the store link and a ZIP with the latest packaged build.'
      : 'Store listing for your browser is pending. You can still install now by downloading the zip and loading it unpacked.';

  return (
    <div className="extension-install-page">
      <div className="ei-wrap">
        <div className="ei-card">
          <h1>Cart-It Extension</h1>
          <p className="ei-sub">
            Save from any site, share lists and chat with friends, track prices and stock, and add notes.
            Install in one click from your browser store when available. The Cart-It icon appears{' '}
            <strong>next to the address bar</strong>.
          </p>

          <div className="ei-manual-steps" aria-labelledby="manual-install-heading">
            <h2 id="manual-install-heading" className="ei-manual-steps-title">
              Install manually (ZIP)
            </h2>
            <p className="ei-manual-steps-lead">
              Use this when the store listing is still pending or your IT policy only allows unpacked extensions.
            </p>
            <ol className="ei-manual-steps-list">
              <li>
                <strong>Download the ZIP</strong> for your browser using the large button below these steps, or the
                matching browser row under that. Those files are the latest manual-install packages from this site
                (Chrome/Edge share the Chromium ZIP; Firefox has its own).
              </li>
              <li>Unzip to a folder you will keep — Chrome/Edge need that folder to stay on disk.</li>
              <li>
                Open extensions: Chrome → <code>chrome://extensions</code> · Edge → <code>edge://extensions</code> ·
                Firefox → <code>about:debugging#/runtime/this-firefox</code> (then <strong>Load Temporary Add-on…</strong>{' '}
                and pick the <code>manifest.json</code> inside your unzipped folder).
              </li>
              <li>
                Turn on <strong>Developer mode</strong> (Chrome/Edge), then click <strong>Load unpacked</strong>. In
                the file picker, open your unzipped folder until you see <code>manifest.json</code> in that same folder
                (with files like <code>sidepanel.html</code>). Select that folder and click{' '}
                <strong>Select Folder</strong>. Do not select the <code>.zip</code> file, and do not stop on a parent
                folder that does not contain <code>manifest.json</code>.
              </li>
              <li>
                <strong>Cloned the GitHub repo?</strong> Choose the <code>extension</code> folder inside the project,
                not the project root (which has <code>cart-it-frontend</code>, <code>server</code>, etc.).
              </li>
            </ol>
            <div className="ei-pin-block" aria-labelledby="pin-toolbar-heading">
              <h3 id="pin-toolbar-heading" className="ei-pin-title">
                Pin Cart-It on your toolbar (not a bookmark)
              </h3>
              <p className="ei-pin-lead">
                After install, add Cart-It next to the address bar so you can open the side panel in one click.
              </p>
              <ul className="ei-pin-list">
                <li>
                  <strong>Chrome or Edge:</strong> Click the <strong>Extensions</strong> icon (puzzle piece) to the
                  right of the address bar → find <strong>Cart-It</strong> → click the <strong>pin</strong> icon so the
                  Cart-It icon stays on the toolbar.
                </li>
                <li>
                  <strong>Firefox:</strong> Click the <strong>Extensions</strong> button on the toolbar (or open the
                  application menu → <strong>Add-ons and themes</strong>) → pin or show <strong>Cart-It</strong> so it
                  stays easy to reach.
                </li>
              </ul>
            </div>
          </div>

          <div className="ei-hero-slot">
            {!(meCfg.status === 'approved' && meCfg.url) ? (
              <a
                className="ei-hero-btn"
                href={publicPath(me.zip)}
                download="cart-it-extension.zip"
              >
                Download for {me.label}
              </a>
            ) : null}
          </div>

          <div className="ei-browser-grid">
            {['edge', 'chrome', 'firefox'].map((key) => {
              const browser = BROWSERS[key];
              const cfg = links[key];
              const zipDownloadName = `cart-it-extension-${key}.zip`;
              const tinyLine =
                cfg.status === 'approved' && cfg.url
                  ? 'One-click store install is live, or use the ZIP to get the latest build right away.'
                  : cfg.status === 'approved'
                    ? 'One-click store install is live.'
                    : 'Store listing pending; temporary zip install available.';

              return (
                <div key={key} className={`ei-browser-row${key === current ? ' ei-top-pick' : ''}`}>
                  <div className="ei-browser-head">
                    <span className="ei-browser-name">{browser.label}</span>
                    <span
                      className={`ei-status-pill ${cfg.status === 'approved' ? 'ei-status-approved' : 'ei-status-pending'}`}
                    >
                      {cfg.status}
                    </span>
                  </div>
                  <p className="ei-tiny">{tinyLine}</p>
                  {cfg.status === 'approved' && cfg.url ? (
                    <>
                      <a
                        className="ei-hero-btn"
                        href={cfg.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {browser.storeLabel}
                      </a>
                      <p className="ei-zip-or">or</p>
                      <a
                        className="ei-hero-btn ei-secondary"
                        href={publicPath(browser.zip)}
                        download={zipDownloadName}
                      >
                        Download ZIP (manual install)
                      </a>
                    </>
                  ) : (
                    <a
                      className="ei-hero-btn ei-secondary"
                      href={publicPath(browser.zip)}
                      download={zipDownloadName}
                    >
                      Download ZIP ({browser.label})
                    </a>
                  )}
                  {key === current ? <p className="ei-mini-note">Recommended for this browser.</p> : null}
                </div>
              );
            })}
          </div>

          <p className="ei-footnote">{footnote}</p>

          <details>
            <summary>Advanced / developers</summary>
            <p style={{ margin: '10px 0 0' }}>
              If store approval is still pending, download the zip and install manually: Edge/Chrome →{' '}
              <code>edge://extensions</code> / <code>chrome://extensions</code> → Developer mode →{' '}
              <strong>Load unpacked</strong> after unzipping.
            </p>
          </details>
        </div>
      </div>
    </div>
  );
}
