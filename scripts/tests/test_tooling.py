"""Tests of the package, version and index tooling. Needs the QAROS adaptation kit (scripts/kitpath.py):

    QAROS_ADAPTATION_KIT=<qaros>/adaptation-kit python -I -m unittest discover -s scripts/tests

The `.qarapp` format itself (manifest, signature, ZIP, hostile packages) is tested with the kit.
"""

from __future__ import annotations

import base64
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent
ROOT = SCRIPTS.parent
sys.path.insert(0, str(SCRIPTS))

import kitpath  # noqa: E402

KIT = kitpath.use()

import check_versions  # noqa: E402
import make_index  # noqa: E402
from qaros_adaptation import qarapp  # noqa: E402

KEY = qarapp.SigningKey(0x1F2E3D4C5B6A79881F2E3D4C5B6A79881F2E3D4C5B6A79881F2E3D4C5B6A7988)
OTHER_KEY = qarapp.SigningKey(0x0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF)
TRUSTED = [("Quaternar", KEY.public_der)]


def raw_key_vault_signature(digest: bytes) -> str:
    """What `az keyvault key sign --algorithm ES256` answers: base64url raw r||s, no padding."""
    r, s = qarapp.signature_from_der(KEY.sign(digest))
    return base64.urlsafe_b64encode(r.to_bytes(32, "big") + s.to_bytes(32, "big")).decode().rstrip("=")


def profile_version(name: str) -> str:
    return json.loads((ROOT / "adaptations" / name / "profile.json").read_text(encoding="utf-8"))["Version"]


class Scratch(unittest.TestCase):
    def setUp(self) -> None:
        self.dir = Path(tempfile.mkdtemp(prefix="qaros-webapps-test-"))

    def tearDown(self) -> None:
        shutil.rmtree(self.dir, ignore_errors=True)

    def adaptation(self, name: str = "foxglove") -> Path:
        """A copy of a repository adaptation, with a served panel added so panel paths are covered."""
        folder = self.dir / name
        shutil.copytree(ROOT / "adaptations" / name, folder)
        (folder / "panels/controls").mkdir(parents=True)
        (folder / "panels/controls/index.html").write_text("<!doctype html>\n", encoding="utf-8")
        return folder


class BuildPackagesTests(Scratch):
    """scripts/build_packages.py: the kit's packaging over every adaptation folder."""

    def run_build(self, *arguments: str) -> subprocess.CompletedProcess:
        return subprocess.run(
            [sys.executable, "-I", str(SCRIPTS / "build_packages.py"), "--kit", str(KIT), *arguments],
            capture_output=True,
            text=True,
            check=False,
        )

    def test_signed_packages_verify_and_are_deterministic(self) -> None:
        private = self.dir / "test.key.pem"
        private.write_text(qarapp.private_key_pem(KEY.scalar), encoding="ascii")
        first = self.run_build("--out", str(self.dir / "a"), "--private-key", str(private), "--keep-staging")
        self.assertEqual(first.returncode, 0, first.stderr)
        second = self.run_build("--out", str(self.dir / "b"), "--private-key", str(private))
        self.assertEqual(second.returncode, 0, second.stderr)
        names = sorted(path.name for path in (self.dir / "a").glob("*.qarapp"))
        self.assertEqual(len(names), len(list((ROOT / "adaptations").glob("*/profile.json"))))
        for name in names:
            self.assertEqual((self.dir / "a" / name).read_bytes(), (self.dir / "b" / name).read_bytes(), name)
            contents = qarapp.read_package(self.dir / "a" / name, TRUSTED)
            self.assertTrue(contents.verification.signed)
            self.assertFalse(any(path.startswith("test/") for path in contents.files), name)
        self.assertTrue((self.dir / "a/staging/threejs-examples/profile.json").is_file())

    def test_only_and_unknown_folder(self) -> None:
        built = self.run_build("--out", str(self.dir / "out"), "--only", "foxglove")
        self.assertEqual(built.returncode, 0, built.stderr)
        expected = qarapp.package_file_name("com.quaternar.foxglove", profile_version("foxglove"))
        self.assertEqual([path.name for path in (self.dir / "out").glob("*.qarapp")], [expected])
        missing = self.run_build("--out", str(self.dir / "out"), "--only", "nope")
        self.assertNotEqual(missing.returncode, 0)
        self.assertIn("no adaptation folder named nope", missing.stderr)

    def test_unknown_library_fails_the_build(self) -> None:
        source = self.dir / "src"
        source.mkdir()
        folder = source / "threejs-shinjuku"
        shutil.copytree(ROOT / "adaptations/threejs-shinjuku", folder)
        profile = json.loads((folder / "profile.json").read_text(encoding="utf-8"))
        profile["Scripts"][0]["Library"] = "threejs-capture@99"
        (folder / "profile.json").write_text(json.dumps(profile), encoding="utf-8")
        built = self.run_build("--out", str(self.dir / "out"), "--adaptations", str(source))
        self.assertNotEqual(built.returncode, 0)
        self.assertIn("threejs-capture@99", built.stderr)


