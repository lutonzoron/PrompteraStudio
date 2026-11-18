import asyncio
import unittest
from unittest.mock import patch

from app.llm.providers import RateLimited, nvidia_endpoint, retry_after_seconds
from app.story.contract import contract_errors
from app.story.service import accept_story_contract, conform_takes


def _beat(n, kind, **extra):
    base = {
        "n": n,
        "kind": kind,
        "session": "door_v1",
        "duration": 6,
        "spatial": "Wolf RIGHT. Door CENTER. Camera outside.",
        "camera": "locked-off medium",
        "entry_state": "Forepaws down. Door closed.",
        "action": f"Beat {n} only.",
        "exit_state": "Forepaws down. Door still closed.",
        "visible": "Only the wolf.",
        "speaker": "none",
        "dialogue": "",
        "sound": "Quiet forest air. No speech.",
    }
    base.update(extra)
    return base


class StorySkillTests(unittest.TestCase):
    def test_long_scene_stays_one_session_with_one_seed(self):
        takes = [_beat(1, "new")] + [_beat(n, "continue", seed=2000 + n) for n in range(2, 8)]
        out = conform_takes(takes, slug="lobo", seed_base=2000, width=1024, height=576)
        self.assertEqual(len(out), 7)
        self.assertEqual({t["session"] for t in out}, {"door_v1"})
        self.assertEqual(out[0]["kind"], "new")
        self.assertTrue(all(t["kind"] == "continue" for t in out[1:]))
        self.assertEqual({t["seed"] for t in out}, {2001})
        self.assertEqual([t["prefix"] for t in out], [f"video/lobo/t{n:02d}" for n in range(1, 8)])
        self.assertIn("00:00.000–00:06.000", out[3]["prompt"])
        self.assertIn("horizontal 1024x576", out[0]["prompt"])
        self.assertIn("Continue the latest ready checkpoint", out[1]["prompt"])
        self.assertIn("ONE action:", out[1]["prompt"])
        self.assertNotIn("00:06–00:12", out[1]["prompt"])

    def test_legacy_film_clock_becomes_a_local_range(self):
        takes = [
            _beat(1, "new"),
            {
                "kind": "continue",
                "session": "door_v1",
                "duration": 5,
                "seed": 2002,
                "prompt": "[00:05–00:10] CONTINUITY LOCK: the child walks into the hallway.",
            },
        ]
        out = conform_takes(takes, slug="nova-história", seed_base=2000)
        self.assertEqual(out[0]["seed"], out[1]["seed"])
        self.assertNotIn("00:05–00:10", out[1]["prompt"])
        self.assertIn("00:00.000–00:05.000", out[1]["prompt"])
        self.assertIn("hallway", out[1]["prompt"])
        self.assertTrue(out[1]["prefix"].endswith("/t02"))

    def test_dialogue_is_wrapped_once_and_offscreen_stays_invisible(self):
        takes = [
            _beat(1, "new"),
            _beat(
                2, "continue",
                speaker="offscreen elderly woman inside",
                dialogue="<d>[Portuguese] Quem é?</d>",
                sound="Only the line from inside the closed door. No footsteps.",
            ),
        ]
        prompt = conform_takes(takes, slug="lobo", seed_base=2000)[1]["prompt"]
        self.assertEqual(prompt.count("<d>"), 1)
        self.assertIn("<d>[Portuguese] Quem é?</d>", prompt)
        self.assertIn("The speaker is not visible.", prompt)

    def test_shared_impact_list_does_not_repeat_on_later_takes(self):
        shared = "Footsteps, one knock, and a hinge creak, then room tone."
        takes = [
            _beat(1, "new", sound=shared),
            _beat(2, "continue", sound=shared),
            _beat(3, "continue", sound=shared),
        ]
        out = conform_takes(takes, slug="lobo", seed_base=2000)
        self.assertIn("knock", out[0]["prompt"])
        self.assertIn("Quiet ambience only", out[1]["prompt"])
        self.assertNotIn("hinge", out[2]["prompt"])

    def test_second_new_in_the_same_name_is_a_real_cut(self):
        takes = [_beat(1, "new"), _beat(2, "new", action="A new angle in the street.")]
        out = conform_takes(takes, slug="lobo", seed_base=2000)
        self.assertEqual(out[1]["kind"], "new")
        self.assertNotEqual(out[0]["session"], out[1]["session"])
        self.assertNotEqual(out[0]["seed"], out[1]["seed"])

    def test_scene_plate_stays_on_new_only(self):
        takes = [
            _beat(1, "new", first_frame="story_assets/lobo/porta.png"),
            _beat(2, "continue", first_frame="story_assets/lobo/porta.png"),
        ]
        out = conform_takes(takes, slug="lobo", seed_base=2000)
        self.assertEqual(out[0]["first_frame"], "story_assets/lobo/porta.png")
        self.assertNotIn("first_frame", out[1])

    def test_nsfw_locks_anatomy_on_new_and_continue(self):
        takes = [_beat(1, "new"), _beat(2, "continue")]
        out = conform_takes(takes, slug="lobo", seed_base=2000, model_pack="nsfw")
        self.assertIn("Anatomy lock", out[0]["prompt"])
        self.assertIn("Anatomy lock", out[1]["prompt"])

    def test_footage_is_one_physical_clip_without_speech(self):
        takes = [
            _beat(
                1, "new", duration=5, dialogue="olha isso",
                capture_mode="handheld phone", action="A dim oval drifts past the ridge.",
            ),
            _beat(2, "continue", action="It should not become a second take."),
        ]
        out = conform_takes(
            takes, slug="sf_181", seed_base=3000, width=576, height=1024, category="footage",
        )
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["kind"], "new")
        self.assertEqual(out[0]["duration"], 8.0)
        prompt = out[0]["prompt"]
        self.assertIn("576x1024", prompt)
        self.assertIn("native vertical 9:16", prompt)
        self.assertIn("CAPTURE MODE: handheld phone", prompt)
        self.assertIn("PHYSICAL MATERIAL", prompt)
        self.assertIn("00:00.000–00:08.000", prompt)
        self.assertNotIn("<d>", prompt)
        self.assertNotIn("second take", prompt)

    def test_footage_keeps_extra_takes_when_the_regen_asks_for_them(self):
        takes = [
            _beat(1, "new", duration=9, capture_mode="fixed CCTV", action="A figure stops at the gate."),
            _beat(2, "continue", duration=9, action="The figure stays at the gate."),
        ]
        out = conform_takes(
            takes, slug="sf_181", seed_base=3000, width=576, height=1024,
            category="footage", keep_all=True,
        )
        self.assertEqual(len(out), 2)
        self.assertEqual([item["n"] for item in out], [1, 2])

    def test_style_lock_is_kept(self):
        out = conform_takes(
            [_beat(1, "new")],
            slug="lobo",
            seed_base=2000,
            style_lock="Visual style lock: classic hand-drawn 2D.",
        )
        self.assertIn("Visual style lock: classic hand-drawn 2D.", out[0]["prompt"])
        self.assertIn("Sound:", out[0]["prompt"])
        self.assertIn("No text or captions.", out[0]["prompt"])


