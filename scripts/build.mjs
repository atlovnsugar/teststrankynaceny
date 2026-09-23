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
const indexHtml = await readFile(builtIndex, 'utf8');
await writeFile(builtIndex, indexHtml.replaceAll('__BUILD_VERSION__', buildVersion));

for (const dir of ['data', 'data/geo']) {
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
