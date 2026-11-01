'use strict';
// Sign in to YouTube Music the way an ordinary app does: press the button, a real browser window opens on Google's own
// sign-in page, you sign in as usual (2-step, passkeys, everything works because it is the real page), and Gaane
// notices and closes that window. Nothing is typed into Gaane and no cookie is ever copied by hand.
//
// The window is a private browser profile of its own (a Chromium-family browser started with remote debugging), so
// your everyday browser keeps no copy of this session and cannot change it behind Gaane's back, which is what used to
// make a pasted cookie stop working after a day.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');

const LOGIN_URL = 'https://accounts.google.com/ServiceLogin?ltmpl=music&service=youtube&prompt=select_account&continue=' +
  encodeURIComponent('https://music.youtube.com/');

function browserCandidates(platform = process.platform, env = process.env) {
  const out = [];
  if (platform === 'darwin') {
    const apps = [['Google Chrome', 'Google Chrome'], ['Brave Browser', 'Brave Browser'], ['Microsoft Edge', 'Microsoft Edge'], ['Chromium', 'Chromium'], ['Arc', 'Arc'], ['Vivaldi', 'Vivaldi'], ['Opera', 'Opera']];
    for (const [app, bin] of apps) out.push({ name: bin, path: `/Applications/${app}.app/Contents/MacOS/${bin}` });
    const home = env.HOME || '';
    if (home) for (const [app, bin] of apps.slice(0, 3)) out.push({ name: bin, path: `${home}/Applications/${app}.app/Contents/MacOS/${bin}` });
  } else if (platform === 'win32') {
    const roots = [env['PROGRAMFILES'], env['PROGRAMFILES(X86)'], env['LOCALAPPDATA']].filter(Boolean);
    for (const r of roots) {
      out.push({ name: 'Google Chrome', path: path.join(r, 'Google', 'Chrome', 'Application', 'chrome.exe') });
      out.push({ name: 'Microsoft Edge', path: path.join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe') });
      out.push({ name: 'Brave', path: path.join(r, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe') });
    }
  } else {
    for (const n of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'brave-browser', 'microsoft-edge']) out.push({ name: n, path: n, which: true });
  }
  return out;
}

const BUNDLE_TO_NAME = {
  'com.google.chrome': 'Google Chrome', 'com.brave.browser': 'Brave Browser', 'com.microsoft.edgemac': 'Microsoft Edge',
  'org.chromium.chromium': 'Chromium', 'company.thebrowser.browser': 'Arc', 'com.vivaldi.vivaldi': 'Vivaldi', 'com.operasoftware.opera': 'Opera'
};
// The browser the Mac opens links with, when it is one of the Chromium family (those are the ones Gaane can watch
// for the end of the sign-in; Safari has no such interface).
function defaultBrowserName(platform = process.platform, env = process.env) {
  if (platform !== 'darwin') return '';
  try {
    const plist = path.join(env.HOME || os.homedir(), 'Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure.plist');
    const json = JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', plist], { encoding: 'utf8', timeout: 4000 }));
    for (const h of json.LSHandlers || []) {
      if (h.LSHandlerURLScheme === 'https' || h.LSHandlerURLScheme === 'http') {
        const id = String(h.LSHandlerRoleAll || h.LSHandlerRoleViewer || '').toLowerCase();
        if (BUNDLE_TO_NAME[id]) return BUNDLE_TO_NAME[id];
        if (id) return `other:${id}`;
      }
    }
  } catch (e) { /* unknown */ }
  return '';
}

function orderBrowsers(list, def) {
  if (!def) return list;
  const i = list.findIndex((b) => b.name === def);
  if (i <= 0) return list;
  return [list[i], ...list.slice(0, i), ...list.slice(i + 1)];
}

function findBrowsers(exists = fs.existsSync, platform = process.platform, env = process.env) {
  const list = findBrowsersRaw(exists, platform, env);
  return orderBrowsers(list, defaultBrowserName(platform, env));
}

function findBrowsersRaw(exists = fs.existsSync, platform = process.platform, env = process.env) {
  const found = [];
  for (const c of browserCandidates(platform, env)) {
    try {
      if (c.which) { const p = execFileSync('which', [c.path], { encoding: 'utf8' }).trim(); if (p) found.push({ name: c.name, path: p }); }
      else if (exists(c.path)) found.push({ name: c.name, path: c.path });
    } catch (e) { /* not installed */ }
  }
  return found;
}

// A session is complete once the signed-in cookies for YouTube exist.
function hasSession(cookies) {
  const names = new Set((cookies || []).filter((c) => /(^|\.)youtube\.com$/.test(String(c.domain || '').replace(/^\./, ''))).map((c) => c.name));
  return (names.has('SAPISID') || names.has('__Secure-3PAPISID')) && (names.has('__Secure-3PSID') || names.has('SID') || names.has('__Secure-1PSID'));
}

// The Cookie header a browser would send to music.youtube.com.
function cookieHeader(cookies) {
  const best = new Map();
  for (const c of cookies || []) {
    const d = String(c.domain || '').replace(/^\./, '');
    if (d !== 'youtube.com' && d !== 'music.youtube.com') continue;   // what a browser sends to music.youtube.com
    const prev = best.get(c.name);
    if (!prev || String(c.domain).length > String(prev.domain).length) best.set(c.name, c);
  }
  return [...best.values()].map((c) => `${c.name}=${c.value}`).join('; ');
}

function getJson(port, p) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: p, timeout: 2500 }, (res) => {
      let d = ''; res.on('data', (c) => { d += c; });
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

function cdpCall(wsUrl, method, params = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; try { ws.close(); } catch (e) {} resolve(v); } };
    let ws;
    try { ws = new WebSocket(wsUrl); } catch (e) { return resolve(null); }
    const t = setTimeout(() => finish(null), 5000);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method, params }));
    ws.onmessage = (m) => { try { const d = JSON.parse(m.data); if (d.id === 1) { clearTimeout(t); finish(d.result || null); } } catch (e) { /* ignore */ } };
    ws.onerror = () => { clearTimeout(t); finish(null); };
  });
}

