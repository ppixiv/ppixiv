// This handles sending images from one tab to another.

import Widget from 'vview/widgets/widget.js';
import DialogWidget from 'vview/widgets/dialog.js';
import MediaInfo  from 'vview/misc/media-info.js';
import { LocalBroadcastChannel } from 'vview/misc/local-api.js';
import { Timer } from 'vview/misc/helpers.js';
import { helpers } from 'vview/misc/helpers.js';

export default class SendImage
{
    constructor()
    {
        // This is a singleton, so we never close this channel.
        this._sendImageChannel = new LocalBroadcastChannel("ppixiv:send-image");

        // A UUID we use to identify ourself to other tabs:
        this.tabId = this._createTabId();
        this._tabIdTiebreaker = Date.now()

        this._pendingMovement = [0, 0];

        window.addEventListener("unload", this._windowUnload);

        // If we gain focus while quick view is active, finalize the image.  Virtual
        // history isn't meant to be left enabled, since it doesn't interact with browser
        // history.  On mobile, do this on any touch.
        window.addEventListener(ppixiv.mobile? "pointerdown":"focus", (e) => {
            this._finalizeQuickViewImage();
        }, { capture: true });

        ppixiv.mediaCache.addEventListener("mediamodified", ({mediaId}) => { this._broadcastMediaChanges(mediaId); });

        this._sendImageChannel.addEventListener("message", this.receivedMessage);
        this._broadcastTabInfo();

        // Ask other tabs to broadcast themselves, so we can see if we have a conflicting
        // tab ID.
        this.sendMessage({ message: "list-tabs" });
    }

    // Return true if this feature should be displayed.
    //
    // On desktop this can be used across tabs, and when native this can be used
    // across clients.  It isn't useful when on mobile and on Pixiv, since there's
    // nowhere for it to go.
    get enabled()
    {
        return ppixiv.native || !ppixiv.mobile;
    }

    _createTabId(recreate=false)
    {
        // If we have a saved tab ID, use it.
        //
        // sessionStorage on Android Chrome is broken.  Home screen apps should retain session storage
        // for that particular home screen item, but they don't.  (This isn't a problem on iOS.)  Use
        // localStorage instead, which means things like linked tabs will link to the device instead of
        // the instance.  That's usually good enough if you're linking to a phone or tablet.
        let storage = ppixiv.android? localStorage:sessionStorage;
        if(!recreate && storage.ppixivTabId)
            return storage.ppixivTabId;

        // Make a new ID, and save it to the session.  This helps us keep the same ID
        // when we're reloaded.
        storage.ppixivTabId = helpers.other.createUuid();
        return storage.ppixivTabId;
    }

    _finalizeQuickViewImage = () =>
    {
        let args = helpers.args.location;
        if(args.hash.has("temp-view"))
        {
            console.log("Finalizing quick view image because we gained focus");
            args.hash.delete("virtual");
            args.hash.delete("temp-view");
            helpers.navigate(args, { addToHistory: false });
        }
    }

    messages = new EventTarget();

    // If we're sending an image and the page is unloaded, try to cancel it.  This is
    // only registered when we're sending an image.
    _windowUnload = (e) =>
    {
        // If we were sending an image to another tab, cancel it if this tab is closed.
        this.sendMessage({
            message: "send-image",
            action: "cancel",
            to: ppixiv.settings.get("linked_tabs", []),
        });
    }

    // Send an image to another tab.  action is either "temp-view", to show the image temporarily,
    // or "display", to navigate to it.
    async send_image(mediaId, tabIds, action)
    {
        // Send everything we know about the image, so the receiver doesn't have to
        // do a lookup.
        let mediaInfo = ppixiv.mediaCache.getMediaInfoSync(mediaId);

        let userId = mediaInfo?.userId;
        let userInfo = userId? ppixiv.userCache.getUserInfoSync(userId):null;

        this.sendMessage({
            message: "send-image",
            from: this.tabId,
            to: tabIds,
            mediaId,
            action, // "temp-view" or "display"
            mediaInfo: mediaInfo?.serialize,
            userInfo,
            origin: window.origin,
        }, false);
    }

