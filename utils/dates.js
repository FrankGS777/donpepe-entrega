const TIME_ZONE = "America/Lima";

const partsInLima = (value = new Date(), withTime = false) =>
  Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      ...(withTime
        ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }
        : {}),
    })
      .formatToParts(new Date(value))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

const todayInLima = (value = new Date()) => {
  const { year, month, day } = partsInLima(value);
  return `${year}-${month}-${day}`;
};

const dateTimeInLima = (value) => {
  const { year, month, day, hour, minute } = partsInLima(value, true);
  return `${day}/${month}/${year} ${hour}:${minute}`;
};

module.exports = { TIME_ZONE, todayInLima, dateTimeInLima };