class KitPathTests(unittest.TestCase):
    def test_kit_argument_is_split_off(self) -> None:
        self.assertEqual(kitpath.split_kit_argument(["build", "--kit", "k", "--out", "o"]), ("k", ["build", "--out", "o"]))
        self.assertEqual(kitpath.split_kit_argument(["--kit=k", "verify"]), ("k", ["verify"]))
        self.assertEqual(kitpath.split_kit_argument(["verify"]), (None, ["verify"]))

    def test_missing_kit_is_named(self) -> None:
        with self.assertRaisesRegex(kitpath.KitNotFound, "no QAROS adaptation kit"):
            kitpath.locate(ROOT / "no-such-kit")


class ReleaseConfigTests(Scratch):
    def test_minimum_qaros_ships_the_kit_libraries(self) -> None:
        """The adaptations name kit libraries: release.json's minQarosVersion is at least the first
        QAROS with the kit, and no adaptation may claim an older one."""
        config = make_index.load_config(ROOT / "release.json")
        self.assertGreaterEqual(qarapp.Version.parse(config["minQarosVersion"]), qarapp.Version.parse("0.10.0"))
        path = self.dir / "release.json"
        path.write_text(json.dumps(dict(config, adaptations={"foxglove": {"minQarosVersion": "0.9.0"}})), encoding="utf-8")
        with self.assertRaisesRegex(make_index.IndexFailure, "below"):
            make_index.load_config(path)


