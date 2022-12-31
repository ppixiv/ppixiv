// A simple bezier curve implementation matching cubic-bezier.

import * as math from 'vview/util/math.js';

export default class Bezier2D
{
    // Return a standard curve by name.
    static curve(name)
    {
        if(this._curves == null)
        {
            // Standard curves:
            this._curves = {
                "ease": new Bezier2D(0.25, 0.1, 0.25, 1.0),
                "linear": new Bezier2D(0.0, 0.0, 1.0, 1.0),
                "ease-in": new Bezier2D(0.42, 0, 1.0, 1.0),
                "ease-out": new Bezier2D(0, 0, 0.58, 1.0),
                "ease-in-out": new Bezier2D(0.42, 0, 0.58, 1.0),
            }
        }

        return this._curves[name];
    }

    constructor(a, b, c, d)
    {
        // Store this first for debugging, so it shows up first in the inspector.
        this.originalData = [a,b,c,d];
        this.X = new Quadratic(0, a, c, 1);
        this.Y = new Quadratic(0, b, d, 1);
    }

    GetXSlope(t)
    {
        return 3*this.X.A*t*t + 2*this.X.B*t + this.X.C;
    }

    evaluate(x)
    {
        // The range to search:
        let x_start = this.X.D;
        let x_end = this.X.A + this.X.B + this.X.C + this.X.D;

        // Search for the curve position of x on the X curve.
        let t = math.scale(x, x_start, x_end, 0, 1);
        for(let i = 0; i < 100; ++i)
        {
            let guess = this.X.evaluate(t);
            let error = x-guess;
            if(Math.abs(error) < 0.0001)
                break;

            // Improve our guess based on the curve slope.
            let slope = this.GetXSlope(t);
            t += error / slope;
        }

        return this.Y.evaluate(t);
    }

    // Find a bezier curve that roughly matches a given velocity.
    //
    // This is used when we're responding to a fling with an animation, and we want the
    // animation (usually a page turn) to have the same velocity as the fling.  The end
    // of the curve is always an ease-out, and the beginning of the curve will ease depending
    // on the velocity.
    //
    // Returns a bezier-curve() string.
    static findCurveForVelocity({
        // The desired velocity (usually in pixels/sec):
        targetVelocity,

        // The distance the animation will be travelling (usually in pixels):
        distance,

        // The duration the animation will be, in milliseconds:
        duration,
    }={})
    {
        // We're searching from (0, 0.5, 0.5, 1), which eases in slowly: // https://cubic-bezier.com/#0,.5,.5,1
        // to (0.5, 0.5, 0.5, 1), which starts immediately: // https://cubic-bezier.com/#.5,0,.5,1
        //
        // This is just searching the angle of the start of the curve which changes continuously from
        // 0 to 0.5, so we can binary search this.  This could probably be calculated directly without
        // searching.
        let min = 0, max = 0.5;
        while(max-min > 0.01)
        {
            let t = (max + min) / 2;
            let curve = new Bezier2D(t, 0.5-t, 0.5, 1);

            // Roughly estimate the velocity at the start of the curve by seeing how far we'd travel in the
            // first 60Hz frame.
            let sampleSeconds = 1/60; // one "frame"
            let segmentDistance = distance * curve.evaluate(sampleSeconds / (duration / 1000)); // distance travelled in sampleSeconds
            let actualDistancePerSecond = segmentDistance / sampleSeconds; // distance travelled in one second at that speed

            // Higher values give slower-starting curves.  Adjust min if we're too fast, otherwise
            // adjust max.
            if(actualDistancePerSecond > targetVelocity)
                min = t;
            else
                max = t;
        }

        let t = (max + min) / 2;
        let curve = new Bezier2D(t, 0.5 - t, 0.45, 1.0);
        let easing = `cubic-bezier(${t}, ${0.5-t}, 0.45, 1)`;
        return { curve, easing, t };
    }
}

class Quadratic
{
    constructor(X1, X2, X3, X4)
    {
        this.D = X1;
        this.C = 3.0 * (X2 - X1);
        this.B = 3.0 * (X3 - X2) - this.C;
        this.A = X4 - X1 - this.C - this.B;
    }

    evaluate(t)
    {
        // optimized (A * t*t*t) + (B * t*t) + (C * t) + D
        return ((this.A*t + this.B)*t + this.C)*t + this.D;
    }
}
