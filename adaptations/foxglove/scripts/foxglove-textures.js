// Foxglove can draw a paused URDF model before CEF has uploaded its loaded colour maps.
// Upload each original image again once, then draw the current pose without advancing playback.
(() => {
	const state = window.__qarAdaptationState;
	if (!state?.renderers) return;
	const refreshedByRenderer = new WeakMap();
	state.foxgloveTextureRefreshes = 0;

	function refreshRobotTextures() {
		if (state.suspendConfinement) return;
		for (const renderer of state.renderers) {
			if (!renderer.domElement?.isConnected || renderer.getRenderTarget() !== null) continue;
			const scene = renderer.__qarLastScene;
			const robotLayer = scene?.getObjectByName("foxglove.Urdfs");
			if (!robotLayer) continue;
			let camera;
			scene.traverse(object => {
				if (!camera && object.isPerspectiveCamera) camera = object;
			});
			if (!camera) continue;

			let refreshed = refreshedByRenderer.get(renderer);
			if (!refreshed) {
				refreshed = new WeakMap();
				refreshedByRenderer.set(renderer, refreshed);
			}
			let updates = 0;
			robotLayer.traverse(mesh => {
				if (!mesh.isMesh) return;
				const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
				for (const material of materials) {
					const texture = material?.map;
					const image = texture?.image;
					if (!(image instanceof HTMLImageElement) || !image.complete || !image.naturalWidth
							|| refreshed.get(texture) === image) continue;
					refreshed.set(texture, image);
					texture.needsUpdate = true;
					updates++;
				}
			});
			if (updates) {
				renderer.render(scene, camera);
				state.foxgloveTextureRefreshes += updates;
			}
		}
	}

	setInterval(refreshRobotTextures, 500);
})();
