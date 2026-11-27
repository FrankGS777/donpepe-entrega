"use strict";
const { limaTimestamp, timeFields } = require("./time");
const { describeLocation } = require("./location-description");

// Enrich the authorized API copy only. Readable labels and local timestamp
// companions must not rewrite geometry or historical persisted documents.
function enrichRecordPresentation(view) {
  view.clock.timeZone = "America/Lima";
  view.clock.localNow = limaTimestamp(view.clock.now);
  for (const key of [
    "orders",
    "purchases",
    "returns",
    "missions",
    "receipts",
    "inspections",
    "maintenance",
    "storeStock",
  ])
    for (const row of view[key] || []) {
      for (const field of [
        "createdAt",
        "updatedAt",
        "receivedAt",
        "requestedAt",
        "completedAt",
        "startedAt",
      ])
        if (row[field]) row[`${field}Local`] = limaTimestamp(row[field]);
    }
  view.events?.forEach((row) => {
    if (row.at) Object.assign(row, timeFields(row.at));
  });
  view.hus?.forEach((row) => {
    row.locationLabel = describeLocation(view, row.locationId).label;
  });
  view.missions?.forEach((row) => {
    row.sourceLabel = describeLocation(view, row.sourceId).label;
    row.destinationLabel = describeLocation(
      view,
      row.finalLocationId || row.destinationId,
    ).label;
  });
  view.layout?.locations?.forEach((row) => {
    const description = describeLocation(view, row.id);
    row.description = description.label;
    row.components = description.components;
  });
  return view;
}
module.exports = { enrichRecordPresentation };
