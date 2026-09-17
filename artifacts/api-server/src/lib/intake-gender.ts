/**
 * Gender inferred from the candidate's first name.
 *
 * Asking "are you male or female?" on a recruitment call is jarring and the
 * client's own recruiters never do it — they read it off the name. This does
 * the same thing, and returns `null` whenever the name is genuinely ambiguous
 * (Kiran, Jyoti, Harper) so the field is simply left blank rather than guessed.
 */

type Gender = "MALE" | "FEMALE";

const MALE_NAMES = new Set([
  "aarav", "aayan", "abhay", "abhijit", "abhilash", "abhinav", "abhishek", "aditya", "advait",
  "ajay", "ajith", "akash", "akhil", "alok", "aman", "amar", "amit", "amol", "anand", "aniket",
  "anil", "animesh", "anirudh", "ankit", "ankur", "anoop", "anshul", "antony", "anuj", "arav",
  "arjun", "arun", "aryan", "ashish", "ashok", "ashutosh", "ashwin", "atul", "avinash", "ayush",
  "balaji", "basavaraj", "bharat", "bhaskar", "bhavesh", "bibek", "bijay", "biju", "binod",
  "chaitanya", "chandan", "chetan", "chirag", "daniel", "darshan", "deepak", "dev", "devendra",
  "dhanush", "dheeraj", "dhruv", "dinesh", "divyesh", "gaurav", "george", "girish", "gokul",
  "gopal", "govind", "guru", "harish", "harsh", "harshad", "hemant", "hitesh", "imran", "indrajit",
  "irfan", "jagdish", "jai", "james", "jatin", "jay", "jayanth", "jeevan", "john", "joseph",
  "kabir", "kalyan", "kamal", "karan", "karthik", "karthikeyan", "kaushik", "keshav", "kevin",
  "kiran kumar", "kishore", "krishna", "kunal", "lakshman", "lokesh", "madhav", "mahesh", "manan",
  "manish", "manoj", "mani", "manu", "mayank", "michael", "mithun", "mohammad", "mohammed",
  "mohan", "mohit", "mukesh", "murali", "nagaraj", "naveen", "navin", "neeraj", "nikhil", "nilesh",
  "nirmal", "nishant", "nitin", "noel", "omkar", "pankaj", "paras", "parth", "paul", "pavan",
  "peter", "prabhu", "pradeep", "prajwal", "prakash", "pranav", "prasad", "prashant", "prateek",
  "pratik", "praveen", "prem", "puneet", "radhakrishnan", "raghav", "rahul", "raj", "rajan",
  "rajesh", "rajiv", "rakesh", "ram", "raman", "ramesh", "ranjith", "ratan", "ravi", "rehan",
  "rishabh", "rishi", "ritesh", "robert", "rohan", "rohit", "ronald", "roshan", "sachin", "sagar",
  "sahil", "saiful", "sameer", "samuel", "sandeep", "sanjay", "sankar", "santhosh", "santosh",
  "sarath", "sarvesh", "satish", "saurabh", "shailesh", "shankar", "sharath", "shashank", "shaun",
  "shiva", "shrikant", "shubham", "shubh", "siddharth", "soham", "sourav", "srinivas", "stephen",
  "subhash", "sudhir", "sujith", "suman", "sumit", "sunder", "sundar", "sunil", "sunny", "suraj",
  "suresh", "surya", "sushant", "swapnil", "tarun", "tejas", "thomas", "tushar", "udit", "ujjwal",
  "umesh", "vaibhav", "varun", "vasanth", "venkat", "venkatesh", "vicky", "vignesh", "vijay",
  "vikas", "vikram", "vimal", "vinay", "vinod", "vipul", "viraj", "vishal", "vishnu", "vivek",
  "william", "yash", "yogesh", "yuvraj", "zaid",
]);

