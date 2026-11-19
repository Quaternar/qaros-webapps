import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const script = readFileSync(new URL("../scripts/foxglove-textures.js", import.meta.url), "utf8");

test("a paused URDF redraws once when each original colour map becomes available", () => {
	class Image {
		complete = false;
		naturalWidth = 0;
	}
	const image = new Image();
	let uploads = 0;
	const texture = { image, set needsUpdate(value) { if (value) uploads++; } };
	const meshes = [{ isMesh: true, material: [{ map: texture }, { map: texture }] }];
	const layer = { traverse: visit => meshes.forEach(visit) };
	const camera = { isPerspectiveCamera: true };
	const scene = {
		getObjectByName: name => name === "foxglove.Urdfs" ? layer : undefined,
		traverse: visit => visit(camera),
	};
	let draws = 0;
	let renderTarget = null;
	const renderer = {
		domElement: { isConnected: true },
		getRenderTarget: () => renderTarget,
		__qarLastScene: scene,
		render(renderedScene, renderedCamera) {
			assert.equal(renderedScene, scene);
			assert.equal(renderedCamera, camera);
			draws++;
		},
	};
	const state = { renderers: new Set([renderer]) };
	let refresh;
	vm.runInNewContext(script, {
		window: { __qarAdaptationState: state },
		HTMLImageElement: Image,
		setInterval: callback => { refresh = callback; },
	});

	refresh();
	assert.equal(draws, 0);
	Object.assign(image, { complete: true, naturalWidth: 256 });
	state.suspendConfinement = true;
	refresh();
	state.suspendConfinement = false;
	renderTarget = {};
	refresh();
	assert.equal(uploads, 0);

	renderTarget = null;
	refresh();
	refresh();
	assert.equal(draws, 1);
	assert.equal(uploads, 1);

	texture.image = Object.assign(new Image(), { complete: true, naturalWidth: 128 });
	refresh();
	assert.equal(draws, 2);
	assert.equal(uploads, 2);
});
