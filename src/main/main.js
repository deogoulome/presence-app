const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs   = require('fs');

let db, SQL, dbPath;

// ── DATABASE ──────────────────────────────────────────────────────────────────
async function initDB() {
  const initSqlJs = require('sql.js');
  SQL    = await initSqlJs();
  dbPath = path.join(app.getPath('userData'), 'presences.db');

  db = fs.existsSync(dbPath)
    ? new SQL.Database(fs.readFileSync(dbPath))
    : new SQL.Database();

  db.run(`
    CREATE TABLE IF NOT EXISTS projets (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      nom            TEXT    NOT NULL,
      description    TEXT    DEFAULT '',
      date_creation  TEXT    NOT NULL,
      actif          INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS participants (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      projet_id  INTEGER NOT NULL,
      nom        TEXT    NOT NULL
    );
    CREATE TABLE IF NOT EXISTS presences (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      participant_id INTEGER NOT NULL,
      projet_id      INTEGER NOT NULL,
      date           TEXT    NOT NULL,
      statut         TEXT    NOT NULL,
      UNIQUE(participant_id, date)
    );
  `);
  saveDB();
}

function saveDB() {
  try {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    fs.writeFileSync(dbPath, Buffer.from(db.export()));
  } catch (e) { console.error('saveDB:', e); }
}

function dbAll(sql, params = []) {
  try {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  } catch (e) { console.error('dbAll:', e.message); return []; }
}

function dbGet(sql, params = []) {
  return dbAll(sql, params)[0] || null;
}

function lastId() {
  try {
    const r = db.exec('SELECT last_insert_rowid()');
    return (r && r[0] && r[0].values[0]) ? r[0].values[0][0] : null;
  } catch (e) { return null; }
}

// ── WINDOW ────────────────────────────────────────────────────────────────────
function createWindow() {
  const win = new BrowserWindow({
    width: 1100, height: 720, minWidth: 800, minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0f1117', symbolColor: '#ffffff', height: 38 },
    backgroundColor: '#0f1117',
    show: false
  });
  win.loadFile(path.join(__dirname, '../renderer/index.html'));
  win.once('ready-to-show', () => win.show());
}

