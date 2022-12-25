// Various self-contained helpers that work with HTML nodes.

// Move all children of parent to newParent.
export function moveChildren(parent, newParent)
{
    for(let child of parent.children)
    {
        child.remove();
        newParent.appendChild(child);
    }
}

// Remove all of parent's children.
export function removeElements(parent)
{
    for(let child of parent.children)
        child.remove();
}

// Return true if ancestor is one of descendant's parents, or if descendant is ancestor.
export function isAbove(ancestor, descendant)
{
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
    let scroll_top = savedPosition.originalScrollTop;
    if(restoreRelativeTo)
    {
        let offset = restoreRelativeTo.offsetTop - savedPosition.originalOffsetTop;
        scroll_top += offset;
    }

    // Don't write to scrollTop if it's not changing, since that breaks
    // scrolling on iOS.
    if(scroller.scrollTop != scroll_top)
        scroller.scrollTop = scroll_top;
}


function getTemplate(type)
{
    let template = document.body.querySelector(type);
    if(template == null)
        throw "Missing template: " + type;

    // Replace any <ppixiv-inline> inlines on the template, and remember that
    // we've done this so we don't redo it every time the template is used.
    if(!template.dataset.replacedInlines)
    {
        template.dataset.replacedInlines = true;
        this.replaceInlines(template.content);
    }

    return template;
}

// If makeSVGUnique is false, skip making SVG IDs unique.  This is a small optimization
// for creating thumbs, which don't need this.
export function createFromTemplate(type, {makeSVGUnique=true}={})
{
    let template;
    if(typeof(type) == "string")
        template = this.getTemplate(type);
    else
        template = type;

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
    let id_map = {};
    let idx = _svgIdSequence;

    // First, find all IDs in the SVG and change them to something unique.
    for(let def of svg.querySelectorAll("[id]"))
    {
        let old_id = def.id;
        let new_id = def.id + "_" + idx;
        idx++;
        id_map[old_id] = new_id;
        def.id = new_id;
    }

    // Search for all URL references within the SVG and point them at the new IDs.
    for(let node of svg.querySelectorAll("*"))
    {
        for(let attr of node.getAttributeNames())
        {
            let value = node.getAttribute(attr);
            let new_value = value;
            
            // See if this is an ID reference.  We don't try to parse all valid URLs
            // here.  Handle url(#abcd) inside strings, and things like xlink:xref="#abcd".
            if((attr == "href" || attr == "xlink:href") && value.startsWith("#"))
            {
                let old_id = value.substr(1);
                let new_id = id_map[old_id];
                if(new_id == null)
                {
                    console.warn("Unmatched SVG ID:", old_id);
                    continue;
                }

                new_value = "#" + new_id;
            }

            let re = /url\(#.*?\)/;
            new_value = new_value.replace(re, (str) => {
                let re = /url\(#(.*)\)/;
                let old_id = str.match(re)[1];
                let new_id = id_map[old_id];
                if(new_id == null)
                {
                    console.warn("Unmatched SVG ID:", old_id);
                    return str;
                }
                // Replace the ID.
                return "url(#" + new_id + ")";
            });

            if(new_value != value)
                node.setAttribute(attr, new_value);
        }
    }

    // Store the index, so the next call will start with the next value.
    _svgIdSequence = idx;
}

    
// Set node's height as a CSS variable.
//
// If target is null, the variable is set on the node itself.
export function setHeightAsProperty(node, name, { target, signal }={})
{
    if(target == null)
        target = node;
    let refreshHeight = () =>
    {
        // Our height usually isn't an integer.  Round down, so we prefer to overlap backgrounds
        // with things like the video UI rather than leaving a gap.
        let {height} = node.getBoundingClientRect();
        target.style.setProperty(name, `${Math.floor(height)}px`);
    };

    let resizeObserver = new ResizeObserver(() => refreshHeight());
    resizeObserver.observe(node);
    if(signal)
        signal.addEventListener("abort", () => resizeObserver.disconnect());

    refreshHeight();
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
