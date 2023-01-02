import Widget from 'vview/widgets/widget.js';
import ImageEditingOverlayContainer from 'vview/viewer/images/editing-overlay-container.js';
import PointerListener from 'vview/actors/pointer-listener.js';
import { helpers, KeyListener } from 'vview/misc/helpers.js';

export default class InpaintEditor extends Widget
{
    constructor(options)
    {
        super({...options, template: `
            <div class=inpaint-editor>
                <!-- This node is removed and placed on top of the image.-->
                <div class=inpaint-editor-overlay>
                    <svg class=inpaint-container width=100% height=100% viewBox="0 0 1 1"></svg>
                </div>

                <div class="image-editor-buttons bottom">
                    <div class="image-editor-button-row box-button-row left"></div>

                    <div class="image-editor-button-row editor-buttons box-button-row">
                        ${ helpers.createBoxLink({label: "View",       classes: ["view-inpaint"] }) }
                        ${ helpers.createBoxLink({label: "Create lines",       classes: ["create-lines"] }) }

                        <div class="inpaint-line-width-box box-link">
                            <span>Thickness</span>
                            <input class=inpaint-line-width type=range min=1 max=50>
                            <div class="save-default-thickness popup block-button" data-popup="Set as default">
                                ${ helpers.createIcon("push_pin") }
                            </div>
                        </div>
                        <div class=box-link>
                            <span>Downscale</span>
                            <input class=inpaint-downscale type=range min=1 max=20>

                            <div class="save-default-downscale popup block-button" data-popup="Set as default">
                                ${ helpers.createIcon("push_pin") }
                            </div>
                        </div>
                        <div class=box-link>
                            <span>Soften edges</span>
                            <input class=inpaint-blur type=range min=0 max=5>

                            <div class="save-default-soften popup block-button" data-popup="Set as default">
                                ${ helpers.createIcon("push_pin") }
                            </div>
                        </div>
                    </div>
                    <div class="image-editor-button-row box-button-row right"></div>
                </div>
            </div>
        `});

        this.width = 100;
        this.height = 100;
        this.lines = [];
        this._downscaleRatio = 1;
        this._blur = 0;

        this._draggingSegmentPoint = -1;
        this._dragStart = null;
        this._selectedLineIdx = -1;

        this.ui = this.root.querySelector(".editor-buttons");

        // Remove .inpaint-editor-overlay.  It's inserted into the image overlay when we
        // have one, so it pans and zooms with the image.
        this._editorOverlay = this.root.querySelector(".inpaint-editor-overlay");
        this._editorOverlay.remove();
        this._svg = this._editorOverlay.querySelector(".inpaint-container");

        this._createLinesButton = this.root.querySelector(".create-lines");
        this._createLinesButton.addEventListener("click", (e) => {
            e.stopPropagation();
            this.createLines = !this._createLines;
        });

        // Update the selected line's thickness when the thickness slider changes.
        this._lineWidthSlider = this.root.querySelector(".inpaint-line-width");
        this._lineWidthSliderBox = this.root.querySelector(".inpaint-line-width-box");
        this._lineWidthSlider.addEventListener("input", (e) => {
            if(this._selectedLine == null)
                return;
            this._selectedLine.thickness = parseInt(this._lineWidthSlider.value);
        });
        this._lineWidthSlider.value = ppixiv.settings.get("inpaint_default_thickness", 10);

        // Hide the inpaint while dragging the thickness slider.
        new PointerListener({
            element: this._lineWidthSlider,
            callback: (e) => {
                this._overlayContainer.hideInpaint = e.pressed;
            },
        });

        this._downscaleSlider = this.root.querySelector(".inpaint-downscale");
        this._downscaleSlider.addEventListener("change", (e) => {
            this.parent.saveUndo();
            this.downscaleRatio = parseFloat(this._downscaleSlider.value);
        }, { signal: this.shutdownSignal });

        this._blurSlider = this.root.querySelector(".inpaint-blur");
        this._blurSlider.addEventListener("change", (e) => {
            this.parent.saveUndo();
            this.blur = parseFloat(this._blurSlider.value);
        }, { signal: this.shutdownSignal });
        
        let viewInpaintButton = this.root.querySelector(".view-inpaint");
        new PointerListener({
            element: viewInpaintButton,
            callback: (e) => {
                this.visible = !e.pressed;
            },
            signal: this.shutdownSignal,
        });

        // "Save default" buttons:
        this.root.querySelector(".save-default-thickness").addEventListener("click", (e) => {
            e.stopPropagation();

            let value = parseInt(this._lineWidthSlider.value);
            ppixiv.settings.set("inpaint_default_thickness", value);
            console.log("Saved default line thickness:", value);
        }, { signal: this.shutdownSignal });

        this.root.querySelector(".save-default-downscale").addEventListener("click", (e) => {
            e.stopPropagation();

            let value = parseFloat(this._downscaleSlider.value);
            ppixiv.settings.set("inpaint_default_downscale", value);
            console.log("Saved default downscale:", value);
        }, { signal: this.shutdownSignal });

        this.root.querySelector(".save-default-soften").addEventListener("click", (e) => {
            e.stopPropagation();

            let value = parseFloat(this._blurSlider.value);
            ppixiv.settings.set("inpaint_default_blur", value);
            console.log("Saved default blur:", value);
        }, { signal: this.shutdownSignal });

        new PointerListener({
            element: this._editorOverlay,
            callback: this.pointerevent,
            signal: this.shutdownSignal,
        });

        // This is a pain.  We want to handle clicks when modifier buttons are pressed, and
        // let them through otherwise so panning works.  Every other event system lets you
        // handle or not handle a mouse event and have it fall through if you don't handle
        // it, but CSS won't.  Work around this by watching for our modifier keys and setting
        // pointer-events: none as needed.
        this._ctrlPressed = false;
        for(let modifier of ["Control", "Alt", "Shift"])
        {
            new KeyListener(modifier, (pressed) => {
                this._ctrlPressed = pressed;
                this._refreshPointerEvents();
            }, {
                signal: this.shutdownSignal
            });
        }

        this._createLines = ppixiv.settings.get("inpaint_create_lines", false);

        // Prevent fullscreening if a UI element is double-clicked.
        this._editorOverlay.addEventListener("dblclick", this.ondblclick, { signal: this.shutdownSignal });
        this._editorOverlay.addEventListener("mouseover", this.onmousehover, { signal: this.shutdownSignal });

        this._refreshPointerEvents();
    }

