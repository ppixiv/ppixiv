// Lookup and caching for user data.

import { helpers } from 'vview/misc/helpers.js';

export default class UserCache extends EventTarget
{
    constructor()
    {
        super();

        this._userData = { };
        this._allUserFollowTags = null;
        this._userFollowInfo = { };
        this._userInfoLoads = {};
        this._followInfoLoads = {};
        this._userFollowTagsLoad = null;
        this._nonexistantUserIds = { };
    }

    async getUserIdForMediaId(mediaId)
    {
        if(mediaId == null)
            return null;

        // If the media ID is a user ID, use it.
        let { type, id } = helpers.mediaId.parse(mediaId);
        if(type == "user")
            return id;

        // Fetch media info.  We don't need to coalesce these requests if this is called
        // multiple times, since MediaCache will do that for us.
        let mediaInfo = await ppixiv.mediaCache.getMediaInfo(mediaId, { full: false });
        return mediaInfo?.userId;
    }

    // Fire usermodified to let listeners know that a user's info changed.
    callUserModifiedCallbacks(userId)
    {
        console.log(`User modified: ${userId}`);
        let event = new Event("usermodified");
        event.user_id = userId;
        this.dispatchEvent(event);
    }
    
    getUserLoadError(userId)
    {
        return this._nonexistantUserIds[userId];
    }

    // The user request can either return a small subset of data (just the username,
    // profile image URL, etc.), or a larger set with a webpage URL, Twitter, etc.
    // User preloads often only have the smaller set, and we want to use the preload
    // data whenever possible.
    //
    // getUserInfo requests the smaller set of data, and getUserInfoFull requests
    // the full data.
    //
    // Note that getUserInfo will return the full data if we have it already.
    async getUserInfoFull(userId)
    {
        return await this._getUserInfo(userId, true);
    }

    async getUserInfo(userId)
    {
        return await this._getUserInfo(userId, false);
    }

    // Return user info for userId if it's already cached, otherwise return null.
    //
    // If afterLoad is given and the user info isn't available, load the user in the background.
    // If user info can be loaded, call afterLoad() when the load completes.
    getUserInfoSync(userId, { afterLoad=null }={})
    {
        if(this._userData[userId])
            return this._userData[userId];
        
        if(afterLoad == null)
            return null;
        
        this.getUserInfo(userId).then((userInfo) => {
            if(userInfo)
                afterLoad(userInfo);
        });
        return null;
    }

    // Load userId if needed.
    //
    // If loadFullData is false, it means the caller only needs partial data, and we
    // won't send a request if we already have that, but if we do end up loading the
    // user we'll always load full data.
    //
    // Some sources only give us partial data, which only has a subset of keys.  See
    // _checkUserData for the keys available with partial and full data.
    _getUserInfo(userId, loadFullData)
    {
        if(userId == null)
            return null;

        // Stop if we know this user doesn't exist.
        let baseMediaId = `user:${userId}`;
        if(baseMediaId in this._nonexistantUserIds)
            return null;
        
        // If we already have the user info for this illustration (and it's full data, if
        // requested), we're done.
        if(this._userData[userId] != null)
        {
            // userInfo.partial is 1 if it's the full data (this is backwards).  If we need
            // full data and we only have partial data, we still need to request data.
            if(!loadFullData || this._userData[userId].partial)
            {
                return new Promise(resolve => {
                    resolve(this._userData[userId]);
                });
            }
        }

        // If there's already a load in progress, just return it.
        if(this._userInfoLoads[userId] != null)
            return this._userInfoLoads[userId];
       
        this._userInfoLoads[userId] = this._loadUserInfo(userId);
        this._userInfoLoads[userId].then(() => {
            delete this._userInfoLoads[userId];
        });

        return this._userInfoLoads[userId];
    };
    
    async _loadUserInfo(userId)
    {
        // -1 is for illustrations with no user, which is used for local images.
        if(userId == -1)
            return null;

        // console.log("Fetch user", userId);
        let result = await helpers.pixivRequest.get(`/ajax/user/${userId}`, {full:1});
        if(result == null || result.error)
        {
            let message = result?.message || "Error loading user";
            console.log(`Error loading user ${userId}: ${message}`);
            this._nonexistantUserIds[`user:${userId}`] = message;
            return null;
        }

        return this._loadedUserInfo(result);
    }

    // Add user data that we received from other sources.
    addUserData(userData)
    {
        this._loadedUserInfo({
            body: userData,
        });
    }

    _loadedUserInfo = (userResult) =>
    {
        if(userResult.error)
            return;

        let userData = userResult.body;
        userData = this._checkUserData(userData);

        let userId = userData.userId;
        // console.log("Got user", userId);

        // Store the user data.
        if(this._userData[userId] == null)
            this._userData[userId] = userData;
        else
        {
            // If we already have an object for this user, we're probably replacing partial user data
            // with full user data.  Don't replace the userData object itself, since widgets will have
            // a reference to the old one which will become stale.  Just replace the data inside the
            // object.
            let oldUserData = this._userData[userId];
            for(let key of Object.keys(oldUserData))
                delete oldUserData[key];
            for(let key of Object.keys(userData))
                oldUserData[key] = userData[key];
        }

        return userData;
    }

