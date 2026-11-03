import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
const file=readFileSync(new URL('../public/index.html', import.meta.url),'utf8');
const match=file.match(/<script>\s*([\s\S]*?)\s*<\/script>/);
if(!match)throw Error('Missing inline application script');
new Script(match[1],{filename:'public/index.html (inline)'});
if(!file.includes('id="loginGate"')||!file.includes('id="site"'))throw Error('Missing login gate');
console.log('Frontend inline JS syntax and login gate OK');
