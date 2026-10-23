'use strict';
// Znacznik wersji na komputer — strona sprawdza window.cloudcutDesktop (core.js: IS_DESKTOP)
const { contextBridge } = require('electron');

const version = (process.argv.find(a => a.startsWith('--cloudcut-version=')) || '').split('=')[1] || '';
contextBridge.exposeInMainWorld('cloudcutDesktop', Object.freeze({ platform: process.platform, version }));
