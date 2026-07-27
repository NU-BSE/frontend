export const differenceInCalendarDays = (later: Date, earlier: Date): number => {
  const dayMs = 24 * 60 * 60 * 1000;
  const startLater = Date.UTC(
    later.getUTCFullYear(),
    later.getUTCMonth(),
    later.getUTCDate(),
  );
  const startEarlier = Date.UTC(
    earlier.getUTCFullYear(),
    earlier.getUTCMonth(),
    earlier.getUTCDate(),
  );
  return Math.max(0, Math.floor((startLater - startEarlier) / dayMs));
};
