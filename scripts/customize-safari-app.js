import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const appDir = process.argv[2] || 'Kikoe';

const files = {
  html: join(appDir, 'Shared (App)', 'Resources', 'Base.lproj', 'Main.html'),
  css: join(appDir, 'Shared (App)', 'Resources', 'Style.css'),
  js: join(appDir, 'Shared (App)', 'Resources', 'Script.js'),
};

for (const file of Object.values(files)) {
  if (!existsSync(file)) {
    console.error(`Missing Safari app file: ${file}`);
    process.exit(1);
  }
}

writeFileSync(files.html, `<!DOCTYPE html>
<html>
<head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'">
    <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
    <link rel="stylesheet" href="../Style.css">
    <script src="../Script.js" defer></script>
</head>
<body>
    <main>
        <img class="logo" src="../Icon.png" width="180" height="180" alt="Kikoe Icon">
        <h1>Kikoe</h1>
        <p class="tagline">Voice answers for WaniKani &amp; BunPro</p>

        <section class="platform-ios panel">
            <h2>Enable in Safari</h2>
            <ol>
                <li>Open Settings.</li>
                <li>Go to Apps &gt; Safari &gt; Extensions.</li>
                <li>Turn on Kikoe and allow WaniKani and BunPro access.</li>
            </ol>
            <p class="note">On some iOS versions, Safari is listed directly in Settings instead of under Apps.</p>
        </section>

        <section class="platform-ios panel">
            <h2>Microphone access</h2>
            <p>Open a WaniKani or BunPro review page in Safari and start listening. When Safari asks for microphone access, choose Allow.</p>
        </section>

        <section class="platform-mac panel">
            <h2>Safari extension</h2>
            <p class="state-unknown">You can turn on Kikoe’s extension in Safari Extensions preferences.</p>
            <p class="state-on">Kikoe’s extension is currently on. You can turn it off in Safari Extensions preferences.</p>
            <p class="state-off">Kikoe’s extension is currently off. You can turn it on in Safari Extensions preferences.</p>
            <button class="open-preferences">Quit and Open Safari Extensions Preferences...</button>
            <p class="note">Turning the extension on isn’t quite enough — Safari also asks separately for permission to run it on websites. In that same preferences pane, set Kikoe’s website access to “Allow” (or “Always Allow on Every Website”) for WaniKani and BunPro, or open a review page, click the Kikoe icon in Safari’s toolbar, and choose Allow there.</p>
        </section>
    </main>
</body>
</html>
`);

writeFileSync(files.css, `* {
    -webkit-user-select: none;
    -webkit-user-drag: none;
    box-sizing: border-box;
}

:root {
    color-scheme: light dark;
    --bg: #fbf3e4;
    --card: #fff9ec;
    --text: #11120f;
    --text-soft: #55564d;
    --border: #171713;
    --border-soft: rgba(17, 18, 15, 0.18);
    --accent: #6ab889;
    --accent-hover: #4f9f6f;
    --bg-corner: rgba(199, 230, 204, 0.95);
    --bg-start: #fff9ec;
    --bg-end: #eef5e9;
    --logo-shadow: rgba(17, 18, 15, 0.12);
    --button-text: #11120f;
    --button-border: #11120f;
}

@media (prefers-color-scheme: dark) {
    :root {
        --bg: #11110f;
        --card: #1d1c19;
        --text: #f5f1e5;
        --text-soft: #a9a399;
        --border: #3a3730;
        --border-soft: rgba(245, 241, 229, 0.13);
        --accent-hover: #7ecb9c;
        --bg-corner: rgba(106, 184, 137, 0.24);
        --bg-start: #151410;
        --bg-end: #141713;
        --logo-shadow: rgba(0, 0, 0, 0.28);
    }
}

html {
    min-height: 100%;
    background: var(--bg);
}

body {
    position: relative;
    min-height: 100%;
    margin: 0;
    padding: calc(28px + env(safe-area-inset-top, 0px)) 22px calc(28px + env(safe-area-inset-bottom, 0px));
    background:
        radial-gradient(circle at 94% 0%, var(--bg-corner) 0 150px, transparent 152px),
        linear-gradient(145deg, var(--bg-start) 0%, var(--bg) 70%, var(--bg-end) 100%);
    color: var(--text);
    font: -apple-system-body;
}

main {
    width: min(100%, 520px);
    margin: 0 auto;
}

.logo {
    display: block;
    width: min(46vw, 180px);
    height: auto;
    margin: 0 auto 10px;
    filter: drop-shadow(0 10px 0 var(--logo-shadow));
}

h1 {
    margin: 0;
    font: -apple-system-title1;
    font-weight: 700;
    text-align: center;
}

.tagline {
    margin: 6px auto 26px;
    color: var(--text-soft);
    font: -apple-system-subheadline;
    text-align: center;
}

.panel {
    margin: 0 0 16px;
    padding: 18px;
    background: var(--card);
    border: 2px solid var(--border);
    border-radius: 20px;
    text-align: left;
}

h2 {
    margin: 0 0 12px;
    color: var(--accent);
    font: -apple-system-footnote;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
}

p,
ol {
    margin: 0;
    color: var(--text-soft);
    font: -apple-system-body;
    line-height: 1.45;
}

ol {
    padding-left: 1.25em;
}

li + li {
    margin-top: 6px;
}

.note {
    margin-top: 12px;
    font: -apple-system-footnote;
}

button {
    width: 100%;
    margin-top: 16px;
    padding: 12px 18px;
    border: 2px solid var(--button-border);
    border-radius: 999px;
    background: var(--accent);
    color: var(--button-text);
    font: -apple-system-headline;
}

button:active {
    background: var(--accent-hover);
}

body:not(.platform-mac, .platform-ios) :is(.platform-mac, .platform-ios) {
    display: none;
}

body.platform-ios .platform-mac,
body.platform-mac .platform-ios {
    display: none;
}

body:not(.state-on, .state-off) :is(.state-on, .state-off) {
    display: none;
}

body.state-on :is(.state-off, .state-unknown),
body.state-off :is(.state-on, .state-unknown) {
    display: none;
}
`);

writeFileSync(files.js, `function show(platform, enabled, useSettingsInsteadOfPreferences) {
    document.body.classList.add(\`platform-\${platform}\`);

    if (useSettingsInsteadOfPreferences) {
        document.getElementsByClassName('platform-mac state-on')[0].innerText = "Kikoe’s extension is currently on. You can turn it off in the Extensions section of Safari Settings.";
        document.getElementsByClassName('platform-mac state-off')[0].innerText = "Kikoe’s extension is currently off. You can turn it on in the Extensions section of Safari Settings.";
        document.getElementsByClassName('platform-mac state-unknown')[0].innerText = "You can turn on Kikoe’s extension in the Extensions section of Safari Settings.";
        document.getElementsByClassName('platform-mac open-preferences')[0].innerText = "Quit and Open Safari Settings...";
    }

    if (typeof enabled === "boolean") {
        document.body.classList.toggle("state-on", enabled);
        document.body.classList.toggle("state-off", !enabled);
    } else {
        document.body.classList.remove("state-on");
        document.body.classList.remove("state-off");
    }
}

function postControllerMessage(message) {
    webkit.messageHandlers.controller.postMessage(message);
}

document.querySelector("button.open-preferences")?.addEventListener("click", () => {
    postControllerMessage("open-preferences");
});
`);

console.log(`Customized Safari containing app at ${appDir}`);
