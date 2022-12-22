// This handles the list of saved and recent search tags.  For backwards-compatibility
// this is stored in the "recent-tag-searches" setting.  This has the format:
//
// [
//     "tag1",
//     "tag2",
//     { "type": "section", "name: "Saved Tags" },
//     "tag3",
//     { "type": "section", "name: "Saved Tags 2" },
//     "tag3",
// ]
//
// Tags are simple strings.  All tags before the first section are recent tags, and all
// saved tags are always in a section.  The order of tags and groups can be edited by the
// user.
//
// Putting recent tags first allows the older simple tag list format to have the same
// meaning, so no migrations are needed.

export default class SavedSearchTags
{
    static data()
    {
        return ppixiv.settings.get("recent-tag-searches") || [];;
    }

    // Return a map of all recent and saved tags, mapping from group names to lists
    // of searches.  Recent searches are returned with a tag of "null".  The map is
    // ordered.
    static getAllGroups({data=null}={})
    {
        let result = new Map();
        result.set(null, []); // recents

        data ??= this.data();
        let inGroup = null;
        for(let recentTag of data)
        {
            if((recentTag instanceof Object) && recentTag.type == "section")
            {
                inGroup = recentTag.name;
                result.set(inGroup, []);
                continue;
            }

            result.get(inGroup).push(recentTag);
        }

        return result;
    }

    // Set recent-tag-searches from a group map returned by getAllGroups.
    static setAllGroups(groups)
    {
        let data = [];

        for(let [name, tagsInGroup] of groups.entries())
        {
            if(name != null)
            {
                data.push({
                    type: "section",
                    name,
                });
            }

            for(let tag of tagsInGroup)
                data.push(tag);
        }

        ppixiv.settings.set("recent-tag-searches", data);

        window.dispatchEvent(new Event("recent-tag-searches-changed"));
    }

    // Return all individual tags that the user has in recents and saved searches.
    static getAllUsedTags()
    {
        let allTags = new Set();
        for(let group_tags of this.getAllGroups().values())
        {
            for(let tags of group_tags)
                for(let tag of tags.split(" "))
                    allTags.add(tag);
        }

        return allTags;
    }

    // Add tag to the recent search list, or move it to the front.  If group is set, add
    // a saved search in the given group.  If group is null, add to the recent list.
    //
    // If tag is null, just create group if it doesn't exist.
    static add(tag, { group=null, addToEnd=true }={})
    {
        if(this._disableAddingSearchTags || tag == "")
            return;

        let recentTags = ppixiv.settings.get("recent-tag-searches") || [];

        // If tag is already in the list as a recent tag, remove it.
        if(tag != null)
        {
            // If tag is a saved tag, don't change it.
            if(this.groupNameForTag(tag) != null)
                return;

            let idx = recentTags.indexOf(tag);
            if(idx != -1)
                recentTags.splice(idx, 1);
        }

        // If we're adding it as a recent, add it to the beginning.  If we're adding it as
        // a saved tag, create the null separating recents and saved tags if needed, and add
        // the tag at the end.
        if(group == null)
            recentTags.unshift(tag);
        else
        {
            // Find or create the group header for this group.
            let [startIdx, endIdx] = this._findGroupRange(group);
            if(startIdx == -1)
            {
                console.log(`Created tag group: ${group}`);
                recentTags.push({
                    type: "section",
                    name: group,
                });

                startIdx = endIdx = recentTags.length;
            }
    
            // If tag is null, we're just creating the group and not adding anything to it.
            if(tag != null)
            {
                if(addToEnd)
                    recentTags.splice(endIdx, 0, tag);
                else
                    recentTags.splice(startIdx+1, 0, tag);
            }
        }

        ppixiv.settings.set("recent-tag-searches", recentTags);

        window.dispatchEvent(new Event("recent-tag-searches-changed"));
    }

    // Replace a saved tag.
    static modifyTag(oldTags, newTags)
    {
        if(oldTags == newTags)
            return;

        let data = this.data();
        if(this.findIndex({tag: newTags, data}) != -1)
        {
            ppixiv.message.show(`Saved tag already exists`);
            return;
        }

        // Find the tag.
        let idx = this.findIndex({tag: oldTags, data});
        if(idx == -1)
            return;

        data[idx] = newTags;
        ppixiv.settings.set("recent-tag-searches", data);
        window.dispatchEvent(new Event("recent-tag-searches-changed"));
        ppixiv.message.show(`Saved tag updated`);
    }

    // Return [start,end) in the tag list for the given section, where start is the
    // index of the section header and end is one past last entry in the group.  If
    // the section doesn't exist, return [-1,-1].
    static _findGroupRange(sectionName, { data }={})
    {
        let recentTags = data ?? this.data();

        // Find the start of the group.  recent searches always start at the beginning.
        let startIdx = -1;
        if(sectionName == null)
            startIdx = 0;
        else
        {
            for(let idx = 0; idx < recentTags.length; ++idx)
            {
                let group = recentTags[idx];
                if(!(group instanceof Object) || group.type != "section")
                    continue;
                if(group.name != sectionName)
                    continue;

                startIdx = idx;
                break;
            }
        }

        // Return -1 if the group doesn't exist.
        if(startIdx == -1)
            return [-1, -1];

        // Find the end of the group.
        for(let idx = startIdx+1; idx < recentTags.length; ++idx)
        {
            let group = recentTags[idx];
            if(!(group instanceof Object) || group.type != "section")
                continue;

            return [startIdx, idx];
        }

        return [startIdx,recentTags.length];
    }

