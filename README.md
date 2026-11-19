# qaros-webapps

Web app adaptations for QAROS: the scripts and settings that let QAROS stream a website (three.js
examples, Foxglove) to every user's view in stereo with depth. Each adaptation is published as a
`.qarapp` package; QAROS downloads new releases by itself.

This repository holds adaptations useful to a broad audience, the ones the Visualizer shows in
user mode. Developer and debugging samples stay with the QAROS product.

Index of the newest release (fixed address, no API token, no rate limit):

```
https://github.com/Quaternar/qaros-webapps/releases/latest/download/webapps-index.json
```

## Layout

```
adaptations/<name>/          one adaptation folder, packaged as it is (except test/)
  profile.json               Id, Name, DisplayName, Version, StartAddress, AddressPattern, PageRegion, Scripts, ...
  scripts/*.js               the adaptation's own scripts (Scripts[].File)
  panels/                    optional served panel pages
  test/*.test.mjs            optional Node tests of the adaptation (never packaged)
schemas/webapps-index.schema.json
scripts/                     build tooling (Python 3, standard library plus the QAROS adaptation kit)
release.json                 repository name and the minimum QAROS version, globally or per adaptation
CHANGELOG.md                 changes per release, grouped per adaptation
AGENTS.md                    contribution rules (versions, changelog, public-repo rules)
.github/workflows/           ci.yml (pull requests), release.yml (main)
```

Everything in an adaptation folder except `test/` ends up in its package, so keep only adaptation
files there. A `profile.json` in the repository never holds `Files` or `Signature`: the build writes
both.

## Libraries from the QAROS adaptation kit

The scripts several adaptations share (three.js renderer capture, the render-frame core, the
atlas pack, the three.js render frame for WebGL and WebGPU) are not copied here. A profile names
them by `name@major`, and QAROS injects the library of its own installed adaptation kit when the
page loads:

```json
{ "Name": "render-frame-handler", "Stage": "afterLoad", "Library": "threejs-render-frame@1" }
```

