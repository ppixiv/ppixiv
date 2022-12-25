// Keep track of bookmark tags the user has used recently.

export default class RecentBookmarkTags
{
    static setRecentBookmarkTags(tags)
    {
        ppixiv.settings.set("recent-bookmark-tags", JSON.stringify(tags));
    }

    static getRecentBookmarkTags()
    {
        let recentBookmarkTags = ppixiv.settings.get("recent-bookmark-tags");
        if(recentBookmarkTags == null)
            return [];
        return JSON.parse(recentBookmarkTags);
    }

    // Move tagList to the beginning of the recent tag list, and prune tags at the end.
    static updateRecentBookmarkTags(tagList)
    {
        // Move the tags we're using to the top of the recent bookmark tag list.
        let recentBookmarkTags = this.getRecentBookmarkTags();
        for(let i = 0; i < tagList.length; ++i)
        {
            let idx = recentBookmarkTags.indexOf(tagList[i]);
            if(idx != -1)
                recentBookmarkTags.splice(idx, 1);
        }
        for(let i = 0; i < tagList.length; ++i)
            recentBookmarkTags.unshift(tagList[i]);

        // Remove tags that haven't been used in a long time.
        recentBookmarkTags.splice(100);
        this.setRecentBookmarkTags(recentBookmarkTags);
    }
}
