// Get the timezone offset in seconds
export function getOffsetInSeconds(tz, date = new Date()) {
    const utcd = new Date(date.toLocaleString('en-US', { timeZone: 'UTC', hour12: false })),
        tzd = new Date(date.toLocaleString('en-US', { timeZone: tz, hour12: false }));
    return (tzd - utcd) / 1000;
}

// Get the timezone info
export function getTimeZoneInfo(tz) {
    let result = {
        tz: 'UTC',
        gmtOffset: 0,
        dst: 0
    };

    if (!tz)
        return { ...result, defaulted: true };

    try {
        const now = new Date();

        // Get strict offset in seconds
        // "en-GB" is often cleaner for 24h checks than "en-US"
        const formatter = new Intl.DateTimeFormat('en-GB', {
            timeZone: tz,
            timeZoneName: 'short', // Returns "PST", "GMT+1", etc.
            hour12: false
        });

        // Get timezone abbreviation
        const parts = formatter.formatToParts(now),
            abbrev = parts.find(p => p.type === 'timeZoneName')?.value || '';

        // Calculate offset (seconds)
        const currentOffset = getOffsetInSeconds(tz, now);

        // Determine Standard Offset (usually Jan or July) to check for DST
        const jan = getOffsetInSeconds(tz, new Date(now.getFullYear(), 0, 1)),
            jul = getOffsetInSeconds(tz, new Date(now.getFullYear(), 6, 1)),
            stdOffset = Math.min(jan, jul);

        return {
            ...result,
            tz,
            gmtOffset: currentOffset,
            dst: (currentOffset > stdOffset) ? 1 : 0,
            abbrev
        };
    } catch (e) {
        return { ...result, error: "Invalid timezone" };
    }
}