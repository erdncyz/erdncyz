/**
 * Local smoke for index.html. Serves this repo on 127.0.0.1 and never calls production.
 * Analytics requests are recorded, then failed, so acceptance is observable without a completed hit.
 *
 *   node tests/browser-smoke.mjs
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const outDir = process.env.SMOKE_SHOTS || join(tmpdir(), 'portfolio-smoke-shots');
mkdirSync(outDir, { recursive: true });
const types = { '.html': 'text/html; charset=utf-8', '.jpg': 'image/jpeg', '.css': 'text/css', '.js': 'text/javascript' };

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
  if (rel.includes('..')) {
    res.writeHead(403);
    res.end();
    return;
  }
  const file = join(root, rel);
  if (!file.startsWith(root)) {
    res.writeHead(403);
    res.end();
    return;
  }
  try {
    const body = readFileSync(file);
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const pageUrl = `http://127.0.0.1:${port}/index.html`;

const chrome = spawn('google-chrome', [
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  '--remote-debugging-port=9333',
  '--user-data-dir=/tmp/chrome-portfolio-smoke',
  'about:blank',
], { stdio: 'ignore' });

async function waitForChrome() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const response = await fetch('http://127.0.0.1:9333/json/version');
      if (response.ok) return response.json();
    } catch { /* retry */ }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error('Chrome did not start');
}

const version = await waitForChrome();
const browser = new WebSocket(version.webSocketDebuggerUrl);
let nextId = 0;
const pending = new Map();
const sessions = new Map();
await new Promise((resolve, reject) => {
  browser.addEventListener('open', resolve, { once: true });
  browser.addEventListener('error', reject, { once: true });
});
browser.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(JSON.stringify(message.error)));
    else resolve(message.result);
    return;
  }
  const session = message.sessionId && sessions.get(message.sessionId);
  if (session && message.method === 'Fetch.requestPaused') {
    session.analytics.push(message.params.request.url);
    send('Fetch.failRequest', {
      requestId: message.params.requestId,
      errorReason: 'BlockedByClient',
    }, message.sessionId).catch(() => {});
  }
});
function send(method, params = {}, sessionId) {
  const id = ++nextId;
  const payload = { id, method, params };
  if (sessionId) payload.sessionId = sessionId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    browser.send(JSON.stringify(payload));
  });
}

function isAnalytics(url) {
  return /googletagmanager\.com|google-analytics\.com|analytics\.google\.com|doubleclick\.net/.test(url);
}

async function openPage() {
  const { browserContextId } = await send('Target.createBrowserContext');
  const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const session = { analytics: [] };
  sessions.set(sessionId, session);
  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);
  await send('Fetch.enable', {
    patterns: [
      { urlPattern: '*googletagmanager.com*', requestStage: 'Request' },
      { urlPattern: '*google-analytics.com*', requestStage: 'Request' },
      { urlPattern: '*analytics.google.com*', requestStage: 'Request' },
      { urlPattern: '*doubleclick.net*', requestStage: 'Request' },
    ],
  }, sessionId);
  return {
    sessionId,
    analytics: session.analytics,
    async close() {
      await send('Target.disposeBrowserContext', { browserContextId }).catch(() => {});
    },
  };
}

async function evaluate(sessionId, expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  }, sessionId);
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails).slice(0, 500));
  return result.result?.value;
}
async function metrics(sessionId, width, height, mobile = false) {
  await send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile,
  }, sessionId);
}
async function shot(sessionId, name) {
  const image = await send('Page.captureScreenshot', { format: 'png', fromSurface: true }, sessionId);
  writeFileSync(`${outDir}/${name}.png`, Buffer.from(image.data, 'base64'));
}
function layoutScript() {
  return `(() => {
    const banner = document.getElementById('cookieBanner');
    const projects = document.querySelector('#about a[href="#projects"]');
    const contact = document.querySelector('#about a[href="#contact"]');
    const bannerBox = banner && !banner.hidden ? banner.getBoundingClientRect() : null;
    function overlaps(node) {
      if (!bannerBox || banner.hidden) return false;
      const box = node.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return false;
      return !(box.right <= bannerBox.left || box.left >= bannerBox.right || box.bottom <= bannerBox.top || box.top >= bannerBox.bottom);
    }
    const blogHeading = document.querySelector('#blog h3');
    return {
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      bannerHidden: banner.hidden,
      projectsOverlap: overlaps(projects),
      contactOverlap: overlaps(contact),
      projectsBottom: Math.round(projects.getBoundingClientRect().bottom),
      contactBottom: Math.round(contact.getBoundingClientRect().bottom),
      viewportHeight: window.innerHeight,
      blogOpacity: blogHeading ? getComputedStyle(blogHeading).opacity : null,
      blogParentOpacity: blogHeading ? getComputedStyle(blogHeading.parentElement).opacity : null,
      blogTop: blogHeading ? Math.round(blogHeading.getBoundingClientRect().top) : null,
      blogText: blogHeading ? blogHeading.textContent.slice(0, 48) : null,
      lang: document.documentElement.lang,
      hero: document.querySelector('#about p')?.innerText.slice(0, 180),
      blogIntro: document.querySelector('#blog p')?.innerText.slice(0, 70),
      tenure: document.getElementById('digiturk-tenure')?.textContent.trim(),
      typing: document.getElementById('typing-text')?.textContent,
      motion: document.documentElement.classList.contains('motion-ok'),
      menuExpanded: document.getElementById('mobile-menu-btn')?.getAttribute('aria-expanded'),
      menuLabel: document.getElementById('mobile-menu-label')?.textContent,
      gaScripts: document.querySelectorAll('script[src*="googletagmanager"]').length
    };
  })()`;
}

