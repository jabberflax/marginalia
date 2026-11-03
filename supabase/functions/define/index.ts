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
{"word": string, "partOfSpeech": string, "phonetic": string, "definition": string, "note": string}

Rules:
- word: the dictionary (base) form, lowercase unless a proper noun. "knaves" -> "knave", "extolling" -> "extol", "deluged" -> "deluge". Keep multi-word phrases as phrases ("roman à clef").
- partOfSpeech: noun, verb, adjective, adverb, etc., for the sense you define.
- phonetic: American pronunciation in Merriam-Webster respelling style, wrapped in backslashes, with hyphens between syllables and a stress mark before the stressed syllable, e.g. \\kə-ˈjōl\\, \\jü-ˈdi-shəs\\, \\ˈprä-fli-gət\\.
- definition: one sentence in plain modern English, at most about 20 words, never using the word itself. If the word has several senses, give the one most likely meant given the sentence and book provided; otherwise the most common literary sense.
- note: optional, empty string if nothing useful. One short line on register or tone (archaic, formal, derogatory, admiring) or a brief origin when it genuinely helps remember the meaning. Must be accurate; leave empty if unsure.
- If the input is not a real English word or is badly misspelled, return {"error": "not_found", "suggestions": [up to 5 likely intended words]}.

Examples:
{"word":"knave","partOfSpeech":"noun","phonetic":"\\\\ˈnāv\\\\","definition":"A dishonest, unscrupulous man; a rogue.","note":"Archaic. Originally meant a boy or male servant."}
{"word":"muckraker","partOfSpeech":"noun","phonetic":"\\\\ˈmək-ˌrā-kər\\\\","definition":"A journalist who exposes corruption or scandal, especially among the powerful.","note":"Popularised by Theodore Roosevelt in 1906, after a character in The Pilgrim's Progress who rakes muck instead of looking up."}
{"word":"dogged","partOfSpeech":"adjective","phonetic":"\\\\ˈdȯ-gəd\\\\","definition":"Showing stubborn persistence despite difficulty.","note":"Usually admiring, as in \\"dogged determination\\"."}
{"word":"extol","partOfSpeech":"verb","phonetic":"\\\\ik-ˈstōl\\\\","definition":"To praise someone or something enthusiastically.","note":"Formal."}
{"word":"demagogue","partOfSpeech":"noun","phonetic":"\\\\ˈde-mə-ˌgäg\\\\","definition":"A political leader who wins support by playing on people's fears and prejudices rather than using reason.","note":"From Greek for \\"leader of the people\\"; now almost always negative."}`;

const BATCH_RULE = `\n\nBATCH MODE: when given a numbered list of words, return a JSON array (and nothing else) with exactly one object per input word, in the same order. Each object follows the shape and rules above (or the error shape), plus an "input" field echoing the word exactly as given.`;

type Entry = { source: string; word: string; partOfSpeech: string; phonetic: string; definition: string; audioUrl: string };

const toEntry = (o: any, fallbackWord: string): Entry | null => {
  if (!o || o.error || !o.definition) return null;
  return {
    source: "Claude",
    word: String(o.word || fallbackWord),
    partOfSpeech: String(o.partOfSpeech || ""),
    phonetic: String(o.phonetic || ""),
    definition: String(o.definition).trim() + (o.note ? "\n" + String(o.note).trim() : ""),
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
  const text = await askClaude(STYLE, user, key, 400);
  const m = text?.match(/\{[\s\S]*\}/);
  if (!m) return null;
  const o = JSON.parse(m[0]);
  if (o.error) return { suggestions: Array.isArray(o.suggestions) ? o.suggestions.slice(0, 5) : [] };
  return toEntry(o, word);
}

async function claudeBatch(items: { word: string; book: string }[], key: string): Promise<(Entry | null)[]> {
  const books = [...new Set(items.map((i) => i.book).filter(Boolean))];
  const user = (books.length === 1 ? `Book: ${books[0]}\n` : "") +
    "Words:\n" + items.map((i, n) => `${n + 1}. ${i.word}` + (books.length > 1 && i.book ? ` (from ${i.book})` : "")).join("\n");
  const text = await askClaude(STYLE + BATCH_RULE, user, key, 300 * items.length + 200);
  const m = text?.match(/\[[\s\S]*\]/);
  if (!m) return items.map(() => null);
  let arr: any[] = [];
  try { arr = JSON.parse(m[0]); } catch { return items.map(() => null); }
  // Match by echoed input first, then by position
  return items.map((it, n) => {
    const byInput = arr.find((o) => o && String(o.input || "").toLowerCase() === it.word.toLowerCase());
    return toEntry(byInput || arr[n], it.word);
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
  if (!mKey || entry.audioUrl) return entry;
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

const cleanWord = (s: unknown) => String(s || "").trim().replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "").toLowerCase().slice(0, 60);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json();
    const aKey = Deno.env.get("ANTHROPIC_API_KEY");
    const mKey = Deno.env.get("MW_API_KEY");

    // Batch mode (Kobo import): { items: [{ word, book }] } -> { results: [entry | { input, error }] }
    if (Array.isArray(body.items)) {
      const items = body.items.slice(0, 20)
        .map((i: any) => ({ word: cleanWord(i?.word), book: String(i?.book || "").trim().slice(0, 200) }))
        .filter((i: any) => i.word);
      if (!items.length) return json({ results: [] });
      let entries: (Entry | null)[] = items.map(() => null);
      if (aKey) entries = await claudeBatch(items, aKey).catch((e) => { console.error(e); return entries; });
      const results = await Promise.all(items.map(async (it: any, n: number) => {
        let e = entries[n];
        if (e) e = await addAudio(e, mKey);
        else e = (await dictionaryLookup(it.word, mKey)).entry;
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
    const d = await dictionaryLookup(w, mKey);
    if (d.entry) return json(d.entry);
    return json({ error: "not_found", suggestions: suggestions.length ? suggestions : d.suggestions }, 404);
  } catch (_e) {
    return json({ error: "Lookup failed" }, 500);
  }
});
