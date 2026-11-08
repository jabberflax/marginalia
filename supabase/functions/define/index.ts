import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const CLAUDE_MODEL = "claude-haiku-5-5";

const STYLE = `You write entries for a reader's personal vocabulary notebook. Words come from books they read on a Kobo (often history, politics and literary non-fiction).

For the given word, return JSON only, no prose, in this exact shape:
{"word": string, "partOfSpeech": string, "phonetic": string, "definition": string, "note": string, "example": string}

Rules:
- word: the dictionary (base) form, lowercase unless a proper noun. "knaves" -> "knave", "extolling" -> "extol", "deluged" -> "deluge". Keep multi-word phrases as phrases ("roman à clef").
- partOfSpeech: noun, verb, adjective, adverb, etc., for the sense you define.
- phonetic: American pronunciation in Merriam-Webster respelling style, wrapped in backslashes, with hyphens between syllables and a stress mark before the stressed syllable, e.g. \\kə-ˈjōl\\, \\jü-ˈdi-shəs\\, \\ˈprä-fli-gət\\.
- definition: one sentence in plain modern English, at most about 20 words, never using the word itself. If the word has several senses, give the one most likely meant given the sentence and book provided; otherwise the most common literary sense.
- note: optional, empty string if nothing useful. One short line on register or tone (archaic, formal, derogatory, admiring) or a brief origin when it genuinely helps remember the meaning. Must be accurate; leave empty if unsure.
- example: one natural sentence of about 12-25 words that uses the word (in any inflection) in the sense defined, showing how it is typically used. Original, not a quotation; avoid real living people.
- If the input is not a real English word or is badly misspelled, return {"error": "not_found", "suggestions": [up to 5 likely intended words]}.

Examples:
{"word":"knave","partOfSpeech":"noun","phonetic":"\\\\ˈnāv\\\\","definition":"A dishonest, unscrupulous man; a rogue.","note":"Archaic. Originally meant a boy or male servant.","example":"Everyone at court knew him for a knave who would sell a friend for a favour."}
{"word":"muckraker","partOfSpeech":"noun","phonetic":"\\\\ˈmək-ˌrā-kər\\\\","definition":"A journalist who exposes corruption or scandal, especially among the powerful.","note":"Popularised by Theodore Roosevelt in 1906, after a character in The Pilgrim's Progress who rakes muck instead of looking up.","example":"The muckraker spent two years digging through the company's records before publishing her exposé."}
{"word":"dogged","partOfSpeech":"adjective","phonetic":"\\\\ˈdȯ-gəd\\\\","definition":"Showing stubborn persistence despite difficulty.","note":"Usually admiring, as in \\"dogged determination\\".","example":"Her dogged pursuit of the story finally forced the board to release the documents."}
{"word":"extol","partOfSpeech":"verb","phonetic":"\\\\ik-ˈstōl\\\\","definition":"To praise someone or something enthusiastically.","note":"Formal.","example":"The brochure extols the resort's quiet beaches and award-winning restaurant."}
{"word":"demagogue","partOfSpeech":"noun","phonetic":"\\\\ˈde-mə-ˌgäg\\\\","definition":"A political leader who wins support by playing on people's fears and prejudices rather than using reason.","note":"From Greek for \\"leader of the people\\"; now almost always negative.","example":"The demagogue promised easy answers and blamed every problem on outsiders."}`;

const BATCH_RULE = `\n\nBATCH MODE: when given a numbered list of words, return a JSON array (and nothing else) with exactly one object per input word, in the same order. Each object follows the shape and rules above (or the error shape), plus an "input" field echoing the word exactly as given.`;