def _script(takes):
    return {
        "title": "A porta",
        "synopsis": "O lobo espera do lado de fora.",
        "roteiro_md": (
            "# A porta\n\n## Take 01 — NEW\n**Uma ação:** chega.\n"
            "**Sem fala.**\n**Som exclusivo deste take:** passos.\n"
        ),
        "takes": takes,
        "total_duration_sec": 6,
    }


class StoryContractTests(unittest.TestCase):
    def test_a_single_session_matches_the_working_shape(self):
        takes = [_beat(1, "new")] + [_beat(n, "continue") for n in range(2, 8)]
        errors = contract_errors(_script(takes), category="general", max_duration_sec=60)
        self.assertEqual(errors, [])

    def test_portuguese_action_is_rejected(self):
        bad = _beat(1, "new", action="O lobo não se mexe.")
        errors = contract_errors(_script([bad]), category="general", max_duration_sec=30)
        self.assertTrue(any("English" in item for item in errors))

    def test_spatial_without_a_screen_side_is_rejected(self):
        bad = _beat(1, "new", spatial="The wolf stands beside the door.")
        errors = contract_errors(_script([bad]), category="general", max_duration_sec=30)
        self.assertTrue(any("LEFT, CENTER, or RIGHT" in item for item in errors))

    def test_copied_event_sound_is_rejected(self):
        shared = "Footsteps, one knock, and a hinge creak, then room tone."
        takes = [_beat(1, "new", sound=shared), _beat(2, "continue", sound=shared)]
        errors = contract_errors(_script(takes), category="general", max_duration_sec=30)
        self.assertTrue(any("knock" in item for item in errors))

    def test_a_cut_every_three_takes_in_the_same_place_is_rejected(self):
        takes = []
        for block, session in ((0, "hall_a"), (1, "hall_b")):
            for offset in range(3):
                n = block * 3 + offset + 1
                kind = "new" if offset == 0 else "continue"
                takes.append(_beat(n, kind, session=session))
        errors = contract_errors(_script(takes), category="general", max_duration_sec=60)
        self.assertTrue(any("one session" in item for item in errors))

    def test_footage_must_be_one_silent_clip(self):
        clip = _beat(
            1, "new", duration=9, dialogue="olha isso",
            capture_mode="handheld phone", action="A dim oval drifts past the ridge.",
        )
        errors = contract_errors(
            _script([clip, _beat(2, "continue", duration=9, capture_mode="handheld phone")]),
            category="footage",
            max_duration_sec=10,
        )
        self.assertTrue(any("exactly one take" in item for item in errors))
        one = contract_errors(_script([clip]), category="footage", max_duration_sec=10)
        self.assertTrue(any("dialogue" in item for item in one))

    def test_two_rejections_then_a_valid_script(self):
        good = _script([_beat(1, "new")])
        stub = _Stub([{"takes": []}, {"title": "sem campos"}, good])

        async def _run():
            return await accept_story_contract(
                stub,
                system="contract",
                user="brief",
                schema={"takes": []},
                validate=lambda payload: contract_errors(
                    payload, category="general", max_duration_sec=30,
                ),
            )

        result = asyncio.run(_run())
        self.assertEqual(stub.calls, 3)
        self.assertIn("CONTRACT REJECTED", stub.users[1])
        self.assertIn("CONTRACT REJECTED", stub.users[2])
        self.assertEqual(result["title"], "A porta")

    def test_stops_after_two_retries(self):
        stub = _Stub([{"takes": []}, {"takes": []}, {"takes": []}])

        async def _run():
            return await accept_story_contract(
                stub,
                system="contract",
                user="brief",
                schema={"takes": []},
                validate=lambda payload: contract_errors(
                    payload, category="general", max_duration_sec=30,
                ),
            )

        with self.assertRaises(ValueError) as caught:
            asyncio.run(_run())
        self.assertEqual(stub.calls, 3)
        self.assertIn("2 novas tentativas", str(caught.exception))

    def test_rate_limit_waits_without_spending_a_retry(self):
        good = _script([_beat(1, "new")])
        stub = _Stub([RateLimited(60), good])
        slept: list[float] = []

        async def _sleep(seconds):
            slept.append(seconds)

        async def _run():
            with patch("app.story.service.asyncio.sleep", _sleep):
                return await accept_story_contract(
                    stub,
                    system="contract",
                    user="brief",
                    schema={"takes": []},
                    validate=lambda payload: contract_errors(
                        payload, category="general", max_duration_sec=30,
                    ),
                )

        result = asyncio.run(_run())
        self.assertEqual(stub.calls, 2)
        self.assertEqual(slept, [60])
        self.assertNotIn("CONTRACT REJECTED", stub.users[1])
        self.assertEqual(result["title"], "A porta")

    def test_nvidia_window_and_thinking_flag(self):
        self.assertEqual(retry_after_seconds({}), 60)
        self.assertEqual(retry_after_seconds({"retry-after": "12"}), 12)
        self.assertTrue(nvidia_endpoint("https://integrate.api.nvidia.com/v1", "other"))
        self.assertFalse(nvidia_endpoint("https://api.openai.com/v1", "gpt-4o-mini"))


class _Stub:
    def __init__(self, replies):
        self.replies = list(replies)
        self.calls = 0
        self.users = []

    async def chat_json(self, system, user, schema, temperature=0.3, max_tokens=None):
        self.calls += 1
        self.users.append(user)
        item = self.replies.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


if __name__ == "__main__":
    unittest.main()
