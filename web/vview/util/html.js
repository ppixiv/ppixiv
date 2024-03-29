// Various self-contained helpers that work with HTML nodes.

// Move all children of parent to newParent.
export function moveChildren(parent, newParent)
{
    for(let child of Array.from(parent.children))
    {
        child.remove();
        newParent.appendChild(child);
    }
}

// Remove all of parent's children.
export function removeElements(parent)
{
    for(let child of Array.from(parent.children))
        child.remove();
}

// Return true if ancestor is one of descendant's parents, or if descendant is ancestor.
export function isAbove(ancestor, descendant)
{
    console.assert(ancestor != null, "ancestor is null");
    console.assert(descendant != null, "descendant is null");

    while(descendant != null && descendant != ancestor)
        descendant = descendant.parentNode;
    return descendant == ancestor;
}

// Create a style node.
export function createStyle(css, { id }={})
{
    let style = document.realCreateElement("style");
    style.type = "text/css";
    if(id)
        style.id = id;
    style.textContent = css;
    return style;
}

// Add a style node to the document.
export function addStyle(name, css)
{
    let style = this.createStyle(css);
    style.id = name;
    document.querySelector("head").appendChild(style);
    return style;
}

// Set or unset a class.
export function setClass(element, className, enable)
{
    if(element.classList.contains(className) == enable)
        return;

    if(enable)
        element.classList.add(className);
    else
        element.classList.remove(className);
}

// dataset is another web API with nasty traps: if you assign false or null to
// it, it assigns "false" or "null", which are true values.
export function setDataSet(dataset, name, value)
{
    if(value)
        dataset[name] = value;
    else
        delete dataset[name];
}


// Return the value of a list of CSS expressions.  For example:
//
// getCSSValues({ value1: "calc(let(--value) * 2)" });
function getCSSValues(properties)
{
    let div = document.createElement("div");

    let style = [];
    for(let [key, value] of Object.entries(properties))
        style += `--${key}:${value};\n`;
    div.style = style;

    // The div needs to be in the document for this to work.
    document.body.appendChild(div);
    let computed = getComputedStyle(div);
    let results = {};
    for(let key of Object.keys(properties))
        results[key] = computed.getPropertyValue(`--${key}`);
    div.remove();

    return results;
}

// Get the current safe area insets.
export function getSafeAreaInsets()
{
    let { left, top, right, bottom } = getCSSValues({
        left: 'env(safe-area-inset-left)',
        top: 'env(safe-area-inset-top)',
        right: 'env(safe-area-inset-right)',
        bottom: 'env(safe-area-inset-bottom)',
    });

    left = parseInt(left ?? 0);
    top = parseInt(top ?? 0);
    right = parseInt(right ?? 0);
    bottom = parseInt(bottom ?? 0);
    return { left, top, right, bottom };
}

// Sae the position of a scroller relative to the given node.  The returned object can
// be used with restoreScrollPosition.
export function saveScrollPosition(scroller, saveRelativeTo)
{
    return {
        originalScrollTop: scroller.scrollTop,
        originalOffsetTop: saveRelativeTo.offsetTop,
    };
}

// Restore a scroll position saved with saveSCrollPosition.  If given, restoreRelativeTo should
// be a node corresponding to saveRelativeTo given to saveSCrollPosition.
export function restoreScrollPosition(scroller, restoreRelativeTo, savedPosition)
{
    let scrollTop = savedPosition.originalScrollTop;
    if(restoreRelativeTo)
    {
        let offset = restoreRelativeTo.offsetTop - savedPosition.originalOffsetTop;
        scrollTop += offset;
    }

    // Don't write to scrollTop if it's not changing, since that breaks
    // scrolling on iOS.
    if(scroller.scrollTop != scrollTop)
        scroller.scrollTop = scrollTop;
}