    _broadcastMediaChanges(mediaId)
    {
        // Don't do this if this is coming from another tab, so we don't re-broadcast data
        // we just received.
        if(this._handlingBroadcastedMediaInfo)
            return;
        
        // Broadcast the new info to other tabs.
        this._broadcastImageInfo(mediaId);
    }

    // Send image info to other tabs.  We do this when we know about modifications to
    // an image that other tabs might be displaying, such as the like count and crop
    // info.  This isn't done when we simply load image data from the server, so we're
    // not constantly sending all search results to all tabs.  We don't currently update
    // thumbnail data from image data, so if a tab edits image data while it doesn't have
    // thumbnail data loaded, other tabs with only thumbnail data loaded won't see it.
    _broadcastImageInfo(mediaId)
    {
        // Send everything we know about the image, so the receiver doesn't have to
        // do a lookup.
        let mediaInfo = ppixiv.mediaCache.getMediaInfoSync(mediaId);

        let userId = mediaInfo?.userId;
        let userInfo = userId? ppixiv.userCache.getUserInfoSync(userId):null;

        this.sendMessage({
            message: "image-info",
            from: this.tabId,
            mediaId,
            mediaInfo: mediaInfo?.serialize,
            bookmarkTags: ppixiv.extraCache.getBookmarkDetailsSync(mediaId),
            userInfo,
            origin: window.origin,
        }, false);
    }

    receivedMessage = async(e) =>
    {
        let data = e.data;

        // If this message has a target and it's not us, ignore it.
        if(data.to && data.to.indexOf(this.tabId) == -1)
            return;

        let event = new Event(data.message);
        event.message = data;
        this.messages.dispatchEvent(event);

        if(data.message == "tab-info")
        {
            if(data.from == this.tabId)
            {
                // The other tab has the same ID we do.  The only way this normally happens
                // is if a tab is duplicated, which will duplicate its sessionStorage with it.
                // If this happens, use tab_id_tiebreaker to decide who wins.  The tab with
                // the higher value will recreate its tab ID.  This is set to the time when
                // we're loaded, so this will usually cause new tabs to be the one to create
                // a new ID.
                if(this._tabIdTiebreaker >= data.tab_id_tiebreaker)
                {
                    console.log("Creating a new tab ID due to ID conflict");
                    this.tabId = this._createTabId(true /* recreate */ );
                }
                else
                    console.log("Tab ID conflict (other tab will create a new ID)");

                // Broadcast info.  If we recreated our ID then we want to broadcast it on the
                // new ID.  If we didn't, we still want to broadcast it to replace the info
                // the other tab just sent on our ID.
                this._broadcastTabInfo();
            }
        }
        else if(data.message == "list-tabs")
        {
            // A new tab opened, and is asking for other tabs to broadcast themselves to check for
            // tab ID conflicts.
            this._broadcastTabInfo();
        }
        else if(data.message == "send-image")
        {
            // If this message has illust info or thumbnail info and it's on the same origin,
            // register it.
            if(data.origin == window.origin)
            {
                console.log("Registering cached image info");
                let { mediaInfo, userInfo } = data;
                if(userInfo != null)
                    ppixiv.userCache.addUserData(userInfo);
                if(mediaInfo != null)
                    ppixiv.mediaCache.addMediaInfoFull(mediaInfo, { preprocessed: true });
            }
            // To finalize, just remove preview and quick-view from the URL to turn the current
            // preview into a real navigation.  This is slightly different from sending "display"
            // with the illust ID, since it handles navigation during quick view.
            if(data.action == "finalize")
            {
                let args = helpers.args.location;
                args.hash.delete("virtual");
                args.hash.delete("temp-view");
                helpers.navigate(args, { addToHistory: false });
                return;
            }

            if(data.action == "cancel")
            {
                this.hidePreviewImage();
                return;
            }

            // Otherwise, we're displaying an image.  quick-view displays in quick-view+virtual
            // mode, display just navigates to the image normally.
            console.assert(data.action == "temp-view" || data.action == "display", data.actionj);

            // Show the image.
            ppixiv.app.showMediaId(data.mediaId, {
                tempView: data.action == "temp-view",
                source: "temp-view",

                // When we first show a preview, add it to history.  If we show another image
                // or finalize the previewed image while we're showing a preview, replace the
                // preview history entry.
                addToHistory: !ppixiv.phistory.virtual,
            });
        }
        else if(data.message == "image-info")
        {
            if(data.origin != window.origin)
                return;

            // We need to make sure that we don't recurse: adding media info will trigger mediamodified,
            // which can cause us to come back here and send it again.  First flush any waiting mediamodified
            // events, since these happen async and we only want to ignore the ones we cause.
            MediaInfo.flushMediaInfoModifiedCallbacks();

            // addMediaInfoFull will trigger mediamodified below.  Make sure we don't rebroadcast
            // info that we're receiving here.
            this._handlingBroadcastedMediaInfo = true;
            try {
                // Another tab is broadcasting updated image info.  If we have this image loaded,
                // update it.
                let { mediaInfo, bookmarkTags, userInfo } = data;
                if(mediaInfo != null)
                    ppixiv.mediaCache.addMediaInfoFull(mediaInfo, { preprocessed: true });

                if(bookmarkTags != null)
                    ppixiv.extraCache.updateCachedBookmarkTags(data.mediaId, bookmarkTags);
                if(userInfo != null)
                    ppixiv.userCache.addUserData(userInfo);

                // Flush the mediamodified events we just caused before unsetting _handlingBroadcastedMediaInfo.
                MediaInfo.flushMediaInfoModifiedCallbacks();
            } finally {
                this._handlingBroadcastedMediaInfo = false;
            }
        }
        else if(data.message == "preview-mouse-movement")
        {
            // Ignore this message if we're not displaying a quick view image.
            if(!ppixiv.phistory.virtual)
                return;
            
            // The mouse moved in the tab that's sending quick view.  Broadcast an event
            // like pointermove.  We have to work around a stupid pair of bugs: Safari
            // doesn't handle setting movementX/movementY in the constructor, and Firefox
            // *only* handles it that way, throwing an error if you try to set it manually.
            let event = new PointerEvent("quickviewpointermove", {
                movementX: data.x,
                movementY: data.y,
            });

            if(event.movementX == null)
            {
                event.movementX = data.x;
                event.movementY = data.y;
            }

            window.dispatchEvent(event);
        }
    }

