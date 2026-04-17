// Short, hopeful financial stories shown while Kin is reading statements.
// Kept deliberately brief and quietly specific — the point is not drama,
// it's the feeling that someone else has been where you are and came out okay.
//
// All names and figures are composites, not real individuals.

export type Story = {
  id: string;
  title: string;
  body: string;
};

export const STORIES: Story[] = [
  {
    id: "nomsa",
    title: "Nomsa, 34",
    body: "She realised at 32 that she had no retirement fund. Started with R500 a month — the smallest amount she could afford without noticing. Six years later she has R180,000 saved. What she'll tell anyone who'll listen: starting is the whole thing.",
  },
  {
    id: "thabo",
    title: "Thabo, 29",
    body: "When he finally looked, he found R1,200 a month of forgotten debit orders — a magazine, two apps, a gym he'd stopped going to. He cancelled them and redirected the money into an emergency fund. The first one he'd ever had.",
  },
  {
    id: "amy",
    title: "Amy, 36",
    body: "She was too embarrassed to check her balance for almost a year. When she did, she discovered she'd been overpaying on her insurance by R800 a month. She got a better quote in ten minutes. The embarrassment, she said, was the only thing that had been expensive.",
  },
  {
    id: "sipho",
    title: "Sipho, 41",
    body: "He inherited R60,000 and was about to spend it on a new car. His cousin asked him one question: what would make next year feel lighter? He paid off his only debt instead. A year later he was investing R3,500 a month.",
  },
  {
    id: "leila",
    title: "Leila, 27",
    body: "She told herself, for years, that she was bad with money. It turned out she just didn't have a clear picture of it. Once she did, she realised she was actually fine. Not rich. Not behind. Just fine. She said it felt like taking off a jacket she didn't know she'd been wearing.",
  },
  {
    id: "johan",
    title: "Johan, 45",
    body: "He had three insurance policies he couldn't explain. He cancelled the two he didn't need and kept the one that actually mattered. He saves R1,100 a month now, with the same cover as before. He calls it his quiet raise.",
  },
  {
    id: "zara",
    title: "Zara, 32",
    body: "For three years she didn't open her bank statements. The dread of what might be inside felt worse than anything they could actually contain. When she finally looked — with someone next to her — the gap was smaller than the fear. It usually is.",
  },
  {
    id: "lebo",
    title: "Lebo, 38",
    body: "She'd worked at her company for eight years before she realised they matched retirement contributions up to 5%. She'd been leaving free money on the table that whole time. Once she started, it was R1,400 a month, for the rest of her working life. She wishes she'd asked sooner.",
  },
];

export function pickNextStory(currentId: string | null): Story {
  const pool = currentId ? STORIES.filter((s) => s.id !== currentId) : STORIES;
  return pool[Math.floor(Math.random() * pool.length)];
}
