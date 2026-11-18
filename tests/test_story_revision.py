import asyncio
import unittest
from unittest.mock import patch

from fastapi import HTTPException

from app.main import StoryGenerateBody, api_generate_story
from app.story.service import story_user_prompt


def _prompt(**overrides):
    base = dict(
        brief="Um gato na porta",
        max_duration_sec=30,
        model_pack="sfw",
        category="general",
        frame="vertical 576x1024",
        bible="",
        style_lock="",
        craft="",
    )
    base.update(overrides)
    return story_user_prompt(**base)


class StoryRevisionPromptTests(unittest.TestCase):
    def test_plain_prompt_has_no_revision_block(self):
        text = _prompt()
        self.assertIn("BRIEF (Portuguese):\nUm gato na porta", text)
        self.assertNotIn("SCRIPT REVISION", text)

    def test_revision_lists_keeps_drops_adds_and_exact_count(self):
        text = _prompt(
            revise=True,
            take_count=3,
            notes="menos fala",
            drop_takes=[2],
            add_takes=[{"after": 1, "note": "fecha o portão"}],
            current_takes=[
                {"n": 1, "kind": "new", "session": "door", "duration": 6, "title": "chega", "action": "Steps to the door."},
                {"n": 2, "kind": "continue", "session": "door", "duration": 5, "title": "espera", "action": "Waits."},
            ],
            roteiro_md="Take 1 chega.",
        )
        self.assertIn("KEEP take 1", text)
        self.assertIn("DROP take 2", text)
        self.assertIn("after take 1: fecha o portão", text)
        self.assertIn("exactly 3", text)
        self.assertIn("menos fala", text)
        self.assertIn("Take 1 chega.", text)

    def test_footage_multi_take_overrides_the_single_clip_rule(self):
        text = _prompt(category="footage", take_count=3, notes="mais um instante")
        self.assertIn("USER OVERRIDE", text)
        self.assertIn("exactly 3", text)
        self.assertNotIn("CURRENT SCRIPT", text)

    def test_footage_single_take_keeps_the_clip_rule(self):
        text = _prompt(category="footage", take_count=1, revise=True, current_takes=[
            {"n": 1, "kind": "new", "title": "portão", "action": "Stops at the gate."},
        ])
        self.assertNotIn("USER OVERRIDE", text)
        self.assertIn("KEEP take 1", text)


class StoryGenerateGuardTests(unittest.TestCase):
    def test_active_generation_blocks_script_regen(self):
        with patch("app.main.db.get_project", return_value={"id": "p", "status": "generating"}):
            with self.assertRaises(HTTPException) as caught:
                asyncio.run(api_generate_story("p", StoryGenerateBody(brief="x")))
        self.assertEqual(caught.exception.status_code, 409)


if __name__ == "__main__":
    unittest.main()
