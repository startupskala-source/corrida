// Copia os arquivos do site (raiz, publicada no GitHub Pages) para www/, que o Capacitor empacota no APK.
import { cpSync, rmSync, mkdirSync } from 'node:fs';
rmSync('www', { recursive: true, force: true });
mkdirSync('www');
for (const f of ['index.html', 'manifest.json', 'icon.svg', 'css', 'js']) cpSync(f, `www/${f}`, { recursive: true });
console.log('www/ atualizado');