const STYLE_ZH = `You write entries for a reader's personal Chinese vocabulary notebook. The reader is fluent in English and reads Chinese books.

For the given Chinese word or idiom, return JSON only, no prose, in this exact shape:
{"word": string, "pinyin": string, "partOfSpeech": string, "definition": string, "definitionZh": string, "note": string, "chars": [{"c": string, "m": string}], "example": string, "exampleTranslation": string, "contextTranslation": string}

Rules:
- word: the word in SIMPLIFIED characters (convert traditional input to simplified).
- pinyin: Hanyu Pinyin with tone marks; syllables of one word written together, separate words or idiom halves spaced, e.g. "wòxuán", "diēdàng qǐfú". Use the reading that fits the sense defined.
- partOfSpeech: in English: noun, verb, adjective, adverb, idiom, measure word, conjunction, etc.
- definition: one sentence in plain English, at most about 20 words, for the sense most likely meant given the sentence and book provided; otherwise the most common sense in written Chinese.
- definitionZh: a concise definition in simplified Chinese, at most about 25 characters, without repeating the word itself.
- note: optional, empty string if nothing useful. Start with a Chinese register label when one applies (书面语, 口语, 成语, 俗语, 方言, 网络用语), then " · " and a short English remark on usage, tone or origin. Must be accurate; leave empty if unsure.
- chars: one entry per character of the word, in order, with a short English gloss (1-4 words) of that character's meaning as used in this word.
- example: one natural sentence in simplified Chinese, about 12-30 characters, using the word in the sense defined. Original, not a quotation; avoid real living people.
- exampleTranslation: a natural English translation of the example.
- contextTranslation: a natural English translation of the sentence it appeared in, if one was provided; otherwise "".
- If the input is not a real Chinese word or phrase, return {"error": "not_found", "suggestions": [up to 5 likely intended words]}.

Examples:
{"word":"斡旋","pinyin":"wòxuán","partOfSpeech":"verb","definition":"To mediate between opposing sides to help them reach an agreement.","definitionZh":"居中调解，使双方达成一致","note":"书面语 · Formal; common in news about diplomacy.","chars":[{"c":"斡","m":"turn"},{"c":"旋","m":"revolve, circle"}],"example":"经过联合国的斡旋，双方终于同意停火。","exampleTranslation":"After mediation by the UN, the two sides finally agreed to a ceasefire.","contextTranslation":""}
{"word":"跌宕起伏","pinyin":"diēdàng qǐfú","partOfSpeech":"idiom","definition":"Full of ups and downs; dramatically eventful.","definitionZh":"形容事物变化多端，起落不定","note":"成语 · Four-character idiom, often used of a life or a story.","chars":[{"c":"跌","m":"fall"},{"c":"宕","m":"sway, delay"},{"c":"起","m":"rise"},{"c":"伏","m":"lie low"}],"example":"他的一生跌宕起伏，充满了传奇色彩。","exampleTranslation":"His life was full of ups and downs, like something out of a legend.","contextTranslation":""}`;

const isZh = (s: string) => /\p{Script=Han}/u.test(s);

type Entry = { source: string; word: string; partOfSpeech: string; phonetic: string; definition: string; example?: string; audioUrl: string;
  lang?: string; definitionZh?: string; chars?: { c: string; m: string }[]; exampleTranslation?: string; contextTranslation?: string; practice?: { s: string; t: string }[] };

// Practice sentences: keep only ones with the word marked as {{...}}, max 3
const normPractice = (p: any): { s: string; t: string }[] => (Array.isArray(p) ? p : [])
  .map((x: any) => typeof x === "string" ? { s: x, t: "" } : { s: String(x?.s || ""), t: String(x?.t || "") })
  .map((x) => ({ s: x.s.trim(), t: x.t.trim() }))
  .filter((x) => /\{\{[^{}]+\}\}/.test(x.s)).slice(0, 3);

const toEntry = (o: any, fallbackWord: string): Entry | null => {
  if (!o || o.error || !o.definition) return null;
  return {
    source: "Claude",
    word: String(o.word || fallbackWord),
    partOfSpeech: String(o.partOfSpeech || ""),
    phonetic: String(o.phonetic || ""),
    definition: String(o.definition).trim() + (o.note ? "\n" + String(o.note).trim() : ""),
    example: String(o.example || "").trim(),
    practice: normPractice(o.practice),
    audioUrl: "",
  };
};