// If makeSVGUnique is false, skip making SVG IDs unique.  This is a small optimization
// for creating thumbs, which don't need this.
export function createFromTemplate(template, {makeSVGUnique=true}={})
{
    let node = document.importNode(template.content, true).firstElementChild;
    
    if(makeSVGUnique)
    {
        // Make all IDs in the template we just cloned unique.
        for(let svg of node.querySelectorAll("svg"))
            makeSVGIdsUnique(svg);
    }
    
    return node;
}

// SVG has a big problem: it uses IDs to reference its internal assets, and that
// breaks if you inline the same SVG more than once in a document.  Making them unique
// at build time doesn't help, since they break again as soon as you clone a template.
// This makes styling SVGs a nightmare, since you can only style inlined SVGs.
//
// <use> doesn't help, since that's just broken with masks and gradients entirely.
// Broken for over a decade and nobody cares: https://bugzilla.mozilla.org/show_bug.cgi?id=353575
//
// This seems like a basic feature of SVG, and it's just broken.
//
// Work around it by making IDs within SVGs unique at runtime.  This is called whenever
// we clone SVGs.
let _svgIdSequence = 0;
function makeSVGIdsUnique(svg)
{
    let idMap = {};
    let idx = _svgIdSequence;

    // First, find all IDs in the SVG and change them to something unique.
    for(let def of svg.querySelectorAll("[id]"))
    {
        let oldId = def.id;
        let newId = def.id + "_" + idx;
        idx++;
        idMap[oldId] = newId;
        def.id = newId;
    }

    // Search for all URL references within the SVG and point them at the new IDs.
    for(let node of svg.querySelectorAll("*"))
    {
        for(let attr of node.getAttributeNames())
        {
            let value = node.getAttribute(attr);
            let newValue = value;
            
            // See if this is an ID reference.  We don't try to parse all valid URLs
            // here.  Handle url(#abcd) inside strings, and things like xlink:xref="#abcd".
            if((attr == "href" || attr == "xlink:href") && value.startsWith("#"))
            {
                let oldId = value.substr(1);
                let newId = idMap[oldId];
                if(newId == null)
                {
                    console.warn("Unmatched SVG ID:", oldId);
                    continue;
                }

                newValue = "#" + newId;
            }

            let re = /url\(#.*?\)/;
            newValue = newValue.replace(re, (str) => {
                let re = /url\(#(.*)\)/;
                let oldId = str.match(re)[1];
                let newId = idMap[oldId];
                if(newId == null)
                {
                    console.warn("Unmatched SVG ID:", oldId);
                    return str;
                }
                // Replace the ID.
                return "url(#" + newId + ")";
            });

            if(newValue != value)
                node.setAttribute(attr, newValue);
        }
    }

    // Store the index, so the next call will start with the next value.
    _svgIdSequence = idx;
}

    
// Set node's height as a CSS variable.
//
// If target is null, the variable is set on the node itself.
export function setSizeAsProperty(node, { heightProperty, widthProperty, target, signal }={})
{
    if(target == null)
        target = node;
    let refreshSize = () =>
    {
        // Our height usually isn't an integer.  Round down, so we prefer to overlap backgrounds
        // with things like the video UI rather than leaving a gap.
        let { width, height } = node.getBoundingClientRect();
        if(widthProperty)
            target.style.setProperty(widthProperty, `${Math.floor(width)}px`);
        if(heightProperty)
            target.style.setProperty(heightProperty, `${Math.floor(height)}px`);
    };

    let resizeObserver = new ResizeObserver(() => refreshSize());
    resizeObserver.observe(node);
    if(signal)
        signal.addEventListener("abort", () => resizeObserver.disconnect());

    refreshSize();
}

// Return the offset of element relative to an ancestor.
export function getRelativePosition(element, ancestor)
{
    let x = 0, y = 0;
    while(element != null && element != ancestor)
    {
        x += element.offsetLeft;
        y += element.offsetTop;

        // Advance through parents until we reach the offsetParent or the ancestor
        // that we're stopping at.  We do this rather than advancing to offsetParent,
        // in case ancestor isn't an offsetParent.
        let searchFor = element.offsetParent;
        while(element != ancestor && element != searchFor)
            element = element.parentNode;
    }
    return [x, y];
}
