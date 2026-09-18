import { mkdir, copyFile, cp, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, 'dist');
await mkdir(output, { recursive: true });
for (const file of ['index.html', 'style.css', 'app.js', 'controller.js', 'favicon.svg', 'LICENSE', 'THIRD_PARTY.md']) {
  await copyFile(resolve(root, file), resolve(output, file));
}
for (const directory of ['editor', 'runtime', 'ui', 'vendor']) {
  await cp(resolve(root, directory), resolve(output, directory), { recursive: true });
}
await writeFile(resolve(output, '.nojekyll'), '');
const html = await readFile(resolve(output, 'index.html'), 'utf8');
if (!html.includes('app.js')) throw new Error('Static entry point is incomplete.');
console.log('Built static website in dist/. No server runtime or environment variables required.');
