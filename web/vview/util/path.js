
// Helpers for working with paths.
export default class Path
{
    // Return true if array begins with prefix.
    static _arrayStartsWith(array, prefix)
    {
        if(array.length < prefix.length)
            return false;

        for(let i = 0; i < prefix.length; ++i)
            if(array[i] != prefix[i])
                return false;
        return true;
    }

    static isRelativeTo(path, root)
    {
        let pathParts = path.split("/");
        let rootParts = root.split("/");
        return Path._arrayStartsWith(pathParts, rootParts);
    }

    static splitPath(path)
    {
        // If the path ends with a slash, remove it.
        if(path.endsWith("/"))
            path = path.substr(0, path.length-1);

        let parts = path.split("/");
        return parts;
    }

    // Return absolutePath relative to relativeTo.
    static getRelativePath(relativeTo, absolutePath)
    {
        console.assert(absolutePath.startsWith("/"));
        console.assert(relativeTo.startsWith("/"));

        let pathParts = Path.splitPath(absolutePath);
        let rootParts = Path.splitPath(relativeTo);

        // If absolutePath isn"t underneath relativeTo, leave it alone.
        if(!Path._arrayStartsWith(pathParts, rootParts))
            return absolutePath;

        let relativeParts = pathParts.splice(rootParts.length);
        return relativeParts.join("/");
    }

    // Append child to path.
    static getChild(path, child)
    {
        // If child is absolute, leave it alone.
        if(child.startsWith("/"))
            return child;

        let pathParts = Path.splitPath(path);
        let childParts = Path.splitPath(child);
        let combined = pathParts.concat(childParts);
        return combined.join('/');
    }
}
