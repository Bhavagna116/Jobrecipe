/**
 * Rewrite terse, note-style reasoning questions into full exam questions.
 *
 * The reasoning bank was originally seeded with compressed notes such as:
 *   "1,3,6,10,15,?"                    -> full number-series question
 *   "Book now for discount. Assumption?" -> full assumption question
 *   "100:60 cricket,50 football,30 both. Only cricket?"
 *
 * These are valid data but read as malformed to candidates. This script
 * replaces the question text, options and explanation with full sentences,
 * and corrects answer keys that did not match the stated rule.
 *
 * It updates:
 *   1. backend/data/questions/reasoning.json (the seed source)
 *   2. the `questions` table (the live bank)
 *   3. the `assessment_questions` table (per-assessment snapshots)
 *
 * Idempotent: re-running writes the same values.
 *
 * Usage: node scripts/fix_terse_reasoning_questions.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/db/pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JSON_PATH = path.resolve(__dirname, '../data/questions/reasoning.json');

const REWRITES = {
  // ── Number Series ────────────────────────────────────────────────────────
  'rea-0011': {
    question: 'What is the next number in the series: 1, 3, 6, 10, 15, ?',
    options: ['21', '20', '22', '23'],
    correctAnswer: 'A',
    explanation:
      'The differences between consecutive terms increase by 1: +2, +3, +4, +5, +6. Therefore, 15 + 6 = 21.'
  },
  'rea-0012': {
    question: 'What is the next number in the series: 2, 5, 10, 17, 26, 37, ?',
    options: ['48', '49', '51', '50'],
    correctAnswer: 'D',
    explanation:
      'Each term follows the pattern n² + 1: 1²+1=2, 2²+1=5, 3²+1=10, 4²+1=17, 5²+1=26, 6²+1=37, so 7²+1=50.'
  },
  'rea-0013': {
    question: 'Which number should replace the question mark: 1, 4, 9, 16, ?, 36?',
    options: ['20', '30', '25', '32'],
    correctAnswer: 'C',
    explanation:
      'The series consists of consecutive perfect squares: 1², 2², 3², 4², 5², 6². Therefore, the missing term is 5² = 25.'
  },
  'rea-0014': {
    question: 'What is the next number in the Fibonacci series: 1, 1, 2, 3, 5, 8, 13, ?',
    options: ['18', '21', '20', '22'],
    correctAnswer: 'B',
    explanation: 'Each term is the sum of the two preceding terms: 8 + 13 = 21.'
  },

  // ── Letter & Symbol Series ───────────────────────────────────────────────
  'rea-0015': {
    question: 'Which letter comes next in the series: A, C, E, G, ?',
    options: ['I', 'H', 'J', 'K'],
    correctAnswer: 'A',
    explanation: 'Each letter moves two places forward in the alphabet: A→C→E→G→I.'
  },
  'rea-0016': {
    question: 'Which letter comes next in the series: Z, X, V, T, R, ?',
    options: ['Q', 'S', 'O', 'P'],
    correctAnswer: 'D',
    explanation: 'Each letter moves two places backward in the alphabet: Z→X→V→T→R→P.'
  },
  'rea-0017': {
    question: 'Which letter comes next in the series: B, D, G, K, P, ?',
    options: ['T', 'U', 'V', 'W'],
    correctAnswer: 'C',
    explanation:
      'The gaps between letters increase by one each time: +2, +3, +4, +5, +6. Thus P + 6 = V.'
  },
  'rea-0018': {
    question: 'Which letter comes next in the series: A, Z, B, Y, C, X, ?',
    options: ['W', 'D', 'E', 'V'],
    correctAnswer: 'B',
    explanation:
      'The series alternates between two sequences: A, B, C, D, ... moving forward and Z, Y, X, ... moving backward. The next term is D.'
  },
  'rea-0019': {
    question: 'Which letter comes next in the series: C, F, I, L, O, ?',
    options: ['R', 'Q', 'S', 'P'],
    correctAnswer: 'A',
    explanation: 'Each letter moves three places forward in the alphabet: C→F→I→L→O→R.'
  },
  'rea-0020': {
    question: 'Which pair comes next in the series: AZ, BY, CX, DW, ?',
    options: ['EV', 'EU', 'FV', 'FW'],
    correctAnswer: 'A',
    explanation:
      'The first letter moves forward (A, B, C, D, E) while the second letter moves backward (Z, Y, X, W, V). Therefore, the next pair is EV.'
  },
  'rea-0021': {
    question: 'Which letter comes next in the series: J, L, N, P, ?',
    options: ['Q', 'S', 'T', 'R'],
    correctAnswer: 'D',
    explanation: 'Each letter moves two places forward in the alphabet: J→L→N→P→R.'
  },

  // ── Analogy ──────────────────────────────────────────────────────────────
  'rea-0022': {
    question: 'Complete the analogy: Book : Pages :: Pen : ?',
    options: ['Paper', 'Cap', 'Ink', 'Nib'],
    correctAnswer: 'C',
    explanation: 'A book is made up of pages, just as a pen contains ink.'
  },
  'rea-0023': {
    question: 'Complete the analogy: Cat : Kitten :: Dog : ?',
    options: ['Cub', 'Pup', 'Calf', 'Foal'],
    correctAnswer: 'B',
    explanation: 'A kitten is the young one of a cat, just as a pup is the young one of a dog.'
  },
  'rea-0024': {
    question: 'Complete the analogy: Doctor : Hospital :: Teacher : ?',
    options: ['School', 'Office', 'Clinic', 'College'],
    correctAnswer: 'A',
    explanation: 'A doctor works in a hospital, just as a teacher works in a school.'
  },
  'rea-0025': {
    question: 'Complete the analogy: Eye : Sight :: Ear : ?',
    options: ['Hear', 'Listening', 'Audition', 'Sound'],
    correctAnswer: 'D',
    explanation:
      'The eye is the sense organ for sight, just as the ear is the sense organ for sound.'
  },
  'rea-0026': {
    question: 'Complete the analogy: Man : Biography :: Nation : ?',
    options: ['Geography', 'Leader', 'History', 'Flag'],
    correctAnswer: 'C',
    explanation:
      'A biography records the life of a man, just as history records the life of a nation.'
  },
  'rea-0027': {
    question: 'Complete the analogy: Clock : Time :: Thermometer : ?',
    options: ['Heat', 'Temperature', 'Mercury', 'Degree'],
    correctAnswer: 'B',
    explanation: 'A clock measures time, just as a thermometer measures temperature.'
  },
  'rea-0028': {
    question: 'Complete the analogy: Wheat : Flour :: Sugarcane : ?',
    options: ['Sugar', 'Juice', 'Syrup', 'Molasses'],
    correctAnswer: 'A',
    explanation: 'Flour is obtained from wheat, just as sugar is obtained from sugarcane.'
  },

  // ── Classification (Odd One Out) ─────────────────────────────────────────
  'rea-0029': {
    question: 'Which of the following is the odd one out: Apple, Orange, Banana, Carrot?',
    options: ['Apple', 'Orange', 'Banana', 'Carrot'],
    correctAnswer: 'D',
    explanation: 'Apple, orange and banana are fruits, whereas carrot is a vegetable.'
  },
  'rea-0030': {
    question: 'Which of the following is the odd one out: Pen, Pencil, Eraser, Notebook?',
    options: ['Pen', 'Pencil', 'Eraser', 'Notebook'],
    correctAnswer: 'D',
    explanation:
      'A pen, pencil and eraser are individual writing or correction tools, whereas a notebook is a bound collection of pages.'
  },
  'rea-0031': {
    question: 'Which of the following is the odd one out: Cow, Dog, Cat, Tiger?',
    options: ['Dog', 'Cat', 'Cow', 'Tiger'],
    correctAnswer: 'C',
    explanation: 'The cow is a herbivore, whereas the dog, cat and tiger are carnivores.'
  },
  'rea-0032': {
    question: 'Which of the following is the odd one out: Monday, Tuesday, Wednesday, Sunday?',
    options: ['Mon', 'Sun', 'Tue', 'Wed'],
    correctAnswer: 'B',
    explanation:
      'Sunday is a weekend day, whereas Monday, Tuesday and Wednesday are weekdays.'
  },
  'rea-0033': {
    question: 'Which of the following is the odd one out: 2, 4, 6, 9?',
    options: ['9', '2', '4', '6'],
    correctAnswer: 'A',
    explanation: '9 is an odd number, whereas 2, 4 and 6 are even numbers.'
  },
  'rea-0034': {
    question: 'Which of the following is the odd one out: Circle, Square, Triangle, Rectangle?',
    options: ['Square', 'Circle', 'Triangle', 'Rectangle'],
    correctAnswer: 'B',
    explanation:
      'A circle has no straight sides, whereas a square, triangle and rectangle are polygons with straight sides.'
  },
  'rea-0035': {
    question:
      'Which of the following is the odd one out: Copper (Cu), Iron (Fe), Gold (Au), Plastic?',
    options: ['Cu', 'Fe', 'Plastic', 'Au'],
    correctAnswer: 'C',
    explanation: 'Copper, iron and gold are metals, whereas plastic is a non-metal.'
  },

  // ── Coding & Decoding ────────────────────────────────────────────────────
  'rea-0036': {
    question: 'If CAT is coded as DBU, how is DOG coded in the same code?',
    options: ['DPH', 'EOF', 'EOG', 'EPH'],
    correctAnswer: 'D',
    explanation:
      'Each letter is shifted one place forward: C→D, A→B, T→U. Applying the same rule, D→E, O→P, G→H, so DOG becomes EPH.'
  },
  'rea-0037': {
    question: 'If APPLE is coded as BQQMF, how is ORANGE coded in the same code?',
    options: ['PSBOHF', 'PSBOIF', 'PTBOHF', 'PRBOHF'],
    correctAnswer: 'A',
    explanation:
      'Each letter is shifted one place forward: O→P, R→S, A→B, N→O, G→H, E→F, so ORANGE becomes PSBOHF.'
  },
  'rea-0038': {
    question: 'If ROAD is coded as URDG, how is SWAN coded in the same code?',
    options: ['UXDQ', 'VYDQ', 'VZCP', 'VZDQ'],
    correctAnswer: 'D',
    explanation:
      'Each letter is shifted three places forward: S→V, W→Z, A→D, N→Q, so SWAN becomes VZDQ.'
  },
  'rea-0039': {
    question: 'If FISH is coded as GJTI, how is BIRD coded in the same code?',
    options: ['CKSE', 'CJTF', 'CJSE', 'DKSE'],
    correctAnswer: 'C',
    explanation:
      'Each letter is shifted one place forward: B→C, I→J, R→S, D→E, so BIRD becomes CJSE.'
  },
  'rea-0040': {
    question: 'If CLOCK is coded as DMPDL, how is WATCH coded in the same code?',
    options: ['XBUDI', 'WBUCI', 'XBXDI', 'XBVCH'],
    correctAnswer: 'A',
    explanation:
      'Each letter is shifted one place forward: W→X, A→B, T→U, C→D, H→I, so WATCH becomes XBUDI.'
  },
  'rea-0041': {
    question: 'If TEA is coded as UFB, how is CUP coded in the same code?',
    options: ['DVP', 'DVQ', 'EVQ', 'DUQ'],
    correctAnswer: 'B',
    explanation:
      'Each letter is shifted one place forward: C→D, U→V, P→Q, so CUP becomes DVQ.'
  },
  'rea-0042': {
    question: 'If WATER is coded as YCVGT, how is MILK coded in the same code?',
    options: ['OKNM', 'PKNN', 'OJNM', 'OKML'],
    correctAnswer: 'A',
    explanation:
      'Each letter is shifted two places forward: M→O, I→K, L→N, K→M, so MILK becomes OKNM.'
  },
  'rea-0043': {
    question: 'If TABLE is coded as VCDNG, how is CHAIR coded in the same code?',
    options: ['EJDKT', 'FJCKT', 'EICKT', 'EJCKT'],
    correctAnswer: 'D',
    explanation:
      'Each letter is shifted two places forward: C→E, H→J, A→C, I→K, R→T, so CHAIR becomes EJCKT.'
  },

  // ── Blood Relations ──────────────────────────────────────────────────────
  'rea-0044': {
    question: 'Rita says, "He is the son of my father." How is the man related to Rita?',
    options: ['Uncle', 'Cousin', 'Brother', 'Father'],
    correctAnswer: 'C',
    explanation:
      "The son of Rita's father is either Rita's brother or Rita herself. Since the person is a man, he is Rita's brother."
  },
  'rea-0045': {
    question:
      "A is B's sister, C is B's mother, and D is C's father. How is A related to D?",
    options: ['Daughter', 'Niece', 'Sister', 'Granddaughter'],
    correctAnswer: 'D',
    explanation:
      "C is B's mother, so D, C's father, is B's grandfather. Since A is B's sister, A is also D's granddaughter."
  },
  'rea-0046': {
    question:
      'A man says, "The son of the man in this photograph is the uncle of my son." How is the man in the photograph related to the speaker?',
    options: ['Father', 'Brother', 'Grandfather', 'Uncle'],
    correctAnswer: 'A',
    explanation:
      "The speaker's son's uncle is the speaker's brother. Therefore, the son of the man in the photograph is the speaker's brother, which makes the man in the photograph the speaker's father."
  },
  'rea-0047': {
    question: 'X is the brother of Y, and Y is the sister of Z. How is Z related to X?',
    options: ['Cousin', 'Nephew', 'Niece', 'Sibling'],
    correctAnswer: 'D',
    explanation:
      "X and Y are siblings, and Y and Z are siblings, so X and Z are also siblings. Therefore, Z is X's sibling."
  },
  'rea-0048': {
    question: "A's mother is the only daughter of B's father. How is B related to A?",
    options: ['Uncle', 'Grandfather', 'Father', 'Brother'],
    correctAnswer: 'A',
    explanation:
      "B's father's only daughter is B's sister, who is A's mother. Therefore, B is the brother of A's mother, making B A's maternal uncle."
  },
  'rea-0049': {
    question: "P is Q's brother, R is Q's mother, and S is R's father. How is P related to S?",
    options: ['Great-grandson', 'Grandson', 'Son', 'Nephew'],
    correctAnswer: 'B',
    explanation:
      "R is Q's mother, so S, R's father, is Q's grandfather. Since P is Q's brother, P is also S's grandson."
  },
  'rea-0050': {
    question:
      'A woman says, "The boy is the son of the only daughter of my mother." How is the boy related to the woman?',
    options: ['Brother', 'Son', 'Nephew', 'Cousin'],
    correctAnswer: 'B',
    explanation:
      "The only daughter of the woman's mother is the woman herself. Therefore, the boy is the woman's son."
  },

  // ── Direction Sense ──────────────────────────────────────────────────────
  'rea-0051': {
    question:
      'A person walks 5 km North, turns right and walks 3 km. How far east of the starting point is the person?',
    options: ['3 km East', '5 km North', '3 km West', '4 km North-East'],
    correctAnswer: 'A',
    explanation:
      'Turning right from North makes the person face East, so the person moves 3 km east (and 5 km north) of the starting point.'
  },
  'rea-0052': {
    question:
      'A person walks 4 km North, 3 km East, 4 km South, and then 3 km West. How far is the person from the starting point?',
    options: ['2 km', '4 km', '6 km', '0 km'],
    correctAnswer: 'D',
    explanation:
      'The northward and southward movements cancel out, as do the eastward and westward movements. The person returns to the starting point, so the distance is 0 km.'
  },
  'rea-0053': {
    question:
      'A person is facing East. He turns 90° left, then 180° right, and then 90° left. Which direction is he facing now?',
    options: ['North', 'South', 'East', 'West'],
    correctAnswer: 'C',
    explanation:
      'East → 90° left = North; North → 180° right = South; South → 90° left = East. He is facing East.'
  },
  'rea-0054': {
    question:
      'A person walks 6 km North, turns left and walks 8 km, turns left and walks 6 km, and turns left and walks 8 km. Where does the person end up?',
    options: [
      'At the starting point',
      '1 km from the starting point',
      '2 km from the starting point',
      'Never returns to the starting point'
    ],
    correctAnswer: 'A',
    explanation:
      'The path forms a closed rectangle: 6 km North, 8 km West, 6 km South, and 8 km East. The person returns to the starting point.'
  },

  // ── Order & Ranking ──────────────────────────────────────────────────────
  'rea-0055': {
    question:
      'In a row of people, a person is 5th from the left end and 7th from the right end. How many people are there in the row?',
    options: ['11', '12', '10', '13'],
    correctAnswer: 'A',
    explanation:
      'Total = position from left + position from right − 1 = 5 + 7 − 1 = 11.'
  },
  'rea-0056': {
    question:
      "In a class of 40 students, a student is ranked 3rd from the top. What is the student's rank from the bottom?",
    options: ['37th', '39th', '36th', '38th'],
    correctAnswer: 'D',
    explanation:
      'Rank from the bottom = total students − rank from the top + 1 = 40 − 3 + 1 = 38th.'
  },
  'rea-0057': {
    question: 'If A is taller than B and C is taller than A, who is the tallest?',
    options: ['A', 'B', 'C', 'Equal'],
    correctAnswer: 'C',
    explanation: 'C is taller than A, and A is taller than B, so C is the tallest.'
  },
  'rea-0058': {
    question:
      'Tom is 2nd from the start in a race of 10 runners. What is his position from the end?',
    options: ['8th', '7th', '6th', '9th'],
    correctAnswer: 'D',
    explanation:
      'Position from the end = total runners − position from the start + 1 = 10 − 2 + 1 = 9th.'
  },
  'rea-0059': {
    question:
      'If A is costlier than B, B is costlier than C, C is costlier than D, and D is costlier than E, which item is the third costliest?',
    options: ['C', 'B', 'D', 'E'],
    correctAnswer: 'A',
    explanation:
      'The order from costliest to cheapest is A, B, C, D, E, so C is the third costliest.'
  },
  'rea-0060': {
    question:
      'If P is taller than Q, Q is equal in height to R, and R is taller than S, who is the tallest?',
    options: ['P', 'Q', 'R', 'S'],
    correctAnswer: 'A',
    explanation:
      'P is taller than Q, and Q is equal to R, so P is taller than both Q and R. R is taller than S, so P is the tallest.'
  },

  // ── Seating Arrangement ──────────────────────────────────────────────────
  'rea-0061': {
    question:
      'Four friends A, B, C and D are sitting in a row facing North. A is to the left of B, B is to the left of C, and C is to the left of D. Who is sitting at the right end?',
    options: ['A', 'B', 'C', 'D'],
    correctAnswer: 'D',
    explanation: 'The order from left to right is A, B, C, D, so D is at the right end.'
  },
  'rea-0062': {
    question:
      'Four people A, B, C and D are sitting around a circular table. Without knowing which direction they are facing, who sits to the immediate right of A?',
    options: ['B', 'C', 'Cannot be determined', 'D'],
    correctAnswer: 'C',
    explanation:
      'The immediate right of a person depends on whether the group is facing the centre or facing outward, so it cannot be determined from the given information.'
  },
  'rea-0063': {
    question:
      'Five people P, Q, R, S and T are sitting in a row. Q is between P and R, T is at the left end, and S is at the right end. Who is sitting immediately to the left of S?',
    options: ['T', 'R', 'P', 'Q'],
    correctAnswer: 'B',
    explanation: 'The arrangement is T, P, Q, R, S. Therefore, R is sitting immediately to the left of S.'
  },
  'rea-0064': {
    question:
      'Six people A, B, C, D, E and F are sitting around a circular table facing the centre. A is sitting between B and C. Which of the following could be sitting opposite A?',
    options: ['D', 'B', 'C', 'None of these'],
    correctAnswer: 'A',
    explanation:
      'A is adjacent to both B and C, so neither B nor C can be opposite A. The person opposite A must be one of D, E or F, so D is a possible answer.'
  },
  'rea-0065': {
    question:
      'Five people A, B, C, D and E are sitting in a row. A is to the left of B, B is to the left of C, C is to the left of E, and D is at the extreme right end. Who is sitting in the middle?',
    options: ['B', 'A', 'E', 'C'],
    correctAnswer: 'D',
    explanation:
      'The order from left to right is A, B, C, E, D. Therefore, C is sitting in the middle.'
  },
  'rea-0066': {
    question:
      'Eight people A, B, C, D, E, F, G and H are sitting around a circular table facing the centre in the order A, B, C, D, E, F, G, H. Who is sitting opposite B?',
    options: ['D', 'F', 'E', 'G'],
    correctAnswer: 'B',
    explanation:
      'In an eight-person circular arrangement, the person opposite is four seats away. Starting from B and moving four seats gives F.'
  },
  'rea-0067': {
    question:
      'Six people P, Q, R, S, T and U are sitting in two parallel rows of three, facing each other. P, Q and U sit in one row, while R, S and T sit in the other row. P is opposite R. Who is opposite Q?',
    options: ['T', 'S', 'U', 'Cannot be determined'],
    correctAnswer: 'B',
    explanation:
      'With P opposite R, the remaining positions pair Q with S and U with T. Therefore, S is opposite Q.'
  },

  // ── Syllogism ────────────────────────────────────────────────────────────
  'rea-0068': {
    question: 'All cats are animals. Tom is a cat. Which conclusion follows?',
    options: [
      'Tom is an animal',
      'Tom is not an animal',
      'Tom may or may not be an animal',
      'None of these'
    ],
    correctAnswer: 'A',
    explanation: 'Since all cats are animals and Tom is a cat, Tom must be an animal.'
  },
  'rea-0069': {
    question: 'No birds are fish. Some fish are goldfish. Which conclusion follows?',
    options: [
      'All goldfish are birds',
      'There is no relation between birds and goldfish',
      'All birds are fish',
      'Some goldfish are not birds'
    ],
    correctAnswer: 'D',
    explanation:
      'The goldfish that are fish cannot be birds, because no bird is a fish. Therefore, some goldfish are not birds.'
  },
  'rea-0070': {
    question: 'All A are B and all B are C. Which conclusion follows?',
    options: ['Some A are not C', 'All A are C', 'No A is C', 'Some C are not A'],
    correctAnswer: 'B',
    explanation: 'If every A is a B and every B is a C, then every A must also be a C.'
  },
  'rea-0071': {
    question: 'Some A are B and all B are C. Which conclusion follows?',
    options: ['All A are C', 'No A is C', 'Some A are C', 'None of these'],
    correctAnswer: 'C',
    explanation:
      "The A's that are B are also C, because all B are C. Therefore, some A are C."
  },
  'rea-0072': {
    question: 'No A is B and all B are C. Which conclusion follows?',
    options: ['All C are A', 'No C is A', 'Some A are C', 'Some C are not A'],
    correctAnswer: 'D',
    explanation:
      "Since all B are C and no A is B, the B's that are C cannot be A. Therefore, some C are not A."
  },
  'rea-0073': {
    question: 'Some pens are books and some books are tables. Which conclusion follows?',
    options: [
      'No definite conclusion follows',
      'All pens are tables',
      'No pen is a table',
      'Some pens are tables'
    ],
    correctAnswer: 'A',
    explanation:
      "The two 'some' statements do not establish a definite relationship between pens and tables."
  },
  'rea-0074': {
    question: 'All dogs bark and some animals bark. Which conclusion follows?',
    options: [
      'All dogs are animals',
      'No definite conclusion follows',
      'Some barking animals are dogs',
      'None of these'
    ],
    correctAnswer: 'B',
    explanation:
      'The premises do not establish whether dogs are animals or whether any barking animal is a dog, so no definite conclusion follows.'
  },

  // ── Statement, Assumption & Conclusion ───────────────────────────────────
  'rea-0075': {
    question:
      'An advertisement says, "Use XYZ oil for a longer engine life." Which assumption is implicit in this advertisement?',
    options: [
      'All oils are the same',
      'Engines do not need oil',
      'XYZ oil improves engine life',
      'XYZ oil is the most costly'
    ],
    correctAnswer: 'C',
    explanation: 'The advertisement assumes that using XYZ oil will actually improve engine life.'
  },
  'rea-0076': {
    question:
      'An advertisement says, "Attend our workshop to learn coding." Which assumption is implicit in this advertisement?',
    options: [
      'Coding cannot be learned',
      'There is no need to learn coding',
      'Books are sufficient to learn coding',
      'The workshop teaches coding'
    ],
    correctAnswer: 'D',
    explanation: 'The advertisement assumes that the workshop actually teaches coding.'
  },
  'rea-0077': {
    question:
      'An advertisement says, "Apply early." Which assumption is implicit in this statement?',
    options: [
      'Applying early is considered advantageous',
      'Applying late is better',
      'There are no seats available',
      'Everyone applies late'
    ],
    correctAnswer: 'A',
    explanation:
      'The instruction to apply early assumes that applying early is beneficial or necessary.'
  },
  'rea-0078': {
    question:
      'The government warns people against smoking. Which assumption is implicit in this warning?',
    options: [
      'Smoking is good for health',
      'Smoking is harmful to health',
      'People are unaware of smoking',
      'Smoking is cheap'
    ],
    correctAnswer: 'B',
    explanation: 'A warning against smoking assumes that smoking is harmful.'
  },
  'rea-0079': {
    question:
      'A sign says, "Take this route to save time." Which assumption is implicit in this statement?',
    options: [
      'The route is scenic',
      'There is no traffic on any route',
      'This route is faster than the alternatives',
      'All routes take the same time'
    ],
    correctAnswer: 'C',
    explanation: 'Saving time implies that this route is faster than the other available routes.'
  },
  'rea-0080': {
    question:
      'An advertisement says, "Book now to get a discount." Which assumption is implicit in this statement?',
    options: [
      'There is no demand',
      'Prices will rise later',
      'A discount is actually available',
      'The service is free'
    ],
    correctAnswer: 'C',
    explanation:
      'The advertisement assumes that a discount is genuinely available to those who book now.'
  },

  // ── Logical Deduction ────────────────────────────────────────────────────
  'rea-0081': {
    question: 'All roses are flowers and some flowers fade. Which conclusion follows?',
    options: ['All roses fade', 'No rose fades', 'All flowers are roses', 'Some roses may fade'],
    correctAnswer: 'D',
    explanation:
      'Because some flowers fade and roses are flowers, it is possible that some roses fade, but it is not certain.'
  },
  'rea-0082': {
    question:
      'Only graduates can apply for a post. Tom applied for the post. Which conclusion follows?',
    options: [
      'Tom is a graduate',
      'Tom is not a graduate',
      'Tom may or may not be a graduate',
      'Cannot be determined'
    ],
    correctAnswer: 'A',
    explanation: 'If only graduates can apply and Tom applied, Tom must be a graduate.'
  },
  'rea-0083': {
    question: 'If P is true, then Q is true. P is true. Which conclusion follows?',
    options: ['Q is false', 'Q is true', 'P is false', 'None of these'],
    correctAnswer: 'B',
    explanation: 'This is modus ponens: given P → Q and P, it follows that Q is true.'
  },
  'rea-0084': {
    question: 'If P is true, then Q is true. Q is false. Which conclusion follows?',
    options: ['P is true', 'Q is true', 'P is false', 'None of these'],
    correctAnswer: 'C',
    explanation: 'This is modus tollens: given P → Q and not Q, it follows that P is false.'
  },

  // ── Venn Diagrams ────────────────────────────────────────────────────────
  'rea-0085': {
    question:
      'In a Venn diagram showing doctors, lawyers and women, which region represents women who are both doctors and lawyers?',
    options: [
      'Only doctors',
      'Only women',
      'None of these',
      'Women who are both doctors and lawyers'
    ],
    correctAnswer: 'D',
    explanation:
      'The required region is the intersection of all three circles: doctors, lawyers and women.'
  },
  'rea-0086': {
    question:
      'In a Venn diagram of students, athletes and boys, how is a boy who is both a student and an athlete represented?',
    options: [
      'The region where all three circles intersect',
      'The region where two circles intersect',
      'A single circle only',
      'Outside all three circles'
    ],
    correctAnswer: 'A',
    explanation:
      'A boy who is both a student and an athlete belongs to all three categories, so he is represented by the intersection of all three circles.'
  },
  'rea-0087': {
    question:
      'In a group of 50 people, 30 drink tea, 20 drink coffee, and 10 drink both. How many drink neither tea nor coffee?',
    options: ['20', '10', '0', '5'],
    correctAnswer: 'B',
    explanation:
      'People who drink at least one beverage = 30 + 20 − 10 = 40. Therefore, people who drink neither = 50 − 40 = 10.'
  },
  'rea-0088': {
    question:
      'All singers are dancers and some dancers are actors. Which Venn diagram best represents this relationship?',
    options: [
      'Three separate circles',
      'The actors circle inside the singers circle',
      'The singers circle inside the dancers circle, with the actors circle overlapping the dancers circle',
      'None of these'
    ],
    correctAnswer: 'C',
    explanation:
      'All singers are dancers, so the singers circle lies inside the dancers circle. Some dancers are actors, so the actors circle overlaps the dancers circle.'
  },
  'rea-0089': {
    question:
      'In a group of 100 people, 60 play cricket, 50 play football, and 30 play both. How many play only cricket?',
    options: ['40', '20', '10', '30'],
    correctAnswer: 'D',
    explanation:
      'People who play only cricket = total cricket players − players of both = 60 − 30 = 30.'
  },

  // ── Puzzles ──────────────────────────────────────────────────────────────
  'rea-0090': {
    question:
      'Two fathers and two sons are travelling in a car. What is the minimum number of people in the car?',
    options: ['4', '3', '2', '5'],
    correctAnswer: 'B',
    explanation:
      'The group can consist of a grandfather, his son, and his grandson: the grandfather and father are two fathers, and the father and grandson are two sons.'
  },
  'rea-0091': {
    question: 'A farmer has 17 sheep. All but 9 die. How many sheep are left?',
    options: ['9', '8', '17', '0'],
    correctAnswer: 'A',
    explanation: "'All but 9' means all except 9 die, so 9 sheep are left."
  },
  'rea-0092': {
    question:
      'Five people each shake hands with every other person exactly once. How many handshakes take place in total?',
    options: ['5', '15', '20', '10'],
    correctAnswer: 'D',
    explanation:
      'The number of handshakes is the number of pairs that can be formed from 5 people: 5 × 4 / 2 = 10.'
  },
  'rea-0093': {
    question:
      'A farmer must cross a river with a wolf, a goat and a cabbage. The boat can carry only the farmer and one item at a time. If left alone, the wolf will eat the goat and the goat will eat the cabbage. What should the farmer take across first?',
    options: ['Take wolf', 'Take cabbage', 'Take goat', 'Take all'],
    correctAnswer: 'C',
    explanation:
      'The farmer must take the goat first, because the wolf and cabbage can be left together safely.'
  },
  'rea-0094': {
    question:
      'There are three boxes labelled "Apples", "Oranges" and "Both", but every label is wrong. From which box should you pick one fruit to determine the contents of all three boxes?',
    options: [
      'The box labelled "Apples"',
      'The box labelled "Both"',
      'The box labelled "Oranges"',
      'Any box'
    ],
    correctAnswer: 'B',
    explanation:
      "Since every label is wrong, the box labelled 'Both' must contain only apples or only oranges. Picking from it reveals the contents of all three boxes."
  },
  'rea-0095': {
    question:
      'You have 8 identical-looking balls, one of which is heavier than the rest. Using a balance scale, what is the minimum number of weighings needed to find the heavier ball?',
    options: ['2', '1', '3', '4'],
    correctAnswer: 'A',
    explanation:
      'Divide the balls into groups of 3, 3 and 2. Weigh the two groups of 3; the heavier group contains the heavy ball. A second weighing identifies it. If they balance, the heavy ball is in the group of 2, and one more weighing is needed—so at most 2 weighings.'
  },

  // ── Calendar & Clock ─────────────────────────────────────────────────────
  'rea-0096': {
    question:
      'If 1 January 2000 was a Saturday, what day of the week was 1 January 2001?',
    options: ['Monday', 'Sunday', 'Tuesday', 'Friday'],
    correctAnswer: 'A',
    explanation:
      'The year 2000 was a leap year, so the period from 1 January 2000 to 1 January 2001 contained 366 days, which is 52 weeks and 2 days. Saturday + 2 days = Monday.'
  },
  'rea-0097': {
    question: 'How many days are there in February 2000?',
    options: ['28', '30', '29', '31'],
    correctAnswer: 'C',
    explanation:
      'The year 2000 was a leap year (divisible by 400), so February had 29 days.'
  },
  'rea-0099': {
    question:
      'What is the angle between the hour hand and the minute hand of a clock at 3:15?',
    options: ['7.5°', '0°', '15°', '22.5°'],
    correctAnswer: 'A',
    explanation:
      'At 3:15, the minute hand is at 90° and the hour hand is at 3 × 30° + 15 × 0.5° = 97.5°. The difference is 97.5° − 90° = 7.5°.'
  },
  'rea-0100': {
    question:
      'A clock gains 2 minutes every hour. If it is set correctly at noon, what time will the clock show at 6 pm?',
    options: ['6:00 pm', '6:12 pm', '5:48 pm', '6:10 pm'],
    correctAnswer: 'B',
    explanation:
      'In 6 real hours, the clock gains 6 × 2 = 12 minutes. Therefore, at 6 pm it will show 6:12 pm.'
  }
};

const applyToJson = () => {
  const doc = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
  const questions = doc.questions || doc;
  let changed = 0;

  for (const question of questions) {
    const rewrite = REWRITES[question.id];
    if (!rewrite) continue;

    question.question = rewrite.question;
    question.options = rewrite.options;
    question.correctAnswer = rewrite.correctAnswer;
    question.explanation = rewrite.explanation;
    changed += 1;
  }

  fs.writeFileSync(JSON_PATH, `${JSON.stringify(doc, null, 2)}\n`);
  return changed;
};

const applyToDatabase = async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const [id, rewrite] of Object.entries(REWRITES)) {
      const bank = await client.query(
        `UPDATE questions
            SET question = $2,
                options = $3::jsonb,
                correct_answer = $4,
                explanation = $5,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1`,
        [
          id,
          rewrite.question,
          JSON.stringify(rewrite.options),
          rewrite.correctAnswer,
          rewrite.explanation
        ]
      );

      const snapshots = await client.query(
        `UPDATE assessment_questions
            SET question = $2,
                options = $3::jsonb,
                correct_answer = $4
          WHERE question_id = $1`,
        [id, rewrite.question, JSON.stringify(rewrite.options), rewrite.correctAnswer]
      );

      console.log(
        `${id}: questions=${bank.rowCount}, assessment snapshots=${snapshots.rowCount}`
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
};

const run = async () => {
  const changed = applyToJson();
  console.log(`reasoning.json: rewrote ${changed} questions`);

  if (process.argv.includes('--json-only')) {
    console.log('Skipping database update (--json-only).');
    return;
  }

  await applyToDatabase();
  console.log('Done.');
};

run().catch((error) => {
  console.error('Repair failed:', error.message);
  process.exit(1);
});
