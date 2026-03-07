"""Tests for scoreboard parsing pipeline.

Tests are organized in layers:
- Preprocessing tests (no API key needed): cropping, image encoding
- Integration tests (need ANTHROPIC_API_KEY): full LLM pipeline on real screenshots

Set ANTHROPIC_API_KEY env var to run integration tests.
"""

import base64
import os
from pathlib import Path

import cv2
import numpy as np
import pytest

from routes.cv_parser import (
    SPEC_TO_PROFESSION,
    VALID_SPEC_IDS,
    _crop_scoreboard_region,
    _encode_image,
    parse_scoreboard_hybrid,
)

FIXTURES = Path(__file__).parent / "fixtures"

# Expected ground truth for the real in-game screenshots
EXPECTED_REAL_1 = {
    "red_team_names": ["Foulayi", "Silvanis Shadowpaw", "Teresa Faint Smile", "Luvita Primula", "Minnie Mouse"],
    "blue_team_names": ["Lalaji", "Koldaczek", "Yola Oups", "Allenheim", "A Samurai Champion"],
}

EXPECTED_REAL_2 = {
    "red_team_names": ["Allenheim", "Chupakabrada", "Je Suis Bonobo", "Schnabel Tasse", "Dajag"],
    "blue_team_names": ["Anotherjohny", "Exbelive", "The Last Citizen", "Drowishki", "Physsi"],
}

needs_api_key = pytest.mark.skipif(
    not os.environ.get("ANTHROPIC_API_KEY"),
    reason="ANTHROPIC_API_KEY not set",
)


# ── Preprocessing tests (no API needed) ──


class TestSpecMapping:
    def test_all_spec_ids_have_profession(self):
        """Every spec ID in VALID_SPEC_IDS must map to a profession."""
        for spec_id in VALID_SPEC_IDS:
            assert spec_id in SPEC_TO_PROFESSION, f"{spec_id} missing from SPEC_TO_PROFESSION"

    def test_professions_are_valid(self):
        """All profession values must be one of the 9 GW2 professions."""
        valid_professions = {
            "guardian", "warrior", "revenant", "ranger", "thief",
            "engineer", "necromancer", "elementalist", "mesmer",
        }
        for spec_id, prof in SPEC_TO_PROFESSION.items():
            assert prof in valid_professions, f"{spec_id} maps to invalid profession {prof}"

    def test_each_profession_has_specs(self):
        """Each profession should have at least 4 specs (core + 3 elite)."""
        from collections import Counter
        counts = Counter(SPEC_TO_PROFESSION.values())
        for prof, count in counts.items():
            assert count >= 4, f"{prof} only has {count} specs"


class TestCropScoreboard:
    def test_crop_real_screenshot(self):
        """Cropping a real screenshot should produce a smaller focused region."""
        img = cv2.imread(str(FIXTURES / "scoreboard_real_1.jpg"))
        assert img is not None, "Test fixture scoreboard_real_1.jpg not found"

        h, w = img.shape[:2]
        cropped = _crop_scoreboard_region(img)
        ch, cw = cropped.shape[:2]

        # Crop should be smaller than original
        assert cw < w
        assert ch < h
        # But still contain the scoreboard (reasonable size)
        assert cw > w * 0.5
        assert ch > h * 0.3

    def test_crop_second_screenshot(self):
        """Cropping second real screenshot should work too."""
        img = cv2.imread(str(FIXTURES / "scoreboard_real_2.jpg"))
        assert img is not None, "Test fixture scoreboard_real_2.jpg not found"

        h, w = img.shape[:2]
        cropped = _crop_scoreboard_region(img)
        ch, cw = cropped.shape[:2]

        assert cw < w
        assert ch < h
        assert cw > w * 0.5

    def test_small_image_not_cropped(self):
        """Images that are already small should not be cropped further."""
        small = np.zeros((400, 800, 3), dtype=np.uint8)
        result = _crop_scoreboard_region(small)
        assert result.shape == small.shape

    def test_crop_contains_player_names_region(self):
        """The crop should contain the scoreboard player area (rough check via brightness)."""
        img = cv2.imread(str(FIXTURES / "scoreboard_real_1.jpg"))
        cropped = _crop_scoreboard_region(img)

        # The scoreboard area should have text (bright pixels on dark background)
        gray = cv2.cvtColor(cropped, cv2.COLOR_BGR2GRAY)
        bright_pixels = np.sum(gray > 180)
        total_pixels = gray.size
        bright_ratio = bright_pixels / total_pixels

        # Should have some bright text but not be entirely bright
        assert bright_ratio > 0.005, "Crop appears to have no text"
        assert bright_ratio < 0.5, "Crop appears to be mostly bright (missed the scoreboard)"