const results = [];
function record(name, detail) {
  results.push({ name, ...detail });
  console.log(name, JSON.stringify(detail));
}

const fresh = await openPage();
await metrics(fresh.sessionId, 390, 844, true);
await send('Page.navigate', { url: pageUrl }, fresh.sessionId);
await new Promise(resolve => setTimeout(resolve, 2500));
const mobile = await evaluate(fresh.sessionId, layoutScript());
await shot(fresh.sessionId, 'after-mobile-390-banner');
record('mobile-390', { overflow: mobile.overflow, projectsOverlap: mobile.projectsOverlap, contactOverlap: mobile.contactOverlap, projectsBottom: mobile.projectsBottom, contactBottom: mobile.contactBottom, viewportHeight: mobile.viewportHeight, bannerHidden: mobile.bannerHidden, analytics: fresh.analytics.filter(isAnalytics) });
if (mobile.overflow || mobile.projectsOverlap || mobile.contactOverlap || mobile.bannerHidden || mobile.projectsBottom <= 0 || mobile.contactBottom <= 0 || mobile.contactBottom > mobile.viewportHeight || fresh.analytics.some(isAnalytics)) {
  throw new Error('mobile fresh banner check failed');
}
await evaluate(fresh.sessionId, `document.getElementById('mobile-menu-btn').click()`);
const menu = await evaluate(fresh.sessionId, layoutScript());
await shot(fresh.sessionId, 'after-mobile-390-menu');
record('mobile-menu', { expanded: menu.menuExpanded, label: menu.menuLabel, overflow: menu.overflow });
if (menu.menuExpanded !== 'true' || menu.menuLabel !== 'Close main menu' || menu.overflow) throw new Error('menu state failed');

await evaluate(fresh.sessionId, `document.querySelector('#mobile-menu a[href="#blog"]').click()`);
await new Promise(resolve => setTimeout(resolve, 400));
const blog = await evaluate(fresh.sessionId, layoutScript());
await shot(fresh.sessionId, 'after-blog-anchor-390');
record('blog-anchor', { opacity: blog.blogOpacity, parentOpacity: blog.blogParentOpacity, top: blog.blogTop, text: blog.blogText });
if (blog.blogOpacity !== '1' || blog.blogParentOpacity !== '1' || blog.blogTop < 0 || blog.blogTop > 844 || !String(blog.blogText).includes('Cloudflare')) {
  throw new Error('blog anchor hidden');
}

await evaluate(fresh.sessionId, `document.getElementById('lang-tr').click()`);
const turkish = await evaluate(fresh.sessionId, layoutScript());
await shot(fresh.sessionId, 'after-mobile-tr');
record('tr', { lang: turkish.lang, hero: turkish.hero, blogIntro: turkish.blogIntro, menu: turkish.menuLabel, tenure: turkish.tenure });
if (turkish.lang !== 'tr' || !turkish.hero.includes('yüksek trafikli') || !turkish.blogIntro.includes('Yapay zeka destekli') || !turkish.tenure.includes('Mart 2022’den beri')) {
  throw new Error('Turkish toggle failed');
}
await evaluate(fresh.sessionId, `document.getElementById('digiturk-tenure').scrollIntoView({behavior:'auto', block:'center'})`);
await shot(fresh.sessionId, 'experience-tr-390');
await evaluate(fresh.sessionId, `document.getElementById('lang-en').click()`);
const english = await evaluate(fresh.sessionId, layoutScript());
if (english.lang !== 'en' || !english.blogIntro.includes('AI-assisted') || english.tenure !== 'Full-time · Since March 2022') throw new Error('English toggle failed');
await shot(fresh.sessionId, 'experience-en-390');

await evaluate(fresh.sessionId, `document.getElementById('cookie-reject').click()`);
await new Promise(resolve => setTimeout(resolve, 300));
const rejected = await evaluate(fresh.sessionId, layoutScript());
record('rejected-click', { bannerHidden: rejected.bannerHidden, gaScripts: rejected.gaScripts, analytics: fresh.analytics.filter(isAnalytics) });
if (!rejected.bannerHidden || rejected.gaScripts !== 0 || fresh.analytics.some(isAnalytics)) throw new Error('reject still loaded analytics');
await fresh.close();