const toEntryZh = (o: any, fallbackWord: string): Entry | null => {
  if (!o || o.error || !o.definition) return null;
  return {
    source: "Claude",
    lang: "zh",
    word: String(o.word || fallbackWord).trim(),
    partOfSpeech: String(o.partOfSpeech || ""),
    phonetic: String(o.pinyin || ""),
    definition: String(o.definition).trim() + (o.note ? "\n" + String(o.note).trim() : ""),
    definitionZh: String(o.definitionZh || "").trim(),
    chars: Array.isArray(o.chars) ? o.chars.filter((x: any) => x && x.c).map((x: any) => ({ c: String(x.c), m: String(x.m || "") })).slice(0, 12) : [],
    example: String(o.example || "").trim(),
    exampleTranslation: String(o.exampleTranslation || "").trim(),
    contextTranslation: String(o.contextTranslation || "").trim(),
    practice: normPractice(o.practice),
    audioUrl: "",
  };
};

async function askClaude(system: string, user: string, key: string, maxTokens: number): Promise<string | null> {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
  });
  if (!r.ok) { console.error("claude", r.status, await r.text()); return null; }
  const data = await r.json();
  return (data.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
}

async function claude(word: string, context: string, book: string, key: string) {
  let user = `Word: ${word}`;
  if (context) user += `\nSentence it appeared in: ${context}`;
  if (book) user += `\nBook: ${book}`;
  const zh = isZh(word);
  const text = await askClaude(zh ? STYLE_ZH : STYLE, user, key, zh ? 700 : 400);
  const m = text?.match(/\{[\s\S]*\}/);
  if (!m) return null;
  const o = JSON.parse(m[0]);
  if (o.error) return { suggestions: Array.isArray(o.suggestions) ? o.suggestions.slice(0, 5) : [] };
  return zh ? toEntryZh(o, word) : toEntry(o, word);
}

async function claudeBatch(items: { word: string; book: string }[], key: string, zh = false): Promise<(Entry | null)[]> {
  const books = [...new Set(items.map((i) => i.book).filter(Boolean))];
  const user = (books.length === 1 ? `Book: ${books[0]}\n` : "") +
    "Words:\n" + items.map((i, n) => `${n + 1}. ${i.word}` + (books.length > 1 && i.book ? ` (from ${i.book})` : "")).join("\n");
  const text = await askClaude((zh ? STYLE_ZH : STYLE) + BATCH_RULE, user, key, (zh ? 550 : 300) * items.length + 200);
  const m = text?.match(/\[[\s\S]*\]/);
  if (!m) return items.map(() => null);
  let arr: any[] = [];
  try { arr = JSON.parse(m[0]); } catch { return items.map(() => null); }
  // Match by echoed input first, then by position
  return items.map((it, n) => {
    const byInput = arr.find((o) => o && String(o.input || "").toLowerCase() === it.word.toLowerCase());
    return zh ? toEntryZh(byInput || arr[n], it.word) : toEntry(byInput || arr[n], it.word);
  });
}

function mwAudio(file?: string): string {
  if (!file) return "";
  let sub = file[0];
  if (file.startsWith("bix")) sub = "bix";
  else if (file.startsWith("gg")) sub = "gg";
  else if (!/^[a-z]/i.test(file)) sub = "number";
  return `https://media.merriam-webster.com/audio/prons/en/us/mp3/${sub}/${file}.mp3`;
}

async function merriamWebster(word: string, key: string) {
  const r = await fetch(`https://www.dictionaryapi.com/api/v3/references/collegiate/json/${encodeURIComponent(word)}?key=${key}`);
  if (!r.ok) return null;
  const data = await r.json();
  if (!Array.isArray(data) || !data.length) return null;
  if (typeof data[0] === "string") return { suggestions: data.slice(0, 5) };
  const e = data[0];
  const defs: string[] = e.shortdef || [];
  if (!defs.length) return null;
  const pr = e.hwi?.prs?.[0];
  return {
    source: "Merriam-Webster",
    word: String(e.meta?.id || word).split(":")[0],
    partOfSpeech: e.fl || "",
    phonetic: pr?.mw ? `\\${pr.mw}\\` : "",
    definition: defs.slice(0, 2).join("; "),
    audioUrl: mwAudio(pr?.sound?.audio),
  };
}

