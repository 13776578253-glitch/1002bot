import { cp, mkdir } from 'node:fs/promises';

const destination = new URL('../dist/react/', import.meta.url);
await mkdir(destination, { recursive: true });
await cp(new URL('../src/react/styles.css', import.meta.url), new URL('styles.css', destination));
await cp(new URL('../src/react/styles/', import.meta.url), new URL('styles/', destination), { recursive: true });