- A library fix reaches every adaptation with the next QAROS, without a new adaptation version.
- The kit is the public repository [Quaternar/qaros](https://github.com/Quaternar/qaros), folder
  `adaptation-kit`: libraries, the `qaros-adaptation` command line (`check`, `test`, `package`,
  `pin`) and the guide. Its version follows QAROS.
- QAROS resolves `Library` references from version 0.10.0, so `release.json` sets
  `minQarosVersion` to 0.10.0: an older QAROS reports the adaptations as not compatible instead of
  loading them without their libraries.
- An adaptation's own scripts stay files in its folder (`File`).

## Adaptations

| Folder | Id | Opens | Version |
|---|---|---|---|
| `foxglove` | `com.quaternar.foxglove` | https://app.foxglove.dev/ | 0.2.0 |
| `molstar-alphafold` | `com.quaternar.molstar-alphafold` | AlphaFold DB entry P69905 | 0.1.0 |
| `molstar-classic` | `com.quaternar.molstar-classic` | Mol* Viewer with PDB entry 1CBS | 0.1.0 |
| `molstar-pdbe` | `com.quaternar.molstar-pdbe` | PDBe entry 1CBS | 0.1.0 |
| `molstar-prism` | `com.quaternar.molstar-prism` | Mol* Prism with a served sequence panel | 0.1.0 |
| `molstar-rcsb` | `com.quaternar.molstar-rcsb` | RCSB PDB entry 1CBS | 0.1.0 |
| `molview-editor` | `com.quaternar.molview-editor` | MolView Stories Editor with a simple template | 0.1.0 |
| `molview-stories` | `com.quaternar.molview-stories` | MolView Stories Exosome example | 0.1.0 |
| `threejs-examples` | `com.quaternar.threejs-examples` | https://threejs.org/examples/ | 0.2.0 |
| `threejs-shinjuku` | `com.quaternar.threejs-shinjuku` | Shinjuku Station indoor map demo | 0.2.0 |

- QAROS streams the renderer of the top-level page only. A site that shows its content in an
  iframe (the three.js examples gallery) gets no stream: the adaptation opens the frame's own
  address as the page instead (`threejs-examples/scripts/open-example.js`).
- three.js examples stream with a `WebGLRenderer` and with a `WebGPURenderer` (the `webgpu_*`
  examples): the profile lists both kit render-frame libraries, and each request goes to the one
  for the renderer the page created.
- Scale: one three.js scene unit is one metre (`AppScale` 1). `AppScaleByAddress` sets another
  scale for single examples, first match wins: `webgl_animation_keyframes` (Littlest Tokyo) is
  shown at 0.2. `threejs-examples/test/app-scale.test.mjs` checks the mapping.

## Versioning

- Every adaptation has its own semantic version, `Version` in its `profile.json`. All start at
  0.1.0: below 1.0 an adaptation is not yet considered stable.
- Any change to an adaptation folder (a script, a panel file, a profile field) needs a higher
  `Version`. While below 1.0: MINOR for features and breaking changes, PATCH for fixes. From 1.0:
  MAJOR for breaking changes (a newer QAROS needed, different addresses matched), MINOR for
  features, PATCH for fixes. `scripts/check_versions.py` refuses a changed folder without a bump,
  compared with the previous release tag; CI runs it on every pull request.
- A user-noticeable change also gets a one-line entry in `CHANGELOG.md` under `[Unreleased]`, in
  the same commit as the bump (see AGENTS.md).
- QAROS installs a package only when it is newer than the copy it has, so a version is never
  reused and never goes down.
- `Id` is permanent. A different Id is a different adaptation: add a new folder.
- `release.json` sets `minQarosVersion` (the oldest QAROS that installs the packages), globally or
  per folder under `adaptations`. A per-folder value may only raise the global one, which is the
  first QAROS with the adaptation kit (`make_index.py` refuses a lower one).
- QAROS stops shipping its own copies of these adaptations and takes them from this repository's
  releases, so QAROS product versions and adaptation versions never compete.
- Releases currently use date-based tags (`YYYY.MM.DD.N`), not the shared QAROS scheme in [ADR-0001: One versioning scheme for every QAROS repository](https://github.com/Quaternar/qaros/blob/main/docs/adr/0001-one-versioning-scheme.md). Moving to it needs the tools that pick the newest release changed first.

## Releases

Every merge to `main` that changes an adaptation publishes a release (several a day are fine):

1. tooling tests, `qaros-adaptation check` and `test` on every adaptation (against the kit, see
   below), version check;
2. one package per adaptation: `<id>-<version>.qarapp`;
3. when signing is configured: each package signed with the QAROS release key, held in Azure Key
   Vault (the build hands the package digest to `az keyvault key sign --algorithm ES256` and
   attaches the answer);
4. `webapps-index.json` written, and signed with the same key when signing is configured;
5. everything verified (against the public key when signed), then published as release
   `YYYY.MM.DD.N` (UTC date, N counting from 1 per day), marked latest. Tags are made by CI only.

Signing is optional:

- **Unsigned** (today): none of the Key Vault variables below is set. Packages carry `Files` but no
  `Signature`, the index has no `signature` block, entries say `"signed": false`, and the release
  notes say the release is unsigned.
- **Signed**: all of `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `QAROS_RELEASE_KEY_VAULT` and
  `QAROS_RELEASE_PUBLIC_KEY` are set; every package and the index must then verify as signed.
- Setting only some of them fails the run instead of publishing.

A push that changes no adaptation publishes nothing; run the Release workflow by hand with
`force` to publish anyway.

Signing configuration lives in the GitHub environment `release-signing` (variables only, no
secrets; `azure/login` uses OIDC):

| Variable | Value |
|---|---|
| `AZURE_CLIENT_ID` | identity with a federated credential for `repo:Quaternar/qaros-webapps:environment:release-signing` |
| `AZURE_TENANT_ID` | its tenant |
| `AZURE_SUBSCRIPTION_ID` | optional |
| `QAROS_RELEASE_KEY_VAULT` | Key Vault holding the release key (the identity needs the key's `sign` permission, e.g. "Key Vault Crypto User") |
| `QAROS_RELEASE_KEY_NAME` | key name, default `qaros-release` |
| `QAROS_RELEASE_PUBLIC_KEY` | the key's public half (PEM text), the key QAROS pins |

Limit the environment to the `main` branch.

## Package format

A `.qarapp` is a ZIP:

```
package.json             {"content": "adaptation", "formatVersion": 1, "kind": "web-app-adaptation"}
adaptation/profile.json  the profile plus Files and Signature
adaptation/...           exactly the files Files lists
```

- `Files`: every file of the folder except `profile.json`, sorted by path, as
  `{"Path": ..., "Sha256": <lower-case hex>}`. Paths are relative, `/`-separated, at most 512
  bytes, with only `A-Z a-z 0-9 . _ - ~ + @ ( ) ! ,` per segment.
- `Signature`: `{"Signer": "Quaternar", "KeyId": <hex SHA-256 of the DER public key>,
  "PublicKey": <base64 DER SubjectPublicKeyInfo>, "Algorithm": "ECDSA-P256-SHA256",
  "Value": <base64 DER signature>}` over
  `SHA-256("QAROS-ADAPTATION-SIGNATURE-V1" NUL canonical(profile.json without Signature))`,
  canonical meaning sorted keys, no whitespace, UTF-8. Through `Files` it covers every file.
- Entries are deflated, in manifest order, dated 1980-01-01: the same folder gives the same bytes.

The index (`schemas/webapps-index.schema.json`) lists per adaptation `id`, `version`, `asset`,
`url`, `release`, `sha256`, `size`, `formatVersion`, `minQarosVersion` and `signed`. Its `signature`
block (same fields, lower camel case) covers
`SHA-256("QAROS-WEBAPPS-INDEX-SIGNATURE-V1" NUL canonical(index without signature))`.

## Tooling

Python 3.10 or newer, standard library only, plus the QAROS adaptation kit; Node.js 20 or newer for
the adaptation tests. Run with `python -I`.

The scripts find the kit with `--kit <dir>`, else the environment variable `QAROS_ADAPTATION_KIT`,
else `.qaros/adaptation-kit` (a checkout of Quaternar/qaros in this folder, ignored by git; CI puts
it there). CI checks out the tag `v<minQarosVersion>` of `release.json`, or the default branch
while that tag does not exist yet (`scripts/ci.py kit-ref` says which).

```
git clone https://github.com/Quaternar/qaros .qaros      the kit, where the scripts look by default
python -I scripts/ci.py check                            everything CI checks (the lines below)
python -I -m unittest discover -s scripts/tests          tooling tests
python -I .qaros/adaptation-kit/tools/qaros-adaptation.py check adaptations/<name>
python -I .qaros/adaptation-kit/tools/qaros-adaptation.py test adaptations/<name>
python -I scripts/check_versions.py [--base <tag>]       version bumps against the previous release
python -I scripts/build_packages.py --out out            unsigned packages, verified (the kit's packaging)
python -I scripts/make_index.py build --packages out --release 2026.01.01.1 --out out/webapps-index.json
python -I scripts/make_index.py verify out/webapps-index.json --packages out
python -I scripts/qarapp.py verify out/<package>.qarapp [--public-key key.pem]
```

`scripts/qarapp.py` is the kit's `.qarapp` command line (`qaros_adaptation.qarapp`), and
`build_packages.py` calls the kit's packaging (`qaros_adaptation.packaging`), the same steps as
`qaros-adaptation package`.

Signing locally (testing only; never commit a key, `*.pem` is ignored):

```
python -I scripts/qarapp.py keygen test.key.pem test.pub.pem
python -I scripts/build_packages.py --out out --private-key test.key.pem
python -I scripts/make_index.py build --packages out --release 2026.01.01.1 --out out/webapps-index.json --private-key test.key.pem
```

With a key held elsewhere: `qarapp.py digest <folder>` / `make_index.py digest <index>` print the
digest to sign, `qarapp.py attach` / `make_index.py attach --signature-file` attach the detached
signature (raw r||s as Key Vault answers it, or DER). `build_packages.py --tool
<qar-adaptation-tool>` also verifies every package with the QAROS command-line tool.

## Origin

The adaptations were previously generated when QAROS was built, and this repository holds that
output as static folders:

| Here | Came from |
|---|---|
| `threejs-examples`, `threejs-shinjuku` | generated from the three.js libraries with page region 1024 x 1024, `RenderScale` 0.5, per example `AppScale` and address; Shinjuku with `TransportAlpha` |
| `foxglove` | a manifest naming the same libraries plus its own `foxglove-scene.js`, page region 1280 x 1024 |
| `scripts/<script>.js` | the local file, with `__PAGE_REGION_WIDTH__`/`__PAGE_REGION_HEIGHT__` replaced by the page region |
| `profile.json` | the manifest with `_sv` 3, `ShareBrowserProfile` true, `Id` `com.quaternar.<name>`, `DisplayName`, `Version`, `Panels` `panels`, `StartAddress`; the libraries as `Library` references (they were copies up to 0.1.x) |

Differences from what earlier QAROS builds shipped, none of which changes behaviour:

- `Version` is 0.1.0 instead of the QAROS version (0.9.0): adaptation versions are independent of
  QAROS versions.
- Line endings are LF everywhere (builds on Windows wrote CRLF).
