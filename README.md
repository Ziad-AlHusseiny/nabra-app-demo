# Nabra · clickable demo

A live demo of **Nabra (نبرة)**, an AI reading-fluency screener for Arabic-speaking children, built as a graduation project. A teacher signs in, picks a child and a passage, the child reads aloud, and the teacher sees each word marked, the reading errors, and a risk band with its evidence.

**Open the demo:** https://ziad-alhusseiny.github.io/nabra-app-demo/

> **Nabra is a screener, not a diagnosis.** Its output is a risk band (`low`, `watch` or `refer`) with evidence. It never says a child has dyslexia.
>
> **This demo has no server and no model.** Every class, child and result is **sample data**. Each result is computed from a scripted sample reading; no model results are claimed. No child was recorded.
>
> **The microphone recording never leaves your browser.** The demo uses the real microphone to show the recording steps, keeps the take in memory only, and drops it after the sample result appears. Nothing is uploaded or saved.

## Try it

1. Open the link. The sign-in form is already filled with the demo account; press «دخول».
2. Open class ٢/أ, start a session for a child, read the passage aloud, and press «تحليل القراءة». Open any word, then «تقرير ولي الأمر» to see and print the parent report.
3. Press the pill «عرض تجريبي» (or Alt+Shift+D) to open any screen or error state directly, switch light and dark, turn motion off, use a simulated microphone if your computer has none, or reset the demo.

The demo keeps its sample data in your browser (local storage) only, so your changes stay on your device; «إعادة العرض إلى بدايته» in the demo panel restores the start. Please do not type the names of real children.

Made for current Chrome, Edge and Safari on a laptop or a tablet (768 px and wider). The interface is Arabic, right to left. The microphone needs the browser's permission; without one, use the simulated microphone in the demo panel.

## What is in this repository

```
site/                 the published app: built files only (HTML, JavaScript, CSS, fonts, an SVG icon)
  source.json         the Nabra commit the site was built from
tools/check.mjs       the check that runs before every deploy
tools/required.json   the app's own screener and sample-data lines the check requires
.github/workflows/    runs the check on the whole repository, then deploys site/ to GitHub Pages
.gitignore            files that must never be published here
```

The source code lives in Nabra's own repository, which is private. Everything here is written by `npm run demo:site` in Nabra, from the Nabra commit named in `site/source.json` (normally its reviewed `main` branch). The check refuses any file outside this layout, a source map, any audio or video, a local path, an internal code, a link into the private repository, any web address not on its short list and any email but the demo account's, and it requires the demo labelling. Do not edit anything here by hand; the next build replaces it.

## Update the demo

In a Nabra checkout next to this one:

```bash
git -C nabra fetch
cd nabra/web
npm run demo:site -- --ref origin/main --out ../../nabra-app-demo
```

Then look at `site/` locally if you wish (`python3 -m http.server 8000 --directory site`), commit everything here, and push to `main`. The workflow checks the site again and deploys it.