async function freeDictionary(word: string) {
  const r = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
  if (!r.ok) return null;
  const data = await r.json();
  const e = data?.[0];
  const m = e?.meanings?.[0];
  const d = m?.definitions?.[0];
  if (!d?.definition) return null;
  return {
    source: "Free Dictionary",
    word: e.word || word,
    partOfSpeech: m.partOfSpeech || "",
    phonetic: e.phonetic || e.phonetics?.find((p: any) => p.text)?.text || "",
    definition: d.definition,
    audioUrl: e.phonetics?.find((p: any) => p.audio)?.audio || "",
  };
}

async function addAudio(entry: Entry, mKey?: string) {
  if (!mKey || entry.audioUrl || entry.lang === "zh") return entry;
  const mw = await merriamWebster(entry.word, mKey).catch(() => null);
  if (mw && "audioUrl" in mw) entry.audioUrl = mw.audioUrl as string;
  return entry;
}

// Dictionary fallbacks for one word: Merriam-Webster, then Free Dictionary
async function dictionaryLookup(w: string, mKey?: string) {
  let suggestions: string[] = [];
  if (mKey) {
    const mw = await merriamWebster(w, mKey).catch(() => null);
    if (mw && "definition" in mw) return { entry: mw as Entry, suggestions };
    if (mw && "suggestions" in mw) suggestions = mw.suggestions as string[];
  }
  const fd = await freeDictionary(w).catch(() => null);
  return { entry: (fd as Entry) || null, suggestions };
}

const EXAMPLE_SYSTEM = `You write example sentences for a reader's personal vocabulary notebook.
For each numbered word, write one natural sentence of about 12-25 words that uses the word (any inflection is fine) in the sense given by its definition, or the sentence it was read in when provided. Original, not a quotation; avoid real living people; plain modern English.
For a Chinese word, write the sentence in simplified Chinese (about 12-30 characters) and add "translation": a natural English translation. For an English word, leave "translation" as "".
Return a JSON array only, one object per word in the same order: {"input": the word exactly as given, "example": the sentence, "translation": string}.`;

async function claudeExamples(items: { word: string; definition: string; context: string; book: string }[], key: string): Promise<{ example: string; translation: string }[]> {
  const user = items.map((i, n) => `${n + 1}. ${i.word}` +
    (i.definition ? `\n   Definition: ${i.definition.split("\n")[0]}` : "") +
    (i.context ? `\n   Read in: ${i.context}` : "") +
    (i.book ? `\n   Book: ${i.book}` : "")).join("\n");
  const text = await askClaude(EXAMPLE_SYSTEM, user, key, 140 * items.length + 200);
  const m = text?.match(/\[[\s\S]*\]/);
  const none = () => items.map(() => ({ example: "", translation: "" }));
  if (!m) return none();
  let arr: any[] = [];
  try { arr = JSON.parse(m[0]); } catch { return none(); }
  return items.map((it, n) => {
    const o = arr.find((x) => x && String(x.input || "").toLowerCase() === it.word.toLowerCase()) || arr[n];
    return { example: o && o.example ? String(o.example).trim() : "", translation: o && o.translation ? String(o.translation).trim() : "" };
  });
}

