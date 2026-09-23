import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const site = join(root, 'site');
const dist = join(root, 'dist');

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(site, dist, { recursive: true });

for (const dir of ['data', 'data/geo']) {
  const src = join(root, dir);
  if (existsSync(src)) await cp(src, join(dist, dir), { recursive: true });
}

const builtAt = new Date().toISOString();
const repository = process.env.GITHUB_REPOSITORY || '';
const serverUrl = process.env.GITHUB_SERVER_URL || 'https://github.com';
const actionsUrl = repository ? `${serverUrl}/${repository}/actions/workflows/update-data.yml` : '';
await writeFile(join(dist, 'build-info.json'), JSON.stringify({ builtAt, repository, actionsUrl }, null, 2));
await writeFile(join(dist, 'runtime-config.js'), `window.RUNTIME_CONFIG=${JSON.stringify({ repository, actionsUrl, builtAt })};\n`);
console.log(`Built static site → ${dist}`);
console.log(`Workflow URL → ${actionsUrl || '(set automatically by GitHub Actions during deployment)'}`);
