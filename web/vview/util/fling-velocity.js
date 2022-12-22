// FlingVelocity takes input samples from pointer movements, and calculates velocity
// and movement over time to calculate the direction and velocity of touch flings.
export default class FlingVelocity
{
    constructor({ samplePeriod=0.1 }={})
    {
        this.samplePeriod = samplePeriod;
        this.reset();
    }

    addSample( {x=0, y=0}={} )
    {
        this.samples.push({
            delta: { x, y },
            time: Date.now()/1000,
        });

        this._purge();
    }

    // Delete samples older than samplePeriod.
    _purge()
    {
        let deleteBefore = Date.now()/1000 - this.samplePeriod;
        while(this.samples.length && this.samples[0].time < deleteBefore)
            this.samples.shift();
    }

    // Delete all samples.
    reset()
    {
        this.samples = [];
    }

    // A helper to get currentDistance and currentVelocity in a direction: "up", "down", "left" or "right".
    getMovementInDirection(direction)
    {
        let distance = this.currentDistance;
        let velocity = this._getVelocityFromCurrentDistance(distance);
        switch(direction)
        {
        case "up":    return { distance: -distance.y, velocity: -velocity.y };
        case "down":  return { distance: +distance.y, velocity: +velocity.y };
        case "left":  return { distance: -distance.x, velocity: -velocity.x };
        case "right": return { distance: +distance.x, velocity: +velocity.x };
        default:
            throw new Error("Unknown direction:", direction);
        }
    }

    // Get the distance travelled within the sample period.
    get currentDistance()
    {
        this._purge();

        if(this.samples.length == 0)
            return { x: 0, y: 0 };

        let total = [0,0];
        for(let sample of this.samples)
        {
            total[0] += sample.delta.x;
            total[1] += sample.delta.y;
        }

        return { x: total[0], y: total[1] };
    }

    // Get the average velocity.
    get currentVelocity()
    {
        return this._getVelocityFromCurrentDistance(this.currentDistance);
    }

    _getVelocityFromCurrentDistance(currentDistance)
    {
        let { x, y } = currentDistance;

        if(this.samples.length == 0)
            return { x: 0, y: 0 };

        let duration = Date.now()/1000 - this.samples[0].time;
        if( duration < 0.001 )
        {
            // console.error("no sample duration");
            return { x: 0, y: 0 };
        }

        x /= duration;
        y /= duration;
        return { x, y };
    }
}