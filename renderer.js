"use strict";

const app = require("electron").remote.app;
const child_process = require("child_process");
const fs = require("fs");
const ipcRenderer = require("electron").ipcRenderer;
const path = require("path");
const read_prefs = require("./modules/preferences").read_prefs;
const readline = require("readline");

const colours = ["#c5ec98", "#ff9999", "#ffbe00", "#66cccc"];
const names = ["Alfa", "Bravo", "Charlie", "Delta"];

const canvas = document.getElementById("canvas");
const infobox = document.getElementById("infobox");
const context = canvas.getContext("2d");

function make_token_parser() {

	let o = Object.create(null);

	o.__tokens = [];		// I did use a private variable, but this may be faster (??)

	o.total_count = 0;

	o.receive = (line) => {

		// The app can hang if this method is slow. Speed matters here.

		let new_tokens = line.split(" ");
		let length = new_tokens.length;

		for (let n = 0; n < length; n++) {
			o.__tokens.push(new_tokens[n]);
		}

		o.total_count += length;
	};

	o.count = () => {
		return o.__tokens.length;
	};

	o.token = () => {
		return o.__tokens.shift();
	};

	o.int = () => {

		let raw = o.__tokens.shift();			// This can be slow if the array gets very large.
		let val = parseInt(raw, 10);

		if (Number.isNaN(val)) {
			console.log("Token was not a number! This is bad!");
			console.log(`Token was ${raw}`);
		}

		return val;
	};

	o.peek_int = (n) => {

		let raw = o.__tokens[n];
		let val = parseInt(raw, 10);

		if (Number.isNaN(val)) {
			console.log("Token was not a number! This is bad!");
			console.log(`Token was ${raw}`);
		}

		return val;
	};

	o.cut = (n) => {
		o.__tokens = o.__tokens.slice(n);
	};

	return o;
}

function make_dropoff(pid, sid, x, y, factory_flag) {
	let dropoff = Object.create(null);
	dropoff.pid = pid;
	dropoff.sid = sid;
	dropoff.x = x;
	dropoff.y = y;
	dropoff.factory = factory_flag;
	return dropoff;
}

function make_ship(pid, sid, x, y, halite, direction, time_seen) {
	let ship = Object.create(null);
	ship.pid = pid;
	ship.sid = sid;
	ship.x = x;
	ship.y = y;
	ship.halite = halite;
	ship.direction = direction;
	ship.time_seen = time_seen;
	return ship;
}

function make_game() {

	let game = Object.create(null);

	game.clean = false;		// Can be rendered?

	game.players = null;
	game.width = null;
	game.height = null;
	game.turn = null;

	game.free_halite = 0;
	game.initial_free_halite = 0;

	game.budgets = [];
	game.ship_counts = [];
	game.dropoff_counts = [];
	game.build_counts = [];
	game.carried = [];

	game.constants = Object.create(null);
	game.ships = Object.create(null);
	game.dropoffs = Object.create(null);
	game.halite = null;

	game.init = () => {

		game.halite = [];

		for (let x = 0; x < game.width; x++) {
			game.halite.push([]);
			for (let y = 0; y < game.height; y++) {
				game.halite[x].push(0);
			}
		}

		for (let pid = 0; pid < game.players; pid++) {

			// Live stats...

			game.budgets.push(0);
			game.ship_counts.push(0);
			game.dropoff_counts.push(0);
			game.carried.push(0);

			// Cumulative stats...

			game.build_counts.push(0);
		}
	};

	game.reset_live_stats = () => {

		// Live stats are the ones that only depend on the current frame,
		// not cumulative / long term things.

		for (let pid = 0; pid < game.players; pid++) {
			game.budgets[pid] = 0;
			game.ship_counts[pid] = 0;
			game.dropoff_counts[pid] = 0;
			game.carried[pid] = 0;
		}
	};

	return game;
}