    shutdown()
    {
        super.shutdown();

        // Clear lines when shutting down so we remove their event listeners.
        this.clear();
    }

    // This is called when the ImageEditingOverlayContainer changes.
    set overlayContainer(overlayContainer)
    {
        console.assert(overlayContainer instanceof ImageEditingOverlayContainer)
        if(this._editorOverlay.parentNode)
            this._editorOverlay.remove();
        
        overlayContainer.inpaintEditorOverlay = this._editorOverlay;
        this._overlayContainer = overlayContainer;
    }

    refresh()
    {
        super.refresh();

        helpers.html.setClass(this._createLinesButton, "selected", this._createLines);

        if(this._selectedLine)
            this._lineWidthSlider.value = this._selectedLine.thickness;
        this._downscaleSlider.value = this._downscaleRatio;
        this._blurSlider.value = this.blur;
    }

    updateMenu(menuContainer)
    {
        let create = menuContainer.querySelector(".edit-inpaint");
        helpers.html.setClass(create, "enabled", true);
        helpers.html.setClass(create, "selected", this.editor?._createLines);
    }

    visibilityChanged()
    {
        super.visibilityChanged();
        this._editorOverlay.hidden = !this.visible;
        this.ui.hidden = !this.visible;
    }

    setIllustData({replaceEditorData, extraData, width, height})
    {
        // Scale the thickness slider to the size of the image.
        let size = Math.min(width, height);
        this._lineWidthSlider.max = size / 25;

        if(replaceEditorData)
        {
            this.clear();
            this.setState(extraData.inpaint);
        }

        if(extraData == null)
            return;

        // Match the size of the image.
        this._setSize(width, height);

        // If there's no data at all, load the user's defaults.
        if(extraData.inpaint == null)
        {
            this.downscaleRatio = ppixiv.settings.get("inpaint_default_downscale", 1);
            this.blur = ppixiv.settings.get("inpaint_default_blur", 0);
        }
    }

