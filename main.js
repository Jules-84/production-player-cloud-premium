/*
Production Player PRO
Copyright © 2026 Julie Linklater
All Rights Reserved.
*/
const { app, BrowserWindow, ipcMain, Menu, dialog } = require("electron");
const path = require("path");
const QRCode = require("qrcode");
const { WebSocket } = require("ws");
const { pathToFileURL } = require("url");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");

function safeName(name){
  return String(name || "production")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "production";
}

function ensureDir(dir){
  fs.mkdirSync(dir, { recursive: true });
}

function settingsPath(){
  return path.join(app.getPath("userData"), "settings.json");
}

function readSettings(){
  try{
    if(fs.existsSync(settingsPath())){
      return JSON.parse(fs.readFileSync(settingsPath(), "utf-8"));
    }
  }catch(e){}
  return {};
}

function writeSettings(settings){
  ensureDir(app.getPath("userData"));
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), "utf-8");
}



function dataRoot(){
  const settings = readSettings();
  if(settings.libraryPath){
    return settings.libraryPath;
  }
  return path.join(app.getPath("userData"), "Production Player PRO Library");
}

function productionDir(id, name, yearGroup){
  const group = SCHOOL_YEAR_GROUPS.includes(yearGroup) ? yearGroup : "Year 6";
  return path.join(dataRoot(), "Productions", group, safeName(name || id));
}

function copyAudio(sourcePath, audioDir){
  if(!sourcePath || !fs.existsSync(sourcePath)) return null;
  ensureDir(audioDir);
  const original = path.basename(sourcePath);
  let dest = path.join(audioDir, original);
  if(fs.existsSync(dest)){
    const ext = path.extname(original);
    const stem = path.basename(original, ext);
    let n = 2;
    while(fs.existsSync(dest)){
      dest = path.join(audioDir, `${stem} (${n})${ext}`);
      n++;
    }
  }
  fs.copyFileSync(sourcePath, dest);
  return dest;
}

ipcMain.handle("y6-save-production", async (event, data) => {
  const id = data.productionId || "production";
  const name = data.productionName || id;
  const dir = productionDir(id, name, data.yearGroup);
  const audioDir = path.join(dir, "Audio");
  ensureDir(dir);
  ensureDir(audioDir);

  const skippedAudio = [];
  const savedCues = (data.cues || []).map((cue, index) => {
    let savedPath = cue.savedPath || null;
    const candidate = cue.originalPath || savedPath;

    if(candidate && fs.existsSync(candidate)){
      if(candidate.startsWith(audioDir)){
        savedPath = candidate;
      }else{
        savedPath = copyAudio(candidate, audioDir);
      }
    }

    if(!savedPath || !fs.existsSync(savedPath)){
      skippedAudio.push(cue.name || `Cue ${index + 1}`);
    }

    return {
      name: cue.name,
      duration: cue.duration,
      played: !!cue.played,
      path: savedPath
    };
  });

  const payload = {
    version: "2.0-desktop-library",
    productionId: id,
    productionName: name,
    yearGroup: data.yearGroup || "Year 6",
    selectedIndex: data.selectedIndex ?? -1,
    notes: data.notes || {},
    cues: savedCues
  };

  fs.writeFileSync(path.join(dir, "production.json"), JSON.stringify(payload, null, 2), "utf-8");
  return { ok: true, productionDir: dir, skippedAudio };
});

