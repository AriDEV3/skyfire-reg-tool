const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    register: (data) => ipcRenderer.invoke('register-account', data),
    closeApp: () => ipcRenderer.send('close-window'),
    launchGame: () => ipcRenderer.invoke('launch-game'),
    selectWowPath: () => ipcRenderer.invoke('select-wow-path'),
    checkWowPath: () => ipcRenderer.invoke('check-wow-path'),
    launchAuthServer: () => ipcRenderer.invoke('launch-authserver'),
    launchWorldServer: () => ipcRenderer.invoke('launch-worldserver')
});