const PRACTICE_SYSTEM = `You write fill-in-the-blank quiz items for a reader's personal vocabulary notebook.
For each numbered word you get its definition, part of speech, and candidate wrong answers (other words from the reader's notebook).

Write three original sentences for the word, each in a different everyday context. Each sentence uses the word exactly once, in whatever grammatical form the sentence naturally needs (past tense, third person, plural, -ing, comparative and so on); vary the forms across the three sentences where the word allows. The sentence should make the meaning guessable without stating it. Use the sense in the definition. Avoid real living people.

For each sentence return:
- "s": the full sentence, plain text, no markup.
- "form": the word exactly as it appears in "s".
- "opts": exactly 3 wrong answers chosen from the candidates, each put into the SAME grammatical form as "form", correctly spelled, as {"word": the candidate exactly as given, "form": the inflected candidate}. If "form" is "extolled", candidates "cajole" and "rankle" become "cajoled" and "rankled"; if "form" is "knaves", "rogue" becomes "rogues". Choose candidates that clearly do NOT fit this sentence, so only one answer is right, preferring the same part of speech.
- "t": a natural English translation for Chinese words, otherwise "".
English: 12-25 words per sentence. Chinese: simplified Chinese, 12-30 characters, the word and the wrong answers unchanged (no inflection).

Return a JSON array only, one object per word in the same order: [{"input": the word exactly as given, "sentences": [{"s": string, "form": string, "opts": [{"word": string, "form": string}], "t": string}]}]`;

