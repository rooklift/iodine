"use strict";

const app = require("electron").remote.app;
const fs = require("fs");
const ipcRenderer = require("electron").ipcRenderer;
const path = require("path");
const read_prefs = require("./modules/preferences").read_prefs;
const readline = require("readline");

const colours = ["#c5ec98", "#ff9999", "#ffbe00", "#66cccc"];
const explosion_colour = "#ff0000";

const canvas = document.getElementById("canvas");
const infobox = document.getElementById("infobox");
const context = canvas.getContext("2d");

let tp;

function make_token_parser() {

	let o = Object.create(null);

	let tokens = [];		// Private

	let scanner = readline.createInterface({
		input: process.stdin,
  		output: null,
	});

	scanner.on("line", (line) => {
		let new_tokens = line.split(" ").trim().filter(t => t.length > 0);
		tokens = tokens.concat(new_tokens);
	});

	o.count = () => {
		return tokens.length;
	};

	o.token = () => {
		return tokens.shift();
	};

	o.int = () => {
		return parseInt(tokens.shift(), 10);
	};

	o.peek_int = (n) => {
		return parseInt(tokens[n], 10);
	};


	return o;
}

function make_dropoff(pid, x, y, factory_flag) {
	let dropoff = Object.create(null);
	dropoff.pid = pid;
	dropoff.x = x;
	dropoff.y = y;
	dropoff.factory = factory_flag;
}

function make_ship(pid, sid, x, y, halite) {
	let ship = Object.create(null);
	ship.pid = pid;
	ship.sid = sid;
	ship.x = x;
	ship.y = y;
	ship.halite = halite;
	return ship;
}

function make_game() {

	let game = Object.create(null);

	game.clean = false;		// Can be rendered?

	game.players = null;
	game.pid = null;
	game.width = null;
	game.height = null;
	game.turn = null;

	game.budgets = Object.create(null);
	game.ships = [];
	game.dropoffs = [];
	game.halite = null;

	game.init_map = () => {
		game.halite = [];
		for (let x = 0; x < game.width; x++) {
			game.halite.push([]);
			for (let y = 0; y < game.height; y++) {
				game.halite[x].push(0);
			}
		}
	}

	return game;
}

