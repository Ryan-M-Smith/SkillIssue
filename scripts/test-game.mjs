import { spawnSync } from "node:child_process";

const candidates = process.env.GODOT_BIN ? [process.env.GODOT_BIN] : ["godot", "godot4"];
const executable = candidates.find((candidate) => spawnSync(candidate, ["--version"], { encoding: "utf8", windowsHide: true }).status === 0);
if (!executable) {
	console.error("Set GODOT_BIN to your Godot 4.7 executable, or add godot/godot4 to PATH.");
	process.exit(1);
}
for (const args of [
	["--headless", "--path", "apps/game", "--editor", "--import", "--quit"],
	["--headless", "--path", "apps/game", "--script", "res://tests/gameplay_smoke.gd"],
	["--headless", "--path", "apps/game", "--script", "res://tests/lifecycle_smoke.gd"],
]) {
	const result = spawnSync(executable, args, { encoding: "utf8", windowsHide: true, timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
	if (result.stdout) process.stdout.write(result.stdout);
	if (result.stderr) process.stderr.write(result.stderr);
	if (result.error || result.status !== 0 || /(?:SCRIPT ERROR|ERROR):/.test(`${result.stdout}\n${result.stderr}`)) {
		console.error(result.error?.message ?? "Godot validation failed.");
		process.exit(1);
	}
}