app.whenReady().then(async () => {
  await initDB();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ── IPC ───────────────────────────────────────────────────────────────────────

ipcMain.handle('get-projets', () => {
  const projets = dbAll('SELECT * FROM projets WHERE actif = 1 ORDER BY date_creation DESC');
  return projets.map(p => ({
    ...p,
    participants: dbAll('SELECT * FROM participants WHERE projet_id = ?', [p.id]),
    nb_jours: (dbGet('SELECT COUNT(DISTINCT date) as n FROM presences WHERE projet_id = ?', [p.id]) || { n: 0 }).n
  }));
});

ipcMain.handle('create-projet', (_, { nom, description, participants }) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    db.run('INSERT INTO projets (nom, description, date_creation) VALUES (?, ?, ?)', [nom, description || '', today]);
    const projetId = lastId();
    if (!projetId) return { success: false, error: 'ID introuvable' };
    for (const name of participants) {
      db.run('INSERT INTO participants (projet_id, nom) VALUES (?, ?)', [projetId, name]);
    }
    saveDB();
    return { success: true, id: projetId };
  } catch (e) {
    console.error('create-projet:', e);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('delete-projet', (_, id) => {
  db.run('UPDATE projets SET actif = 0 WHERE id = ?', [id]);
  saveDB();
  return true;
});

ipcMain.handle('add-participant', (_, { projet_id, nom }) => {
  db.run('INSERT INTO participants (projet_id, nom) VALUES (?, ?)', [projet_id, nom]);
  const id = lastId();
  saveDB();
  return { id, projet_id, nom };
});

ipcMain.handle('remove-participant', (_, id) => {
  db.run('DELETE FROM presences WHERE participant_id = ?', [id]);
  db.run('DELETE FROM participants WHERE id = ?', [id]);
  saveDB();
  return true;
});

ipcMain.handle('get-presences-jour', (_, { projet_id, date }) => {
  const participants = dbAll('SELECT * FROM participants WHERE projet_id = ?', [projet_id]);
  const map = {};
  dbAll('SELECT * FROM presences WHERE projet_id = ? AND date = ?', [projet_id, date])
    .forEach(p => { map[p.participant_id] = p.statut; });
  return participants.map(p => ({ ...p, statut: map[p.id] || null }));
});

ipcMain.handle('marquer-presence', (_, { participant_id, projet_id, date, statut }) => {
  db.run('DELETE FROM presences WHERE participant_id = ? AND date = ?', [participant_id, date]);
  db.run('INSERT INTO presences (participant_id, projet_id, date, statut) VALUES (?, ?, ?, ?)',
    [participant_id, projet_id, date, statut]);
  saveDB();
  return true;
});

ipcMain.handle('get-historique-date', (_, { projet_id, date }) => {
  const participants = dbAll('SELECT * FROM participants WHERE projet_id = ?', [projet_id]);
  const map = {};
  dbAll('SELECT * FROM presences WHERE projet_id = ? AND date = ?', [projet_id, date])
    .forEach(p => { map[p.participant_id] = p.statut; });
  return participants.map(p => ({ ...p, statut: map[p.id] || null }));
});

ipcMain.handle('get-stats', (_, projet_id) => {
  const participants = dbAll('SELECT * FROM participants WHERE projet_id = ?', [projet_id]);
  const jours = dbAll('SELECT DISTINCT date FROM presences WHERE projet_id = ? ORDER BY date DESC', [projet_id]).map(r => r.date);
  return {
    participants: participants.map(p => ({
      ...p,
      present: (dbGet("SELECT COUNT(*) as n FROM presences WHERE participant_id = ? AND statut='present'", [p.id]) || { n: 0 }).n,
      absent:  (dbGet("SELECT COUNT(*) as n FROM presences WHERE participant_id = ? AND statut='absent'",  [p.id]) || { n: 0 }).n,
      total: jours.length
    })),
    jours
  };
});

ipcMain.handle('get-jours-disponibles', (_, projet_id) =>
  dbAll('SELECT DISTINCT date FROM presences WHERE projet_id = ? ORDER BY date DESC', [projet_id]).map(r => r.date)
);

// ── EXPORT CSV ────────────────────────────────────────────────────────────────
ipcMain.handle('export-csv', async (_, projet_id) => {
  const projet       = dbGet('SELECT * FROM projets WHERE id = ?', [projet_id]);
  const participants = dbAll('SELECT * FROM participants WHERE projet_id = ?', [projet_id]);
  const jours        = dbAll('SELECT DISTINCT date FROM presences WHERE projet_id = ? ORDER BY date ASC', [projet_id]).map(r => r.date);

  let csv = 'Participant,' + jours.join(',') + '\n';
  participants.forEach(p => {
    const row = [p.nom];
    jours.forEach(d => {
      const pr = dbGet('SELECT statut FROM presences WHERE participant_id = ? AND date = ?', [p.id, d]);
      row.push(pr ? (pr.statut === 'present' ? 'P' : 'A') : '-');
    });
    csv += row.join(',') + '\n';
  });

  const { filePath } = await dialog.showSaveDialog({
    title: 'Exporter en CSV',
    defaultPath: `presences_${(projet?.nom || 'export').replace(/\s+/g, '_')}.csv`,
    filters: [{ name: 'Fichier CSV', extensions: ['csv'] }]
  });
  if (!filePath) return { success: false };
  fs.writeFileSync(filePath, '\uFEFF' + csv, 'utf8');
  return { success: true, path: filePath };
});

// ── EXPORT PDF ────────────────────────────────────────────────────────────────
ipcMain.handle('export-pdf', async (_, { projet_id, date }) => {
  const projet       = dbGet('SELECT * FROM projets WHERE id = ?', [projet_id]);
  const participants = dbAll('SELECT * FROM participants WHERE projet_id = ?', [projet_id]);
  const map = {};
  dbAll('SELECT * FROM presences WHERE projet_id = ? AND date = ?', [projet_id, date])
    .forEach(p => { map[p.participant_id] = p.statut; });

  const presents   = participants.filter(p => map[p.id] === 'present');
  const absents    = participants.filter(p => map[p.id] === 'absent');
  const nonMarques = participants.filter(p => !map[p.id]);

  function fmtDate(d) {
    if (!d) return '';
    const [y, m, j] = d.split('-');
    return `${j}/${m}/${y}`;
  }

  const pct  = participants.length ? Math.round(presents.length / participants.length * 100) : 0;
  const now  = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  const block = (titre, liste, couleur, symbole) => liste.length === 0 ? '' : `
    <tr><td colspan="3" class="section-head" style="background:${couleur}18;color:${couleur}">
      ${symbole} ${titre} — ${liste.length} personne${liste.length > 1 ? 's' : ''}
    </td></tr>
    ${liste.map((p, i) => `<tr>
      <td class="num">${i + 1}</td>
      <td class="name">${p.nom}</td>
      <td class="badge-cell"><span class="badge" style="background:${couleur}18;color:${couleur};border:1px solid ${couleur}40">${titre}</span></td>
    </tr>`).join('')}`;

  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',Arial,sans-serif;font-size:12px;color:#111;background:#fff}
  .page{padding:32px 36px;max-width:740px;margin:0 auto}
  .header{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:16px;border-bottom:3px solid #1d4ed8;margin-bottom:22px}
  .h-left h1{font-size:21px;color:#1d4ed8;font-weight:800}
  .h-left h2{font-size:13px;color:#374151;margin-top:4px;font-weight:500}
  .h-left .desc{font-size:11px;color:#9ca3af;margin-top:2px}
  .h-right{text-align:right}
  .date-badge{background:#1d4ed8;color:#fff;padding:6px 14px;border-radius:8px;font-size:13px;font-weight:700;display:inline-block}
  .gen{font-size:10px;color:#9ca3af;margin-top:5px}
  .stats{display:flex;gap:10px;margin-bottom:22px}
  .stat{flex:1;border-radius:9px;padding:11px 14px;text-align:center}
  .stat-n{font-size:26px;font-weight:800}
  .stat-l{font-size:10px;text-transform:uppercase;letter-spacing:.06em;margin-top:1px;opacity:.75}
  .s-blue {background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe}
  .s-green{background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0}
  .s-red  {background:#fef2f2;color:#dc2626;border:1px solid #fecaca}
  .s-gray {background:#f9fafb;color:#6b7280;border:1px solid #e5e7eb}
  table{width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden}
  thead th{background:#1e3a8a;color:#fff;padding:9px 13px;text-align:left;font-size:11px;letter-spacing:.05em;text-transform:uppercase}
  td{padding:8px 13px;border-bottom:1px solid #f3f4f6;font-size:12px}
  tr:last-child td{border-bottom:none}
  tr:nth-child(even) td{background:#fafafa}
  .section-head{font-weight:700;font-size:12px;padding:9px 13px;letter-spacing:.04em}
  .num{width:36px;color:#9ca3af;text-align:center}
  .name{font-weight:500}
  .badge-cell{width:110px;text-align:center}
  .badge{padding:3px 11px;border-radius:20px;font-size:11px;font-weight:700}
  .footer{margin-top:26px;padding-top:11px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;font-size:10px;color:#9ca3af}
  @page{size:A4;margin:14mm 12mm}
</style></head><body>
<div class="page">
  <div class="header">
    <div class="h-left">
      <h1>📋 Feuille de Présence</h1>
      <h2>${projet?.nom || ''}</h2>
      ${projet?.description ? `<div class="desc">${projet.description}</div>` : ''}
    </div>
    <div class="h-right">
      <div class="date-badge">📅 ${fmtDate(date)}</div>
      <div class="gen">Généré le ${now}</div>
    </div>
  </div>

  <div class="stats">
    <div class="stat s-blue"><div class="stat-n">${participants.length}</div><div class="stat-l">Total</div></div>
    <div class="stat s-green"><div class="stat-n">${presents.length}</div><div class="stat-l">Présents</div></div>
    <div class="stat s-red"><div class="stat-n">${absents.length}</div><div class="stat-l">Absents</div></div>
    <div class="stat s-gray"><div class="stat-n">${pct}%</div><div class="stat-l">Taux</div></div>
  </div>

  <table>
    <thead><tr><th>#</th><th>Nom du participant</th><th style="text-align:center">Statut</th></tr></thead>
    <tbody>
      ${block('Présent',    presents,   '#16a34a', '✓')}
      ${block('Absent',     absents,    '#dc2626', '✗')}
      ${block('Non marqué', nonMarques, '#6b7280', '—')}
    </tbody>
  </table>

  <div class="footer">
    <span>Suivi Présences — ${projet?.nom || ''}</span>
    <span>${participants.length} participant${participants.length > 1 ? 's' : ''} · ${fmtDate(date)}</span>
  </div>
</div></body></html>`;

  const { filePath } = await dialog.showSaveDialog({
    title: 'Exporter en PDF',
    defaultPath: `presences_${(projet?.nom || 'projet').replace(/\s+/g, '_')}_${date}.pdf`,
    filters: [{ name: 'Fichier PDF', extensions: ['pdf'] }]
  });
  if (!filePath) return { success: false };

  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true } });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise(r => setTimeout(r, 600));
  const pdfData = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4', landscape: false });
  win.close();
  fs.writeFileSync(filePath, pdfData);
  return { success: true, path: filePath };
});
