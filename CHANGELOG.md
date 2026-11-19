# Changelog

All notable changes to the adaptations in this repository are documented here, following
[Keep a Changelog](https://keepachangelog.com/) and [Semantic Versioning](https://semver.org/).
Each adaptation has its own version (`Version` in its `profile.json`); releases are tagged
`YYYY.MM.DD.N` by CI. Entries are grouped per adaptation id. How entries and versions are made:
[AGENTS.md](AGENTS.md).

## [Unreleased]

### com.quaternar.molstar-alphafold

#### Features

- Explore the AlphaFold DB structure viewer in stereo with depth, starting with P69905 (0.1.0).

### com.quaternar.molstar-classic

#### Features

- Open Mol* Classic in stereo with depth, starting with the PDB structure 1CBS (0.1.0).

### com.quaternar.molstar-pdbe

#### Features

- Open the PDBe entry viewer in stereo with depth, starting with 1CBS (0.1.0).

### com.quaternar.molstar-prism

#### Features

- Open Mol* Prism in stereo with depth and inspect residues using its interactive QAROS sequence panel (0.1.0).

### com.quaternar.molstar-rcsb

#### Features

- Open the RCSB PDB structure viewer in stereo with depth, starting with 1CBS (0.1.0).

### com.quaternar.molview-editor

#### Features

- Preview the structure from the MolView Stories Editor in stereo with depth (0.1.0).

### com.quaternar.molview-stories

#### Features

- View MolView Stories in stereo with depth, starting with the Exosome example (0.1.0).

### com.quaternar.foxglove

#### Breaking

- Needs QAROS 0.10.0 or newer: the shared scripts now come from the QAROS install, so library fixes reach Foxglove with QAROS updates. An older QAROS shows the adaptation as not compatible; update QAROS (0.2.0).

#### Features

- Renders at 60 frames per second (`RenderRate`); QAROS renders web apps at 30 unless an adaptation asks for more (0.2.0).
- Foxglove (https://app.foxglove.dev/) streamed in stereo with depth: the scene of its largest 3D panel renders once per eye of every QAROS user (0.1.0).

#### Bug fixes

- Textured robot parts retain their colours in Foxglove's 3D panel and stereo view when a recording opens paused (0.2.2).
- The 3D panel looks as smooth as in the browser: grid lines and box edges are antialiased instead of dotted and jagged, and a distant grid no longer shows moire rings. It renders at full resolution with 4x multisampling (`RenderScale` 1, `Antialias` 4); QAROS without `Antialias` support renders it single-sampled (0.2.1).
- Thin lines and edges keep their depth in the glasses: they no longer show dashed or broken, and keep their full brightness (0.1.1).

### com.quaternar.threejs-examples

#### Breaking

- Needs QAROS 0.10.0 or newer: the shared scripts now come from the QAROS install, so library fixes reach the examples with QAROS updates. An older QAROS shows the adaptation as not compatible; update QAROS (0.2.0).

#### Features

- Examples render at 60 frames per second (`RenderRate`); QAROS renders web apps at 30 unless an adaptation asks for more (0.2.0).
- Any official three.js example (https://threejs.org/examples/) streamed in stereo with depth, one scene unit per metre (0.1.0).
- The WebGPU examples (`webgpu_*`) stream too, in stereo with depth (0.2.0).
- Littlest Tokyo (https://threejs.org/examples/#webgl_animation_keyframes) shows at scale 0.2, its size as the former separate adaptation; every other example keeps one scene unit per metre (0.2.0).

#### Bug fixes

- An example picked in the examples gallery now streams: it opens as the page itself instead of inside the gallery's frame, and Back returns to the gallery (0.1.1).
- Thin lines and edges keep their depth in the glasses: they no longer show dashed or broken, and keep their full brightness (0.1.2).

### com.quaternar.threejs-littlest-tokyo

#### Features

- The three.js Littlest Tokyo example (animated glTF) streamed in stereo with depth (0.1.0).

#### Removed

- Littlest Tokyo is no longer a separate adaptation: open **three.js examples** and pick Littlest Tokyo (https://threejs.org/examples/#webgl_animation_keyframes). Its id is retired and never reused (0.1.0 was its last version).

### com.quaternar.threejs-shinjuku

#### Breaking

- Needs QAROS 0.10.0 or newer: the shared scripts now come from the QAROS install, so library fixes reach the demo with QAROS updates. An older QAROS shows the adaptation as not compatible; update QAROS (0.2.0).

#### Features

- Renders at 60 frames per second (`RenderRate`); QAROS renders web apps at 30 unless an adaptation asks for more (0.2.0).
- The Shinjuku Station indoor map demo streamed in stereo with depth as a 1 m table model, its transparent background as alpha (0.1.0).

#### Bug fixes

- The 3D panel looks as smooth as in the browser: grid lines and box edges are antialiased instead of dotted and jagged, and a distant grid no longer shows moire rings. It renders at full resolution with 4x multisampling (`RenderScale` 1, `Antialias` 4); QAROS without `Antialias` support renders it single-sampled (0.2.1).
- Thin lines and edges keep their depth in the glasses: they no longer show dashed or broken, and keep their full brightness (0.1.1).
