"use strict";

const alert = require("./modules/alert");
const app = require('electron').app;
const electron = require("electron");
const fs = require("fs");
const ipcMain = require("electron").ipcMain;
const path = require("path");
const read_prefs = require("./modules/preferences").read_prefs;
const save_prefs = require("./modules/preferences").save_prefs;
const windows = require("./modules/windows");

let about_message = `Iodine ${app.getVersion()} is a realtime replay viewer for Halite 3\n--\n` +
	`Electron ${process.versions.electron} + Node ${process.versions.node} + Chrome ${process.versions.chrome} + V8 ${process.versions.v8}`;

// -------------------------------------------------------
// Preferences.

const prefs = read_prefs(app);

function set_pref(attrname, value) {
	if (!prefs.hasOwnProperty(attrname)) {
		throw new Error("Tried to set a prefence attr that wasn't defined: ", attrname);
	}
	prefs[attrname] = value;
	windows.send("renderer", "prefs_changed", prefs);
	save_prefs(app, prefs);
}

// -------------------------------------------------------

electron.app.on("ready", () => {

	let main = windows.new("renderer", {
		title: "Iodine", show: false, width: 1150, height: 800, resizable: true, page: path.join(__dirname, "renderer.html")
	});

	main.once("ready-to-show", () => {
		main.show();
	});
});

electron.app.on("window-all-closed", () => {
	electron.app.quit();
});
