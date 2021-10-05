"use strict";

// This handles querying whether a tag or a user is muted.  We don't handle
// editing this list currently.
this.muting = class
{
    static get singleton()
    {
        if(muting._singleton == null)
            muting._singleton = new muting();
        return muting._singleton;
    };

    constructor()
    {
    }

    set_muted_tags(muted_tags)
    {
        this.muted_tags = muted_tags;
    }

    set_muted_user_ids(muted_user_ids)
    {
        this.muted_user_ids = muted_user_ids;
    }

    is_muted_user_id(user_id)
    {
        return this.muted_user_ids.indexOf(user_id) != -1;
    };

    // Return true if any tag in tag_list is muted.
    any_tag_muted(tag_list)
    {
        for(var tag of tag_list)
        {
            if(tag.tag)
                tag = tag.tag;
            if(this.muted_tags.indexOf(tag) != -1)
                return tag;
        }
        return null;
    }
}