    getDataToSave()
    {
        return {
            inpaint: this.getState({forSaving: true}),
        }
    }

    async afterSave(mediaInfo)
    {
        if(mediaInfo.urls == null)
            return;

        if(mediaInfo.urls.inpaint)
        {
            // Saving the new inpaint data will change the inpaint URL.  It'll be generated the first
            // time it's fetched, which can take a little while.  Fetch it before updating image
            // data, so it's already generated when ViewerImages updates with the new URL.
            // Otherwise, we'll be stuck looking at the low-res preview while it generates.
            let img = new realImage();
            img.src = mediaInfo.urls.inpaint;
            await helpers.other.waitForImageLoad(img);
        }

        return true;
    }

    // Return inpaint data for saving.
    //
    // If forSaving is true, return data to send to the server.  This clears the
    // data entirely if there are no lines, so the inpaint data is removed entirely.
    // Otherwise, returns the full state, which is used for things like undo.
    getState({forSaving=false}={})
    {
        if(forSaving && this.lines.length == 0)
            return null;

        let result = [];

        let settings = { }
        if(this._downscaleRatio != 1)
            settings.downscale = this._downscaleRatio;
        if(this.blur != 0)
            settings.blur = this.blur;
        if(Object.keys(settings).length > 0)
        {
            settings.action = "settings";
            result.push(settings);
        }

        for(let line of this.lines)
        {
            let segments = [];
            for(let segment of line.segments)
                segments.push([segment[0], segment[1]]);
                
            let entry = {
                action: "line",
                thickness: line.thickness,
                line: segments,
            };
            result.push(entry);
        }

        return result;
    }

    // Replace the inpaint data.
    setState(inpaint)
    {
        this.clear();

        // Each entry looks like:
        //
        // [action: "settings", blur: 10, downscale: 2}
        // {action: "line", thickness: 10, line: [[1,1], [2,2], [3,3], [4,4], ...]}
        for(let part of inpaint || [])
        {
            let cmd = part.action;
            switch(cmd)
            {
            case "settings":
                if(part.downscale)
                    this.downscaleRatio = parseFloat(part.downscale);
                if(part.blur)
                    this.blur = parseFloat(part.blur);
                break;
            case "line":
                let line = this.addLine();
                if(part.thickness)
                    line.thickness = part.thickness;
    
                for(let point of part.line || [])
                    line.addPoint({x: point[0], y: point[1]});
                break;

            default:
                console.error("Unknown inpaint command:", cmd);
                break;
            }
        }

        this.refresh();
    }

    get downscaleRatio() { return this._downscaleRatio; }
    set downscaleRatio(value)
    {
        if(this._downscaleRatio == value)
            return;

        this._downscaleRatio = value;
        this.refresh();
    }

    get blur() { return this._blur; }
    set blur(value)
    {
        if(this._blur == value)
            return;

        this._blur = value;
        this.refresh();
    }

    clear()
    {
        while(this.lines.length)
            this.removeLine(this.lines[0]);
        this.downscaleRatio = 1;
        this._blur = 0;
    }

    onmousehover = (e) =>
    {
        let over = e.target.closest(".inpaint-line, .inpaint-handle") != null;
        this._overlayContainer.hideInpaint = over;

        // While we think we're hovering, add a mouseover listener to window, so we catch
        // all mouseover events that tell us we're no longer hovering.  If we don't do this,
        // we won't see any event if the element that's being hovered is removed from the
        // document while it's being hovered.
        if(over)
            window.addEventListener("mouseover", this.onmousehover, { signal: this.shutdownSignal });
        else
            window.removeEventListener("mouseover", this.onmousehover, { signal: this.shutdownSignal });
    }

    get createLines() { return this._createLines; }
    set createLines(value)
    {
        if(this._createLines == value)
            return;

        this._createLines = value;
        ppixiv.settings.set("inpaint_create_lines", this._createLines);

        this._refreshPointerEvents();

        // If we're turning quick line creation off and we have an incomplete line,
        // delete it.
        if(!this._createLines && this._addingLine)
        {
            this.removeLine(this._addingLine);
            this._addingLine = null;
        }

        this.refresh();
    }