let current = null;   // { state, message, browser, proc, dir, timer }

function status() {
  if (!current) return { state: 'idle' };
  return { state: current.state, message: current.message || '', browser: current.browser || '' };
}

function cleanup(c) {
  clearInterval(c.timer);
  try { if (c.proc && !c.proc.killed) c.proc.kill(); } catch (e) {}
  setTimeout(() => { try { fs.rmSync(c.dir, { recursive: true, force: true }); } catch (e) {} }, 2500);
}

function cancel() {
  if (current && (current.state === 'waiting' || current.state === 'verifying')) { current.state = 'cancelled'; current.message = 'Cancelled'; cleanup(current); }
  return status();
}

async function start(connect, opts = {}) {
  if (current && (current.state === 'waiting' || current.state === 'verifying')) return status();
  const browsers = (opts.browsers || findBrowsers());
  if (!browsers.length) {
    current = { state: 'nobrowser', message: 'No Chrome, Brave, Edge or Chromium found. Use the cookie option instead.' };
    return status();
  }
  const b = (opts.browser && browsers.find((x) => x.name === opts.browser)) || browsers[0];
  const port = 49152 + Math.floor(Math.random() * 12000);
  const dir = path.join(os.tmpdir(), 'gaane-signin-' + crypto.randomBytes(5).toString('hex'));
  fs.mkdirSync(dir, { recursive: true });
  let proc;
  try {
    proc = spawn(b.path, [`--remote-debugging-port=${port}`, '--remote-allow-origins=*', `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check', '--new-window', LOGIN_URL], { stdio: 'ignore' });
  } catch (e) {
    current = { state: 'error', message: 'Could not open ' + b.name };
    return status();
  }
  const c = current = { state: 'waiting', message: `Sign in in the ${b.name} window that just opened`, browser: b.name, proc, dir, timer: null };
  proc.on('exit', () => { if (current === c && (c.state === 'waiting')) { c.state = 'cancelled'; c.message = 'The sign-in window was closed'; cleanup(c); } });
  const started = Date.now();
  let busy = false;
  c.timer = setInterval(async () => {
    if (busy || current !== c || c.state !== 'waiting') return;
    if (Date.now() - started > 12 * 60 * 1000) { c.state = 'error'; c.message = 'Timed out waiting for sign-in'; cleanup(c); return; }
    busy = true;
    try {
      const v = await getJson(port, '/json/version');
      if (!v || !v.webSocketDebuggerUrl) return;
      const r = await cdpCall(v.webSocketDebuggerUrl, 'Storage.getCookies');
      const cookies = (r && r.cookies) || [];
      if (!hasSession(cookies)) return;
      // signed in: give Google a moment to finish setting the last cookies, then read them once more
      c.state = 'verifying'; c.message = 'Signed in. Finishing up...';
      await new Promise((res) => setTimeout(res, 2500));
      const r2 = await cdpCall(v.webSocketDebuggerUrl, 'Storage.getCookies');
      const header = cookieHeader((r2 && r2.cookies) || cookies);
      const out = await connect(header);
      if (out && out.ok) { c.state = 'done'; c.message = 'Connected'; await cdpCall(v.webSocketDebuggerUrl, 'Browser.close'); cleanup(c); }
      else { c.state = 'error'; c.message = (out && out.error) || 'YouTube Music did not accept the sign-in'; await cdpCall(v.webSocketDebuggerUrl, 'Browser.close'); cleanup(c); }
    } finally { busy = false; }
  }, 1500);
  return status();
}

module.exports = { start, status, cancel, findBrowsers, orderBrowsers, defaultBrowserName, browserCandidates, hasSession, cookieHeader, LOGIN_URL };