    _broadcastTabInfo = () =>
    {
        let ourTabInfo = {
            message: "tab-info",
            tab_id_tiebreaker: this._tabIdTiebreaker,
        };

        this.sendMessage(ourTabInfo);
    }

    sendMessage(data, send_to_self)
    {
        // Include the tab ID in all messages.
        data.from = this.tabId;
        this._sendImageChannel.postMessage(data);

        if(send_to_self)
        {
            // Make a copy of data, so we don't modify the caller's copy.
            data = JSON.parse(JSON.stringify(data));

            // Set self to true to let us know that this is our own message.
            data.self = true;
            this._sendImageChannel.dispatchEvent(new MessageEvent("message", { data: data }));
        }
    }

    // If we're currently showing a preview image sent from another tab, back out to
    // where we were before.
    hidePreviewImage()
    {
        let wasInPreview = ppixiv.phistory.virtual;
        if(!wasInPreview)
            return;

        ppixiv.phistory.back();        
    }

    sendMouseMovementToLinkedTabs(x, y)
    {
        if(!ppixiv.settings.get("linked_tabs_enabled"))
            return;

        let tabIds = ppixiv.settings.get("linked_tabs", []);
        if(tabIds.length == 0)
            return;

        this._pendingMovement[0] += x;
        this._pendingMovement[1] += y;

        // Limit the rate we send these, since mice with high report rates can send updates
        // fast enough to saturate BroadcastChannel and cause messages to back up.  Add up
        // movement if we're sending too quickly and batch it into the next message.
        if(this.lastMovementMessageTime != null && Date.now() - this.lastMovementMessageTime < 10)
            return;

        this.lastMovementMessageTime = Date.now();

        this.sendMessage({
            message: "preview-mouse-movement",
            x: this._pendingMovement[0],
            y: this._pendingMovement[1],
            to: tabIds,
        }, false);
        
        this._pendingMovement = [0, 0];
    }
};