type PItem = { s: string; form: string; opts: { word: string; form: string }[]; t: string };
const escRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Keep only items where the form really appears in the sentence and there are 3 distinct wrong answers
function normItems(list: any): PItem[] {
  return (Array.isArray(list) ? list : []).map((x: any) => {
    const s = String(x?.s || "").replace(/\{\{|\}\}|\*\*/g, "").replace(/\s+/g, " ").trim();
    const form = String(x?.form || "").replace(/\{\{|\}\}|\*\*/g, "").trim();
    const opts = (Array.isArray(x?.opts) ? x.opts : []).map((o: any) => typeof o === "string" ? { word: o, form: o } : { word: String(o?.word || o?.form || "").trim(), form: String(o?.form || o?.word || "").trim() })
      .filter((o: any) => o.form && o.form.toLowerCase() !== form.toLowerCase());
    const seen = new Set<string>(); const uniq = opts.filter((o: any) => { const k = o.form.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
    return { s, form, opts: uniq.slice(0, 3), t: String(x?.t || "").trim() };
  }).filter((x: PItem) => {
    if (!x.s || !x.form || x.opts.length < 3) return false;
    return isZh(x.form) ? x.s.includes(x.form) : new RegExp("(^|[^\\p{L}])" + escRe(x.form) + "($|[^\\p{L}])", "iu").test(x.s);
  }).slice(0, 3);
}

async function claudePractice(items: { word: string; definition: string; pos: string; candidates: string[] }[], key: string): Promise<PItem[][]> {
  const user = items.map((i, n) => `${n + 1}. ${i.word}` +
    (i.pos ? ` (${i.pos})` : "") +
    (i.definition ? `\n   Definition: ${i.definition.split("\n")[0].slice(0, 200)}` : "") +
    `\n   Candidates: ${i.candidates.join(", ")}`).join("\n");
  const text = await askClaude(PRACTICE_SYSTEM, user, key, 420 * items.length + 300);
  const m = text?.match(/\[[\s\S]*\]/);
  let arr: any[] = [];
  try { arr = m ? JSON.parse(m[0]) : []; } catch { arr = []; }
  const out = items.map((it, n) => {
    const o = arr.find((x) => x && String(x.input || "").toLowerCase() === it.word.toLowerCase()) || arr[n];
    return normItems(o?.sentences);
  });
  if (out.some((x) => !x.length)) console.error("practice: some words got no valid items", JSON.stringify(items.map((i) => i.word)), String(text || "").slice(0, 1500));
  return out;
}

const cleanWord = (s: unknown) => String(s || "").trim().replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "").toLowerCase().slice(0, 60);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json();
    const aKey = Deno.env.get("ANTHROPIC_API_KEY");
    const mKey = Deno.env.get("MW_API_KEY");

    // Fill-the-gap items: { practice: [{ word, definition, pos, candidates }] } -> { results: [{ input, practice: [{ s, form, opts, t }] }] }
    if (Array.isArray(body.practice)) {
      const items = body.practice.slice(0, 10).map((i: any) => ({
        word: String(i?.word || "").trim().slice(0, 60),
        definition: String(i?.definition || "").trim().slice(0, 400),
        pos: String(i?.pos || "").trim().slice(0, 30),
        candidates: (Array.isArray(i?.candidates) ? i.candidates : []).map((c: any) => String(c || "").trim().slice(0, 60)).filter(Boolean).slice(0, 8),
      })).filter((i: any) => i.word && i.candidates.length >= 3);
      if (!aKey) return json({ results: items.map((i: any) => ({ input: i.word, practice: [] })), error: "no_claude_key" });
      const got = await claudePractice(items, aKey).catch((e) => { console.error(e); return items.map(() => []); });
      return json({ results: items.map((i: any, n: number) => ({ input: i.word, practice: got[n] })) });
    }

    // Examples only (Suggest example button, Add examples in Settings):
    // { examples: [{ word, definition, context, book }] } -> { results: [{ input, example }] }
    if (Array.isArray(body.examples)) {
      const items = body.examples.slice(0, 20).map((i: any) => ({
        word: String(i?.word || "").trim().slice(0, 60),
        definition: String(i?.definition || "").trim().slice(0, 400),
        context: String(i?.context || "").trim().slice(0, 600),
        book: String(i?.book || "").trim().slice(0, 200),
      })).filter((i: any) => i.word);
      if (!aKey) return json({ results: items.map((i: any) => ({ input: i.word, example: "", translation: "" })), error: "no_claude_key" });
      const ex = await claudeExamples(items, aKey).catch((e) => { console.error(e); return items.map(() => ({ example: "", translation: "" })); });
      return json({ results: items.map((i: any, n: number) => ({ input: i.word, example: ex[n].example, translation: ex[n].translation })) });
    }

    // Batch mode (Kobo import): { items: [{ word, book }] } -> { results: [entry | { input, error }] }
    if (Array.isArray(body.items)) {
      const items = body.items.slice(0, 20)
        .map((i: any) => ({ word: cleanWord(i?.word), book: String(i?.book || "").trim().slice(0, 200) }))
        .filter((i: any) => i.word);
      if (!items.length) return json({ results: [] });
      const entries: (Entry | null)[] = items.map(() => null);
      if (aKey) {
        for (const zh of [false, true]) {
          const idx = items.map((it: any, n: number) => (isZh(it.word) === zh ? n : -1)).filter((n: number) => n >= 0);
          if (!idx.length) continue;
          const got = await claudeBatch(idx.map((n: number) => items[n]), aKey, zh).catch((e) => { console.error(e); return idx.map(() => null); });
          idx.forEach((n: number, k: number) => { entries[n] = got[k]; });
        }
      }
      const results = await Promise.all(items.map(async (it: any, n: number) => {
        let e = entries[n];
        if (e) e = await addAudio(e, mKey);
        else if (!isZh(it.word)) e = (await dictionaryLookup(it.word, mKey)).entry;
        return e ? { input: it.word, ...e } : { input: it.word, error: "not_found" };
      }));
      return json({ results });
    }

    // Single word (Add word screen)
    const w = cleanWord(body.word);
    const context = String(body.context || "").trim().slice(0, 600);
    const book = String(body.book || "").trim().slice(0, 200);
    if (!w) return json({ error: "Missing word" }, 400);

    let suggestions: string[] = [];
    if (aKey) {
      const c = await claude(w, context, book, aKey).catch((e) => { console.error(e); return null; });
      if (c && "definition" in c) return json(await addAudio(c as Entry, mKey));
      if (c && "suggestions" in c) suggestions = c.suggestions as string[];
    }
    if (isZh(w)) return json({ error: "not_found", suggestions }, 404);
    const d = await dictionaryLookup(w, mKey);
    if (d.entry) return json(d.entry);
    return json({ error: "not_found", suggestions: suggestions.length ? suggestions : d.suggestions }, 404);
  } catch (_e) {
    return json({ error: "Lookup failed" }, 500);
  }
});
