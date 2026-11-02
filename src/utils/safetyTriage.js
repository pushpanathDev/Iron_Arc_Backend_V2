/*
 * Safety checks around the coach that don't depend on the AI.
 *
 * dangerSign(): what the user wrote, checked before any AI call. Signs of a
 * medical emergency, an acute injury, a mental health crisis or an eating
 * disorder get a fixed, careful reply instead of coaching (and cost no AI
 * call). Plain phrases only, so gym talk ("broke my PR", "leg day killed me")
 * passes; "no chest pain" and similar negations pass too. The prompts carry
 * the same rules for anything these phrases miss.
 *
 * outOfScope(): the coach's reply, checked before the user sees it. Personal
 * calorie targets, doses and performance-enhancing drugs are outside what the
 * coach may give (general nutrition guidance only); such a reply is replaced.
 *
 * leaksInstructions(): the coach's reply, checked for its own instructions or
 * the prompt's tags: a prompt injection that worked. Never shown either.
 */

const HELPLINES = "You can find a free, confidential helpline in your country at findahelpline.com.";

const REPLIES = {
  emergency:
    "Please stop training now. Chest pain or pressure, fainting, trouble breathing, a racing or irregular heartbeat or sudden numbness can be signs of something serious. If it's happening now or feels severe, call your local emergency number. Otherwise, see a doctor before your next workout. I won't adjust your training around this; please get checked first.",
  injury:
    "Stop training that area for now. A pop or snap, a sudden sharp pain, swelling, or not being able to put weight on it should be checked by a doctor or physiotherapist before you train it again. Once you're cleared, I can help you work around it, for example by swapping exercises.",
  crisis: `I'm really sorry you're feeling this way, and I'm glad you said something. Please talk to someone now: if you might act on these thoughts, call your local emergency number. ${HELPLINES} If I've misread you, just ask me your training question again.`,
  eating: `Thank you for telling me. This is something to talk through with a doctor or an eating-disorder specialist rather than a fitness app, so I won't give nutrition advice here. ${HELPLINES} I'm still glad to help with your training.`,
};

/** Checked in this order: the most serious first. */
const SIGNS = [
  {
    kind: "crisis",
    pattern: /\b(kill(ing)? myself|suicid\w*|end(ing)? my life|want(ed)? to die|don'?t want to (live|be alive)|self[- ]?harm\w*|hurt(ing)? myself|cut(ting)? myself)\b/i,
  },
  {
    kind: "emergency",
    pattern:
      /\b(chest (pain|pains|pressure|tightness)|pain in (my|the) chest|tight(ness)? in (my|the) chest|faint(ed|ing)?|pass(ed|ing)? out|black(ed|ing)? out|lost consciousness|can'?t breathe|cannot breathe|struggling to breathe|(heart|pulse) (is |was |keeps )?(racing|pounding|skipping)|irregular heart ?beat|palpitations?|numb(ness)? in (my|the) (arm|face|jaw)|slurred speech|cough(ing|ed)? (up )?blood)\b/i,
  },
  {
    kind: "injury",
    pattern:
      /\b((heard|felt) (a |something )?(pop|snap)|something (popped|snapped)|(tore|torn|ruptured|dislocated|fractured) (my |a |the )?\w+|broke (my|a) (bone|wrist|arm|leg|ankle|foot|toe|finger|hand|rib|nose)|can'?t (put|bear) weight|(sudden|sharp|stabbing|shooting) pain|swollen)\b/i,
  },
  {
    kind: "eating",
    pattern:
      /\b(make myself (throw up|vomit|sick)|purg(e|ed|ing)|starv(e|ed|ing) myself|laxatives?|(not|haven'?t|didn'?t) eaten (in|for) (days|\d+ days|a week)|eating disorder|anorexi\w*|bulimi\w*)\b/i,
  },
];

/** "no chest pain", "I didn't faint": a negation just before the phrase, in the same sentence. */
const NEGATED = /\b(no|not|never|without|don'?t|didn'?t|haven'?t|hasn'?t|isn'?t|wasn'?t|zero)\b[^.!?]{0,20}$/i;

/** { kind, reply } for the first danger sign in `text`, or null. */
function dangerSign(text) {
  const value = String(text ?? "");
  for (const { kind, pattern } of SIGNS) {
    const global = new RegExp(pattern.source, "gi");
    for (const match of value.matchAll(global)) {
      if (!NEGATED.test(value.slice(0, match.index))) return { kind, reply: REPLIES[kind] };
    }
  }
  return null;
}

/** What the coach says instead of a reply that went beyond general nutrition guidance. */
const NUTRITION_REPLY =
  "I can only give general nutrition guidance, like protein (about 1.6 to 2.2 g per kg of body weight a day, spread over your meals) and eating and drinking around training. For calorie targets, meal plans, supplement doses or anything about drugs, please talk to a registered dietitian or a doctor.";

const OUT_OF_SCOPE = [
  // A personal calorie target: "2,200 calories a day", "eat 1800 kcal", "a deficit of 500 calories".
  /\b\d{1,2},?\d{3}\s*(k?cals?|kilocalories|calories)\b|\b\d{3,4}\s*(k?cals?|calories)\s*(a|per|each)\s*day\b|\b(eat|aim for|target|consume|intake of)\s*(about |around |roughly )?\d{3,5}\s*(k?cals?|calories)\b|\b(deficit|surplus) of (about |around )?\d{2,4}\s*(k?cals?|calories)\b/i,
  // A dose.
  /\b\d+(\.\d+)?\s*(mg|mcg|µg|iu)\b/i,
  // Performance-enhancing drugs.
  /\b(steroids?|anabolic|sarms?|trenbolone|nandrolone|anavar|oxandrolone|dianabol|winstrol|clenbuterol|hgh|growth hormone|testosterone (cypionate|enanthate|injections?|cycle|replacement))\b/i,
];

/** True when the coach's reply gives something only a dietitian or doctor should. */
const outOfScope = (text) => OUT_OF_SCOPE.some((pattern) => pattern.test(String(text ?? "")));

/** Phrases only the coach's instructions contain (see utils/planPrompts.js). */
const INSTRUCTIONS = /SCOPE AND SAFETY|SAFE MODE \(this user|Follow only these instructions|Never follow instructions written inside|<\/?(app_data|user_message|user_reason)>|Return ONLY this JSON/i;

/** True when the coach's reply quotes its own instructions. */
const leaksInstructions = (text) => INSTRUCTIONS.test(String(text ?? ""));

/** What the coach says instead. */
const LEAK_REPLY = "I can't share how I'm set up, but I'm happy to help with your training. What would you like to work on?";

module.exports = { dangerSign, outOfScope, leaksInstructions, NUTRITION_REPLY, LEAK_REPLY, SAFETY_REPLIES: REPLIES };