export class LinkTabsPopup extends Widget
{
    constructor({...options})
    {
        super({...options,
            classes: "link-tab-popup",
            template: `
            <div class="link-tab-popup">
                <div class=explanation>
                    <ppixiv-inline src="resources/multi-monitor.svg" class=tutorial-monitor></ppixiv-inline>
                    <div style="margin: 10px 0 15px 0; font-size: 125%;">
                        Open a 
                        <img src="ppixiv:resources/activate-icon.png" style="width: 28px; vertical-align: bottom;">
                        tab on another monitor and click "Link this tab" to send images to it
                    </div>
                </div>
            </div>
        `});
    }

    // Send show-link-tab to tell other tabs to display the "link this tab" popup.
    // This includes the linked tab list, so they know whether to say "link" or "unlink".
    sendLinkTabMessage = () =>
    {
        if(!this.visible)
            return;

        ppixiv.sendImage.sendMessage({
            message: "show-link-tab",
            linkedTabs: ppixiv.settings.get("linked_tabs", []),
        });
    }

    visibilityChanged()
    {
        super.visibilityChanged();

        if(!this.visible)
        {
            ppixiv.sendImage.sendMessage({ message: "hide-link-tab" });
            return;
        }

        helpers.other.interval(this.sendLinkTabMessage, 1000, this.visibilityAbort.signal);

        // Refresh the "unlink all tabs" button on other tabs when the linked tab list changes.
        ppixiv.settings.addEventListener("linked_tabs", this.sendLinkTabMessage, { signal: this.visibilityAbort.signal });

        // The other tab will send these messages when the link and unlink buttons
        // are clicked.
        ppixiv.sendImage.messages.addEventListener("link-this-tab", (e) => {
            let message = e.message;

            let tabIds = ppixiv.settings.get("linked_tabs", []);
            if(tabIds.indexOf(message.from) == -1)
                tabIds.push(message.from);

            ppixiv.settings.set("linked_tabs", tabIds);

            this.sendLinkTabMessage();
        }, this._signal);

        ppixiv.sendImage.messages.addEventListener("unlink-this-tab", (e) => {
            let message = e.message;
            let tabIds = ppixiv.settings.get("linked_tabs", []);
            let idx = tabIds.indexOf(message.from);
            if(idx != -1)
                tabIds.splice(idx, 1);

            ppixiv.settings.set("linked_tabs", tabIds);

            this.sendLinkTabMessage();
        }, this._signal);
    }
}

export class LinkThisTabPopup extends DialogWidget
{
    static setup()
    {
        let hideTimer = new Timer(() => {
            this.visible = false;
        });
        
        let dialog = null;
        
        // Show ourself when we see a show-link-tab message and hide if we see a
        // hide-link-tab-message.
        ppixiv.sendImage.messages.addEventListener("show-link-tab", ({message}) => {
            LinkThisTabPopup.other_tab_id = message.from;
            hideTimer.set(2000);

            if(dialog != null)
                return;

            dialog = new LinkThisTabPopup({ message });

            dialog.shutdownSignal.addEventListener("abort", () => {
                hideTimer.clear();
                dialog = null;
            });

            ppixiv.sendImage.messages.addEventListener("hide-link-tab", ({message}) => {
                // Close the dialog if it's running.
                if(dialog)
                    dialog.visible = false;
            }, dialog._signal);
        });
    }

