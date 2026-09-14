const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const mysql = require('mysql2/promise');
const crypto = require('crypto');
const { execFile } = require('child_process');
const fs = require('fs');

// REPARATUR: Sucht die .env Datei außerhalb der ASAR-Verpackung, wenn die App kompiliert ist
const envPath = app.isPackaged 
    ? path.join(process.resourcesPath, '../.env') // Liegt direkt neben der .exe
    : path.join(__dirname, '.env');               // Im Dev-Modus

require('dotenv').config({ path: envPath });

const dbConfig = {
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'auth'
};

// Flüchtige RAM-Variablen für die Pfade
let currentWowPath = null;
let currentAuthPath = null; // Neu für Authserver
let currentWorldPath = null;

const g = 7n;
const N = BigInt('0x894B645E89E1535BBDAD5B8B290650530801B18EBFBF5E8FAB3C82872A3E9BB7');

function calculateSrp6Verifier(username, password, saltBuffer) {
    const userUpper = username.toUpperCase();
    const passUpper = password.toUpperCase();
    const h1 = crypto.createHash('sha1').update(`${userUpper}:${passUpper}`).digest();
    const h2Buffer = crypto.createHash('sha1').update(Buffer.concat([saltBuffer, h1])).digest();
    const h2HexReverse = Buffer.from(h2Buffer).reverse().toString('hex');
    const h2BigInt = BigInt('0x' + h2HexReverse);
    let resultBigInt = 1n;
    let base = g;
    let exp = h2BigInt;
    while (exp > 0n) {
        if (exp % 2n === 1n) resultBigInt = (resultBigInt * base) % N;
        base = (base * base) % N;
        exp = exp / 2n;
    }
    let verifierHex = resultBigInt.toString(16).toUpperCase().padStart(64, '0');
    const verifierBuffer = Buffer.from(verifierHex, 'hex').reverse();
    return verifierBuffer.toString('hex').toUpperCase();
}

function updateRealmlist(wowFilePath) {
    try {
        const gameDir = path.dirname(wowFilePath);
        const wtfDir = path.join(gameDir, 'WTF');
        const configWtfPath = path.join(wtfDir, 'Config.wtf');
        if (!fs.existsSync(wtfDir)) fs.mkdirSync(wtfDir, { recursive: true });
        let configContent = '';
        if (fs.existsSync(configWtfPath)) configContent = fs.readFileSync(configWtfPath, 'utf8');
        const realmlistLine = 'SET realmlist "127.0.0.1"';
        const realmlistRegex = /^SET realmlist\s+".*"/im;
        if (realmlistRegex.test(configContent)) {
            configContent = configContent.replace(realmlistRegex, realmlistLine);
        } else {
            configContent += (configContent.endsWith('\n') || configContent === '' ? '' : '\n') + realmlistLine + '\n';
        }
        fs.writeFileSync(configWtfPath, configContent, 'utf8');
    } catch (error) {
        console.error('Fehler beim Aktualisieren der WTF/Config.wtf:', error);
    }
}

function createWindow() {
    const win = new BrowserWindow({
        width: 1280,
        height: 720,
        resizable: false,
        frame: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    ipcMain.on('close-window', () => { app.quit(); });
    ipcMain.handle('check-wow-path', () => { return { exists: !!currentWowPath }; });

    ipcMain.handle('select-wow-path', async () => {
        const result = await dialog.showOpenDialog(win, {
            title: 'Wow.exe suchen - Wähle die ausführbare Spieldatei aus',
            filters: [{ name: 'World of Warcraft Client (Wow.exe)', extensions: ['exe'] }],
            properties: ['openFile']
        });
        if (!result.canceled && result.filePaths.length > 0) {
            currentWowPath = result.filePaths;
            return { success: true };
        }
        return { success: false };
    });

    ipcMain.handle('launch-game', async () => {
        if (!currentWowPath) return { success: false, message: 'Kein Pfad vorhanden.' };
        updateRealmlist(String(currentWowPath));
        execFile(String(currentWowPath), { cwd: path.dirname(String(currentWowPath)) }, (err) => {
            if (err) console.error(err);
        });
        return { success: true };
    });

    // --- NEU: HANDLER FÜR AUTHSERVER ---
    ipcMain.handle('launch-authserver', async () => {
        if (!currentAuthPath) {
            const result = await dialog.showOpenDialog(win, {
                title: 'Bitte wähle deine authserver.exe aus',
                filters: [{ name: 'Skyfire Authserver (authserver.exe)', extensions: ['exe'] }],
                properties: ['openFile']
            });
            if (!result.canceled && result.filePaths.length > 0) {
                currentAuthPath = result.filePaths;
            } else {
                return { success: false, message: 'Start abgebrochen. Kein Pfad gewählt.' };
            }
        }
        
        const serverDir = path.dirname(String(currentAuthPath));
        // Startet den Server in einem neuen, persistenten CMD-Fenster (/k hält es bei Crash offen)
        exec(`start cmd.exe /k "${path.basename(String(currentAuthPath))}"`, { cwd: serverDir });
        return { success: true };
    });
	
	// --- HANDLER FÜR WORLDSERVER ---
    ipcMain.handle('launch-worldserver', async () => {
        if (!currentWorldPath) {
            const result = await dialog.showOpenDialog(win, {
                title: 'Bitte wähle deine worldserver.exe aus',
                filters: [{ name: 'Skyfire Worldserver (worldserver.exe)', extensions: ['exe'] }],
                properties: ['openFile']
            });
            if (!result.canceled && result.filePaths.length > 0) {
                currentWorldPath = result.filePaths;
            } else {
                return { success: false, message: 'Start abgebrochen. Kein Pfad gewählt.' };
            }
        }
        const serverDir = path.dirname(String(currentWorldPath));
        exec(`start cmd.exe /k "${path.basename(String(currentWorldPath))}"`, { cwd: serverDir });
        return { success: true };
    });

    win.loadFile('index.html');
}

app.whenReady().then(createWindow);

ipcMain.handle('register-account', async (event, { username, password, email }) => {
    let connection = null;
    try {
        connection = await mysql.createConnection(dbConfig);
        const [rows] = await connection.execute('SELECT id FROM account WHERE username = ?', [username]);
        if (rows.length > 0) { await connection.end(); return { success: false, message: 'Accountname bereits vergeben!' }; }
        const saltBuffer = crypto.randomBytes(32);
        const verifierHex = calculateSrp6Verifier(username, password, saltBuffer);
        const verifierBuffer = Buffer.from(verifierHex, 'hex');
        const query = `INSERT INTO account (username, salt, verifier, email, reg_email, joindate, last_ip) VALUES (?, ?, ?, ?, ?, NOW(), '127.0.0.1')`;
        await connection.execute(query, [username.toUpperCase(), saltBuffer, verifierBuffer, email, email]);
        await connection.end();
        return { success: true, message: 'Account erfolgreich erstellt!' };
    } catch (error) {
        if (connection) await connection.end().catch(() => {});
        return { success: false, message: `Datenbankfehler: ${error.message}` };
    }
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
