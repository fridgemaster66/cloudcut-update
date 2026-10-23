// Buduje dist/CloudCut-win32-x64/CloudCut.exe (Electron + runtime z wbudowanym PHP i plikami programu)
import { packager } from '@electron/packager';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DESKTOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [out] = await packager({
  dir: DESKTOP,
  out: path.join(DESKTOP, 'dist'),
  overwrite: true,
  platform: 'win32',
  arch: 'x64',
  name: 'CloudCut',
  executableName: 'CloudCut',
  icon: path.join(DESKTOP, 'build', 'icon.ico'),
  asar: true,
  prune: true,
  extraResource: [path.join(DESKTOP, 'runtime')],
  ignore: [/^\/runtime($|\/)/, /^\/dist($|\/)/, /^\/scripts($|\/)/, /^\/build\/icon-256\.png$/],
  appCopyright: 'Adamczyk Usługi',
  win32metadata: { CompanyName: 'Adamczyk Usługi', FileDescription: 'CloudCut — studio montażu wideo', ProductName: 'CloudCut', InternalName: 'CloudCut' },
});
console.log('gotowe:', path.join(out, 'CloudCut.exe'));
