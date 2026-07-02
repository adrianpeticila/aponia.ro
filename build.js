#!/usr/bin/env node
// Injects one sitewide link (nav + footer) across all pages without hand-editing each file.
// Nav/footer content on this site is NOT a single uniform block (each page has its own
// lang-switch href and footer link list) — a wholesale block-swap would destroy that.
// This script does a targeted insertion instead: one new <a> at a fixed anchor point.
// To add another sitewide link later: add an entry pattern here, don't hand-edit pages.
// Run: node build.js  → writes ./dist (deploy this directory, not the source tree)
// Run: node build.js --in-place  → rewrites the source .html files directly (S155:
// aponia.ro is served by GitHub Pages from the repo root, so there is no build step
// at deploy time — insertions must land in the source tree itself).

const fs = require('fs');
const path = require('path');

const SRC = __dirname;
const DIST = path.join(SRC, 'dist');
const SKIP_DIRS = new Set(['dist', '.git', 'node_modules', '.claude', '_archive']);

const LINKS = {
  ro: { href: '/test-anxietate/', label: 'Test anxietate' },
  en: { href: '/en/anxiety-test/', label: 'Anxiety Test' },
};

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), out);
    } else {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

function localeOf(relPath) {
  return relPath.split(path.sep)[0] === 'en' ? 'en' : 'ro';
}

function injectNav(html, relPath) {
  const { href, label } = LINKS[localeOf(relPath)];
  const m = html.match(/<nav class="nav">[\s\S]*?<\/nav>/);
  if (!m) return { html, status: 'no-nav' };
  const block = m[0];
  if (block.includes(href)) return { html, status: 'already' };
  if (block.includes('class="nav-back"')) return { html, status: 'skipped-minimal' };
  if (!block.includes('class="lang-sw"')) return { html, status: 'no-lang-sw' };
  const linkTag = `<a href="${href}" class="t-body-sm" style="text-decoration:none;letter-spacing:0.05em;margin-right:0.5rem;">${label}</a>\n    `;
  const newBlock = block.replace('<span class="lang-sw">', linkTag + '<span class="lang-sw">');
  return { html: html.replace(block, newBlock), status: 'inserted' };
}

function injectFooter(html, relPath) {
  const { href, label } = LINKS[localeOf(relPath)];
  const m = html.match(/<footer[^>]*>[\s\S]*?<\/footer>/);
  if (!m) return { html, status: 'no-footer' };
  const block = m[0];
  if (block.includes(href)) return { html, status: 'already' };
  const linkTag = `<a href="${href}">${label}</a>`;
  let newBlock;
  if (block.includes('class="flinks"')) {
    newBlock = block.replace(/(<div class="flinks">[\s\S]*?)(<\/div>)/, `$1  ${linkTag}\n  $2`);
  } else if (/<\/p>\s*<\/footer>/.test(block)) {
    newBlock = block.replace(/<\/p>\s*<\/footer>/, ` · ${linkTag}</p>\n</footer>`);
  } else {
    newBlock = block.replace(/<\/footer>/, ` · ${linkTag}\n</footer>`);
  }
  return { html: html.replace(block, newBlock), status: 'inserted' };
}

function main() {
  const inPlace = process.argv.includes('--in-place');
  const files = walk(SRC);
  const stats = { htmlFiles: 0, navInserted: 0, navSkippedMinimal: 0, navMissing: 0, footerInserted: 0, footerMissing: 0 };
  const missing = [];

  for (const file of files) {
    const rel = path.relative(SRC, file);
    const base = path.basename(file);
    if (rel === 'build.js' || base === '.DS_Store') continue;

    const outPath = inPlace ? file : path.join(DIST, rel);
    if (!inPlace) fs.mkdirSync(path.dirname(outPath), { recursive: true });

    if (!file.endsWith('.html')) {
      if (!inPlace) fs.copyFileSync(file, outPath);
      continue;
    }

    stats.htmlFiles++;
    let html = fs.readFileSync(file, 'utf8');

    const navRes = injectNav(html, rel);
    html = navRes.html;
    if (navRes.status === 'inserted') stats.navInserted++;
    else if (navRes.status === 'skipped-minimal') stats.navSkippedMinimal++;
    else if (navRes.status === 'no-nav' || navRes.status === 'no-lang-sw') { stats.navMissing++; missing.push(`${rel} [nav:${navRes.status}]`); }

    const footerRes = injectFooter(html, rel);
    html = footerRes.html;
    if (footerRes.status === 'inserted') stats.footerInserted++;
    else if (footerRes.status === 'no-footer') { stats.footerMissing++; missing.push(`${rel} [footer:${footerRes.status}]`); }

    fs.writeFileSync(outPath, html);
  }

  console.log(`HTML files processed: ${stats.htmlFiles}`);
  console.log(`Nav link inserted: ${stats.navInserted}`);
  console.log(`Nav skipped (minimal blog/back nav, by design — S115b): ${stats.navSkippedMinimal}`);
  console.log(`Nav not found/matched: ${stats.navMissing}`);
  console.log(`Footer link inserted: ${stats.footerInserted}`);
  console.log(`Footer not found: ${stats.footerMissing}`);
  if (missing.length) {
    console.log('\nFiles with no nav and/or no footer match (left untouched):');
    missing.forEach((f) => console.log(`  ${f}`));
  }
}

main();
