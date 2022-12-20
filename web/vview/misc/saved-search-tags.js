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
    static get_all_groups({data=null}={})
    {
        let result = new Map();
        result.set(null, []); // recents

        data ??= this.data();
        let in_group = null;
        for(let recent_tag of data)
        {
            if((recent_tag instanceof Object) && recent_tag.type == "section")
            {
                in_group = recent_tag.name;
                result.set(in_group, []);
                continue;
            }

            result.get(in_group).push(recent_tag);
        }

        return result;
    }

    // Set recent-tag-searches from a group map returned by get_all_groups.
    static set_all_groups(groups)
    {
        let data = [];

        for(let [name, tags_in_group] of groups.entries())
        {
            if(name != null)
            {
                data.push({
                    type: "section",
                    name,
                });
            }

            for(let tag of tags_in_group)
                data.push(tag);
        }

        ppixiv.settings.set("recent-tag-searches", data);

        window.dispatchEvent(new Event("recent-tag-searches-changed"));
    }

    // Return all individual tags that the user has in recents and saved searches.
    static get_all_used_tags()
    {
        let all_tags = new Set();
        for(let group_tags of this.get_all_groups().values())
        {
            for(let tags of group_tags)
                for(let tag of tags.split(" "))
                    all_tags.add(tag);
        }

        return all_tags;
    }

    // Add tag to the recent search list, or move it to the front.  If group is set, add
    // a saved search in the given group.  If group is null, add to the recent list.
    //
    // If tag is null, just create group if it doesn't exist.
    static add(tag, { group=null, add_to_end=true }={})
    {
        if(this._disable_adding_search_tags || tag == "")
            return;

        let recent_tags = ppixiv.settings.get("recent-tag-searches") || [];

        // If tag is already in the list as a recent tag, remove it.
        if(tag != null)
        {
            // If tag is a saved tag, don't change it.
            if(this.group_name_for_tag(tag) != null)
                return;

            let idx = recent_tags.indexOf(tag);
            if(idx != -1)
                recent_tags.splice(idx, 1);
        }

        // If we're adding it as a recent, add it to the beginning.  If we're adding it as
        // a saved tag, create the null separating recents and saved tags if needed, and add
        // the tag at the end.
        if(group == null)
            recent_tags.unshift(tag);
        else
        {
            // Find or create the group header for this group.
            let [start_idx, end_idx] = this.find_group_range(group);
            if(start_idx == -1)
            {
                console.log(`Created tag group: ${group}`);
                recent_tags.push({
                    type: "section",
                    name: group,
                });

                start_idx = end_idx = recent_tags.length;
            }
    
            // If tag is null, we're just creating the group and not adding anything to it.
            if(tag != null)
            {
                if(add_to_end)
                    recent_tags.splice(end_idx, 0, tag);
                else
                    recent_tags.splice(start_idx+1, 0, tag);
            }
        }

        ppixiv.settings.set("recent-tag-searches", recent_tags);

        window.dispatchEvent(new Event("recent-tag-searches-changed"));
    }

    // Replace a saved tag.
    static modify_tag(old_tags, new_tags)
    {
        if(old_tags == new_tags)
            return;

        let data = this.data();
        if(this.find_index({tag: new_tags, data}) != -1)
        {
            message_widget.singleton.show(`Saved tag already exists`);
            return;
        }

        // Find the tag.
        let idx = this.find_index({tag: old_tags, data});
        if(idx == -1)
            return;

        data[idx] = new_tags;
        ppixiv.settings.set("recent-tag-searches", data);
        window.dispatchEvent(new Event("recent-tag-searches-changed"));
        message_widget.singleton.show(`Saved tag updated`);
    }

    // Return [start,end) in the tag list for the given section, where start is the
    // index of the section header and end is one past last entry in the group.  If
    // the section doesn't exist, return [-1,-1].
    static find_group_range(section_name, { data }={})
    {
        let recent_tags = data ?? this.data();

        // Find the start of the group.  recent searches always start at the beginning.
        let start_idx = -1;
        if(section_name == null)
            start_idx = 0;
        else
        {
            for(let idx = 0; idx < recent_tags.length; ++idx)
            {
                let group = recent_tags[idx];
                if(!(group instanceof Object) || group.type != "section")
                    continue;
                if(group.name != section_name)
                    continue;

                start_idx = idx;
                break;
            }
        }

        // Return -1 if the group doesn't exist.
        if(start_idx == -1)
            return [-1, -1];

        // Find the end of the group.
        for(let idx = start_idx+1; idx < recent_tags.length; ++idx)
        {
            let group = recent_tags[idx];
            if(!(group instanceof Object) || group.type != "section")
                continue;

            return [start_idx, idx];
        }

        return [start_idx,recent_tags.length];
    }

    // Delete the given group and all tags inside it.
    static delete_group(group)
    {
        let [start_idx, end_idx] = this.find_group_range(group);
        if(start_idx == -1)
            return;

        let count = end_idx - start_idx;

        let recent_tags = ppixiv.settings.get("recent-tag-searches") || [];
        recent_tags.splice(start_idx, count);
        ppixiv.settings.set("recent-tag-searches", recent_tags);

        window.dispatchEvent(new Event("recent-tag-searches-changed"));
        message_widget.singleton.show(`Group "${group}" deleted`);
    }
    
    // Rename a group.  The new name must not already exist.
    static rename_group(from, to)
    {
        let from_idx = this.find_index({group: from});
        if(from_idx == -1)
            return;

        if(this.find_index({group: to}) != -1)
        {
            message_widget.singleton.show(`Group "${to}" already exists`);
            return;
        }

        let recent_tags = ppixiv.settings.get("recent-tag-searches") || [];
        recent_tags[from_idx].name = to;
        ppixiv.settings.set("recent-tag-searches", recent_tags);

        // If this group was collapsed, rename it in collapsed-tag-groups.
        let collapsed_groups = this.get_collapsed_tag_groups();
        if(collapsed_groups.has(from))
        {
            collapsed_groups.delete(from);
            collapsed_groups.add(to);
            ppixiv.settings.set("collapsed-tag-groups", [...collapsed_groups]);
        }

        window.dispatchEvent(new Event("recent-tag-searches-changed"));
    }

    static move_group(group, { down })
    {
        let data = ppixiv.settings.get("recent-tag-searches") || [];

        let groups = this.get_all_groups(data);
        let tag_groups = Array.from(groups.keys());
        let idx = tag_groups.indexOf(group);
        if(idx == -1)
            return;

        // Reorder tag_groups.
        let swap_with = idx + (down? +1:-1);
        if(swap_with < 0 || swap_with >= tag_groups.length)
            return;
        
        // Refuse to move recents, which must always be the first group.
        if(tag_groups[idx] == null || tag_groups[swap_with] == null)
            return;

        [tag_groups[idx], tag_groups[swap_with]] = [tag_groups[swap_with], tag_groups[idx]];
        
        let new_groups = new Map();
        for(let group of tag_groups)
        {
            new_groups.set(group, groups.get(group));
        }

        this.set_all_groups(new_groups);
    }

    static get_collapsed_tag_groups()
    {
        return new Set(ppixiv.settings.get("collapsed-tag-groups") || []);
    }
    
    // group_name can be null to collapse recents.  If collapse is "toggle", toggle the current value.
    static set_tag_group_collapsed(group_name, collapse)
    {
        let collapsed_groups = this.get_collapsed_tag_groups();
        if(collapse == "toggle")
            collapse = !collapsed_groups.has(group_name);
        if(collapsed_groups.has(group_name) == collapse)
            return;

        if(collapse)
            collapsed_groups.add(group_name);
        else
            collapsed_groups.delete(group_name);
            
        ppixiv.settings.set("collapsed-tag-groups", [...collapsed_groups]);
        window.dispatchEvent(new Event("recent-tag-searches-changed"));
    }

    // This is a hack used by TagSearchBoxWidget to temporarily disable adding to history.
    static disable_adding_search_tags(value)
    {
        this._disable_adding_search_tags = value;
    }

    // recent-tag-searches contains both recent tags and saved tags.  Recent tags are listed
    // first for compatibility, followed by a group labels, followed by saved tags.  A group
    // label looks like: { "type": "section", "name": "section name" }.  Section names are
    // always unique.
    //
    // Return the group name if tag is a saved tag, otherwise null.
    static group_name_for_tag(tag)
    {
        let recent_tags = ppixiv.settings.get("recent-tag-searches") || [];

        let in_group = null;
        for(let recent_tag of recent_tags)
        {
            if((recent_tag instanceof Object) && recent_tag.type == "section")
            {
                in_group = recent_tag.name;
                continue;
            }

            if(recent_tag == tag)
                return in_group;
        }

        return null;
    }

    static remove(tag)
    {
        // Remove tag from the list.  There should normally only be one.
        let recent_tags = ppixiv.settings.get("recent-tag-searches") || [];
        let idx = recent_tags.indexOf(tag);
        if(idx == -1)
            return;

        recent_tags.splice(idx, 1);
        ppixiv.settings.set("recent-tag-searches", recent_tags);
        
        window.dispatchEvent(new Event("recent-tag-searches-changed"));
    }

    // Move tag in the list so its index is to_idx.
    static move(tag, to_idx)
    {
        // Remove tag from the list.  There should normally only be one.
        let recent_tags = ppixiv.settings.get("recent-tag-searches") || [];
        let idx = recent_tags.indexOf(tag);
        if(idx == -1)
            return;
        if(idx == to_idx)
            return;

        // If the target index is after its current position, subtract one to adjust for
        // the offset changing as we remove the old one.
        if(to_idx > idx)
            to_idx--;
        recent_tags.splice(idx, 1);

        recent_tags.splice(to_idx, 0, tag);

        ppixiv.settings.set("recent-tag-searches", recent_tags);
        
        window.dispatchEvent(new Event("recent-tag-searches-changed"));
    }

    // Return the index in recent-tag-searches of the given tag or group, or -1 if it
    // doesn't exist.
    static find_index({tag, group, data=null})
    {
        data ??= ppixiv.settings.get("recent-tag-searches") || [];

        for(let idx = 0; idx < data.length; ++idx)
        {
            let recent_tag = data[idx];
            if((recent_tag instanceof Object) && recent_tag.type == "section")
            {
                if(group != null && recent_tag.name == group)
                    return idx;
            }
            else
            {
                if(tag != null && recent_tag == tag)
                    return idx;
            }
        }

        return -1;
    }
}