function make_renderer() {

	let renderer = Object.create(null);
	renderer.game = make_game();

	renderer.offset_x = 0;
	renderer.offset_y = 0;

	renderer.last_draw = null;

	renderer.prefs = read_prefs(app);

	// --------------------------------------------------------------

	renderer.get_json_line = () => {

		if (tp.count() === 0) {
			setTimeout(renderer.get_json_line, 1);
			return;
		}

		let raw = tp.token();
		renderer.game.constants = JSON.parse(raw);

		let width = renderer.game.constants.DEFAULT_MAP_WIDTH;
		let height = renderer.game.constants.DEFAULT_MAP_HEIGHT;
		let seed = renderer.game.constants.game_seed;

		console.log(`New game: ${width} x ${height} -- seed ${seed}`);

		renderer.pre_parse();
	};

	renderer.pre_parse = () => {

		if (tp.count() < 2) {
			setTimeout(renderer.pre_parse, 1);
			return;
		}

		renderer.game.players = tp.int();
		tp.int();	// PID, not needed.

		renderer.parse_factories();
	};

	renderer.parse_factories = () => {

		let tokens_needed = renderer.game.players * 3;

		if (tp.count() < tokens_needed) {
			setTimeout(renderer.parse_factories, 1);
			return;
		}

		for (let n = 0; n < renderer.game.players; n++) {
			let pid = tp.int();
			let sid = -1000 - n;	// Any unique value not used by real dropoffs
			let x = tp.int();
			let y = tp.int();
			let factory = make_dropoff(pid, sid, x, y, true);
			renderer.game.dropoffs[sid] = factory;
		}

		renderer.parse_width_height();
	};

	renderer.parse_width_height = () => {

		if (tp.count() < 2) {
			setTimeout(renderer.parse_width_height, 1);
			return;
		}

		renderer.game.width = tp.int();
		renderer.game.height = tp.int();

		renderer.parse_map();
	};

	renderer.parse_map = () => {

		let tokens_needed = renderer.game.width * renderer.game.height;

		if (tp.count() < tokens_needed) {
			setTimeout(renderer.parse_map, 1);
			return;
		}

		renderer.game.init();

		let ti = 0;		// token index, so we can peek instead of using slow tp.int()

		for (let y = 0; y < renderer.game.height; y++) {
			for (let x = 0; x < renderer.game.width; x++) {
				renderer.game.halite[x][y] = tp.peek_int(ti++);
				renderer.game.free_halite += renderer.game.halite[x][y];
			}
		}

		renderer.game.initial_free_halite = renderer.game.free_halite;

		// For speed reasons we used tp.peek_int() instead of tp.int() (which causes a shift).
		// Now we must tell the token parser to cut its list of tokens to remove the used ones.

		tp.cut(ti);

		setTimeout(renderer.game_loop, 0);		// Eh, it's nice to clear the stack.
	};

	// --------------------------------------------------------------

	renderer.game_loop = () => {

		// Read tokens until we can't form a new frame...

		while (1) {

			// bare_min_tokens_needed is the absolute bare minimum number
			// of tokens that might be capable of forming the frame, given
			// what we actually know. It is updated as we gain more info.

			let bare_min_tokens_needed = 1 + (renderer.game.players * 4) + 1;

			if (tp.count() < bare_min_tokens_needed) {
				setTimeout(renderer.game_loop, 1);
				return;
			}

			// --------------------

			let info_index = 1;		// Start of the first player in the stream.

			for (let z = 0; z < renderer.game.players; z++) {

				let ships = tp.peek_int(info_index + 1);
				let dropoffs = tp.peek_int(info_index + 2);

				// Update our bare minimums and check...

				bare_min_tokens_needed += ships * 4;
				bare_min_tokens_needed += dropoffs * 3;

				if (tp.count() < bare_min_tokens_needed) {
					setTimeout(renderer.game_loop, 1);
					return;
				}

				info_index += 4 + (ships * 4) + (dropoffs * 3);
			}

			let map_updates = tp.peek_int(info_index);

			bare_min_tokens_needed += map_updates * 3;

			if (tp.count() < bare_min_tokens_needed) {
				setTimeout(renderer.game_loop, 1);
				return;
			}

			// --------------------
			// The tokens exist!

			let ti = 0;		// Token index. To avoid many expensive shift ops, we just use tp.peek_int()

			renderer.game.reset_live_stats();

			renderer.game.turn = tp.peek_int(ti++) - 1;		// Turns start at 0 internally.

			for (let n = 0; n < renderer.game.players; n++) {

				let pid = tp.peek_int(ti++);
				let ships = tp.peek_int(ti++);
				let dropoffs = tp.peek_int(ti++);

				renderer.game.budgets[pid] = tp.peek_int(ti++);

				for (let i = 0; i < ships; i++) {

					let sid = tp.peek_int(ti++);
					let x = tp.peek_int(ti++);
					let y = tp.peek_int(ti++);
					let halite = tp.peek_int(ti++);

					let ship = renderer.game.ships[sid];

					if (ship === undefined) {
						renderer.game.ships[sid] = make_ship(pid, sid, x, y, halite, "", renderer.game.turn);
						renderer.game.build_counts[pid] += 1;
					} else {
						ship.direction = "";
						// Note here that ship.x and ship.y are the old values...
						if (ship.x < x) ship.direction = Math.abs(ship.x - x) === 1 ? "e" : "w";
						if (ship.x > x) ship.direction = Math.abs(ship.x - x) === 1 ? "w" : "e";
						if (ship.y < y) ship.direction = Math.abs(ship.y - y) === 1 ? "s" : "n";
						if (ship.y > y) ship.direction = Math.abs(ship.y - y) === 1 ? "n" : "s";

						ship.pid = pid;		// Could change if captures enabled.
						ship.x = x;
						ship.y = y;
						ship.halite = halite;
						ship.time_seen = renderer.game.turn;
					}

					renderer.game.carried[pid] += halite;
					renderer.game.ship_counts[pid] += 1;
				}

				for (let i = 0; i < dropoffs; i++) {

					let sid = tp.peek_int(ti++);
					let x = tp.peek_int(ti++);
					let y = tp.peek_int(ti++);

					let dropoff = renderer.game.dropoffs[sid];

					if (dropoff === undefined) {
						renderer.game.dropoffs[sid] = make_dropoff(pid, sid, x, y);
					}

					renderer.game.dropoff_counts[pid] += 1;
				}
			}

			// Delete dead ships...

			for (let ship of Object.values(renderer.game.ships)) {
				if (ship.time_seen !== renderer.game.turn) {
					delete renderer.game.ships[ship.sid];
				}
			}

			map_updates = tp.peek_int(ti++);

			for (let n = 0; n < map_updates; n++) {

				let x = tp.peek_int(ti++);
				let y = tp.peek_int(ti++);
				let val = tp.peek_int(ti++);

				renderer.game.free_halite -= renderer.game.halite[x][y];
				renderer.game.free_halite += val;

				renderer.game.halite[x][y] = val;
			}

			renderer.game.clean = true;

			if (renderer.game.turn === renderer.game.constants.MAX_TURNS) {

				// Allow selecting the seed after the game...
				document.body.style["user-select"] = "auto";

				// How many tokens did the reader get? Interesting stat...
				console.log(`Game over -- token reader received ${tp.total_count} tokens`);
			}

			// For speed reasons we used tp.peek_int() instead of tp.int() (which causes a shift).
			// Now we must tell the token parser to cut its list of tokens to remove the used ones.

			tp.cut(ti);
		}
	};

	renderer.draw_loop = () => {

		if (renderer.game.clean === false || renderer.game.turn === renderer.last_draw) {
			setTimeout(renderer.draw_loop, 1);
			return;
		}

		renderer.draw();
		renderer.last_draw = renderer.game.turn;

		setTimeout(renderer.draw_loop, 1);
	};

	// --------------------------------------------------------------

	renderer.go = (args) => {

		// Note: our own process has already been stripped from args.

		console.log("Got args:", JSON.stringify(args));

		let settings;

		if (fs.existsSync(path.join(__dirname, "settings.json"))) {
			try {
				let f = fs.readFileSync(path.join(__dirname, "settings.json"));
				settings = JSON.parse(f);
			} catch (err) {
				console.log("Couldn't load settings:", err.message);
				return;		// i.e. fail to start.
			}
		} else {
			try {
				let f = fs.readFileSync(path.join(__dirname, "settings.json.example"));
				settings = JSON.parse(f);
			} catch (err) {
				console.log("Couldn't load settings:", err.message);
				return;		// i.e. fail to start.
			}
		}

		args = ["--viewer"].concat(args);

		let sleep = settings.sleep;
		if (sleep === undefined || sleep < 0) {
			sleep = 10;
		}
		if (sleep < 10) {
			console.log(`Very low sleep value (${sleep}) -- this is not recommended`);
		}
		args.push("--sleep");
		args.push(sleep.toString());

		let exe = child_process.spawn(settings.engine, args);

		let scanner = readline.createInterface({
			input: exe.stdout,
			output: undefined,
			terminal: false			// What is this?
		});

		let stderr_scanner = readline.createInterface({
			input: exe.stderr,
			output: undefined,
			terminal: false
		});

		scanner.on("line", (line) => {
			tp.receive(line.toString());
		});

		stderr_scanner.on("line", (line) => {
			if (line.includes("viewer_info") && line.includes("{") && line.includes("}")) {
				let info = JSON.parse(line).viewer_info;
				renderer.handle_info(info);
			} else {
				console.log("Engine:", line);
			}
		});

		setTimeout(renderer.get_json_line, 0);
		setTimeout(renderer.draw_loop, 0);
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

	renderer.handle_info = (info) => {		// Can be expanded but watch for concurrency issues
		if (info.names) {
			for (let n = 0; n < info.names.length && n < names.length; n++) {
				names[n] = info.names[n];
			}
		}
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

		x = (x % renderer.game.width + renderer.game.width) % renderer.game.width;
		y = (y % renderer.game.height + renderer.game.height) % renderer.game.height;

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
			desired_size = Math.max(1 * renderer.game.height, window.innerHeight - 1);
		} else {
			desired_size = renderer.game.height * Math.max(1, Math.floor((window.innerHeight - 1) / renderer.game.height));
		}

		if (desired_size !== canvas.width || desired_size !== canvas.height) {
			canvas.width = desired_size;
			canvas.height = desired_size;
		}

		context.clearRect(0, 0, canvas.width, canvas.height);
	};

	renderer.draw = () => {

		if (!renderer.game || !renderer.game.clean) {
			return;
		}

		renderer.clear();
		renderer.draw_grid();
		renderer.draw_structures();
		renderer.draw_ships();

		renderer.write_infobox();
	};

	renderer.draw_if_finished = () => {

		if (!renderer.game || !renderer.game.clean) {
			return;
		}

		if (renderer.game.turn === renderer.game.constants.MAX_TURNS) {
			renderer.draw();
		}
	};

	renderer.draw_grid = () => {

		let box_width = renderer.box_width();
		let box_height = renderer.box_height();

		for (let x = 0; x < renderer.game.width; x++) {

			for (let y = 0; y < renderer.game.height; y++) {

				let val;

				switch (renderer.prefs.grid_aesthetic) {
					case 0:
						val = 0;
						break;
					case 1:
						val = renderer.game.halite[x][y] / 4;
						break;
					case 2:
						val = 255 * Math.sqrt(renderer.game.halite[x][y] / 2048);
						break;
					case 3:
						val = 255 * Math.sqrt(renderer.game.halite[x][y] / 1024);
						break;
				}

				val = Math.floor(val);
				val = Math.min(255, val);

				context.fillStyle = `rgb(${val},${val},${val})`;

				let [i, j] = renderer.offset_adjust(x, y);
				context.fillRect(i * box_width, j * box_height, box_width, box_height);
			}
		}
	};

	renderer.draw_structures = () => {

		let box_width = renderer.box_width();
		let box_height = renderer.box_height();

		for (let dropoff of Object.values(renderer.game.dropoffs)) {

			let x = dropoff.x;
			let y = dropoff.y;
			let pid = dropoff.pid;

			context.fillStyle = colours[pid];
			let [i, j] = renderer.offset_adjust(x, y);
			context.fillRect(i * box_width, j * box_height, box_width, box_height);
		}
	};

	renderer.draw_ships = () => {

		let box_width = renderer.box_width();
		let box_height = renderer.box_height();

		for (let ship of Object.values(renderer.game.ships)) {

			let pid = ship.pid;
			let x = ship.x;
			let y = ship.y;

			let colour = colours[pid];
			let opacity = ship.halite / 1000;

			let [i, j] = renderer.offset_adjust(x, y);

			let a = 0.1;
			let b = 0.5;
			let c = 1 - a;

			context.strokeStyle = colour;

			switch (ship.direction) {

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
	};

	renderer.box_width = () => {
		if (renderer.game.width <= 0) return 1;
		return Math.max(1, canvas.width / renderer.game.width);
	};

	renderer.box_height = () => {
		if (renderer.game.height <= 0) return 1;
		return Math.max(1, canvas.height / renderer.game.height);
	};

	// --------------------------------------------------------------

	renderer.write_infobox = () => {

		let lines = [];

		let turn_fudge = renderer.prefs.turns_start_at_one ? 1 : 0;
		let max_turns = renderer.game.constants.MAX_TURNS;

		let free = renderer.game.free_halite;
		let percentage = Math.floor(100 * renderer.game.free_halite / renderer.game.initial_free_halite);

		lines.push(`<p class="lowlight">Seed: ${renderer.game.constants.game_seed} (${renderer.game.width} x ${renderer.game.height})</p>`);
		lines.push(`<p class="lowlight">Free halite: ${free} (${percentage}%)</p>`);
		lines.push(`<p class="lowlight">Turn: <span class="white-text">${renderer.game.turn + turn_fudge}</span> / ${max_turns}</p>`);

		let all_pids = [];

		for (let pid = 0; pid < renderer.game.players; pid++) {
			all_pids.push(pid);
		}

		if (renderer.game.turn === renderer.game.constants.MAX_TURNS) {
			all_pids.sort((a, b) => {
				return renderer.game.budgets[b] - renderer.game.budgets[a];
			});
		}

		for (let pid of all_pids) {

			let budget = renderer.game.budgets[pid];
			let ships = renderer.game.ship_counts[pid];
			let dropoffs = renderer.game.dropoff_counts[pid];
			let carried = renderer.game.carried[pid];
			let built = renderer.game.build_counts[pid];

			let c = `<span class="player-${pid}-colour">`;
			let z = `</span>`;

			lines.push(`
				<h2 class="player-${pid}-colour">${names[pid]}</h2>
				<ul>
					<li>Ships: ${c}${ships}${z} / ${c}${built}${z}</li>
					<li>Dropoffs: ${c}${dropoffs}${z}</li>
					<li>Carrying: ${c}${carried}${z}</li>
					<li>Budget: ${c}${budget}${z}</li>
				</ul>`
			);
		}

		infobox.innerHTML = lines.join("");
	};

	return renderer;
}

let tp = make_token_parser();
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

ipcRenderer.on("receive", (event, msg) => {
	tp.receive(msg);
});

ipcRenderer.on("go", (event, args) => {
	renderer.go(args);
});

window.addEventListener("resize", () => renderer.draw_if_finished());

renderer.clear();

// Give the window and canvas a little time to settle... (may prevent sudden jerk during load).

setTimeout(() => {
	ipcRenderer.send("renderer_ready", null);
}, 200);
