# Suivi Présences — Application Desktop

Application Electron pour suivre les présences de participants à des projets/travaux, avec base de données SQLite locale.

## Fonctionnalités

- Créer des projets avec liste de participants
- Marquer présent/absent chaque jour
- Historique par date
- Statistiques par participant (taux de présence)
- Export CSV
- Base de données locale SQLite (données sauvegardées sur votre PC)

## Installation & Lancement

### Prérequis
- **Node.js** version 18 ou supérieure → https://nodejs.org
- **Windows 10/11** 64-bit

### Étapes

1. **Décompressez** le dossier `presence-app`

2. **Ouvrez un terminal** dans ce dossier (clic droit → "Ouvrir dans le terminal")

3. **Installez les dépendances** :
   ```
   npm install
   ```

4. **Lancez l'application** :
   ```
   npm start
   ```

### Créer un installateur Windows (.exe)

```
npm run build
```
Le fichier `.exe` sera dans le dossier `dist/`.

Pour une version portable (sans installation) :
```
npm run build-portable
```

## Base de données

Les données sont stockées dans :
```
C:\Users\[VotreNom]\AppData\Roaming\presence-app\presences.db
```
Fichier SQLite — vous pouvez le sauvegarder ou le copier.

## Structure du projet

```
presence-app/
├── src/
│   ├── main/
│   │   ├── main.js       ← Processus principal Electron + SQLite
│   │   └── preload.js    ← Pont sécurisé IPC
│   └── renderer/
│       └── index.html    ← Interface utilisateur
├── package.json
└── README.md
```
