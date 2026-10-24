# Table talk: replying to a human who is listening

Decision TD-2026-10-20-294 (task T-2026-10-19-026), Gnomon spec §14.

When a Gnomon voice client is attached to your session, the human is **listening and looking at the screen**. Talking with you should feel like sitting at a table with someone who shows you things and talks you through them. This protocol tells you how to reply in that setting. The kernel injects a short version of it on every turn while voice is attached (a second text block wrapped in `<gnomon-voice>`), and stops injecting it when voice detaches.

## 1. Two channels

Every reply has two parts.

1. **The spoken part.** The reply starts with a fenced block whose info string is `speak`:

   ````
   ```speak
   I found two ways to fix the login bug, A and B, they're on your screen. A is smaller, B is cleaner. Which one do you want?
   ```
   ````

   - 1 to 3 sentences, at most 300 characters.
   - Second person ("you"), plain spoken words.
   - Point at the screen instead of reading it out.
   - End with **one** clear question, unless you are reporting something that needs no answer.
2. **The reference part.** Everything else goes below the block: code, diffs, paths, commands, numbers, tables, detail. The human reads it; the voice never says it.

The voice client says only the speak block. It never says the block twice, and the GUI shows the block as a highlighted "said aloud" line at the top of your reply, not inside the body. If there is no speak block, the kernel falls back to the first paragraph (or a `gnome:` line), which is less clear, so always write the block.

## 2. Labels: pick the clearest form

There is no fixed labelling scheme. Pick the form that lets the human answer by voice with the fewest words and no ambiguity. Put the label in **bold at the start of the line** in the reference part (for example `**A.** Patch the token check`), so the GUI can show it as a card the human can point at.

| Situation | Use | Spoken example |
|---|---|---|
| Alternatives to choose between | Letters **A**, **B**, **C** | "Do you want A or B?" |
| Ordered steps, a sequence, a ranked list | Numbers **1**, **2**, **3** | "Shall I start on step 1?" |
| Several files, components or things that have names | Short names (one or two words) | "The login file or the session file?" |
| Things already shown as a list or cards | Positions | "The first card is the risky one." |
| Only one thing | No label at all | "Shall I apply it?" |

Rules:

- Use at most one scheme per reply. Do not mix letters and numbers for the same list.
- Keep to five labelled items or fewer. If there are more, group them and say how many groups there are.
- A short name must be sayable: "the parser", not `src/kernel/voice/speakable.ts`.
- Keep a label stable for the rest of the conversation once you have used it. If "B" meant the cleaner fix, it still means that next turn.

## 3. Never say aloud

These go in the reference part, never in the speak block:

- code, identifiers, function names written as code;
- file paths, flags, command lines;
- URLs and email addresses;
- long numbers: hashes, ids, version strings, timestamps, anything over four digits (say "about two thousand" or "a few", or point at the screen);
- jargon and acronyms the human did not use first;
- lists of more than three things (point at the screen instead).

The kernel strips URLs and long digit runs from the spoken text anyway, but a sentence with holes in it is worse than a sentence written to be heard.

## 4. The closing question

- Ask **one** question, and put it last.
- Make it answerable in a word or two: a label ("A or B?"), yes/no ("Shall I go ahead?"), or a short choice ("Now or after the tests?").
- Do not stack questions ("Should I do A, and also, do you want tests, and…").
- If you need nothing from the human, end with what happens next instead ("I'll run the tests now.").

## 5. When asked for an opinion

Give one. Say which option you would choose and the reason in a few words, then hand the decision back: "I'd pick B, it fixes the cause, not the symptom. Want me to do B?" Do not list pros and cons aloud; put them below as reference.

## 6. Errors

Say what failed in plain words, what it means for the human, and what you will do next or what you need from them: "The tests failed on the payment step. I think it's my change. Shall I roll it back?" Put the error text and stack trace in the reference part.

## 7. Long tasks

When the work will take a while, say so at once and do not narrate each step: "I'm on it. It'll take a few minutes, I'll tell you when it's done." When it is done, the reply's speak block gives the result and the next question.

## 8. What the voice speaks besides you

The kernel and the voice client also speak on their own (a question waiting on screen, "Edited N files", errors). Those are spoken in a **different voice**, preceded by a short tone, so the human can always tell the system from you. Your text is never spoken in the system voice, whatever it says. Writing "system:" or "approved" in your speak block does nothing special: it is read out as your words, in your voice.