// Build5 exact production load fix
ipcMain.handle("y6-load-production", async (event, id) => {
  const root = dataRoot();
  if(!fs.existsSync(root)) return null;

  const requestedId = String(id || "");
  const expectedNames = {};
  const requestedName = expectedNames[requestedId] || requestedId;

  const dirs = fs.readdirSync(root, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => path.join(root, d.name));

  let fallbackByFolder = null;

  for(const dir of dirs){
    const file = path.join(dir, "production.json");
    if(!fs.existsSync(file)) continue;

    try{
      const data = JSON.parse(fs.readFileSync(file, "utf-8"));

      const exactId = data.productionId === requestedId || data.id === requestedId;
      const exactName = data.productionName === requestedName || data.name === requestedName;
      const folderName = path.basename(dir).toLowerCase();
      const requestedFolder = safeName(requestedName).toLowerCase();

      if(folderName === requestedFolder){
        fallbackByFolder = data;
      }

      if(!exactId && !exactName) continue;

      data.cues = (data.cues || [])
        .filter(c => c.path && fs.existsSync(c.path))
        .map(c => ({
          ...c,
          url: pathToFileURL(c.path).href,
          savedPath: c.path,
          filePath: c.path,
          originalPath: c.path
        }));
      return data;
    }catch(e){}
  }

  if(fallbackByFolder){
    fallbackByFolder.cues = (fallbackByFolder.cues || [])
      .filter(c => c.path && fs.existsSync(c.path))
      .map(c => ({
        ...c,
        url: pathToFileURL(c.path).href,
        savedPath: c.path,
        filePath: c.path,
        originalPath: c.path
      }));
    return fallbackByFolder;
  }

  return null;
});



ipcMain.handle("y6-get-library-location", async () => {
  const settings = readSettings();
  const root = dataRoot();
  return {
    path: root,
    configured: !!settings.libraryPath,
    exists: fs.existsSync(root)
  };
});

ipcMain.handle("y6-choose-library-location", async () => {
  const result = await dialog.showOpenDialog({
    title: "Choose the School Shared Production Library",
    buttonLabel: "Use This Folder",
    properties: ["openDirectory", "createDirectory"]
  });

  if(result.canceled || !result.filePaths || !result.filePaths[0]){
    return { canceled: true };
  }

  const chosen = result.filePaths[0];
  ensureDir(chosen);
  ensureSchoolLibraryStructure(chosen);

  const settings = readSettings();
  settings.libraryPath = chosen;
  writeSettings(settings);

  return { path: chosen, configured: true };
});




const SCHOOL_YEAR_GROUPS = [
  "Nursery", "Reception", "Year 1", "Year 2",
  "Year 3", "Year 4", "Year 5", "Year 6"
];

function ensureSchoolLibraryStructure(root){
  ensureDir(root);
  const productions = path.join(root, "Productions");
  ensureDir(productions);
  SCHOOL_YEAR_GROUPS.forEach(group => ensureDir(path.join(productions, group)));
  ensureDir(path.join(root, "Backups"));
  ensureDir(path.join(root, "Exports"));
}

function schoolCataloguePath(){
  return path.join(dataRoot(), "school-productions.json");
}

function readSchoolCatalogue(){
  try{
    ensureSchoolLibraryStructure(dataRoot());
    const file = schoolCataloguePath();
    if(fs.existsSync(file)){
      const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
      return {
        version: parsed.version || 1,
        updatedAt: parsed.updatedAt || null,
        productions: Array.isArray(parsed.productions) ? parsed.productions : []
      };
    }
  }catch(error){
    console.error("Could not read school catalogue:", error);
  }
  return { version:1, updatedAt:null, productions:[] };
}

function writeSchoolCatalogue(productions){
  ensureSchoolLibraryStructure(dataRoot());

  const payload = {
    version:1,
    updatedAt:new Date().toISOString(),
    productions:Array.isArray(productions) ? productions : []
  };

  const target = schoolCataloguePath();
  const temporary = target + ".tmp";
  const backup = path.join(dataRoot(), "Backups", "school-productions-latest.json");

  fs.writeFileSync(temporary, JSON.stringify(payload, null, 2), "utf-8");

  if(fs.existsSync(target)){
    try{ fs.copyFileSync(target, backup); }catch(e){}
    try{ fs.unlinkSync(target); }catch(e){}
  }

  fs.renameSync(temporary, target);
  return payload;
}

