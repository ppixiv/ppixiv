# PPixiv Plus

A PPixiv overhaul.

## What's news

- New ui style;
- Morden UX;
- Optimization, performance boots;
- More biased invasive changing;
- Compatible with ppixiv;
- And more ...

## Usage

### Note

ADblock may cause compatibility issue, disable it.

## Build

`python -m vview.build.build_ppixiv`

## Live Debug

`python -m http.server 8000`

Install fellow script:

```js
// ==UserScript==
// @name        pppixiv for Pixiv
// @author      rainbowflesh, ppixiv
// @namespace   pppixiv
// @description A PPixiv overhaul.
// @homepage    https://github.com/ppixiv/ppixiv
// @match       https://*.pixiv.net/*
// @run-at      document-start
// @icon        https://ppixiv.org/ppixiv.png
// @grant       GM.xmlHttpRequest
// @grant       GM.setValue
// @grant       GM.getValue
// @connect     pixiv.net
// @connect     pximg.net
// @connect     self
// @connect     *
// @comment     Live debug profile
// @require     http://[::1]:8000/output/ppixiv-main.user.js
// ==/UserScript==
(async function () {
  GM.xmlHttpRequest({
    url: "http://[::1]:8000/output/ppixiv-main.user.js",
    onload: async (response) => {
      const text = response.responseText;
      const storageData = await GM.getValue("CachedScriptKey");

      if (text != storageData) {
        console.log("reload!");

        await GM.setValue("CachedScriptKey", text);
        location.reload();
      } else {
        console.log("NO reload!");
      }
    },
  });
})();
```