    _refreshPointerEvents()
    {
        helpers.html.setClass(this._editorOverlay, "creating-lines", this._createLines);
        if(this._ctrlPressed || this._createLines)
            this._editorOverlay.style.pointerEvents = "auto";
        else
            this._editorOverlay.style.pointerEvents = "none";
    }

    _getControlPointFromElement(node)
    {
        let inpaintSegment = node.closest(".inpaint-segment");
        if(inpaintSegment)
            inpaintSegment = Widget.fromNode(inpaintSegment);

        let controlPoint = node.closest("[data-type='control-point']");
        let inpaintLine = node.closest(".inpaint-line");
        if(inpaintSegment == null)
            return { };

        let controlPointIdx = controlPoint? parseInt(controlPoint.dataset.idx):-1;
        let inpaintLineIdx = inpaintLine? parseInt(inpaintLine.dataset.idx):-1;

        // If we're on an inpaint segment we should always have a point or line.  If we
        // don't for some reason, ignore the segment too.
        if(controlPointIdx == -1 && inpaintLineIdx == -1)
            inpaintSegment = null;

        return { inpaintSegment, controlPointIdx, inpaintLineIdx };
    }
    
    pointerevent = (e) =>
    {
        let { x, y } = this.getPointFromClick(e);
        let { inpaintSegment, controlPointIdx, inpaintLineIdx } = this._getControlPointFromElement(e.target);
        this._selectedLine = inpaintSegment;

        // Check if we're in the middle of adding a line.  Don't do this if the
        // same point was clicked (fall through and allow moving the point).
        if(e.pressed && this._addingLine != null && (inpaintSegment == null || inpaintSegment != this._addingLine))
        {
            e.preventDefault();
            e.stopPropagation();

            if(inpaintSegment == this._addingLine)
                return;

            this.parent.saveUndo();

            // If another segment was clicked while adding a line, connect to that line.
            if(inpaintSegment && controlPointIdx != -1)
            {
                // We can only connect to the beginning or end.  Connect to whichever end is
                // closer to the point thta was clicked.
                let pointIdx = 0;
                if(controlPointIdx >= inpaintSegment.segments.length/2)
                    pointIdx = inpaintSegment.segments.length;

                let point = this._addingLine.segments[0];
                this.removeLine(this._addingLine);

                this._addingLine = null;
                inpaintSegment.addPoint({x: point[0], y: point[1], at: pointIdx});

                // Drag the point we connected to, not the new point.
                this._startDraggingPoint(inpaintSegment, controlPointIdx, e);
                return;
            }

            let newControlPointIdx = this._addingLine.addPoint({x: x, y: y});
            this._startDraggingPoint(this._addingLine, newControlPointIdx, e);
            this._addingLine = null;

            return;
        }

        if(e.pressed && inpaintSegment)
        {
            e.preventDefault();
            e.stopPropagation();

            this.parent.saveUndo();
            
            // If shift is held, clicking a line segment inserts a point.  Otherwise, it
            // drags the whole segment.
            if(controlPointIdx == -1 && e.shiftKey)
            {
                let { x, y } = this.getPointFromClick(e);
                controlPointIdx = inpaintSegment.addPoint({x: x, y: y, at: inpaintLineIdx});
            }

            this._startDraggingPoint(inpaintSegment, controlPointIdx, e);

            return;
        }
        else if(this._draggingSegment && !e.pressed)
        {
            // We released dragging a segment.
            this._draggingSegmentPoint = -1;
            window.removeEventListener("pointermove", this._pointermoveDragPoint);
        }

        // If we're in create line mode, create points on click.
        if(e.pressed && this._createLines)
        {
            e.preventDefault();
            e.stopPropagation();
            
            this.parent.saveUndo();

            this._addingLine = this.addLine();
            this._addingLine.thickness = ppixiv.settings.get("inpaint_default_thickness", 10);
            let controlPointIdx = this._addingLine.addPoint({x: x, y: y});
            this._startDraggingPoint(this._addingLine, controlPointIdx, e);
        }
    }

