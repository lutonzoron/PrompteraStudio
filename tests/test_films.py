from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest import mock

from app import db
from app import films


class FilmsAssemblyTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        root = Path(self._tmpdir.name)
        self._db_patch = mock.patch.object(db, "DB_PATH", root / "studio.db")
        self._films_patch = mock.patch("app.films.FILMS_DIR", root / "films")
        self._db_patch.start()
        self._films_patch.start()
        # db.init uses config.DB_PATH via ensure_dirs; patch config path used by db module
        db.DB_PATH = root / "studio.db"  # type: ignore[attr-defined]
        from app import config

        self._cfg_db = mock.patch.object(config, "DB_PATH", root / "studio.db")
        self._cfg_films = mock.patch.object(config, "FILMS_DIR", root / "films")
        self._cfg_db.start()
        self._cfg_films.start()
        (root / "films").mkdir(parents=True, exist_ok=True)
        db.init_db()

        self.project = db.create_project({"title": "Cena 1", "slug": "cena-1"})
        self.master = root / "master1.mp4"
        self.master.write_bytes(b"fake-mp4-1")

    def tearDown(self) -> None:
        self._cfg_films.stop()
        self._cfg_db.stop()
        self._films_patch.stop()
        self._db_patch.stop()
        self._tmpdir.cleanup()

    def test_create_and_update_scenes(self) -> None:
        film = films.create_film("Chapeuzinho")
        self.assertEqual(film["title"], "Chapeuzinho")
        self.assertEqual(film["scene_count"], 0)

        updated = films.update_film(
            film["id"],
            scenes=[{"project_id": self.project["id"]}],
        )
        assert updated is not None
        self.assertEqual(updated["scene_count"], 1)
        self.assertEqual(updated["scenes"][0]["project_id"], self.project["id"])

    def test_build_concatenates_masters(self) -> None:
        film = films.create_film(
            "Filme",
            scenes=[{"project_id": self.project["id"]}],
        )
        out = Path(self._tmpdir.name) / "films" / film["slug"] / "film.mp4"

        def fake_concat(clips, path):
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"joined")
            return path

        with mock.patch("app.films.resolve_master_path", return_value=self.master), mock.patch(
            "app.films.concat_master",
            side_effect=fake_concat,
        ) as concat:
            result = films.build_film(film["id"])

        concat.assert_called_once()
        self.assertTrue(result["has_output"])
        self.assertEqual(result["status"], "ready")
        self.assertTrue(Path(result["output_path"]).is_file())
        self.assertEqual(Path(result["output_path"]).read_bytes(), b"joined")
        self.assertEqual(out, Path(result["output_path"]))


if __name__ == "__main__":
    unittest.main()
