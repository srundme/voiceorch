"""The intake program picks the next question and the disposition."""
import unittest

from intake import apply_save, empty_screen, infer_gender, step


def fill(screen: dict, **patch) -> dict:
    return apply_save(screen, patch)


def ready(**extra) -> dict:
    base = {
        "first_name": "Karthik",
        "last_name": "S",
        "email": "karthik@example.com",
        "date_of_birth": "15 March 2000",
        "work_status": "fresher",
        "city": "Chennai",
        "job_city": "Bangalore",
        "pincode": "600042",
        "skill_role": "voice executive",
        "skill": "international",
        "industry": "bpo",
        "qualification": "graduate",
        "shift": "us",
        "dnd": "no",
        "english": "Good",
        "exam_years_asked": "yes",
        "tenth_year": "2016",
        "twelfth_year": "2018",
        "degree_year": "2021",
    }
    base.update(extra)
    return fill(empty_screen("919900000000"), **base)


class IntakeTests(unittest.TestCase):
    def test_starts_with_the_first_name(self):
        self.assertIn("first name", step(empty_screen())["ask"])

    def test_gender_comes_from_the_name(self):
        self.assertEqual(infer_gender("Priya"), "Female")
        self.assertEqual(infer_gender("Rahul"), "Male")
        screen = fill(empty_screen(), first_name="Priya")
        self.assertEqual(screen["gender"], "Female")
        self.assertIn("surname", step(screen)["ask"])

    def test_fresher_skips_company_count(self):
        screen = fill(empty_screen(), first_name="Rahul", last_name="K", email="a@b.com", date_of_birth="1 Jan 2001", work_status="fresher")
        self.assertEqual(screen["total_companies"], "0")
        self.assertIn("city", step(screen)["ask"])

    def test_outside_bangalore_asks_relocate_then_closes(self):
        screen = ready()
        self.assertIn("relocate", step(screen)["ask"].lower())
        screen = fill(screen, will_relocate="no")
        closed = step(screen)
        self.assertEqual(closed["disposition"], "out_station_candidate")
        self.assertFalse(closed["pitch"])

    def test_bangalore_can_be_lined_up(self):
        screen = ready(city="Bangalore", pincode="560001")
        lined = step(screen)
        self.assertEqual(lined["disposition"], "line_up_scheduled")
        self.assertTrue(lined["pitch"])

    def test_poor_english_on_international_asks_for_domestic(self):
        screen = ready(city="Bangalore", pincode="560001", english="Poor")
        self.assertIn("domestic", step(screen)["ask"].lower())
        closed = step(fill(screen, skill_down="no"))
        self.assertEqual(closed["disposition"], "poor_communication")

    def test_poor_english_on_domestic_can_still_line_up(self):
        screen = ready(city="Bangalore", pincode="560001", skill="domestic", english="Poor")
        self.assertTrue(step(screen)["pitch"])

    def test_age_forty_is_not_an_automatic_cutoff(self):
        jobs = [{"minAge": 18, "maxAge": 40, "salaryMax": 30000}]
        screen = ready(
            city="Bangalore",
            pincode="560001",
            date_of_birth="1 January 1986",
            tenth_year="2002",
            twelfth_year="2004",
            degree_year="2007",
        )
        self.assertTrue(step(screen, jobs)["pitch"])

    def test_age_outside_every_stated_range_closes(self):
        jobs = [{"minAge": 18, "maxAge": 28, "salaryMax": 30000}]
        screen = ready(city="Bangalore", pincode="560001", date_of_birth="1 January 1980")
        self.assertEqual(step(screen, jobs)["disposition"], "age_limit")

    def test_education_gap_asks_the_reason_then_files(self):
        screen = ready(city="Bangalore", pincode="560001", tenth_year="2019")
        self.assertIn("gap", step(screen)["ask"].lower())
        closed = step(fill(screen, gap_reason="family"))
        self.assertEqual(closed["disposition"], "career_gap")

    def test_pincode_collects_across_turns(self):
        screen = ready(city="Bangalore", pincode="five double one")
        self.assertEqual(screen["pincode_partial"], "511")
        self.assertIn("511", step(screen)["ask"])
        screen = fill(screen, pincode="seven one two")
        self.assertEqual(screen["pincode"], "511712")

    def test_pincode_can_be_left_for_later(self):
        screen = ready(city="Bangalore", pincode="I will share it later")
        self.assertEqual(screen["pincode_later"], "yes")
        self.assertTrue(step(screen)["pitch"])

    def test_bangle_is_bangalore(self):
        self.assertEqual(fill(empty_screen(), job_city="Bangle")["job_city"], "Bangalore")

    def test_do_not_disturb_is_not_a_disposition(self):
        screen = fill(empty_screen(), dnd="yes")
        current = step(screen)
        self.assertEqual(current["disposition"], "")
        self.assertIn("blocked", current["ask"])
        self.assertFalse(current["pitch"])


if __name__ == "__main__":
    unittest.main()