    _startDraggingPoint(inpaintSegment, pointIdx=-1, e)
    {
        this._draggingSegment = inpaintSegment;
        this._draggingSegmentPoint = pointIdx;
        this._dragPos = [e.clientX, e.clientY];
        window.addEventListener("pointermove", this._pointermoveDragPoint);
    }

    // Convert a click from client coordinates to image coordinates.
    getPointFromClick({clientX, clientY})
    {
        let {width, height, top, left} = this._editorOverlay.getBoundingClientRect();
        let x = (clientX - left) / width * this.width;
        let y = (clientY - top) / height * this.height;
        return { x: x, y: y };
    }

    ondblclick = (e) =>
    {
        // Block double-clicks to stop ScreenIllust from toggling fullscreen.
        e.stopPropagation();

        // Delete segments and points on double-click.
        let { inpaintSegment, controlPointIdx } = this._getControlPointFromElement(e.target);
        if(inpaintSegment)
        {
            this.parent.saveUndo();

            if(controlPointIdx == -1)
                this.removeLine(inpaintSegment);
            else
            {
                inpaintSegment.removePoint(controlPointIdx);

                // If only one point is left, delete the segment.
                if(inpaintSegment.segments.length < 2)
                    this.removeLine(inpaintSegment);
            }
        }
    }

    _pointermoveDragPoint = (e) =>
    {
        // Get the delta in client coordinates.  Don't use movementX/movementY, since it's
        // in screen pixels and will be wrong if the browser is scaled.
        let delta_x = e.clientX - this._dragPos[0];
        let delta_y = e.clientY - this._dragPos[1];
        this._dragPos = [e.clientX, e.clientY];

        // Scale movement from client coordinates to the size of the container.
        let {width, height} = this._editorOverlay.getBoundingClientRect();
        delta_x *= this.width / width;
        delta_y *= this.height / height;

        // Update the control points we're editing.  If _draggingSegmentPoint is -1, update
        // the whole segment, otherwise update just that control point.
        let segments = this._draggingSegment.segments;
        for(let idx = 0; idx < segments.length; ++idx)
        {
            if(this._draggingSegmentPoint != -1 && this._draggingSegmentPoint != idx)
                continue;

            let segment = segments[idx];
            segment[0] += delta_x;
            segment[1] += delta_y;

            // Clamp the position so it doesn't go offscreen.
            segment[0] = helpers.math.clamp(segment[0], 0, this.width);
            segment[1] = helpers.math.clamp(segment[1], 0, this.height);
        }

        this._draggingSegment.updateSegment();
    }

    addLine()
    {
        let line = new LineEditorSegment({
            container: this._svg,
        });

        this.lines.push(line);
        this._refreshLines();
        return line;
    }

    removeLine(line)
    {
        line.root.remove();

        let idx = this.lines.indexOf(line);
        console.assert(idx != -1);
        
        // Deselect the line if it's selected.
        if(this._selectedLineIdx == idx)
            this._selectedLine = null;
        if(this._addingLine == line)
            this._addingLine = null;

        this.lines.splice(idx, 1);
        this._refreshLines();
    }

    set _selectedLine(line)
    {
        if(line == null)
            this._selectedLineIdx = -1;
        else
            this._selectedLineIdx = this.lines.indexOf(line);

        this._refreshLines();
        this.refresh();
    }

    get _selectedLine()
    {
        if(this._selectedLineIdx == -1)
            return null;
        return this.lines[this._selectedLineIdx];
    }

    _refreshLines()
    {
        for(let idx = 0; idx < this.lines.length; ++idx)
        {
            let line = this.lines[idx];
            if(idx == this._selectedLineIdx)
                line.root.classList.add("selected");
            else
                line.root.classList.remove("selected");
        }
    }

    _setSize(width, height)
    {
        this.width = width;
        this.height = height;
        this._svg.setAttribute("viewBox", `0 0 ${this.width} ${this.height}`);
    }
}

