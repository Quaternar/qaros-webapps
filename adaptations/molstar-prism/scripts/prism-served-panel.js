(() => {
    if (!window.qaros?.panels || !window.qaros?.app || !window.__qarPrismSequence) return;
    const sequence = window.__qarPrismSequence;
    const motion = new Set(["hover", "down", "move", "up", "cancel"]);
    let owner = null;
    let lastInput = 0;

    qaros.app.expose({
        sequenceInfo() {
            try {
                return sequence.info();
            } catch (error) {
                return {ready: false, error: error.message};
            }
        },
        sequenceFrame(key) {
            const frame = sequence.frame();
            if (frame.key !== key) throw new Error("Sekvence se změnila.");
            return frame.png;
        },
        sequenceInput(data) {
            const {action, client} = data ?? {};
            if (typeof client !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(client)) {
                throw new Error("Chybí identita panelu.");
            }
            if (action === "leave") {
                if (owner === client) {
                    owner = null;
                    sequence.leave();
                }
                return {ok: true};
            }
            const kind = typeof action === "string" && action.startsWith("sequence-") ? action.slice(9) : "";
            if (!motion.has(kind) && kind !== "wheel") throw new Error("Neznámý vstup sekvence.");
            if (owner && owner !== client && performance.now() - lastInput < 1500) return {busy: true};
            const result = kind === "wheel" ? sequence.wheel(data) : sequence.input(kind, data);
            owner = client;
            lastInput = performance.now();
            return result;
        },
    });
    setInterval(() => {
        if (owner && performance.now() - lastInput >= 1500) {
            owner = null;
            sequence.leave();
        }
    }, 300);
    qaros.panels.open({
        name: "sekvence", displayName: "Mol* · Sekvence", entry: "sequence/index.html",
        sizeMeters: {width: 0.6, height: 0.125625},
        offset: {x: -0.65, y: -0.35, z: 2},
    }).catch(error => console.error("Sekvenční panel se nepodařilo otevřít", error));
})();
