// ==UserScript==
// @name        ppixiv for Pixiv
// @author      ppixiv
// @namespace   ppixiv
// @description Better Pixiv viewing | Fullscreen images | Faster searching | Bigger thumbnails | Download ugoira MKV | Ugoira seek bar | Download manga ZIP | One-click like, bookmark, follow | One-click zoom and pan
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
//
// @comment     Note: this doesn't actually give the script access everywhere.  It just lets us request
// @comment     access to new domains at runtime.  If you use a feature that needs access to another site,
// @comment     the script manager will ask for permission the first time.
// @connect     *
//
