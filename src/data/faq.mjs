// ST-62 H11 / LN-19. THE FAQ, EXTRACTED TO ONE SOURCE SO IT CANNOT DRIFT.
//
// 🔴 THIS ARRAY IS PORTED VERBATIM FROM KEEGAN'S OLD SITE AND IS OUT OF REWRITE
// SCOPE. Anyone MAY ADD a question. NOBODY may reword an existing one. It is the
// most citation-shaped asset the site owns: real questions, answers that lead
// with the answer, prices visible in the text.
//
// WHY IT MOVED HERE (2026-08-07): Keegan's site review asked for a reduced
// version of these questions on the home page. "Reduced" means FEWER QUESTIONS,
// NOT SHORTENED ANSWERS. Two hand-copied arrays would make that rule
// unenforceable the first time someone edited one of them — the same drift the
// shared WhatsInvolved block exists to prevent. Both pages now read this array,
// and the home page SELECTS BY QUESTION TEXT (see byQuestion), so rewording a
// question fails the build instead of silently splitting the two pages apart.
//
// The strings below were moved programmatically, not retyped, and asserted
// byte-identical to the versions that were live before the move.

// ---------------------------------------------------------------------------
// FAQ — VERBATIM. Transcribed from px-output/website-content-capture-2026-07-20.txt
// ---------------------------------------------------------------------------
// ELEVEN questions: the six from /services/chiropractic-treatment/ and five from
// /services/mobility-coaching/, which folds into this page.
//
// ⚠️ ONE DELIBERATE MERGE, AND SMITH OWNS IT — flagged for Keegan and Manny.
// Both source pages ended with a "Can I claim my health fund?" question. Keeping
// both would put two near-identical questions on one page, which reads as
// sloppy and splits any citation between them. I kept the MOBILITY page's
// wording verbatim, because it is a strict superset: it adds the parenthetical
// "(even for mobility and flexibility services)", which is exactly the question
// a reader of this merged page would have. The chiropractic version's wording is
// otherwise identical and nothing in it is lost. No other question was touched.
export const TREATMENT_FAQ = [
  {
    question: 'Does the adjustment hurt?',
    answer:
      'Most people find chiropractic treatment comfortable, and many leave feeling immediate relief. Some techniques involve a bit of firm pressure, and occasionally you might feel a little sore afterward (similar to how you’d feel after a good workout). I always work within your comfort level and adjust my approach based on your feedback, so please never hesitate to speak up.',
  },
  {
    question: 'Do you just crack backs?',
    answer:
      'The "cracking" sound you might have heard about is simply gas releasing from a joint as it moves – it’s a harmless yet satisfying side effect of what we are really trying to achieve – joint movement! Adjustments are just one tool in my kit. Depending on what you need, I may also use softer techniques that involve no cracking at all, so if the idea of it makes you nervous, just let me know.',
  },
  {
    question: 'Is Chiropractic safe?',
    answer:
      'Yes! Chiropractic is one of the most thoroughly researched and widely used forms of manual therapy in the world. It has an excellent safety record, particularly for common complaints like back and neck pain. Before any treatment, I’ll always take a thorough history and assessment to make sure chiropractic is appropriate for you. If I ever feel something is outside my scope or needs further investigation, I’ll tell you and refer you to the right person. Chiropractors actually have the lowest insurance premiums of any healthcare profession in Australia!',
  },
  {
    question: 'How much training do chiropractors have?',
    answer:
      'Chiropractors in Australia complete a minimum five-year university degree, which includes extensive study in anatomy, physiology, neurology, pathology, radiology, and clinical practice. We’re registered health professionals regulated by AHPRA, the same body that oversees doctors, physios, and nurses. So while we might be best known for back cracking, there’s a lot of science behind what we do! I graduated from Macquarie University in 2023 with a Bachelors and Masters of Chiropractic Science. Since then I have worked as a registered Chiropractor and continued to learn through experience and post graduate study.',
  },
  {
    question: 'How are Chiropractors, Physiotherapists and Osteopaths different?',
    answer:
      'All three professions work with the muscles and joints to reduce pain and improve how your body moves – there’s more overlap than most people realise. Traditionally, chiropractors are known for spinal adjustments, physios for exercise rehab, and osteopaths for whole-body manual therapy, but in practice the lines are pretty blurry. My style sits somewhere in the middle – I’m registered as a chiropractor, but I incorporate a lot of muscle testing, muscle release, and targeted rehab that you’d more commonly associate with physiotherapy. Many of my patients tell me I feel more like a physio who also does adjustments. At the end of the day, the profession matters less than finding someone who actually listens, does a thorough assessment, and tailors care to you.',
  },
  {
    question: 'How much time do I need to dedicate to mobility for results?',
    answer:
      'Not as much time as people typically think. Most of my clients only perform one or two, 25-30 minute, dedicated sessions per week. Less is actually more with flexibility training as your body needs time to rest and adapt to the changes we are making.',
  },
  {
    question: 'How long does it take to get more flexible?',
    answer:
      'The answer to this one will always depend on the individual. I typically see clients make a big jump in progress in just the first few sessions, but then progress slows down a little (much like beginner gains in the gym when strength training). I personally only trained 2 sessions per week for 2.5 months when training for my pancake and went from sitting at almost 90 degrees and struggling to lean forwards to touching my head on the floor.',
  },
  {
    question: 'Can I incorporate mobility training around or alongside my usual training?',
    answer:
      'Yes! There are multiple ways to do it but flexibility training doesn’t take away from your strength or sport specific training. Depending on your training load, you may need to time sessions carefully, but it isn’t usually an issue. I personally train hybrid calisthenics strength training 3 times per week and I usually just add my mobility sessions at the end of two of those sessions.',
  },
  {
    question: 'Does flexibility training hurt?',
    answer:
      'No! If stretching hurts, you are either pushing it too hard, not resting enough, or have an injury or troublesome compensation pattern holding you back. I always emphasise that mobility and flexibility training should be moderately uncomfortable in the extreme ranges, but definitely not painful. Pain will cause your body to feel unsafe and hold extra tension to protect itself.',
  },
  {
    question: 'Can I claim my health fund?',
    answer:
      'Yes you can! If your private health fund has chiropractic care included, you can claim it with me (even for mobility and flexibility services). We can process it in clinic at the time of payment if you have your card with you or I can send you an invoice after the consult and you can claim it yourself if you forget your card.',
  },
];

/**
 * Pick entries by their exact question text, preserving the order asked for.
 * Throws on a miss, which is the point: if someone rewords a question in
 * TREATMENT_FAQ, the build fails here rather than quietly leaving the home page
 * showing an old wording or nothing at all.
 */
export function byQuestion(...questions) {
  return questions.map((q) => {
    const hit = TREATMENT_FAQ.find((e) => e.question === q);
    if (!hit) {
      throw new Error(
        `faq.mjs: no entry matches ${JSON.stringify(q)}. A question was reworded or removed — ` +
          `see the standing rule at the top of this file before "fixing" the caller.`,
      );
    }
    return hit;
  });
}
