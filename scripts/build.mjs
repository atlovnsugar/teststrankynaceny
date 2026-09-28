import { cp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const site = join(root, 'site');
const dist = join(root, 'dist');
const builtAt = new Date().toISOString();
const buildVersion = process.env.GITHUB_SHA || builtAt.replace(/[^0-9]/g, '').slice(0, 14);

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(site, dist, { recursive: true });

const builtIndex = join(dist, 'index.html');
let indexHtml = await readFile(builtIndex, 'utf8');
indexHtml = indexHtml.replaceAll('__BUILD_VERSION__', buildVersion);

// The energy-system module is source-only and injects its own tab/view at runtime.
// This keeps the local repository independent of generated data and avoids requiring
// manual edits to site/index.html when the module is installed.
if (!indexHtml.includes('./energy_system.js')) {
  const injection = `  <link rel="stylesheet" href="./energy_system.css?v=${buildVersion}" />\n  <script src="./energy_system.js?v=${buildVersion}"></script>\n`;
  const appScript = /\s*<script[^>]+src=["']\.\/app\.js\?v=[^"']+["'][^>]*><\/script>/i;
  if (appScript.test(indexHtml)) {
    indexHtml = indexHtml.replace(appScript, `\n${injection}$&`);
  } else {
    indexHtml = indexHtml.replace(/<\/body>/i, `\n${injection}</body>`);
  }
}
await writeFile(builtIndex, indexHtml);

for (const dir of ['data', 'data/geo', 'data/infrastructure']) {
  const src = join(root, dir);
  if (existsSync(src)) await cp(src, join(dist, dir), { recursive: true });
}

const repository = process.env.GITHUB_REPOSITORY || '';
const serverUrl = process.env.GITHUB_SERVER_URL || 'https://github.com';
const actionsUrl = repository ? `${serverUrl}/${repository}/actions/workflows/update-data.yml` : '';
await writeFile(join(dist, 'build-info.json'), JSON.stringify({ builtAt, repository, actionsUrl }, null, 2));
await writeFile(join(dist, 'runtime-config.js'), `window.RUNTIME_CONFIG=${JSON.stringify({ repository, actionsUrl, builtAt })};\n`);
console.log(`Built static site → ${dist}`);
console.log(`Workflow URL → ${actionsUrl || '(set automatically by GitHub Actions during deployment)'}`);