ipcMain.handle("ppp-school-catalogue-load", async () => {
  const settings = readSettings();
  if(!settings.libraryPath){
    return { ok:false, configured:false, productions:[] };
  }

  const catalogue = readSchoolCatalogue();
  return {
    ok:true,
    configured:true,
    libraryPath:dataRoot(),
    ...catalogue
  };
});

ipcMain.handle("ppp-school-catalogue-save", async (event, productions) => {
  const settings = readSettings();
  if(!settings.libraryPath){
    return { ok:false, configured:false, message:"Choose the school shared library first." };
  }

  try{
    const saved = writeSchoolCatalogue(productions);
    return {
      ok:true,
      configured:true,
      libraryPath:dataRoot(),
      ...saved
    };
  }catch(error){
    return {
      ok:false,
      configured:true,
      message:error.message || "The shared school catalogue could not be saved."
    };
  }
});

ipcMain.handle("ppp-school-library-test", async () => {
  const settings = readSettings();
  if(!settings.libraryPath){
    return { ok:false, configured:false };
  }

  try{
    ensureSchoolLibraryStructure(dataRoot());
    const testFile = path.join(dataRoot(), ".production-player-write-test");
    fs.writeFileSync(testFile, "ok", "utf-8");
    fs.unlinkSync(testFile);
    return { ok:true, path:dataRoot(), writable:true };
  }catch(error){
    return {
      ok:false,
      configured:true,
      path:dataRoot(),
      writable:false,
      message:error.message
    };
  }
});



// -----------------------------------------------------------------------------
// School Site Activation Key
// One offline activation key activates the whole shared school library.
// Every computer using that library is therefore activated.
// -----------------------------------------------------------------------------
const SCHOOL_ACTIVATION_SECRET = "338e02c923957320a49088563d127216c06ff96b74192eaf867604bbb808d92f";

function normaliseSchoolName(value){
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
}

