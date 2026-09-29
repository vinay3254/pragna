// Decides, per user message, whether the slow paths are worth taking.
// Live web search and the tool-calling loop each add seconds to a reply, so both
// stay off unless the message clearly needs them. Keep the rules explicit and tight:
// a false positive costs latency on every chat, a false negative only means the
// model answers from its own knowledge.

const GREETING = /^(hi|hii+|hello|hey|greetings|good (morning|evening|afternoon|night)|howdy|sup|thanks|thank you|thx|bye|goodbye|ok|okay|cool|nice|great|yes|no|yep|nope)[!.? ]*$/i;

const IMAGE_REQUEST =
  /\b(generate|create|draw|make|render|paint|produce|give me|show me)\b.*\b(image|picture|photo|illustration|drawing|painting|artwork|graphic|portrait|wallpaper|sketch|logo)\b/i;

const DATE_TIME_QUESTION =
  /^\W*(what('s|s| is| was)?|tell me)\s+(the\s+)?(current\s+|today'?s?\s+)?(date|time|day)(\s+and\s+(date|time|day))?(\s+(now|today|right now))?\W*$/i;

const ARITHMETIC = /^(what is |calculate |compute |solve )?[\d\s+\-*/^().%x×÷=]+\??$/i;

const GENERIC_CODING =
  /^(write|create|implement|give me|show me|explain|fix|debug|refactor|convert)\b.*\b(python|javascript|typescript|c\+\+|java|rust|golang|html|css|sql|function|script|algorithm|regex|class|component|code|bug|error)\b/i;

const CREATIVE_OR_TRANSFORM =
  /^(write|draft|compose|rewrite|rephrase|paraphrase|summari[sz]e|translate|proofread|improve|shorten|expand)\b/i;

const URL = /https?:\/\/\S+/i;

// Phrases that mean the answer depends on information newer than the model's training.
const FRESHNESS_CUES =
  /\b(latest|current(ly)?|today|tonight|tomorrow|yesterday|right now|this (week|month|year)|recent(ly)?|news|breaking|headlines?|update[sd]?|price of|prices?|stock|share price|weather|forecast|score|scores|match|fixtures?|standings|results?|live|trending|release date|released|launch(ed)?|who won|election|exchange rate|rate of|worth|market)\b|\b(202[5-9]|203\d)\b/i;

// "Who is the CM / CEO / president of X" style questions have a time-dependent answer.
const ROLE_HOLDER =
  /\b(who (is|are|was)|who's)\b.*\b(ceo|cto|cm|chief minister|prime minister|pm|president|governor|minister|captain|coach|chairman|founder|head)\b|\b(ceo|cm|chief minister|prime minister|president|governor|captain|coach)\s+of\b/i;

const EXPLICIT_SEARCH =
  /\b(search( for| the web| online)?|google( it| for)?|look ?up|find (out|online|info)|browse|check online|on the (web|internet))\b/i;

/** True when a live web search should run before the model answers. */
export function needsLiveSearch(text: string): boolean {
  const msg = (text || '').trim();
  if (!msg || msg.length < 3) return false;

  if (URL.test(msg) || EXPLICIT_SEARCH.test(msg)) return true;

  if (GREETING.test(msg)) return false;
  if (IMAGE_REQUEST.test(msg)) return false;
  if (DATE_TIME_QUESTION.test(msg)) return false; // answered from the live clock in the system prompt
  if (ARITHMETIC.test(msg)) return false;
  if (CREATIVE_OR_TRANSFORM.test(msg)) return false;
  if (GENERIC_CODING.test(msg) && !FRESHNESS_CUES.test(msg)) return false;

  return FRESHNESS_CUES.test(msg) || ROLE_HOLDER.test(msg);
}

// Messages that can only be satisfied by really calling a tool.
const TOOL_INTENTS: RegExp[] = [
  // scheduling and reminders
  /\b(remind me|set (a |an )?(reminder|alarm|timer)|schedule|every (day|week|month|hour|morning|evening|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|at \d{1,2}(:\d{2})?\s*(am|pm))\b/i,
  // running code or commands
  /\b(run|execute)\b.*\b(code|script|python|command|terminal|shell|program)\b/i,
  // files and documents
  /\b(read|open|write to|save to|create|edit|delete)\b.*\b(file|folder|directory)\b/i,
  /\b(pdf|docx|word document|excel|spreadsheet|xlsx|pptx|powerpoint|slide deck)\b/i,
  // web
  EXPLICIT_SEARCH,
  URL,
  /\b(scrape|crawl|extract from (the )?(page|site|website))\b/i,
  // memory and past chats
  /\b(remember (that|this)|don'?t forget|forget (that|this)|what do you (remember|know) about me|my memories)\b/i,
  /\b(last time|earlier|previous(ly)? (chat|conversation)|we (talked|discussed)|search (my )?(chats|history))\b/i,
  // productivity integrations
  /\b(kanban|todo list|to-do|add (a )?task|calendar|meeting|inbox|email|gmail)\b/i,
  // image editing needs the tool, plain image generation has its own path
  /\b(edit|modify|change|remove|replace)\b.*\b(image|photo|picture)\b/i,
  // freshness questions may need web_search even when auto search was skipped
  FRESHNESS_CUES,
  ROLE_HOLDER,
];

/** True when the tool schema should be sent to the model for this message. */
export function needsTools(text: string): boolean {
  const msg = (text || '').trim();
  if (!msg || GREETING.test(msg) || ARITHMETIC.test(msg)) return false;
  return TOOL_INTENTS.some((re) => re.test(msg));
}