class TestEncodeImage:
    def test_encode_produces_valid_base64(self):
        """_encode_image should produce valid base64 JPEG data."""
        img = np.zeros((100, 200, 3), dtype=np.uint8)
        b64 = _encode_image(img)

        # Should be valid base64
        decoded = base64.b64decode(b64)
        assert len(decoded) > 0

        # Should be valid JPEG (starts with FFD8)
        assert decoded[:2] == b'\xff\xd8'

    def test_encode_preserves_dimensions(self):
        """Encoded image should decode back to same dimensions."""
        img = np.zeros((100, 200, 3), dtype=np.uint8)
        cv2.rectangle(img, (10, 10), (190, 90), (255, 255, 255), -1)

        b64 = _encode_image(img)
        decoded = base64.b64decode(b64)
        arr = np.frombuffer(decoded, dtype=np.uint8)
        result = cv2.imdecode(arr, cv2.IMREAD_COLOR)

        assert result.shape[:2] == img.shape[:2]


# ── Integration tests (need ANTHROPIC_API_KEY) ──


@needs_api_key
class TestLLMParsingReal1:
    """Integration tests against real screenshot 1.

    Red: The Schoolmasters vs Blue: Thermal Runaways
    """

    @pytest.fixture(autouse=True)
    def _check_fixtures(self):
        assert (FIXTURES / "scoreboard_real_1.jpg").exists(), "Missing test fixture"

    async def test_returns_both_teams(self):
        """Should return 5 players per team."""
        b64 = _load_b64("scoreboard_real_1.jpg")
        result = await parse_scoreboard_hybrid(b64, "image/jpeg")

        assert "error" not in result, f"Parse failed: {result.get('error')}"
        assert len(result["red_team"]) == 5
        assert len(result["blue_team"]) == 5
        assert result["user_team_color"] in ("red", "blue")

    async def test_player_names(self):
        """Player names should match expected."""
        b64 = _load_b64("scoreboard_real_1.jpg")
        result = await parse_scoreboard_hybrid(b64, "image/jpeg")

        red_names = [p["character_name"] for p in result["red_team"]]
        blue_names = [p["character_name"] for p in result["blue_team"]]

        for expected in EXPECTED_REAL_1["red_team_names"]:
            assert _fuzzy_name_match(expected, red_names), (
                f"Expected red team name '{expected}' not found in {red_names}"
            )
        for expected in EXPECTED_REAL_1["blue_team_names"]:
            assert _fuzzy_name_match(expected, blue_names), (
                f"Expected blue team name '{expected}' not found in {blue_names}"
            )

    async def test_specs_are_valid(self):
        """All spec IDs should be valid."""
        b64 = _load_b64("scoreboard_real_1.jpg")
        result = await parse_scoreboard_hybrid(b64, "image/jpeg")

        for team in ("red_team", "blue_team"):
            for player in result[team]:
                spec = player["spec_id"]
                if spec is not None:
                    assert spec in SPEC_TO_PROFESSION, f"Invalid spec_id: {spec}"
                    assert player["profession_id"] == SPEC_TO_PROFESSION[spec]

    async def test_has_user(self):
        """Exactly one player should be marked as user."""
        b64 = _load_b64("scoreboard_real_1.jpg")
        result = await parse_scoreboard_hybrid(b64, "image/jpeg")

        all_players = result["red_team"] + result["blue_team"]
        user_players = [p for p in all_players if p.get("is_user")]
        assert len(user_players) == 1, f"Expected 1 user, got {len(user_players)}"