function make_renderer() {

	let renderer = Object.create(null);
	let game = make_game();

	renderer.offset_x = 0;
	renderer.offset_y = 0;

	renderer.prefs = read_prefs(app);

	// --------------------------------------------------------------

	renderer.get_json_line = () => {

		if (tp.count() === 0) {
			setTimeout(renderer.get_json_line, 1);
			return;
		}

		tp.token()

		renderer.pre_parse();
	};

	renderer.pre_parse = () => {

		if (tp.count() < 2) {
			setTimeout(renderer.pre_parse, 1);
			return;
		}

		game.players = tp.int();
		game.pid = tp.int();

		renderer.parse_factories();
	};

	renderer.parse_factories = () => {

		let tokens_needed = game.players * 3;

		if (tp.count() < tokens_needed) {
			setTimeout(renderer.parse_factories, 1);
			return;
		}

		for (let n = 0; n < game.players; n++) {
			let pid = tp.int();
			let x = tp.int();
			let y = tp.int();
			let factory = make_dropoff(pid, x, y, true);
			game.dropoffs.push(factory);
		}

		renderer.parse_width_height();
	};

	renderer.parse_width_height = () => {

		if (tp.count() < 2) {
			setTimeout(renderer.parse_width_height, 1);
			return;
		}

		game.width = tp.int();
		game.height = tp.int();

		renderer.parse_map();
	};

	renderer.parse_map = () => {

		let tokens_needed = width * height;

		if (tp.count() < tokens_needed) {
			setTimeout(renderer.parse_map, 1);
			return;
		}

		game.init_map();

		for (let y = 0; y < game.height; y++) {
			for (let x = 0; x < game.width; x++) {
				game.halite[x][y] = tp.int();
			}
		}

		setTimeout(renderer.loop, 0);		// Eh, it's nice to clear the stack.
	};

	// --------------------------------------------------------------

	renderer.loop = () => {

		// bare_min_tokens_needed is the absolute bare minimum number
		// of tokens that might be capable of forming the frame, given
		// what we actually know. It is updated as we gain more info.

		let bare_min_tokens_needed = 1 + (game.players * 4) + 1;

		if (tp.count() < bare_min_tokens_needed) {
			setTimeout(renderer.loop, 1);
			return;
		}

		// --------------------

		let info_index = 1;

		for (let z = 0; z < game.players; z++) {

			let pid = tp.peek_int(info_index + 0);
			let ships = tp.peek_int(info_index + 1);
			let dropoffs = tp.peek_int(info_index + 2);

			// Update our bare minimums and check...

			bare_min_tokens_needed += ships * 4;
			bare_min_tokens_needed += dropoffs * 3;

			if (tp.count() < bare_min_tokens_needed) {
				setTimeout(renderer.loop, 1);
				return;
			}

			info_index += 4 + (ships * 4) + (dropoffs * 3);

		}

		let map_updates = tp.peek_int(info_index);

		bare_min_tokens_needed += map_updates * 3;

		if (tp.count() < bare_min_tokens_needed) {
			setTimeout(renderer.loop, 1);
			return;
		}

		// --------------------
		// The tokens exist!

		game.ships = [];

		// Clear the dropoffs but save the factories...
		game.dropoffs = game.dropoffs.slice(0, game.players);

		game.turn = tp.int();

		for (let n = 0; n < game.players; n++) {

			let pid = tp.int();
			let ships = tp.int();
			let dropoffs = tp.int();

			game.budgets[pid] = tp.int();

			for (let i = 0; i < ships; i++) {

				let sid = tp.int();
				let x = tp.int();
				let y = tp.int();
				let halite = tp.int();

				game.ships.push(make_ship(pid, sid, x, y, halite));
			}

			for (let i = 0; i < dropoffs; i++) {

				tp.int();			// sid
				let x = tp.int();
				let y = tp.int();

				game.dropoffs.push(make_dropoff(pid, x, y));
			}
		}

		map_updates = tp.int();

		for (let n = 0; n < map_updates; n++) {

			let x = tp.int();
			let y = tp.int();
			let val = tp.int();

			game.halite[x][y] = val;
		}

		console.log(`Finished reading turn ${game.turn}`);

		game.clean = true;

		// FIXME: setTimeout for self
	};

	// --------------------------------------------------------------

	renderer.right = (n) => {
		renderer.offset_x += n;
		renderer.draw();
	};

	renderer.down = (n) => {
		renderer.offset_y += n;
		renderer.draw();
	};

	renderer.set = (attrname, value) => {
		renderer[attrname] = value;
		renderer.draw();
	};

	// --------------------------------------------------------------

	renderer.offset_adjust = (x, y, undo_flag) => {

		// Given coords x, y, return x, y adjusted by current offset.

		if (!renderer.game) return [x, y];

		if (!undo_flag) {
			x += renderer.offset_x;
			y += renderer.offset_y;
		} else {
			x -= renderer.offset_x;
			y -= renderer.offset_y;
		}

		// Sneaky modulo method which works for negative numbers too...
		// https://dev.to/maurobringolf/a-neat-trick-to-compute-modulo-of-negative-numbers-111e

		x = (x % renderer.width + renderer.width) % renderer.width;
		y = (y % renderer.height + renderer.height) % renderer.height;

		return [x, y];
	};

	// --------------------------------------------------------------

	renderer.clear = () => {

		if (!renderer.game) {
			context.clearRect(0, 0, canvas.width, canvas.height);
			return;
		}

		let desired_size;

		if (!renderer.prefs.integer_box_sizes) {
			desired_size = Math.max(1 * renderer.height, window.innerHeight - 1);
		} else {
			desired_size = renderer.height * Math.max(1, Math.floor((window.innerHeight - 1) / renderer.height));
		}

		if (desired_size !== canvas.width || desired_size !== canvas.height) {
			canvas.width = desired_size;
			canvas.height = desired_size;
		}

		context.clearRect(0, 0, canvas.width, canvas.height);
	};

	renderer.draw = () => {

		renderer.clear();

		if (!renderer.game) {
			return;
		}

		renderer.draw_grid();
		renderer.draw_structures();
		renderer.draw_ships();
		renderer.draw_collisions();
		renderer.draw_selection_crosshairs();

		renderer.write_infobox();
	};

	renderer.draw_grid = () => {

		let box_width = renderer.box_width();
		let box_height = renderer.box_height();

		let turn_fudge = renderer.prefs.turns_start_at_one ? 1 : 0;

		for (let x = 0; x < renderer.width; x++) {

			for (let y = 0; y < renderer.height; y++) {

				let colour;

				if (renderer.flog_colours) {
					let key = `${renderer.turn + turn_fudge}-${x}-${y}`;
					colour = renderer.flog_colours[key];
				}

				if (colour === undefined) {
					let val;

					switch (renderer.prefs.grid_aesthetic) {
						case 0:
							val = 0;
							break;
						case 1:
							val = renderer.production_list[renderer.turn][x][y] / 4;
							break;
						case 2:
							val = 255 * Math.sqrt(renderer.production_list[renderer.turn][x][y] / 2048);
							break;
						case 3:
							val = 255 * Math.sqrt(renderer.production_list[renderer.turn][x][y] / 1024);
							break;
					}

					val = Math.floor(val);
					val = Math.min(255, val);
					colour = `rgb(${val},${val},${val})`;
				}

				context.fillStyle = colour;

				let [i, j] = renderer.offset_adjust(x, y);
				context.fillRect(i * box_width, j * box_height, box_width, box_height);
			}
		}
	};

	renderer.draw_structures = () => {

		let box_width = renderer.box_width();
		let box_height = renderer.box_height();

		for (let pid = 0; pid < renderer.players(); pid++) {

			let x = renderer.game.players[pid].factory_location.x;
			let y = renderer.game.players[pid].factory_location.y;

			context.fillStyle = colours[pid];
			let [i, j] = renderer.offset_adjust(x, y);
			context.fillRect(i * box_width, j * box_height, box_width, box_height);
		}

		for (let n = 0; n < renderer.dropoff_list.length; n++) {

			if (renderer.dropoff_list[n].turn > renderer.turn) {
				continue;
			}

			let x = renderer.dropoff_list[n].x;
			let y = renderer.dropoff_list[n].y;
			let pid = renderer.dropoff_list[n].pid;

			context.fillStyle = colours[pid];
			let [i, j] = renderer.offset_adjust(x, y);
			context.fillRect(i * box_width, j * box_height, box_width, box_height);
		}
	};

	renderer.draw_ships = () => {

		let box_width = renderer.box_width();
		let box_height = renderer.box_height();
		let frame = renderer.current_frame();

		let moves_map = renderer.get_moves_map(renderer.prefs.triangles_show_next);

		for (let pid = 0; pid < renderer.players(); pid++) {

			let colour = colours[pid];

			let some_ships = frame.entities[pid];

			if (some_ships === undefined) {
				continue;
			}

			for (let [sid, ship] of Object.entries(some_ships)) {

				let x = ship.x;
				let y = ship.y;

				let opacity = ship.energy / renderer.game.GAME_CONSTANTS.MAX_ENERGY;

				context.strokeStyle = colour;

				let [i, j] = renderer.offset_adjust(x, y);

				let a = 0.1;
				let b = 0.5;
				let c = 1 - a;

				switch (moves_map[sid]) {
					case "n":
						context.beginPath();
						context.moveTo((i + a) * box_width, (j + c) * box_height);
						context.lineTo((i + c) * box_width, (j + c) * box_height);
						context.lineTo((i + b) * box_width, (j + a) * box_height);
						context.closePath();
						context.fillStyle = "#000000";
						context.fill();
						context.globalAlpha = opacity;
						context.fillStyle = colour;
						context.fill();
						context.globalAlpha = 1;
						context.stroke();
						break;
					case "s":
						context.beginPath();
						context.moveTo((i + a) * box_width, (j + a) * box_height);
						context.lineTo((i + c) * box_width, (j + a) * box_height);
						context.lineTo((i + b) * box_width, (j + c) * box_height);
						context.closePath();
						context.fillStyle = "#000000";
						context.fill();
						context.globalAlpha = opacity;
						context.fillStyle = colour;
						context.fill();
						context.globalAlpha = 1;
						context.stroke();
						break;
					case "e":
						context.beginPath();
						context.moveTo((i + a) * box_width, (j + a) * box_height);
						context.lineTo((i + a) * box_width, (j + c) * box_height);
						context.lineTo((i + c) * box_width, (j + b) * box_height);
						context.closePath();
						context.fillStyle = "#000000";
						context.fill();
						context.globalAlpha = opacity;
						context.fillStyle = colour;
						context.fill();
						context.globalAlpha = 1;
						context.stroke();
						break;
					case "w":
						context.beginPath();
						context.moveTo((i + c) * box_width, (j + a) * box_height);
						context.lineTo((i + c) * box_width, (j + c) * box_height);
						context.lineTo((i + a) * box_width, (j + b) * box_height);
						context.closePath();
						context.fillStyle = "#000000";
						context.fill();
						context.globalAlpha = opacity;
						context.fillStyle = colour;
						context.fill();
						context.globalAlpha = 1;
						context.stroke();
						break;
					default:
						context.beginPath();
						context.arc((i + b) * box_width, (j + b) * box_height, 0.35 * box_width, 0, 2 * Math.PI, false);
						context.fillStyle = "#000000";
						context.fill();
						context.globalAlpha = opacity;
						context.fillStyle = colour;
						context.fill();
						context.globalAlpha = 1;
						context.stroke();
				}
			}
		}
	};

	renderer.box_width = () => {
		if (renderer.width <= 0) return 1;
		return Math.max(1, canvas.width / renderer.width);
	};

	renderer.box_height = () => {
		if (renderer.height <= 0) return 1;
		return Math.max(1, canvas.height / renderer.height);
	};

	// --------------------------------------------------------------

	renderer.write_infobox = () => {
		let lines = [];
		lines.push(`<p>TODO...</p>`);
		infobox.innerHTML = lines.join("");
	};

	return renderer;
}

let renderer = make_renderer();

ipcRenderer.on("right", (event, n) => {
	renderer.right(n);
});

ipcRenderer.on("down", (event, n) => {
	renderer.down(n);
});

ipcRenderer.on("set", (event, foo) => {
	renderer.set(foo[0], foo[1]);               // Format is [attrname, value]
});

ipcRenderer.on("prefs_changed", (event, prefs) => {
	renderer.set("prefs", prefs);
});

ipcRenderer.on("log", (event, msg) => {
	console.log(msg);
});

renderer.clear();

// Give the window and canvas a little time to settle... (may prevent sudden jerk during load).

setTimeout(() => {
	ipcRenderer.send("renderer_ready", null);
}, 200);
