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

let about_message = `Iodine ${app.getVersion()} is a realtime viewer for Halite 3\n--\n` +
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
		title: "Iodine", show: false, width: 1000, height: 800, resizable: true, page: path.join(__dirname, "renderer.html")
	});

	main.once("ready-to-show", () => {
		main.show();
	});

	let menu = make_main_menu();
	electron.Menu.setApplicationMenu(menu);
});

// -------------------------------------------------------

electron.app.on("window-all-closed", () => {
	electron.app.quit();
});

// -------------------------------------------------------

ipcMain.on("renderer_ready", () => {

	let args;

	if (process.defaultApp) {		// Launched as "electron ." or similar
		args = process.argv.slice(2)
	} else {						// Launched as built app
		args = process.argv.slice(1)
	}

	windows.send("renderer", "go", args);
});

// -------------------------------------------------------

function make_main_menu() {
	const template = [
		{
			label: "File",
			submenu: [
				{role: "reload"},
				{
					label: "About Iodine",
					click: () => {
						alert(about_message);
					}
				},
				{
					label: "Dev tools",
					role: "toggledevtools"
				},
				{
					accelerator: "CommandOrControl+Q",
					role: "quit"
				},
			]
		},
		{
			label: "View",
			submenu: [
				{
					label: "Integer box sizes",
					type: "checkbox",
					checked: prefs.integer_box_sizes,
					click: (menuItem) => {
						set_pref("integer_box_sizes", menuItem.checked);
					}
				},
				{
					label: "Turns start at 1",
					type: "checkbox",
					checked: prefs.turns_start_at_one,
					click: (menuItem) => {
						set_pref("turns_start_at_one", menuItem.checked);
					}
				},
				{
					label: "Grid",
					submenu: [
						{
							label: "0",
							type: "radio",
							accelerator: "F1",
							checked: prefs.grid_aesthetic === 0,
							click: () => {
								set_pref("grid_aesthetic", 0);
							}
						},
						{
							label: "halite / 4",
							type: "radio",
							accelerator: "F2",
							checked: prefs.grid_aesthetic === 1,
							click: () => {
								set_pref("grid_aesthetic", 1);
							}
						},
						{
							label: "255 * sqrt(halite / 2048)",
							type: "radio",
							accelerator: "F3",
							checked: prefs.grid_aesthetic === 2,
							click: () => {
								set_pref("grid_aesthetic", 2);
							}
						},
						{
							label: "255 * sqrt(halite / 1024)",
							type: "radio",
							accelerator: "F4",
							checked: prefs.grid_aesthetic === 3,
							click: () => {
								set_pref("grid_aesthetic", 3);
							}
						},
					]
				},
				{
					type: "separator"
				},
				{
					label: "Up",
					accelerator: "W",
					click: () => {
						windows.send("renderer", "down", 1);
					}
				},
				{
					label: "Left",
					accelerator: "A",
					click: () => {
						windows.send("renderer", "right", 1);
					}
				},
				{
					label: "Down",
					accelerator: "S",
					click: () => {
						windows.send("renderer", "down", -1);
					}
				},
				{
					label: "Right",
					accelerator: "D",
					click: () => {
						windows.send("renderer", "right", -1);
					}
				},
				{
					label: "Reset camera",
					accelerator: "R",
					click: () => {
						windows.send("renderer", "set", ["offset_x", 0]);
						windows.send("renderer", "set", ["offset_y", 0]);
					}
				},
				{
					type: "separator"
				},
				{
					label: "Font smaller",
					accelerator: "CommandOrControl+-",
					role: "zoomout"
				},
				{
					label: "Font larger",
					accelerator: "CommandOrControl+=",
					role: "zoomin"
				},
				{
					label: "Reset font",
					role: "resetzoom"
				},
			]
		},
	];

	return electron.Menu.buildFromTemplate(template);
}