@needs_api_key
class TestLLMParsingReal2:
    """Integration tests against real screenshot 2.

    Red: Tyrian Swarm vs Blue: Dragon's Despair
    """

    @pytest.fixture(autouse=True)
    def _check_fixtures(self):
        assert (FIXTURES / "scoreboard_real_2.jpg").exists(), "Missing test fixture"

    async def test_returns_both_teams(self):
        """Should return 5 players per team."""
        b64 = _load_b64("scoreboard_real_2.jpg")
        result = await parse_scoreboard_hybrid(b64, "image/jpeg")

        assert "error" not in result, f"Parse failed: {result.get('error')}"
        assert len(result["red_team"]) == 5
        assert len(result["blue_team"]) == 5
        assert result["user_team_color"] in ("red", "blue")

    async def test_player_names(self):
        """Player names should match expected."""
        b64 = _load_b64("scoreboard_real_2.jpg")
        result = await parse_scoreboard_hybrid(b64, "image/jpeg")

        red_names = [p["character_name"] for p in result["red_team"]]
        blue_names = [p["character_name"] for p in result["blue_team"]]

        for expected in EXPECTED_REAL_2["red_team_names"]:
            assert _fuzzy_name_match(expected, red_names), (
                f"Expected red team name '{expected}' not found in {red_names}"
            )
        for expected in EXPECTED_REAL_2["blue_team_names"]:
            assert _fuzzy_name_match(expected, blue_names), (
                f"Expected blue team name '{expected}' not found in {blue_names}"
            )

    async def test_specs_are_valid(self):
        """All spec IDs should be valid."""
        b64 = _load_b64("scoreboard_real_2.jpg")
        result = await parse_scoreboard_hybrid(b64, "image/jpeg")

        for team in ("red_team", "blue_team"):
            for player in result[team]:
                spec = player["spec_id"]
                if spec is not None:
                    assert spec in SPEC_TO_PROFESSION, f"Invalid spec_id: {spec}"

    async def test_has_user(self):
        """Exactly one player should be marked as user."""
        b64 = _load_b64("scoreboard_real_2.jpg")
        result = await parse_scoreboard_hybrid(b64, "image/jpeg")

        all_players = result["red_team"] + result["blue_team"]
        user_players = [p for p in all_players if p.get("is_user")]
        assert len(user_players) == 1, f"Expected 1 user, got {len(user_players)}"


@needs_api_key
class TestResponseFormat:
    """Verify response format matches frontend contract."""

    async def test_response_format_matches_frontend_contract(self):
        """Response format must match what the frontend expects."""
        b64 = _load_b64("scoreboard_real_1.jpg")
        result = await parse_scoreboard_hybrid(b64, "image/jpeg")

        # Top-level keys
        assert "red_team" in result
        assert "blue_team" in result
        assert "user_team_color" in result

        # Player object shape
        for player in result["red_team"] + result["blue_team"]:
            assert "character_name" in player
            assert "profession_id" in player
            assert "spec_id" in player
            assert "is_user" in player
            assert isinstance(player["character_name"], str)
            assert isinstance(player["is_user"], bool)


# ── Helpers ──


def _load_b64(filename: str) -> str:
    """Load a test fixture image as base64."""
    path = FIXTURES / filename
    return base64.b64encode(path.read_bytes()).decode()


def _fuzzy_name_match(expected: str, actual_names: list[str], threshold: float = 0.7) -> bool:
    """Check if expected name roughly matches any name in the list.

    Uses character overlap ratio to handle minor OCR errors.
    Threshold is 0.7 — real screenshots should be cleaner than YouTube captures.
    """
    expected_lower = expected.lower().replace(" ", "")
    for name in actual_names:
        name_lower = name.lower().replace(" ", "")
        if expected_lower == name_lower:
            return True
        # Check if most characters match (order-independent overlap)
        if len(expected_lower) == 0 or len(name_lower) == 0:
            continue
        common = sum(1 for c in expected_lower if c in name_lower)
        ratio = common / max(len(expected_lower), len(name_lower))
        if ratio >= threshold:
            return True
    return False