const FEMALE_NAMES = new Set([
  "aaradhya", "aarti", "aditi", "afreen", "aishwarya", "akanksha", "akshara", "alisha", "amala",
  "amrita", "ananya", "anita", "anjali", "anjana", "ankita", "anna", "anu", "anupama", "anuradha",
  "anushka", "aparna", "archana", "arpita", "aruna", "arya", "asha", "ashwini", "asma", "ayesha",
  "bhagya", "bhavana", "bhavya", "bhumika", "bindu", "chaitra", "chandana", "charu", "chitra",
  "deepa", "deepika", "deepthi", "devi", "dhanya", "dimple", "disha", "divya", "elizabeth",
  "esther", "farah", "fatima", "gayathri", "geetha", "gowri", "grace", "harini", "harshitha",
  "hema", "indu", "ishita", "jaya", "jennifer", "jessica", "jyothi", "kalpana", "kamala",
  "kanchana", "kanika", "kavita", "kavitha", "kavya", "keerthana", "keerthi", "khushi", "komal",
  "kruthika", "lakshmi", "lalitha", "latha", "lavanya", "leela", "lekha", "madhavi", "madhuri",
  "mahalakshmi", "mamatha", "manisha", "manjula", "maria", "mary", "meena", "meenakshi", "megha",
  "meghana", "mekhala", "monika", "mounika", "mrinalini", "nandini", "namrata", "nazia", "neelam",
  "neetu", "neha", "netra", "nidhi", "nikitha", "nilima", "nisha", "nithya", "nivedita", "padma",
  "pallavi", "parvathi", "pavithra", "payal", "pooja", "poornima", "prabha", "pragya", "pranitha",
  "prathibha", "preethi", "prerna", "priya", "priyanka", "pushpa", "radha", "radhika", "ragini",
  "rakhi", "ramya", "rani", "rashmi", "rekha", "renu", "reshma", "revathi", "rhea", "riya",
  "roopa", "ruchi", "rupali", "sabina", "sadhana", "sahana", "sakshi", "samantha", "sandhya",
  "sangeetha", "sanjana", "sara", "saranya", "sarika", "sarita", "saroja", "sathya", "savita",
  "seema", "shalini", "shanti", "sharmila", "sheela", "shilpa", "shobha", "shreya", "shruti",
  "shubhangi", "shwetha", "sindhu", "smitha", "sneha", "sonal", "sonia", "soniya", "soumya",
  "sowmya", "sridevi", "srilatha", "sruthi", "subhashini", "sudha", "suhani", "sujatha", "sukanya",
  "suma", "sumathi", "sunanda", "sunita", "supriya", "surekha", "susan", "sushma", "swapna",
  "swathi", "sweta", "tanvi", "tanya", "tara", "tejaswini", "trisha", "usha", "vaishnavi",
  "vandana", "vani", "varsha", "vasanthi", "veena", "vidya", "vijaya", "vinitha", "vidhya",
  "yamini", "yashoda", "zainab", "zoya",
]);

/** Endings that are reliable in Indian names once the lookup misses. */
const FEMALE_SUFFIXES = ["amma", "eshwari", "wari", "priya", "lata", "latha", "bai", "devi"];
const MALE_SUFFIXES = ["endra", "eshwar", "raj", "deep", "veer", "nath", "pal"];

function normalize(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Best-effort gender for a name. Returns `null` when the name is unknown or
 * unisex — the caller should leave the field blank rather than pick a side.
 */
export function inferGenderFromName(rawName: string | null | undefined): Gender | null {
  const cleaned = normalize(String(rawName ?? ""));
  if (!cleaned) return null;

  // Titles settle it outright and beat any name lookup.
  const titled = cleaned.match(/^(mr|shri|sri|master)\b/) ? "MALE"
    : cleaned.match(/^(mrs|ms|miss|smt|smth)\b/) ? "FEMALE"
    : null;
  if (titled) return titled;

  const parts = cleaned.split(" ").filter((p) => p.length > 1);
  if (parts.length === 0) return null;

  for (const part of parts) {
    const male = MALE_NAMES.has(part);
    const female = FEMALE_NAMES.has(part);
    // Present in both lists (or neither) is exactly the ambiguity we refuse.
    if (male && !female) return "MALE";
    if (female && !male) return "FEMALE";
  }

  const first = parts[0]!;
  if (first.length >= 5) {
    for (const suffix of FEMALE_SUFFIXES) if (first.endsWith(suffix)) return "FEMALE";
    for (const suffix of MALE_SUFFIXES) if (first.endsWith(suffix)) return "MALE";
  }
  return null;
}
