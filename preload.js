/*
Production Player PRO
Copyright © 2026 Julie Linklater
All Rights Reserved.
*/
const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("y6DesktopStorage", {
  saveProduction: (data) => ipcRenderer.invoke("y6-save-production", data),
  loadProduction: (productionId) => ipcRenderer.invoke("y6-load-production", productionId),
  getLibraryLocation: () => ipcRenderer.invoke("y6-get-library-location"),
  chooseLibraryLocation: () => ipcRenderer.invoke("y6-choose-library-location")
});


contextBridge.exposeInMainWorld("y6FilePath", {
  getPath: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch (e) {
      return "";
    }
  }
});

contextBridge.exposeInMainWorld("pppLocalLicence", {
  getStatus: () => ipcRenderer.invoke("ppp-local-licence-status"),
  activate: payload => ipcRenderer.invoke("ppp-local-activate-licence", payload),
  deactivate: () => ipcRenderer.invoke("ppp-local-deactivate-licence")
});


contextBridge.exposeInMainWorld("pppSchoolLibrary", {
  loadCatalogue: () => ipcRenderer.invoke("ppp-school-catalogue-load"),
  saveCatalogue: productions => ipcRenderer.invoke("ppp-school-catalogue-save", productions),
  testLibrary: () => ipcRenderer.invoke("ppp-school-library-test")
});



contextBridge.exposeInMainWorld("pppProductionLocks", {
  acquire: payload => ipcRenderer.invoke("ppp-production-lock-acquire", payload),
  heartbeat: id => ipcRenderer.invoke("ppp-production-lock-heartbeat", id),
  release: id => ipcRenderer.invoke("ppp-production-lock-release", id),
  forceClear: id => ipcRenderer.invoke("ppp-production-lock-force-clear", id),
  list: () => ipcRenderer.invoke("ppp-production-lock-list")
});


contextBridge.exposeInMainWorld("pppBackups", {
  create: data => ipcRenderer.invoke("ppp-backup-create", data),
  list: productionId => ipcRenderer.invoke("ppp-backup-list", productionId),
  read: payload => ipcRenderer.invoke("ppp-backup-read", payload),
  delete: payload => ipcRenderer.invoke("ppp-backup-delete", payload)
});


contextBridge.exposeInMainWorld("pppCloudRemote", {
  start: () => ipcRenderer.invoke("ppp-cloud-start"),
  stop: () => ipcRenderer.invoke("ppp-cloud-stop"),
  updateState: state => ipcRenderer.invoke("ppp-cloud-state", state),
  onAction: callback => {
    ipcRenderer.removeAllListeners("ppp-cloud-action");
    ipcRenderer.on("ppp-cloud-action", (_event, action) => callback(action));
  },
  onStatus: callback => {
    ipcRenderer.removeAllListeners("ppp-cloud-status");
    ipcRenderer.on("ppp-cloud-status", (_event, status) => callback(status));
  }
});

contextBridge.exposeInMainWorld("pppUpdates", {
  status: () => ipcRenderer.invoke("ppp-update-status"),
  checkNow: () => ipcRenderer.invoke("ppp-check-for-updates"),
  installNow: () => ipcRenderer.invoke("ppp-install-update"),
  version: () => ipcRenderer.invoke("ppp-get-app-version"),
  onState: callback => {
    ipcRenderer.removeAllListeners("ppp-update-state");
    ipcRenderer.on("ppp-update-state", (_event, state) => callback(state));
  }
});