class LineEditorSegment extends Widget
{
    constructor({...options})
    {
        super({
            ...options,
            template: `
                <svg>
                    <g class=inpaint-segment></g>
                </svg>
            `
        });

        this._editPoints = [];
        this._thickness = 15;
        this.segments = [];
        this.segmentLines = [];
        this.segmentContainer = this.querySelector(".inpaint-segment");

        this.createEditPoints();
    }

    get thickness() { return this._thickness; }
    set thickness(value) {
        this._thickness = value;
        this.createEditPoints();
    }

    addPoint({x, y, at=-1})
    {
        let newSegment = [x, y];
        if(at == -1)
            at = this.segments.length;
        this.segments.splice(at, 0, newSegment);
        this.createEditPoints();
        return at;
    }

    removePoint(idx)
    {
        console.assert(idx < this.segments.length);
        this.segments.splice(idx, 1);
        this.createEditPoints();
    }

    createEditPoint()
    {
        let point = document.createElementNS(helpers.other.xmlns, "ellipse");
        point.setAttribute("class", "inpaint-handle");
        point.setAttribute("cx", "100");
        point.setAttribute("cy", "100");
        point.setAttribute("rx", "10");
        point.setAttribute("ry", "10");
        return point;
    }

    createEditPoints()
    {
        for(let line of this.segmentLines)
            line.remove();
        for(let point of this._editPoints)
            point.remove();

        this.segmentLines = [];
        this._editPoints = [];

        if(!this.polyline)
        {
            this.polyline = document.createElementNS(helpers.other.xmlns, "polyline");
            this.polyline.setAttribute("class", "inpaint-line");
            this.segmentContainer.appendChild(this.polyline);
        }

        if(0)
        for(let idx = 0; idx < this.segments.length-1; ++idx)
        {
            // Use a rect for the lines.  It doesn't join as cleanly as a polyline,
            // but it lets us set both the fill and the stroke.
            let line = document.createElementNS(helpers.other.xmlns, "rect");
            line.setAttribute("class", "inpaint-line");
            line.dataset.idx = idx;

            this.segmentContainer.appendChild(line);
            this.segmentLines.push(line);
        }

        for(let idx = 0; idx < this.segments.length; ++idx)
        {
            let point = this.createEditPoint();
            point.dataset.type = "control-point";
            point.dataset.idx = idx;
            this._editPoints.push(point);
            this.segmentContainer.appendChild(point);
        }
        
        this.updateSegment();
    }

    // Update the line and control points when they've moved.
    updateSegment()
    {
        let points = [];
        for(let point of this.segments)
            points.push(`${point[0]},${point[1]}`);

        this.polyline.setAttribute("points", points.join(" "));
        this.polyline.setAttribute("stroke-width", this._thickness);

        if(0)
        for(let idx = 0; idx < this.segments.length-1; ++idx)
        {
            let line = this.segmentLines[idx];
            let p0 = this.segments[idx];
            let p1 = this.segments[idx+1];

            let length = Math.pow(p0[0]-p1[0], 2) + Math.pow(p0[1]-p1[1],2);
            length = Math.sqrt(length);

            let angle = Math.atan2(p1[1]-p0[1], p1[0]-p0[0]) * 180 / Math.PI;
            line.setAttribute("transform", `translate(${p0[0]}, ${p0[1]}) rotate(${angle}, 0, 0) translate(0 ${-this._thickness/2})`);
            line.setAttribute("x", 0);
            line.setAttribute("y", 0);
            line.setAttribute("rx", this._thickness/4);
            line.setAttribute("width", length);
            line.setAttribute("height", this._thickness);
        }

/*        let points = [];
        for(let segment of this.segments)
            points.push(`${segment[0]},${segment[1]}`);

        points = points.join(" ");
        this.line.setAttribute("points", points);
*/
        for(let idx = 0; idx < this.segments.length; ++idx)
        {
            let segment = this.segments[idx];
            let editPoint = this._editPoints[idx];
            editPoint.setAttribute("cx", segment[0]);
            editPoint.setAttribute("cy", segment[1]);

            let radius = this._thickness / 2;
            editPoint.setAttribute("rx", radius);
            editPoint.setAttribute("ry", radius);
        }
    }
}