function cleanActivationKey(value){
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function schoolActivationPath(){
  return path.join(dataRoot(), "Licence", "school-activation.json");
}

function ensureSchoolActivationFolder(){
  ensureDir(path.join(dataRoot(), "Licence"));
}

function validateSchoolActivationKey(schoolName, activationKey){
  const key = cleanActivationKey(activationKey);
  const match = /^PPPRO-SCHOOL-([A-F0-9]{4})-([A-F0-9]{4})-([A-F0-9]{4})-([A-F0-9]{4})-([A-F0-9]{4})-([A-F0-9]{4})-([A-F0-9]{4})$/.exec(key);
  if(!match) return {ok:false, message:"The activation key format is not valid."};

  const joined = match.slice(1).join("");
  const token = joined.slice(0,16);
  const suppliedMac = joined.slice(16);
  const school = normaliseSchoolName(schoolName);
  if(!school) return {ok:false, message:"Enter the school name."};

  const expectedMac = crypto
    .createHmac("sha256", SCHOOL_ACTIVATION_SECRET)
    .update(`${school}|${token}`)
    .digest("hex")
    .toUpperCase()
    .slice(0,12);

  const valid = crypto.timingSafeEqual(
    Buffer.from(suppliedMac, "utf-8"),
    Buffer.from(expectedMac, "utf-8")
  );

  if(!valid){
    return {ok:false, message:"The activation key does not match this school name."};
  }

  return {ok:true, key, token};
}

function readSchoolActivation(){
  try{
    const file = schoolActivationPath();
    if(!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  }catch(e){ return null; }
}

function publicSchoolActivation(data){
  return {
    ok:true,
    activated:true,
    configured:true,
    holder:data.schoolName,
    schoolName:data.schoolName,
    keyLast4:String(data.activationKey || "").slice(-4),
    licenceType:"School Site Activation",
    unlimitedComputers:true,
    devicesAllowed:"Unlimited",
    devicesUsed:"School network",
    activatedAt:data.activatedAt || "",
    sharedLibrary:dataRoot()
  };
}

ipcMain.handle("ppp-local-licence-status", async () => {
  const settings = readSettings();
  if(!settings.libraryPath){
    return {ok:true, activated:false, configured:false};
  }

  const activation = readSchoolActivation();
  if(!activation){
    return {ok:true, activated:false, configured:true, sharedLibrary:dataRoot()};
  }

  const checked = validateSchoolActivationKey(activation.schoolName, activation.activationKey);
  if(!checked.ok){
    return {ok:false, activated:false, configured:true, message:"The stored school activation is invalid."};
  }

  return publicSchoolActivation(activation);
});

ipcMain.handle("ppp-local-activate-licence", async (event, payload) => {
  const settings = readSettings();
  if(!settings.libraryPath){
    return {ok:false, configured:false, message:"Choose the school shared library first."};
  }

  const schoolName = String(payload?.holder || "").trim();
  const activationKey = cleanActivationKey(payload?.key || "");
  const checked = validateSchoolActivationKey(schoolName, activationKey);
  if(!checked.ok) return checked;

  try{
    ensureSchoolActivationFolder();
    const data = {
      product:"Production Player PRO School Edition",
      licenceType:"School Site Activation",
      schoolName,
      activationKey:checked.key,
      unlimitedComputers:true,
      activatedAt:new Date().toISOString()
    };
    fs.writeFileSync(schoolActivationPath(), JSON.stringify(data, null, 2), "utf-8");
    return publicSchoolActivation(data);
  }catch(error){
    return {ok:false, message:error.message || "The school activation could not be saved."};
  }
});

ipcMain.handle("ppp-local-deactivate-licence", async () => {
  try{
    const file = schoolActivationPath();
    if(fs.existsSync(file)) fs.unlinkSync(file);
    return {ok:true};
  }catch(error){
    return {ok:false, message:error.message};
  }
});





// -----------------------------------------------------------------------------
// Automatic production backups
// -----------------------------------------------------------------------------
function backupRoot(){
  const folder = path.join(dataRoot(), "Backups");
  ensureDir(folder);
  return folder;
}

function productionBackupFolder(productionId){
  const folder = path.join(backupRoot(), safeName(productionId));
  ensureDir(folder);
  return folder;
}

function backupTimestamp(){
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function trimProductionBackups(productionId, keepCount = 20){
  try{
    const folder = productionBackupFolder(productionId);
    const files = fs.readdirSync(folder)
      .filter(name => name.endsWith(".backup.json"))
      .map(name => {
        const full = path.join(folder, name);
        return { name, full, mtime:fs.statSync(full).mtimeMs };
      })
      .sort((a,b) => b.mtime - a.mtime);

    files.slice(keepCount).forEach(item => {
      try{ fs.unlinkSync(item.full); }catch(e){}
    });
  }catch(e){}
}

function createProductionBackup(data){
  const productionId = String(data?.productionId || "");
  if(!productionId) return null;

  const folder = productionBackupFolder(productionId);
  const file = path.join(folder, `${backupTimestamp()}.backup.json`);

  const payload = {
    version:1,
    productionId,
    productionName:String(data?.productionName || productionId),
    yearGroup:String(data?.yearGroup || "Year 6"),
    createdAt:new Date().toISOString(),
    data
  };

  fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf-8");
  trimProductionBackups(productionId, 20);
  return payload;
}

ipcMain.handle("ppp-backup-create", async (event, data) => {
  try{
    const backup = createProductionBackup(data);
    return { ok:true, backup };
  }catch(error){
    return { ok:false, message:error.message || "Backup could not be created." };
  }
});

ipcMain.handle("ppp-backup-list", async (event, productionId) => {
  try{
    const folder = productionBackupFolder(String(productionId || ""));
    const backups = fs.readdirSync(folder)
      .filter(name => name.endsWith(".backup.json"))
      .map(name => {
        const full = path.join(folder, name);
        try{
          const parsed = JSON.parse(fs.readFileSync(full, "utf-8"));
          return {
            id:name,
            createdAt:parsed.createdAt || new Date(fs.statSync(full).mtimeMs).toISOString(),
            productionName:parsed.productionName || "",
            yearGroup:parsed.yearGroup || ""
          };
        }catch(e){
          return null;
        }
      })
      .filter(Boolean)
      .sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));

    return { ok:true, backups };
  }catch(error){
    return { ok:false, message:error.message, backups:[] };
  }
});

ipcMain.handle("ppp-backup-read", async (event, payload) => {
  try{
    const productionId = String(payload?.productionId || "");
    const backupId = String(payload?.backupId || "");
    const full = path.join(productionBackupFolder(productionId), path.basename(backupId));
    const parsed = JSON.parse(fs.readFileSync(full, "utf-8"));
    return { ok:true, backup:parsed };
  }catch(error){
    return { ok:false, message:error.message || "Backup could not be read." };
  }
});

ipcMain.handle("ppp-backup-delete", async (event, payload) => {
  try{
    const productionId = String(payload?.productionId || "");
    const backupId = String(payload?.backupId || "");
    const full = path.join(productionBackupFolder(productionId), path.basename(backupId));
    if(fs.existsSync(full)) fs.unlinkSync(full);
    return { ok:true };
  }catch(error){
    return { ok:false, message:error.message || "Backup could not be deleted." };
  }
});


// -----------------------------------------------------------------------------
// Shared school production locking
// -----------------------------------------------------------------------------
function productionLocksFolder(){
  const folder = path.join(dataRoot(), "Locks");
  ensureDir(folder);
  return folder;
}
function productionLockPath(productionId){
  return path.join(productionLocksFolder(), safeName(productionId) + ".lock.json");
}
function currentLockIdentity(){
  return {
    username: process.env.USERNAME || process.env.USER || os.userInfo().username || "Unknown user",
    computerName: os.hostname(), platform: process.platform, processId: process.pid
  };
}
function productionLockIsStale(lock){
  const t = new Date(lock?.lastSeenAt || lock?.openedAt || 0).getTime();
  return !t || Date.now() - t > 10 * 60 * 1000;
}
function readProductionLock(productionId){
  try{
    const file=productionLockPath(productionId);
    if(!fs.existsSync(file)) return null;
    const lock=JSON.parse(fs.readFileSync(file,"utf-8"));
    if(productionLockIsStale(lock)){ try{fs.unlinkSync(file)}catch(e){}; return null; }
    return lock;
  }catch(e){ return null; }
}
function productionLockIsMine(lock){
  const me=currentLockIdentity();
  return !!lock && lock.username===me.username && lock.computerName===me.computerName;
}
function writeProductionLock(productionId, productionName){
  const me=currentLockIdentity(), now=new Date().toISOString();
  const lock={productionId,productionName,username:me.username,computerName:me.computerName,platform:me.platform,processId:me.processId,openedAt:now,lastSeenAt:now};
  fs.writeFileSync(productionLockPath(productionId),JSON.stringify(lock,null,2),"utf-8");
  return lock;
}
ipcMain.handle("ppp-production-lock-acquire",async(event,payload)=>{
  const id=String(payload?.productionId||""); const name=String(payload?.productionName||id);
  if(!id) return {ok:false,message:"Production ID is required."};
  const existing=readProductionLock(id);
  if(existing && !productionLockIsMine(existing)) return {ok:false,code:"LOCKED",existing};
  return {ok:true,lock:writeProductionLock(id,name)};
});
ipcMain.handle("ppp-production-lock-heartbeat",async(event,id)=>{
  id=String(id||""); const lock=readProductionLock(id);
  if(!lock || !productionLockIsMine(lock)) return {ok:false,lost:true};
  lock.lastSeenAt=new Date().toISOString();
  fs.writeFileSync(productionLockPath(id),JSON.stringify(lock,null,2),"utf-8");
  return {ok:true};
});
ipcMain.handle("ppp-production-lock-release",async(event,id)=>{
  id=String(id||""); const lock=readProductionLock(id);
  if(lock && productionLockIsMine(lock)){ try{fs.unlinkSync(productionLockPath(id))}catch(e){} }
  return {ok:true};
});
ipcMain.handle("ppp-production-lock-force-clear",async(event,id)=>{
  try{ const f=productionLockPath(String(id||"")); if(fs.existsSync(f))fs.unlinkSync(f); return {ok:true}; }
  catch(e){ return {ok:false,message:e.message}; }
});
ipcMain.handle("ppp-production-lock-list",async()=>{
  const locks=[];
  try{
    for(const n of fs.readdirSync(productionLocksFolder())){
      if(!n.endsWith('.lock.json'))continue;
      const f=path.join(productionLocksFolder(),n);
      try{const l=JSON.parse(fs.readFileSync(f,'utf-8'));if(productionLockIsStale(l)){fs.unlinkSync(f);continue}locks.push(l)}catch(e){}
    }
  }catch(e){}
  return {ok:true,locks};
});


// -----------------------------------------------------------------------------
// Production Player Cloud Remote
// -----------------------------------------------------------------------------
const PPP_CLOUD_BASE = "https://production-player-cloud-beta-qi8i.onrender.com";
const PPP_CLOUD_WS = "wss://production-player-cloud-beta-qi8i.onrender.com";
const PPP_CLOUD_SECRET = "3-9JyxVj5b0ji0os_e7HFEuqEsAmQj6L4ZsFbuiZgvE";

let pppCloudSocket = null;
let pppCloudSession = "";
let pppCloudWindow = null;
let pppCloudRemoteUrl = "";
let pppCloudReconnectTimer = null;
let pppCloudShouldReconnect = false;

function pppCloudNewSession(){
  return crypto.randomBytes(5).toString("hex").toUpperCase();
}

function pppCloudStop(){
  pppCloudShouldReconnect = false;
  if(pppCloudReconnectTimer){
    clearTimeout(pppCloudReconnectTimer);
    pppCloudReconnectTimer = null;
  }
  try{ pppCloudSocket?.close(); }catch(e){}
  pppCloudSocket = null;
  pppCloudSession = "";
  pppCloudRemoteUrl = "";
  return {ok:true,running:false};
}

function pppCloudConnectExistingSession(){
  return new Promise(resolve => {
    if(!pppCloudSession){
      resolve({ok:false,message:"No cloud session is available."});
      return;
    }

    const wsUrl = `${PPP_CLOUD_WS}/?role=desktop&session=${encodeURIComponent(pppCloudSession)}&secret=${encodeURIComponent(PPP_CLOUD_SECRET)}`;
    const socket = new WebSocket(wsUrl);
    pppCloudSocket = socket;
    let settled = false;

    const finish = result => {
      if(settled) return;
      settled = true;
      resolve(result);
    };

    const timer = setTimeout(() => {
      try{socket.close();}catch(e){}
      finish({ok:false,message:"Cloud connection timed out. Try again in a moment."});
    }, 15000);

    socket.on("open", () => {
      clearTimeout(timer);
      finish({ok:true,running:true,sessionId:pppCloudSession,remoteUrl:pppCloudRemoteUrl});
      if(pppCloudWindow && !pppCloudWindow.isDestroyed()){
        pppCloudWindow.webContents.send("ppp-cloud-status","connected");
      }
    });

    socket.on("message", raw => {
      try{
        const message = JSON.parse(String(raw));
        if(message.type === "action" && ["play","pause","next","stop"].includes(message.action)){
          if(pppCloudWindow && !pppCloudWindow.isDestroyed()){
            pppCloudWindow.webContents.send("ppp-cloud-action", message.action);
          }
        }
      }catch(e){}
    });

    socket.on("error", error => {
      clearTimeout(timer);
      finish({ok:false,message:error.message || "Could not connect to Production Player Cloud."});
    });

    socket.on("close", () => {
      if(pppCloudSocket === socket) pppCloudSocket = null;
      if(pppCloudWindow && !pppCloudWindow.isDestroyed()){
        pppCloudWindow.webContents.send("ppp-cloud-status","reconnecting");
      }
      if(pppCloudShouldReconnect && pppCloudSession){
        if(pppCloudReconnectTimer) clearTimeout(pppCloudReconnectTimer);
        pppCloudReconnectTimer = setTimeout(() => {
          pppCloudConnectExistingSession().catch(()=>{});
        }, 1800);
      }
    });
  });
}

ipcMain.handle("ppp-cloud-start", async () => {
  pppCloudStop();
  pppCloudSession = pppCloudNewSession();
  pppCloudRemoteUrl = `${PPP_CLOUD_BASE}/remote/${pppCloudSession}`;
  pppCloudShouldReconnect = true;

  const result = await pppCloudConnectExistingSession();
  if(result.ok){
    result.qrDataUrl = await QRCode.toDataURL(pppCloudRemoteUrl, {width:360,margin:1});
    result.remoteUrl = pppCloudRemoteUrl;
  }
  return result;
});

ipcMain.handle("ppp-cloud-stop", async () => pppCloudStop());

ipcMain.handle("ppp-cloud-state", async (_event,state) => {
  if(pppCloudSocket && pppCloudSocket.readyState === WebSocket.OPEN){
    pppCloudSocket.send(JSON.stringify({type:"state",state}));
    return {ok:true};
  }
  return {ok:false};
});



// -----------------------------------------------------------------------------
// PPP_AUTOMATIC_UPDATES v5.8
// -----------------------------------------------------------------------------
let pppAutoUpdater = null;
let pppUpdateWindow = null;
let pppUpdateState = {
  enabled: false,
  packaged: app.isPackaged,
  checking: false,
  available: false,
  downloading: false,
  downloaded: false,
  percent: 0,
  version: "",
  releaseName: "",
  releaseNotes: "",
  message: app.isPackaged
    ? "Ready to check for updates."
    : "Automatic updates run in the installed app."
};

function pppSendUpdateState() {
  if (pppUpdateWindow && !pppUpdateWindow.isDestroyed()) {
    pppUpdateWindow.webContents.send("ppp-update-state", {
      ...pppUpdateState,
      packaged: app.isPackaged
    });
  }
}

function pppSetUpdateState(changes) {
  pppUpdateState = {
    ...pppUpdateState,
    ...changes,
    packaged: app.isPackaged
  };
  pppSendUpdateState();
}

function pppReleaseNotesText(info) {
  const notes = info && info.releaseNotes;
  if (typeof notes === "string") return notes;
  if (Array.isArray(notes)) {
    return notes
      .map(item => typeof item === "string" ? item : (item && item.note) || "")
      .filter(Boolean)
      .join("\n\n");
  }
  return "";
}

try {
  ({ autoUpdater: pppAutoUpdater } = require("electron-updater"));
  pppAutoUpdater.autoDownload = false;
  pppAutoUpdater.autoInstallOnAppQuit = true;
  pppAutoUpdater.allowPrerelease = false;

  pppAutoUpdater.on("checking-for-update", () => {
    pppSetUpdateState({
      enabled: true,
      checking: true,
      available: false,
      downloading: false,
      downloaded: false,
      percent: 0,
      message: "Checking for updates…"
    });
  });

  pppAutoUpdater.on("update-available", info => {
    pppSetUpdateState({
      enabled: true,
      checking: false,
      available: true,
      downloading: true,
      downloaded: false,
      percent: 0,
      version: (info && info.version) || "",
      releaseName: (info && info.releaseName) || "",
      releaseNotes: pppReleaseNotesText(info),
      message: `Downloading Production Player PRO ${(info && info.version) || "update"}…`
    });

    pppAutoUpdater.downloadUpdate().catch(error => {
      console.warn("Update download failed:", error);
      pppSetUpdateState({
        checking: false,
        downloading: false,
        message: "The update could not be downloaded. The app will continue normally."
      });
    });
  });

  pppAutoUpdater.on("update-not-available", () => {
    pppSetUpdateState({
      enabled: true,
      checking: false,
      available: false,
      downloading: false,
      downloaded: false,
      percent: 0,
      message: "Production Player PRO is up to date."
    });
  });

  pppAutoUpdater.on("download-progress", progress => {
    const percent = Math.max(0, Math.min(100, Math.round((progress && progress.percent) || 0)));
    pppSetUpdateState({
      enabled: true,
      checking: false,
      available: true,
      downloading: true,
      downloaded: false,
      percent,
      message: `Downloading update… ${percent}%`
    });
  });

  pppAutoUpdater.on("update-downloaded", info => {
    pppSetUpdateState({
      enabled: true,
      checking: false,
      available: true,
      downloading: false,
      downloaded: true,
      percent: 100,
      version: (info && info.version) || pppUpdateState.version,
      releaseName: (info && info.releaseName) || pppUpdateState.releaseName,
      releaseNotes: pppReleaseNotesText(info) || pppUpdateState.releaseNotes,
      message: `Production Player PRO ${(info && info.version) || "update"} is ready to install.`
    });

    if (pppUpdateWindow && !pppUpdateWindow.isDestroyed()) {
      pppUpdateWindow.show();
      pppUpdateWindow.focus();
    }
  });

  pppAutoUpdater.on("error", error => {
    console.warn("Automatic update error:", error);
    pppSetUpdateState({
      enabled: app.isPackaged,
      checking: false,
      downloading: false,
      message: app.isPackaged
        ? "The update check could not be completed. The app will try again later."
        : "Automatic updates only run in the installed app."
    });
  });
} catch (error) {
  console.warn("Auto updater is not available:", error.message);
}

async function pppCheckForUpdates(showDialog = false) {
  if (!app.isPackaged || !pppAutoUpdater) {
    pppSetUpdateState({
      enabled: false,
      checking: false,
      message: "Automatic updates only run in the installed app."
    });

    if (showDialog) {
      await dialog.showMessageBox({
        type: "info",
        title: "Production Player PRO Updates",
        message: "Automatic updates only run in an installed build.",
        detail: "Install the Mac DMG or Windows installer before testing updates."
      });
    }

    return { ok: false, packaged: app.isPackaged };
  }

  try {
    await pppAutoUpdater.checkForUpdates();
    return { ok: true };
  } catch (error) {
    pppSetUpdateState({
      checking: false,
      downloading: false,
      message: "The update check could not be completed."
    });

    if (showDialog) {
      await dialog.showMessageBox({
        type: "warning",
        title: "Production Player PRO Updates",
        message: "The update check could not be completed.",
        detail: String((error && error.message) || error)
      });
    }

    return { ok: false, error: String((error && error.message) || error) };
  }
}

ipcMain.handle("ppp-update-status", async () => ({
  ...pppUpdateState,
  packaged: app.isPackaged
}));

ipcMain.handle("ppp-check-for-updates", async () => pppCheckForUpdates(true));

ipcMain.handle("ppp-install-update", async () => {
  if (!pppAutoUpdater || !pppUpdateState.downloaded) return { ok: false };
  setImmediate(() => pppAutoUpdater.quitAndInstall(false, true));
  return { ok: true };
});

ipcMain.handle("ppp-get-app-version", async () => app.getVersion());

function createWindow(){
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 650,
    title: "Production Player PRO",
    backgroundColor: "#050505",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  pppCloudWindow = win;
  pppUpdateWindow = win;

  Menu.setApplicationMenu(null);
  win.loadFile("index.html");
}

app.whenReady().then(() => {
  createWindow();

  setTimeout(() => {
    pppCheckForUpdates(false).catch(error => {
      console.warn("Startup update check failed:", error);
    });
  }, 12000);

  setInterval(() => {
    pppCheckForUpdates(false).catch(error => {
      console.warn("Scheduled update check failed:", error);
    });
  }, 6 * 60 * 60 * 1000);
});

app.on("window-all-closed", () => {
  if(process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if(BrowserWindow.getAllWindows().length === 0) createWindow();
});
