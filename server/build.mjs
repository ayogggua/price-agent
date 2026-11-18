import { transform } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function resolveFirst(candidates) {
  for (const rel of candidates) {
    const full = path.join(rootDir, rel);
    try {
      await fs.access(full);
      return full;
    } catch {}
  }
  throw new Error('未找到前端源文件: ' + candidates.join(' / '));
}

export async function buildClient() {
  const outDir = path.join(rootDir, 'client/build');
  await fs.mkdir(outDir, { recursive: true });
  const entries = [
    ['components', await resolveFirst(['client/components.jsx', 'designs/quote-input/components.jsx'])],
    ['form', await resolveFirst(['client/form.jsx', 'client/app.jsx', 'designs/quote-input/app.jsx'])],
    ...['shared', 'project', 'quote', 'libraries', 'platform'].map(name => [
      name,
      path.join(rootDir, 'client', name + '.jsx')
    ])
  ];
  for (const [name, file] of entries) {
    const source = await fs.readFile(file, 'utf8');
    const { code } = await transform(source, {
      loader: 'jsx',
      format: 'iife',
      target: 'es2020',
      minify: true,
      legalComments: 'none'
    });
    await fs.writeFile(path.join(outDir, name + '.js'), code);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  await buildClient();
  console.log('报价页面已构建');
}