class CheckVersionsTests(Scratch):
    def git(self, *arguments: str) -> None:
        subprocess.run(["git", *arguments], cwd=self.dir, check=True, capture_output=True)

    def set_version(self, name: str, version: str) -> None:
        path = self.dir / "adaptations" / name / "profile.json"
        profile = json.loads(path.read_text(encoding="utf-8"))
        profile["Version"] = version
        path.write_text(json.dumps(profile, indent=2), encoding="utf-8")

    def bump_patch(self, name: str) -> None:
        path = self.dir / "adaptations" / name / "profile.json"
        major, minor, patch = json.loads(path.read_text(encoding="utf-8"))["Version"].split(".")
        self.set_version(name, f"{major}.{minor}.{int(patch) + 1}")

    def test_change_needs_a_bump(self) -> None:
        for name in ("foxglove", "threejs-shinjuku"):
            shutil.copytree(ROOT / "adaptations" / name, self.dir / "adaptations" / name)
        self.git("init", "-q")
        self.git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "init", "--allow-empty")
        self.git("add", ".")
        self.git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "adaptations")
        errors, _, changed = check_versions.check(self.dir, None)
        self.assertEqual(errors, [])
        self.assertTrue(changed)
        self.git("tag", "2026.11.14.1")
        self.assertEqual(check_versions.release_tags(self.dir), ["2026.11.14.1"])

        errors, _, changed = check_versions.check(self.dir, "2026.11.14.1")
        self.assertEqual((errors, changed), ([], False))

        test = self.dir / "adaptations/foxglove/test/scene.test.mjs"
        test.parent.mkdir(exist_ok=True)
        test.write_text("// a test, never packaged\n", encoding="utf-8")
        errors, _, changed = check_versions.check(self.dir, "2026.11.14.1")
        self.assertEqual((errors, changed), ([], False))

        script = self.dir / "adaptations/foxglove/scripts/foxglove-scene.js"
        script.write_text(script.read_text(encoding="utf-8") + "// changed\n", encoding="utf-8")
        errors, _, changed = check_versions.check(self.dir, "2026.11.14.1")
        self.assertTrue(changed)
        self.assertEqual(len(errors), 1)
        self.assertIn("foxglove", errors[0])

        self.bump_patch("foxglove")
        errors, _, _ = check_versions.check(self.dir, "2026.11.14.1")
        self.assertEqual(errors, [])

        self.bump_patch("threejs-shinjuku")
        errors, _, _ = check_versions.check(self.dir, "2026.11.14.1")
        self.assertEqual(errors, [])  # the version edit is itself a change, and a bump

        self.set_version("threejs-shinjuku", "0.0.9")
        errors, _, _ = check_versions.check(self.dir, "2026.11.14.1")
        self.assertEqual(len(errors), 1)


class IndexTests(Scratch):
    def build_packages(self, key: qarapp.SigningKey | None) -> Path:
        out = self.dir / "out"
        for name in ("foxglove", "threejs-examples"):
            folder = self.adaptation(name)
            if key is not None:
                qarapp.sign_folder(folder, "Quaternar", key.sign, key.public_der)
            else:
                qarapp.write_manifest(folder)
            profile = qarapp.read_profile(folder)
            qarapp.export_package(folder, out / qarapp.package_file_name(profile["Id"], profile["Version"]))
        return out

    def test_signed_index_verifies_and_detects_changes(self) -> None:
        out = self.build_packages(KEY)
        config = make_index.load_config(ROOT / "release.json")
        index = make_index.build_index(out, "2026.11.14.1", config, TRUSTED)
        digest = make_index.index_digest(index)
        value = qarapp.raw_signature_to_der(qarapp.decode_base64(raw_key_vault_signature(digest)))
        index = make_index.attach(index, "Quaternar", KEY.public_der, value)
        self.assertIn("signed by Quaternar", make_index.verify_index(index, TRUSTED, out, True))
        self.assertEqual({entry["minQarosVersion"] for entry in index["adaptations"]}, {config["minQarosVersion"]})
        tampered = json.loads(json.dumps(index))
        tampered["adaptations"][0]["version"] = "9.9.9"
        with self.assertRaises(make_index.IndexFailure):
            make_index.verify_index(tampered, TRUSTED, None, True)
        with self.assertRaises(make_index.IndexFailure):
            make_index.verify_index(index, [("Quaternar", OTHER_KEY.public_der)], None, True)

    def test_index_matches_schema_fields(self) -> None:
        out = self.build_packages(None)
        index = make_index.build_index(out, "2026.11.14.1", make_index.load_config(ROOT / "release.json"), None)
        index = make_index.attach(index, "Quaternar", KEY.public_der, KEY.sign(make_index.index_digest(index)))
        schema = json.loads((ROOT / "schemas/webapps-index.schema.json").read_text(encoding="utf-8"))
        self.assertTrue(set(schema["required"]) <= set(index) <= set(schema["properties"]))
        entry_schema = schema["$defs"]["adaptation"]
        for entry in index["adaptations"]:
            self.assertTrue(set(entry_schema["required"]) <= set(entry) <= set(entry_schema["properties"]))
        signature_schema = schema["$defs"]["signature"]
        self.assertEqual(set(index["signature"]), set(signature_schema["properties"]))


if __name__ == "__main__":
    unittest.main()
