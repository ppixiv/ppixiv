// Scale x from [l1,h2] to [l2,h2].
export function scale(x, l1, h1, l2, h2)
{
    return (x - l1) * (h2 - l2) / (h1 - l1) + l2;
}

// Clamp value between min and max.
export function clamp(value, min, max)
{
    if(min > max)
        [min, max] = [max, min];
    return Math.min(Math.max(value, min), max);
}

// Scale x from [l1,h2] to [l2,h2], clamping to l2,h2.
export function scaleClamp(x, l1, h1, l2, h2)
{
    return clamp(scale(x, l1, h1, l2, h2), l2, h2);
}

// Return i rounded up to interval.
export function roundUpTo(i, interval)
{
    return Math.floor((i+interval-1)/interval) * interval;
}

export function distance({x: x1, y: y1}, {x: x2, y: y2})
{
    let distance = Math.pow(x1-x2, 2) + Math.pow(y1-y2, 2);
    return Math.pow(distance, 0.5);
}
