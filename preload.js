const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petAPI', {
  // Pet window
  setIgnoreMouse: (ignore)  => ipcRenderer.send('set-ignore-mouse', ignore),
  dragStart:      ()        => ipcRenderer.send('drag-start'),
  moveWindow:     (delta)   => ipcRenderer.send('move-window', delta),
  dragEnd:        ()        => ipcRenderer.send('drag-end'),
  onClaudeState:  (cb)      => ipcRenderer.on('claude-state', (_, s) => cb(s)),
  getPetName:     ()        => ipcRenderer.invoke('get-pet-name'),

  // Setup window
  savePetName:      (name) => ipcRenderer.send('save-name', name),
  onPetNameUpdated: (cb)   => ipcRenderer.on('pet-name-updated', (_, name) => cb(name)),

  // Settings window
  getSettings:       ()     => ipcRenderer.invoke('get-settings'),
  saveSettings:      (data) => ipcRenderer.send('save-settings', data),
  onSettingsUpdated: (cb)   => ipcRenderer.on('settings-updated', (_, s) => cb(s)),
  quitApp:           ()     => ipcRenderer.send('quit-app'),
});
