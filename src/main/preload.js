const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getProjets: () => ipcRenderer.invoke('get-projets'),
  createProjet: (data) => ipcRenderer.invoke('create-projet', data),
  deleteProjet: (id) => ipcRenderer.invoke('delete-projet', id),
  addParticipant: (data) => ipcRenderer.invoke('add-participant', data),
  removeParticipant: (id) => ipcRenderer.invoke('remove-participant', id),

  getPresencesJour: (data) => ipcRenderer.invoke('get-presences-jour', data),
  marquerPresence: (data) => ipcRenderer.invoke('marquer-presence', data),
  getHistoriqueDate: (data) => ipcRenderer.invoke('get-historique-date', data),
  getStats: (projet_id) => ipcRenderer.invoke('get-stats', projet_id),
  getJoursDisponibles: (projet_id) => ipcRenderer.invoke('get-jours-disponibles', projet_id),
  exportCSV: (projet_id) => ipcRenderer.invoke('export-csv', projet_id),
  exportPDF: (data) => ipcRenderer.invoke('export-pdf', data),
});