const persistedReject = await openPage();
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `localStorage.setItem('cookieConsent','false'); localStorage.setItem('portfolioLanguage','en');`,
}, persistedReject.sessionId);
await metrics(persistedReject.sessionId, 1440, 900, false);
await send('Page.navigate', { url: pageUrl }, persistedReject.sessionId);
await new Promise(resolve => setTimeout(resolve, 2000));
const persisted = await evaluate(persistedReject.sessionId, layoutScript());
await shot(persistedReject.sessionId, 'after-desktop-1440-rejected');
record('persisted-reject-1440', { bannerHidden: persisted.bannerHidden, overflow: persisted.overflow, tenure: persisted.tenure, analytics: persistedReject.analytics.filter(isAnalytics) });
if (!persisted.bannerHidden || persisted.overflow || persisted.tenure !== 'Full-time · Since March 2022' || persistedReject.analytics.some(isAnalytics)) throw new Error('persisted reject failed');
await evaluate(persistedReject.sessionId, `document.getElementById('digiturk-tenure').scrollIntoView({behavior:'auto', block:'center'})`);
await shot(persistedReject.sessionId, 'experience-en-1440');
await persistedReject.close();

const desktop = await openPage();
await metrics(desktop.sessionId, 1280, 800, false);
await send('Page.navigate', { url: pageUrl }, desktop.sessionId);
await new Promise(resolve => setTimeout(resolve, 2000));
const nav = await evaluate(desktop.sessionId, layoutScript());
await shot(desktop.sessionId, 'after-desktop-1280-banner');
record('desktop-1280', { overflow: nav.overflow, projectsOverlap: nav.projectsOverlap, contactOverlap: nav.contactOverlap, analytics: desktop.analytics.filter(isAnalytics) });
if (nav.overflow || nav.projectsOverlap || nav.contactOverlap || desktop.analytics.some(isAnalytics)) throw new Error('1280 layout failed');
await desktop.close();

const wide = await openPage();
await metrics(wide.sessionId, 1440, 900, false);
await send('Page.navigate', { url: pageUrl }, wide.sessionId);
await new Promise(resolve => setTimeout(resolve, 1800));
const wideLayout = await evaluate(wide.sessionId, layoutScript());
await shot(wide.sessionId, 'after-desktop-1440-banner');
record('desktop-1440', { overflow: wideLayout.overflow, projectsOverlap: wideLayout.projectsOverlap, analytics: wide.analytics.filter(isAnalytics) });
if (wideLayout.overflow || wideLayout.projectsOverlap || wide.analytics.some(isAnalytics)) throw new Error('1440 layout failed');
await evaluate(wide.sessionId, `document.getElementById('cookie-accept').click()`);
await new Promise(resolve => setTimeout(resolve, 700));
const acceptedUrls = wide.analytics.filter(isAnalytics);
record('accepted', { urls: acceptedUrls });
if (!acceptedUrls.some(url => url.includes('googletagmanager.com/gtag/js?id=G-EPXJ05TPDM'))) {
  throw new Error('accept did not request the Google tag');
}
await wide.close();

const persistedAccept = await openPage();
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `localStorage.setItem('cookieConsent','true');`,
}, persistedAccept.sessionId);
await send('Page.navigate', { url: `${pageUrl}?accepted=1` }, persistedAccept.sessionId);
await new Promise(resolve => setTimeout(resolve, 1200));
const acceptReload = persistedAccept.analytics.filter(isAnalytics);
record('persisted-accept', { urls: acceptReload });
if (!acceptReload.some(url => url.includes('googletagmanager.com/gtag/js?id=G-EPXJ05TPDM'))) {
  throw new Error('persisted accept did not request the Google tag');
}
await persistedAccept.close();

const reduced = await openPage();
await send('Emulation.setEmulatedMedia', {
  features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
}, reduced.sessionId);
await send('Page.navigate', { url: pageUrl }, reduced.sessionId);
await new Promise(resolve => setTimeout(resolve, 800));
const motion = await evaluate(reduced.sessionId, layoutScript());
record('reduced-motion', { typing: motion.typing, motion: motion.motion, blogOpacity: motion.blogOpacity });
if (motion.motion || motion.typing !== 'Software Test Automation Engineer') throw new Error('reduced motion ignored');
await reduced.close();

const noJs = await openPage();
await send('Emulation.setScriptExecutionDisabled', { value: true }, noJs.sessionId);
await send('Page.navigate', { url: `${pageUrl}#blog` }, noJs.sessionId);
await new Promise(resolve => setTimeout(resolve, 1200));
const disabled = await evaluate(noJs.sessionId, `(() => {
  const heading = document.querySelector('#blog h3');
  const card = document.querySelector('#blog .reveal');
  return {
    blogOpacity: heading ? getComputedStyle(heading).opacity : null,
    cardOpacity: card ? getComputedStyle(card).opacity : null,
    text: heading ? heading.textContent.slice(0, 40) : null,
    scripts: document.scripts.length
  };
})()`);
await shot(noJs.sessionId, 'after-js-disabled-blog');
record('js-disabled', disabled);
if (disabled.blogOpacity !== '1' || disabled.cardOpacity !== '1' || noJs.analytics.some(isAnalytics)) {
  throw new Error('JS-disabled content hidden or analytics loaded');
}
await noJs.close();

console.log('SMOKE_OK');
browser.close();
chrome.kill();
server.close();