    _checkUserData(userData)
    {
        // Make sure that the data contains all of the keys we expect, so we catch any unexpected
        // missing data early.  Discard keys that we don't use, to make sure we update this if we
        // make use of new keys.  This makes sure that the user data keys are always consistent.
        let fullKeys = [
            'userId',
            // 'background',
            // 'image',
            'imageBig',
            // 'isBlocking',
            'isFollowed',
            'isMypixiv',
            'name',
            'partial',
            'social',
            'commentHtml',
            // 'premium',
            // 'sketchLiveId',
            // 'sketchLives',
        ];

        let partialKeys = [
            'userId',
            'isFollowed',
            'name',
            'imageBig',
            'partial',
        ];

        // partial is 0 if this is partial user data and 1 if it's full data (this is backwards).
        let expectedKeys = userData.partial? fullKeys:partialKeys;

        let remappedUserData = { };
        for(let key of expectedKeys)
        {
            if(!(key in userData))
            {
                console.warn("User info is missing key:", key);
                continue;
            }
            remappedUserData[key] = userData[key];
        }
        return remappedUserData;
    }

    // Load the follow info for a followed user, which includes follow tags and whether the
    // follow is public or private.  If the user isn't followed, return null.
    // 
    // This can also fetch the results of loadAllUserFollowTags and will cache it if
    // available, so if you're calling both getUserFollowInfo and loadAllUserFollowTags,
    // call this first.
    async getUserFollowInfo(userId, { refresh=false }={})
    {
        // If we request following info for a user we're not following, we'll get a 400.  This
        // isn't great, since it means we have to make an extra API call first to see if we're
        // following to avoid spamming request errors.
        let userData = await this.getUserInfo(userId);
        if(!userData.isFollowed)
        {
            delete this._userFollowInfo[userId];
            return null;
        }

        // Stop if this user's follow info is already loaded.
        if(!refresh && this._userFollowInfo[userId])
            return this._userFollowInfo[userId];

        // If another request is already running for this user, wait for it to finish and use
        // its result.
        if(this._followInfoLoads[userId])
        {
            await this._followInfoLoads[userId];
            return this._userFollowInfo[userId];
        }

        this._followInfoLoads[userId] = helpers.pixivRequest.get("/ajax/following/user/details", {
            user_id: userId,
            lang: "en",
        });
        
        let data = await this._followInfoLoads[userId];
        this._followInfoLoads[userId] = null;

        if(data.error)
        {
            console.log(`Couldn't request follow info for ${userId}`);
            return null;
        }

        // This returns both selected tags and all follow tags, so we can also update
        // _userFollowInfo.
        let allTags = [];
        let tags = new Set();
        for(let tagInfo of data.body.tags)
        {
            allTags.push(tagInfo.name);
            if(tagInfo.selected)
                tags.add(tagInfo.name);
        }

        this._setCachedAllUserFollowTags(allTags);
        this._userFollowInfo[userId] = {
            tags,
            followingPrivately: data.body.restrict == "1",
        }
        return this._userFollowInfo[userId];
    }

    getUserFollowInfoSync(userId)
    {
        return this._userFollowInfo[userId];
    }

    // Load all of the user's follow tags.  This is cached unless refresh is true.
    async loadAllUserFollowTags({ refresh=false }={})
    {
        // Follow tags require premium.
        if(!ppixiv.pixivInfo.premium)
            return [];

        if(!refresh && this._allUserFollowTags != null)
            return this._allUserFollowTags;

        // If another call is already running, wait for it to finish and use its result.
        if(this._userFollowTagsLoad)
        {
            await this._userFollowTagsLoad;
            return this._allUserFollowTags;
        }

        // The only ways to get this list seem to be from looking at an already-followed
        // user, or looking at the follow list.
        this._userFollowTagsLoad = helpers.pixivRequest.get(`/ajax/user/${ppixiv.pixivInfo.userId}/following`, {
            offset: 0,
            limit: 1,
            rest: "show",
        });
        
        let result = await this._userFollowTagsLoad;
        this._userFollowTagsLoad = null;

        if(result.error)
            console.log("Error retrieving follow tags");
        else
            this._setCachedAllUserFollowTags(result.body.followUserTags);

        return this._allUserFollowTags;
    }
    
    // Update the list of tags we've followed a user with.
    _setCachedAllUserFollowTags(tags)
    {
        tags.sort();

        // Work around a Pixiv bug.  If you ever use the follow user API with a tag
        // of null (instead of ""), it returns an internal error and you end up with
        // a "null" tag in your tag list that never goes away.  It seems like it stores
        // the actual null value, which then gets coerced to the string "null" in the
        // API.  Remove it, since it's annoying (sorry if you really wanted to tag
        // people as "null").
        let idx = tags.indexOf("null");
        if(idx != -1)
            tags.splice(idx, 1);

        this._allUserFollowTags = tags;
    }

    // Add a new tag to _allUserFollowTags when the user creates a new one.
    addCachedUserFollowTags(tag)
    {
        if(this._allUserFollowTags == null || this._allUserFollowTags.indexOf(tag) != -1)
            return;

        this._allUserFollowTags.push(tag);
        this._allUserFollowTags.sort();
    }

    // Update the follow info for a user.  This is used after updating a follow.
    updateCachedFollowInfo(userId, followed, followInfo)
    {
        // If user info isn't loaded, follow info isn't either.
        let userInfo = this.getUserInfoSync(userId);
        if(userInfo == null)
            return;

        userInfo.isFollowed = followed;
        if(!followed)
        {
            delete this._userFollowInfo[userId];
        }
        else
        {
            this._userFollowInfo[userId] = followInfo;
        }

        this.callUserModifiedCallbacks(userId);
    }
}