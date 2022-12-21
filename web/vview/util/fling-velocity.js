// This calculates the current velocity from recent motion.
export default class FlingVelocity
{
    constructor({ sample_period=0.1 }={})
    {
        this.sample_period = sample_period;
        this.reset();
    }

    add_sample( {x=0,y=0}={} )
    {
        this.samples.push({
            delta: { x, y },
            time: Date.now()/1000,
        });

        this.purge();
    }

    // Delete samples older than sample_period.
    purge()
    {
        let delete_before = Date.now()/1000 - this.sample_period;
        while(this.samples.length && this.samples[0].time < delete_before)
            this.samples.shift();
    }

    // Delete all samples.
    reset()
    {
        this.samples = [];
    }

    // A helper to get current_distance and current_velocity in a direction: "up", "down", "left" or "right".
    get_movement_in_direction(direction)
    {
        let distance = this.current_distance;
        let velocity = this._get_velocity_from_current_distance(distance);
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
    get current_distance()
    {
        this.purge();

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
    get current_velocity()
    {
        return this._get_velocity_from_current_distance(this.current_distance);
    }

    _get_velocity_from_current_distance(current_distance)
    {
        let { x, y } = current_distance;

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