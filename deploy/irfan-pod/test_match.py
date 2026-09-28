"""Same cases as jobshop-match.test.ts."""
import unittest

from match import empty_profile, match_profile

VOICE = {
    "first_name": "Shiva",
    "city": "Bangalore",
    "birth_year": 2000,
    "tenth_year": 2015,
    "twelfth_year": 2017,
    "degree_year": 2021,
    "qualification": "Graduate",
    "experience_years": 2,
    "skills": "international voice, customer care",
    "shift": "US shift",
    "expected_monthly_salary": 30000,
    "english": "Good",
}


class MatchTests(unittest.TestCase):
    def test_partial_profile_names_no_job(self):
        first = match_profile(empty_profile(), {"city": "Bengaluru", "first_name": "Shiva"})
        self.assertIn("PROFILE_SAVED", first["speech"])
        self.assertIn("Do not name a job", first["speech"])
        self.assertEqual(first["matches"], [])
        self.assertEqual(first["profile"]["city"], "Bengaluru")
        self.assertEqual(first["profile"]["firstName"], "Shiva")

    def test_pitches_us_voice_and_skips_uk_and_fresher(self):
        result = match_profile(empty_profile(), VOICE)
        ids = [row["jobId"] for row in result["matches"]]
        self.assertIn("cnx-us-care-manyata", ids)
        self.assertNotIn("startek-uk-bellandur", ids)
        self.assertNotIn("cnx-fresher-whitefield", ids)
        self.assertIn("Concentrix", result["speech"])
        self.assertIn("US shift", result["speech"])
        self.assertIn("₹28,000 to ₹38,000", result["speech"])
        self.assertNotIn("Java Spring", result["speech"])
        self.assertIn("Speak only these jobs", result["speech"])

    def test_keeps_earlier_answers(self):
        first = match_profile(empty_profile(), {"city": "Chennai", "birth_year": 2000})
        second = match_profile(first["profile"], VOICE)
        self.assertEqual(second["profile"]["birthYear"], 2000)
        self.assertEqual(second["profile"]["city"], "Bangalore")
        self.assertGreater(len(second["matches"]), 0)

    def test_late_tenth(self):
        result = match_profile(empty_profile(), {**VOICE, "tenth_year": 2018})
        self.assertIn("10th at age 18", result["speech"])

    def test_twelfth_gap(self):
        result = match_profile(empty_profile(), {**VOICE, "tenth_year": 2015, "twelfth_year": 2019})
        self.assertIn("12th after 10th: 2 years longer", result["speech"])

    def test_outside_bangalore(self):
        result = match_profile(empty_profile(), {**VOICE, "city": "Delhi"})
        self.assertEqual(result["matches"], [])
        self.assertIn("NO_OPENING", result["speech"])


if __name__ == "__main__":
    unittest.main()