    // Delete the given group and all tags inside it.
    static deleteGroup(group)
    {
        let [startIdx, endIdx] = this._findGroupRange(group);
        if(startIdx == -1)
            return;

        let count = endIdx - startIdx;

        let recentTags = ppixiv.settings.get("recent-tag-searches") || [];
        recentTags.splice(startIdx, count);
        ppixiv.settings.set("recent-tag-searches", recentTags);

        window.dispatchEvent(new Event("recent-tag-searches-changed"));
        ppixiv.message.show(`Group "${group}" deleted`);
    }
    
    // Rename a group.  The new name must not already exist.
    static renameGroup(from, to)
    {
        let from_idx = this.findIndex({group: from});
        if(from_idx == -1)
            return;

        if(this.findIndex({group: to}) != -1)
        {
            ppixiv.message.show(`Group "${to}" already exists`);
            return;
        }

        let recentTags = ppixiv.settings.get("recent-tag-searches") || [];
        recentTags[from_idx].name = to;
        ppixiv.settings.set("recent-tag-searches", recentTags);

        // If this group was collapsed, rename it in collapsed-tag-groups.
        let collapsedGroups = this.getCollapsedTagGroups();
        if(collapsedGroups.has(from))
        {
            collapsedGroups.delete(from);
            collapsedGroups.add(to);
            ppixiv.settings.set("collapsed-tag-groups", [...collapsedGroups]);
        }

        window.dispatchEvent(new Event("recent-tag-searches-changed"));
    }

    static moveGroup(group, { down })
    {
        let data = ppixiv.settings.get("recent-tag-searches") || [];

        let groups = this.getAllGroups(data);
        let tagGroups = Array.from(groups.keys());
        let idx = tagGroups.indexOf(group);
        if(idx == -1)
            return;

        // Reorder tagGroups.
        let swap_with = idx + (down? +1:-1);
        if(swap_with < 0 || swap_with >= tagGroups.length)
            return;
        
        // Refuse to move recents, which must always be the first group.
        if(tagGroups[idx] == null || tagGroups[swap_with] == null)
            return;

        [tagGroups[idx], tagGroups[swap_with]] = [tagGroups[swap_with], tagGroups[idx]];
        
        let new_groups = new Map();
        for(let group of tagGroups)
        {
            new_groups.set(group, groups.get(group));
        }

        this.setAllGroups(new_groups);
    }

    static getCollapsedTagGroups()
    {
        return new Set(ppixiv.settings.get("collapsed-tag-groups") || []);
    }
    
    // groupName can be null to collapse recents.  If collapse is "toggle", toggle the current value.
    static setTagGroupCollapsed(groupName, collapse)
    {
        let collapsedGroups = this.getCollapsedTagGroups();
        if(collapse == "toggle")
            collapse = !collapsedGroups.has(groupName);
        if(collapsedGroups.has(groupName) == collapse)
            return;

        if(collapse)
            collapsedGroups.add(groupName);
        else
            collapsedGroups.delete(groupName);
            
        ppixiv.settings.set("collapsed-tag-groups", [...collapsedGroups]);
        window.dispatchEvent(new Event("recent-tag-searches-changed"));
    }

    // This is a hack used by TagSearchBoxWidget to temporarily disable adding to history.
    static disableAddingSearchTags(value)
    {
        this._disableAddingSearchTags = value;
    }

    // recent-tag-searches contains both recent tags and saved tags.  Recent tags are listed
    // first for compatibility, followed by a group labels, followed by saved tags.  A group
    // label looks like: { "type": "section", "name": "section name" }.  Section names are
    // always unique.
    //
    // Return the group name if tag is a saved tag, otherwise null.
    static groupNameForTag(tag)
    {
        let recentTags = ppixiv.settings.get("recent-tag-searches") || [];

        let inGroup = null;
        for(let recentTag of recentTags)
        {
            if((recentTag instanceof Object) && recentTag.type == "section")
            {
                inGroup = recentTag.name;
                continue;
            }

            if(recentTag == tag)
                return inGroup;
        }

        return null;
    }

    static remove(tag)
    {
        // Remove tag from the list.  There should normally only be one.
        let recentTags = ppixiv.settings.get("recent-tag-searches") || [];
        let idx = recentTags.indexOf(tag);
        if(idx == -1)
            return;

        recentTags.splice(idx, 1);
        ppixiv.settings.set("recent-tag-searches", recentTags);
        
        window.dispatchEvent(new Event("recent-tag-searches-changed"));
    }

    // Move tag in the list so its index is to_idx.
    static move(tag, to_idx)
    {
        // Remove tag from the list.  There should normally only be one.
        let recentTags = ppixiv.settings.get("recent-tag-searches") || [];
        let idx = recentTags.indexOf(tag);
        if(idx == -1)
            return;
        if(idx == to_idx)
            return;

        // If the target index is after its current position, subtract one to adjust for
        // the offset changing as we remove the old one.
        if(to_idx > idx)
            to_idx--;
        recentTags.splice(idx, 1);

        recentTags.splice(to_idx, 0, tag);

        ppixiv.settings.set("recent-tag-searches", recentTags);
        
        window.dispatchEvent(new Event("recent-tag-searches-changed"));
    }

    // Return the index in recent-tag-searches of the given tag or group, or -1 if it
    // doesn't exist.
    static findIndex({tag, group, data=null})
    {
        data ??= ppixiv.settings.get("recent-tag-searches") || [];

        for(let idx = 0; idx < data.length; ++idx)
        {
            let recentTag = data[idx];
            if((recentTag instanceof Object) && recentTag.type == "section")
            {
                if(group != null && recentTag.name == group)
                    return idx;
            }
            else
            {
                if(tag != null && recentTag == tag)
                    return idx;
            }
        }

        return -1;
    }
}