
// Helpers for working with paths.
export default class Path
{
    // Return true if array begins with prefix.
    static array_starts_with(array, prefix)
    {
        if(array.length < prefix.length)
            return false;

        for(let i = 0; i < prefix.length; ++i)
            if(array[i] != prefix[i])
                return false;
        return true;
    }

    static is_relative_to(path, root)
    {
        let path_parts = path.split("/");
        let root_parts = root.split("/");
        return Path.array_starts_with(path_parts, root_parts);
    }

    static split_path(path)
    {
        // If the path ends with a slash, remove it.
        if(path.endsWith("/"))
            path = path.substr(0, path.length-1);

        let parts = path.split("/");
        return parts;
    }

    // Return absolute_path relative to relative_to.
    static get_relative_path(relative_to, absolute_path)
    {
        console.assert(absolute_path.startsWith("/"));
        console.assert(relative_to.startsWith("/"));

        let path_parts = Path.split_path(absolute_path);
        let root_parts = Path.split_path(relative_to);

        // If absolute_path isn"t underneath relative_to, leave it alone.
        if(!Path.array_starts_with(path_parts, root_parts))
            return absolute_path;

        let relative_parts = path_parts.splice(root_parts.length);
        return relative_parts.join("/");
    }

    // Append child to path.
    static get_child(path, child)
    {
        // If child is absolute, leave it alone.
        if(child.startsWith("/"))
            return child;

        let path_parts = Path.split_path(path);
        let child_parts = Path.split_path(child);
        let combined = path_parts.concat(child_parts);
        return combined.join('/');
    }
}
