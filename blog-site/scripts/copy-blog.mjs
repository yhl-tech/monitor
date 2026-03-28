import { cpSync, rmSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Source: blog-site/dist (sibling to this script's parent directory)
const src = resolve(__dirname, '..', 'dist');
// Destination: project-root/public/blog
const dest = resolve(__dirname, '..', '..', 'public', 'blog');

// Clean and recreate destination
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });

// Copy all contents
cpSync(src, dest, { recursive: true });

console.log('Blog site copied to public/blog/');
