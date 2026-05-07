const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let db;
let SQL;
let dbPath;

async function initDB() {
  const initSqlJs = require('sql.js');
  SQL = await initSqlJs();

  const userDataPath = app.getPath('userData');
  dbPath = path.join(userDataPath, 'presences.db');

  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS projets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nom TEXT NOT NULL,
      description TEXT DEFAULT '',
      date_creation TEXT NOT NULL,
      actif INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS participants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      projet_id INTEGER NOT NULL,
      nom TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS presences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      participant_id INTEGER NOT NULL,
      projet_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      statut TEXT NOT NULL,
      UNIQUE(participant_id, date)
    );
  `);
  saveDB();
}

function saveDB() {
  try {
    const data = db.export();
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    fs.writeFileSync(dbPath, Buffer.from(data));
  } catch (e) { console.error('DB save error:', e); }
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

// Méthode fiable pour récupérer le dernier ID inséré avec sql.js
function getLastId() {
  try {
    const result = db.exec('SELECT last_insert_rowid()');
    if (result && result[0] && result[0].values && result[0].values[0]) {
      return result[0].values[0][0];
    }
    return null;
  } catch (e) {
    console.error('getLastId error:', e);
    return null;
  }
}

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
    const projetId = getLastId();
    if (!projetId) throw new Error('Impossible de récupérer lID du projet');
    for (const name of participants) {
      db.run('INSERT INTO participants (projet_id, nom) VALUES (?, ?)', [projetId, name]);
    }
    saveDB();
    return { id: projetId, success: true };
  } catch (e) {
    console.error('create-projet error:', e);
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
  const id = getLastId();
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
  const presences = dbAll('SELECT * FROM presences WHERE projet_id = ? AND date = ?', [projet_id, date]);
  const map = {};
  presences.forEach(p => { map[p.participant_id] = p.statut; });
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
  const presences = dbAll('SELECT * FROM presences WHERE projet_id = ? AND date = ?', [projet_id, date]);
  const map = {};
  presences.forEach(p => { map[p.participant_id] = p.statut; });
  return participants.map(p => ({ ...p, statut: map[p.id] || null }));
});

ipcMain.handle('get-stats', (_, projet_id) => {
  const participants = dbAll('SELECT * FROM participants WHERE projet_id = ?', [projet_id]);
  const jours = dbAll('SELECT DISTINCT date FROM presences WHERE projet_id = ? ORDER BY date DESC', [projet_id]).map(r => r.date);
  const stats = participants.map(p => {
    const rP = dbGet("SELECT COUNT(*) as n FROM presences WHERE participant_id = ? AND statut = 'present'", [p.id]);
    const rA = dbGet("SELECT COUNT(*) as n FROM presences WHERE participant_id = ? AND statut = 'absent'", [p.id]);
    return { ...p, present: rP?.n || 0, absent: rA?.n || 0, total: jours.length };
  });
  return { participants: stats, jours };
});

ipcMain.handle('get-jours-disponibles', (_, projet_id) => {
  return dbAll('SELECT DISTINCT date FROM presences WHERE projet_id = ? ORDER BY date DESC', [projet_id]).map(r => r.date);
});

ipcMain.handle('export-csv', async (_, projet_id) => {
  const projet = dbGet('SELECT * FROM projets WHERE id = ?', [projet_id]);
  const participants = dbAll('SELECT * FROM participants WHERE projet_id = ?', [projet_id]);
  const jours = dbAll('SELECT DISTINCT date FROM presences WHERE projet_id = ? ORDER BY date ASC', [projet_id]).map(r => r.date);

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

  if (filePath) {
    fs.writeFileSync(filePath, '\uFEFF' + csv, 'utf8');
    return { success: true, path: filePath };
  }
  return { success: false };
});

// ── EXPORT PDF ────────────────────────────────────────────────────────────────
ipcMain.handle('export-pdf', async (_, { projet_id, date }) => {
  const projet     = dbGet('SELECT * FROM projets WHERE id = ?', [projet_id]);
  const participants = dbAll('SELECT * FROM participants WHERE projet_id = ?', [projet_id]);
  const presences  = dbAll('SELECT * FROM presences WHERE projet_id = ? AND date = ?', [projet_id, date]);

  const map = {};
  presences.forEach(p => { map[p.participant_id] = p.statut; });

  const presents = participants.filter(p => map[p.id] === 'present');
  const absents  = participants.filter(p => map[p.id] === 'absent');
  const nonMarques = participants.filter(p => !map[p.id]);

  function fmtDate(d) {
    if (!d) return '';
    const [y, m, j] = d.split('-');
    return `${j}/${m}/${y}`;
  }

  const pct = participants.length ? Math.round(presents.length / participants.length * 100) : 0;
  const dateFormatee = fmtDate(date);
  const now = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  const lignes = (liste, statut, couleur, symbole) => liste.length === 0 ? '' : `
    <tr class="section-header">
      <td colspan="3" style="background:${couleur}15;color:${couleur};font-weight:700;font-size:12px;padding:10px 14px;letter-spacing:.05em">
        ${symbole} ${statut.toUpperCase()} — ${liste.length} personne${liste.length > 1 ? 's' : ''}
      </td>
    </tr>
    ${liste.map((p, i) => `
    <tr>
      <td style="color:#6b7280;text-align:center;width:36px">${i + 1}</td>
      <td style="font-weight:500;padding:9px 14px">${p.nom}</td>
      <td style="text-align:center">
        <span style="display:inline-block;padding:3px 12px;border-radius:20px;font-size:11px;font-weight:700;background:${couleur}15;color:${couleur};border:1px solid ${couleur}40">
          ${statut}
        </span>
      </td>
    </tr>`).join('')}`;

  const html = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"/>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 13px; color: #1f2937; background: white; }
  .page { padding: 36px 40px; max-width: 720px; margin: 0 auto; }

  /* HEADER */
  .header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 18px; border-bottom: 3px solid #1d4ed8; margin-bottom: 24px; }
  .header-left h1 { font-size: 22px; color: #1d4ed8; font-weight: 800; letter-spacing: -.3px; }
  .header-left h2 { font-size: 14px; color: #374151; margin-top: 5px; font-weight: 500; }
  .header-left .projet-desc { font-size: 12px; color: #9ca3af; margin-top: 3px; }
  .header-right { text-align: right; }
  .date-badge { background: #1d4ed8; color: white; padding: 6px 14px; border-radius: 8px; font-size: 13px; font-weight: 700; }
  .generated { font-size: 10px; color: #9ca3af; margin-top: 6px; }

  /* STATS */
  .stats { display: flex; gap: 12px; margin-bottom: 24px; }
  .stat { flex: 1; border-radius: 10px; padding: 12px 16px; text-align: center; }
  .stat-n { font-size: 28px; font-weight: 800; }
  .stat-l { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; margin-top: 2px; opacity: .8; }
  .stat.blue  { background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; }
  .stat.green { background: #f0fdf4; color: #16a34a; border: 1px solid #bbf7d0; }
  .stat.red   { background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; }
  .stat.gray  { background: #f9fafb; color: #6b7280; border: 1px solid #e5e7eb; }

  /* TABLE */
  table { width: 100%; border-collapse: collapse; border-radius: 10px; overflow: hidden; border: 1px solid #e5e7eb; }
  th { background: #1e3a8a; color: white; padding: 10px 14px; text-align: left; font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
  td { padding: 8px 14px; border-bottom: 1px solid #f3f4f6; font-size: 12px; }
  tr:last-child td { border-bottom: none; }

  /* FOOTER */
  .footer { margin-top: 28px; padding-top: 12px; border-top: 1px solid #e5e7eb; display: flex; justify-content: space-between; font-size: 10px; color: #9ca3af; }

  @page { size: A4; margin: 15mm 12mm; }
  @media print { .page { padding: 0; } }
</style>
</head><body>
<div class="page">

  <div class="header">
    <div class="header-left">
      <h1>📋 Feuille de Présence</h1>
      <h2>${projet?.nom || ''}</h2>
      ${projet?.description ? `<div class="projet-desc">${projet.description}</div>` : ''}
    </div>
    <div class="header-right">
      <div class="date-badge">📅 ${dateFormatee}</div>
      <div class="generated">Généré le ${now}</div>
    </div>
  </div>

  <div class="stats">
    <div class="stat blue">
      <div class="stat-n">${participants.length}</div>
      <div class="stat-l">Total</div>
    </div>
    <div class="stat green">
      <div class="stat-n">${presents.length}</div>
      <div class="stat-l">Présents</div>
    </div>
    <div class="stat red">
      <div class="stat-n">${absents.length}</div>
      <div class="stat-l">Absents</div>
    </div>
    <div class="stat gray">
      <div class="stat-n">${pct}%</div>
      <div class="stat-l">Taux présence</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width:36px">#</th>
        <th>Nom du participant</th>
        <th style="width:120px;text-align:center">Statut</th>
      </tr>
    </thead>
    <tbody>
      ${lignes(presents,  'Présent',     '#16a34a', '✓')}
      ${lignes(absents,   'Absent',      '#dc2626', '✗')}
      ${lignes(nonMarques,'Non marqué',  '#6b7280', '—')}
    </tbody>
  </table>

  <div class="footer">
    <span>Suivi Présences — ${projet?.nom || ''}</span>
    <span>Date : ${dateFormatee} · ${participants.length} participant${participants.length > 1 ? 's' : ''}</span>
  </div>
</div>
</body></html>`;

  const { filePath } = await dialog.showSaveDialog({
    title: 'Exporter en PDF',
    defaultPath: `presences_${(projet?.nom || 'projet').replace(/\s+/g, '_')}_${date}.pdf`,
    filters: [{ name: 'Fichier PDF', extensions: ['pdf'] }]
  });
  if (!filePath) return { success: false };

  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true } });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));

  // Wait for page to render
  await new Promise(resolve => setTimeout(resolve, 500));

  const pdfData = await win.webContents.printToPDF({
    printBackground: true,
    pageSize: 'A4',
    landscape: false,
    margins: { top: 0, bottom: 0, left: 0, right: 0 }
  });
  win.close();
  fs.writeFileSync(filePath, pdfData);
  return { success: true, path: filePath };
});
