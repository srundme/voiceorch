"""A job match waits until this call has asked the screen."""
import unittest

from screen import screen_gap


class ScreenTests(unittest.TestCase):
    def test_name_only_asks_for_the_job(self):
        turns = [
            {"who": "Sruthi", "text": "Hello, this is Sruthi from Jobshop. Am I speaking with Karthik?"},
            {"who": "Caller", "text": "Yes, Karthikeyan."},
        ]
        self.assertIn("what kind of job", screen_gap(turns))

    def test_full_screen_can_match(self):
        said = [
            "What kind of job are you looking for?",
            "What is your 6-digit pincode?",
            "Okay to continue with me?",
            "Do you want international voice, domestic voice, or non-voice?",
            "Are you a fresher or experienced?",
            "What is your year of birth?",
            "Which shift do you want?",
            "Can you travel to the site?",
            "What salary do you expect?",
            "What is your notice period?",
            "Which companies have you already attended?",
        ]
        turns = [{"who": "Sruthi", "text": line} for line in said]
        self.assertIsNone(screen_gap(turns))


if __name__ == "__main__":
    unittest.main()