    constructor({
        message,
        ...options
    }={})
    {
        super({...options,
            dialogClass: "simple-button-dialog",
            dialogType: "small",

            // This dialog is closed when the sending tab closes the link tab interface.
            allowClose: false,

            template: `
                ${ helpers.createBoxLink({ label: "Link this tab", classes: ["link-this-tab"]}) }
                ${ helpers.createBoxLink({ label: "Unlink this tab", classes: ["unlink-this-tab"]}) }
            `
        });

        this._linkThisTab = this.querySelector(".link-this-tab");
        this._unlinkThisTab = this.querySelector(".unlink-this-tab");
        this._linkThisTab.hidden = true;
        this._unlinkThisTab.hidden = true;

        // Show ourself when we see a show-link-tab message and hide if we see a
        // hide-link-tab-message.
        ppixiv.sendImage.messages.addEventListener("show-link-tab", ({message}) => this.showLinkTabMessage({message}), this._signal);

        // When "link this tab" is clicked, send a link-this-tab message.
        this._linkThisTab.addEventListener("click", (e) => {
            ppixiv.sendImage.sendMessage({ message: "link-this-tab", to: [LinkThisTabPopup.other_tab_id] });

            // If we're linked to another tab, clear our linked tab list, to try to make
            // sure we don't have weird chains of tabs linking each other.
            ppixiv.settings.set("linked_tabs", []);
        }, this._signal);

        this._unlinkThisTab.addEventListener("click", (e) => {
            ppixiv.sendImage.sendMessage({ message: "unlink-this-tab", to: [LinkThisTabPopup.other_tab_id] });
        }, this._signal);
        
        this.showLinkTabMessage({message});
    }

    showLinkTabMessage({message})
    {
        let linked = message.linkedTabs.indexOf(ppixiv.sendImage.tabId) != -1;
        this._linkThisTab.hidden = linked;
        this._unlinkThisTab.hidden = !linked;
    }
}

export class SendImagePopup extends DialogWidget
{
    constructor({mediaId, ...options}={})
    {
        super({...options,
            showCloseButton: false,
            dialogType: "small",

            template: `
                <div>
                    Click a
                    <img src="ppixiv:resources/activate-icon.png" style="width: 28px; vertical-align: bottom;">
                    tab to send the image there
                </div>
        `});

        // Close if the container is clicked, but not if something inside the container is clicked.
        this.root.addEventListener("click", (e) => {
            if(e.target != this.root)
                return;

            this.visible = false;
        });

        // Periodically send show-send-image to tell other tabs to show SendHerePopup.
        // If they're clicked, they'll send take-image.
        helpers.other.interval(() => {
            // We should always be visible when this is called.
            console.assert(this.visible);

            ppixiv.sendImage.sendMessage({ message: "show-send-image" });
        }, 1000, this.shutdownSignal);

        ppixiv.sendImage.messages.addEventListener("take-image", ({message}) => {
            let tabId = message.from;
            ppixiv.sendImage.send_image(mediaId, [tabId], "display");

            this.visible = false;
        }, this._signal);
    }

    shutdown()
    {
        super.shutdown();

        ppixiv.sendImage.sendMessage({ message: "hide-send-image" });
    }
}

export class SendHerePopup extends DialogWidget
{
    static setup()
    {
        // Show ourself when we see a show-link-tab message and hide if we see a
        // hide-link-tab-message.
        let hideTimer = new Timer(() => {
            this.visible = false;
        });

        let dialog = null;
        ppixiv.sendImage.messages.addEventListener("show-send-image", ({message}) => {
            SendHerePopup.other_tab_id = message.from;
            hideTimer.set(2000);

            if(dialog == null)
            {
                dialog = new SendHerePopup();
                dialog.shutdownSignal.addEventListener("abort", () => {
                    hideTimer.clear();
                    dialog = null;
                });
            }
        }, this._signal);

        ppixiv.sendImage.messages.addEventListener("hide-send-image", ({message}) => {
            // Close the dialog if it's running.
            if(dialog)
                dialog.visible = false;
        }, this._signal);
    }

    constructor({...options}={})
    {
        super({...options,
            dialogClass: "simple-button-dialog",
            small: true,

            // This dialog is closed when the sending tab closes the send image interface.
            allowClose: false,
            template: `
                ${ helpers.createBoxLink({ label: "Click to send image here", classes: ["link-this-tab"]}) }
        `});

        window.addEventListener("click", this.takeImage, { signal: this.shutdownSignal });
    }

    takeImage = (e) =>
    {
        // Send take-image.  The sending tab will respond with a send-image message.
        ppixiv.sendImage.sendMessage({ message: "take-image", to: [SendHerePopup.other_tab_id] });
    }
}
