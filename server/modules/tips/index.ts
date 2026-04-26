// ============================================================================
// Personalised tips — derive Ally-voice tip cards from the user's record so
// the wait-state rotator can interleave generic stories with prompts that
// reference their actual situation.
//
// Pragmatic, deterministic: category-keyed templates, no LLM call (keeps the
// wait pages snappy). LLM-generated tips that reference specific notes can
// land later as a follow-up.
// ============================================================================

import { listNotes } from "../record";

export type Tip = {
  id: string;
  title: string;
  body: string;
  source: "personal" | "general";
};

type Template = (note: { label: string; body: string | null }) => { title: string; body: string };

const TEMPLATES: Record<string, Template> = {
  retirement: (n) => ({
    title: "About your retirement",
    body: `You mentioned: "${n.label}". Worth knowing — even a 1% bump in your contribution rate, started today, can change the picture by tens of thousands by the time you're 60. Compound interest doesn't care about effort, only time.`,
  }),
  debt: (n) => ({
    title: "About your debt",
    body: `You said: "${n.label}". When you're ready to look at this, the trick most people miss is paying the highest-interest one first, not the biggest. Counterintuitive, but it costs you less over a year.`,
  }),
  property: (n) => ({
    title: "About your bond",
    body: `You mentioned the bond. One small thing worth knowing — paying just R500 extra a month off the principal can take years off the bond and save more interest than you'd think. Worth a check sometime.`,
  }),
  goals: (n) => ({
    title: "Holding your goal",
    body: `You said: "${n.label}". I'm holding this. When we get to the analysis, I'll show you what the numbers say about how reachable it is. No judgement — just clarity.`,
  }),
  medicalCover: () => ({
    title: "Medical cover",
    body: `You shared where you are with medical aid. Quietly important — one hospital admission without cover can wipe out years of savings. We'll come back to this when we look at protection.`,
  }),
  lifeCover: () => ({
    title: "Life cover",
    body: `You shared where you are with life cover. The honest test isn't 'do I have it' — it's 'would the people who depend on me be okay if I weren't here'. We'll work that out together.`,
  }),
  otherAccounts: () => ({
    title: "Other accounts",
    body: `You mentioned accounts beyond what's in the statements. I've noted them — when we get to the analysis I'll factor them in so the picture is whole, not just what the bank shows.`,
  }),
};

export async function getTipsForUser(userId: string): Promise<Tip[]> {
  const notes = await listNotes({ userId, limit: 100 });
  const tips: Tip[] = [];
  const seenCategories = new Set<string>();
  for (const n of notes) {
    if (!n.category || seenCategories.has(n.category)) continue;
    const tpl = TEMPLATES[n.category];
    if (!tpl) continue;
    const out = tpl({ label: n.label, body: n.body });
    tips.push({
      id: `tip_${n.category}_${n.id}`,
      title: out.title,
      body: out.body,
      source: "personal",
    });
    seenCategories.add(n.category);
    if (tips.length >= 6) break;
  }
  return tips;
}
